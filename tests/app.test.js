import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { IDBFactory } from 'fake-indexeddb';
import createDOMPurify from 'dompurify';
import { createApp } from '../src/app.js';
import { ConversationStore } from '../src/storage.js';
import { renderMarkdown } from '../src/markdown.js';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
async function setup({ runtime, factory = new IDBFactory(), supported = true } = {}) {
  const dom = new JSDOM(html, { url: 'http://localhost:5173' });
  const { window } = dom;
  window.matchMedia = () => ({ matches: false, addEventListener() {} });
  window.HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  window.HTMLDialogElement.prototype.close = function (value) {
    this.returnValue = value || '';
    this.removeAttribute('open');
    this.dispatchEvent(new window.Event('close'));
  };
  const store = new ConversationStore(factory);
  const fake = runtime || {
    ready: false,
    async load(progress) {
      progress({ progress: 1 });
      this.ready = true;
    },
    async *generate() {
      yield { choices: [{ delta: { content: '**Respuesta** de prueba' } }] };
    },
    stop() {},
    dispose() {
      this.ready = false;
    },
  };
  const app = createApp({
    runtime: fake,
    store,
    document: window.document,
    checkCompatibility: async () => ({ supported, reason: 'WebGPU no disponible.' }),
    render: (text) => renderMarkdown(text, createDOMPurify(window)),
  });
  await app.start();
  return {
    app,
    window,
    store,
    runtime: fake,
    $: (selector) => window.document.querySelector(selector),
    close() {
      store.close();
      window.close();
    },
  };
}

test('loads, streams sanitized output, persists history, renames and searches it', async () => {
  const factory = new IDBFactory();
  const page = await setup({ factory });
  assert.equal(page.$('#send').disabled, true);
  assert.equal(page.runtime.ready, false);
  await page.app.loadModel();
  page.$('#prompt').value = '  ';
  await page.app.submit();
  assert.equal(page.app.state.current.messages.length, 0);
  page.$('#prompt').value = 'Hola, ayúdame a escribir';
  await page.app.submit();
  assert.equal(page.app.state.current.messages.length, 2);
  assert.equal(page.$('.message.assistant strong').textContent, 'Respuesta');
  assert.equal(page.$('#model-card').hidden, true);
  page.$('#conversation-name').value = 'Mi borrador';
  page.$('#rename-form').dispatchEvent(new page.window.Event('submit', { cancelable: true }));
  await page.store.queue;
  assert.equal(page.$('#chat-title').textContent, 'Mi borrador');
  page.close();
  const reopened = await setup({ factory });
  assert.equal(reopened.$('#chat-title').textContent, 'Mi borrador');
  assert.equal(reopened.app.state.current.messages[1].content, '**Respuesta** de prueba');
  reopened.$('#search').value = 'inexistente';
  reopened.$('#search').dispatchEvent(new reopened.window.Event('input'));
  assert.equal(reopened.$('.history-item'), null);
  reopened.$('#search').value = 'ayúdame';
  reopened.$('#search').dispatchEvent(new reopened.window.Event('input'));
  assert.ok(reopened.$('.history-item'));
  reopened.close();
});

test('generation failure leaves a retryable answer and retry does not duplicate the user', async () => {
  let fail = true;
  const runtime = {
    ready: true,
    async *generate() {
      if (fail) throw new Error('Synthetic inference failure');
      yield { choices: [{ delta: { content: 'Recuperado' } }] };
    },
    stop() {},
  };
  const page = await setup({ runtime });
  page.$('#prompt').value = 'Mi pregunta';
  await page.app.submit();
  assert.equal(page.app.state.busy, false);
  assert.equal(page.app.state.current.messages[1].status, 'error');
  assert.ok(page.$('[data-retry]'));
  fail = false;
  await page.app.retry(page.app.state.current.messages[1].id);
  assert.equal(page.app.state.current.messages.length, 2);
  assert.equal(page.app.state.current.messages[1].content, 'Recuperado');
  page.close();
});

test('stop preserves partial text and blocks switching conversations during inference', async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const runtime = {
    ready: true,
    async *generate() {
      yield { choices: [{ delta: { content: 'Primera parte' } }] };
      await gate;
    },
    stop() {
      release();
    },
  };
  const page = await setup({ runtime });
  page.$('#prompt').value = 'Explica';
  const pending = page.app.submit();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(page.$('#new-chat').disabled, true);
  assert.equal(page.$('#stop').hidden, false);
  page.$('#stop').click();
  await pending;
  assert.equal(page.app.state.current.messages[1].status, 'interrupted');
  assert.equal(page.app.state.current.messages[1].content, 'Primera parte');
  assert.equal(page.$('#new-chat').disabled, false);
  page.close();
});

test('unsupported browser keeps local history controls available and avoids loading', async () => {
  const page = await setup({ supported: false });
  assert.equal(page.$('#load-model').disabled, true);
  assert.equal(page.$('#new-chat').disabled, false);
  assert.equal(page.$('#status-text').textContent, 'No compatible');
  assert.equal(await page.app.loadModel(), false);
  page.close();
});

test('delete requires confirmation and removes persisted conversation', async () => {
  const page = await setup();
  await page.app.loadModel();
  page.$('#prompt').value = 'Una conversación';
  await page.app.submit();
  const cancel = page.app.remove();
  page.$('#confirm-dialog').close('cancel');
  await cancel;
  assert.equal((await page.store.list()).length, 1);
  const remove = page.app.remove();
  page.$('#confirm-dialog').close('confirm');
  await remove;
  assert.equal((await page.store.list()).length, 0);
  assert.equal(page.$('#welcome').hidden, false);
  page.close();
});

test('failed model load can be retried, and ready is set only after load resolves', async () => {
  let fail = true;
  const runtime = {
    ready: false,
    async load(progress) {
      progress({ progress: 1 });
      if (fail) throw new Error('Synthetic download failure');
      this.ready = true;
    },
  };
  const page = await setup({ runtime });
  assert.equal(await page.app.loadModel(), false);
  assert.equal(page.app.state.loading, false);
  assert.equal(page.$('#send').disabled, true);
  assert.equal(page.$('#model-title').textContent, 'No se pudo cargar el modelo');
  fail = false;
  assert.equal(await page.app.loadModel(), true);
  assert.equal(page.$('#model-card').hidden, true);
  page.close();
});

test('storage quota failure preserves the in-memory answer and displays an export warning', async () => {
  const page = await setup();
  await page.app.loadModel();
  page.store.save = async () => {
    throw new Error('Synthetic quota failure');
  };
  page.$('#prompt').value = 'No pierdas mi texto';
  await page.app.submit();
  assert.equal(page.app.state.storageError, true);
  assert.match(page.$('#notice').textContent, /exporta una copia/);
  assert.equal(page.app.state.current.messages[1].status, 'complete');
  assert.equal(page.$('#conversation-options').disabled, false);
  page.close();
});

test('length-limited answer is labeled and remains context for a request to continue', async () => {
  const seen = [];
  const runtime = {
    ready: true,
    async *generate(messages) {
      seen.push(messages);
      yield { choices: [{ delta: { content: 'Primera explicación' }, finish_reason: 'length' }] };
    },
  };
  const page = await setup({ runtime });
  page.$('#prompt').value = 'Explica en detalle';
  await page.app.submit();
  assert.match(page.$('.message-state').textContent, /Límite/);
  page.$('#prompt').value = 'Continúa';
  await page.app.submit();
  assert.ok(
    seen[1].some(
      (message) => message.role === 'assistant' && message.content === 'Primera explicación',
    ),
  );
  page.close();
});

test('copy and both exports contain the real conversation', async (t) => {
  const page = await setup();
  let copied;
  Object.defineProperty(page.window.navigator, 'clipboard', {
    value: {
      async writeText(text) {
        copied = text;
      },
    },
  });
  const downloads = [];
  const blobs = [];
  t.mock.method(URL, 'createObjectURL', (blob) => {
    blobs.push(blob);
    return 'blob:test';
  });
  page.window.HTMLAnchorElement.prototype.click = function () {
    downloads.push(this.download);
  };
  await page.app.loadModel();
  page.$('#prompt').value = 'Mi borrador';
  await page.app.submit();
  page.$('[data-copy]').click();
  await Promise.resolve();
  assert.equal(copied, '**Respuesta** de prueba');
  page.$('#export-md').click();
  page.$('#export-json').click();
  assert.deepEqual(downloads, ['Mi borrador.md', 'Mi borrador.json']);
  assert.match(await blobs[0].text(), /\*\*Respuesta\*\* de prueba/);
  const exported = JSON.parse(await blobs[1].text());
  assert.equal(exported.schemaVersion, 1);
  assert.equal(exported.messages[0].content, 'Mi borrador');
  page.close();
});

test('cancelling a model download restores the load button without enabling send', async () => {
  let rejectLoad;
  const runtime = {
    ready: false,
    load() {
      return new Promise((_, reject) => {
        rejectLoad = reject;
      });
    },
    dispose() {
      rejectLoad(new DOMException('Cancelado', 'AbortError'));
    },
  };
  const page = await setup({ runtime });
  const loading = page.app.loadModel();
  assert.equal(page.$('#load-model').textContent, 'Cancelar');
  page.$('#load-model').click();
  assert.equal(await loading, false);
  assert.equal(page.app.state.loading, false);
  assert.equal(page.$('#model-title').textContent, 'Carga cancelada');
  assert.equal(page.$('#load-model').disabled, false);
  assert.equal(page.$('#send').disabled, true);
  page.close();
});
