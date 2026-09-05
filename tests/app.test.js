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
function channelPair() {
  const listeners = [new Set(), new Set()];
  return [0, 1].map((index) => ({
    addEventListener(type, listener) {
      if (type === 'message') listeners[index].add(listener);
    },
    postMessage(data) {
      for (const listener of listeners[1 - index]) listener({ data });
    },
    close() {},
  }));
}

async function setup({
  runtime,
  cache,
  factory = new IDBFactory(),
  supported = true,
  checkCompatibility,
  channel,
} = {}) {
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
    cache,
    store,
    document: window.document,
    checkCompatibility:
      checkCompatibility || (async () => ({ supported, reason: 'WebGPU no disponible.' })),
    channel,
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
      channel?.close?.();
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

test('compatibility check failures keep the local history usable', async () => {
  const page = await setup({
    checkCompatibility: async () => {
      throw new Error('Synthetic compatibility failure');
    },
  });
  assert.equal(page.app.state.initialized, true);
  assert.equal(page.app.state.supported, false);
  assert.equal(page.$('#new-chat').disabled, false);
  assert.match(page.$('#notice').textContent, /No se pudo comprobar/);
  assert.equal(await page.app.loadModel(), false);
  page.close();
});

test('syncs saved conversations to another open tab', async () => {
  const factory = new IDBFactory();
  const [firstChannel, secondChannel] = channelPair();
  const runtime = () => ({
    ready: true,
    async *generate() {
      yield { choices: [{ delta: { content: 'Respuesta compartida' } }] };
    },
  });
  const first = await setup({ factory, channel: firstChannel, runtime: runtime() });
  const second = await setup({ factory, channel: secondChannel, runtime: runtime() });
  first.$('#prompt').value = 'Pregunta entre pestañas';
  await first.app.submit();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(second.app.state.conversations.length, 1);
  assert.equal(second.app.state.conversations[0].messages.at(-1).content, 'Respuesta compartida');
  first.close();
  second.close();
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

test('document preview is inert text; accepting it persists before any messages and does not duplicate history', async () => {
  const factory = new IDBFactory();
  const page = await setup({ factory });
  const text = '<img src=x onerror=alert(1)> La garantía dura dos años.';
  await page.app.attachDocument(new File([text], 'garantia.md'));
  assert.equal(page.$('#document-preview').textContent, text);
  assert.equal(page.$('#document-preview img'), null);
  assert.equal((await page.store.list()).length, 0);
  await page.app.acceptDocument();
  assert.equal((await page.store.list())[0].document.text, text);
  assert.equal(page.$('#conversation-options').disabled, false);
  await page.app.loadModel();
  page.$('#prompt').value = '¿Cuánto dura la garantía?';
  await page.app.submit();
  assert.equal(page.app.state.conversations.length, 1);
  page.close();
  const reopened = await setup({ factory });
  assert.equal(reopened.$('#document-card').hidden, false);
  assert.equal(reopened.app.state.current.document.text, text);
  reopened.close();
});

test('document citations open only stored sources and survive reloading', async () => {
  const factory = new IDBFactory();
  const runtime = {
    ready: true,
    async *generate(messages) {
      const request = JSON.parse(messages[1].content);
      assert.equal(request.question, '¿Cuánto dura la garantía?');
      assert.ok(request.fragments[0].text.includes('dos años'));
      yield { choices: [{ delta: { content: 'Dura dos años [1]. Cita inventada [999].' } }] };
    },
  };
  const page = await setup({ factory, runtime });
  await page.app.attachDocument(new File(['La garantía dura dos años.'], 'garantia.txt'));
  await page.app.acceptDocument();
  page.$('#prompt').value = '¿Cuánto dura la garantía?';
  await page.app.submit();
  assert.ok(page.$('.citation-button[data-source="1"]'));
  assert.equal(page.$('[data-source="999"]'), null);
  assert.equal(page.$('.unverified-citation').textContent, '[999]');
  page.$('.citation-button').click();
  assert.equal(page.$('#source-text').textContent, 'La garantía dura dos años.');
  page.$('#source-dialog').close();
  assert.equal(page.$('#source-text').textContent, '');
  page.close();
  const reopened = await setup({ factory });
  reopened.$('.citation-button').click();
  assert.equal(reopened.$('#source-text').textContent, 'La garantía dura dos años.');
  reopened.close();
});

test('questions without document matches skip inference and can switch to general chat', async () => {
  let calls = 0;
  const runtime = {
    ready: true,
    async *generate() {
      calls++;
      yield { choices: [{ delta: { content: 'Chat general' } }] };
    },
  };
  const page = await setup({ runtime });
  await page.app.attachDocument(new File(['Las ballenas viven en el océano.'], 'naturaleza.txt'));
  await page.app.acceptDocument();
  page.$('#prompt').value = '¿Cuánto cuesta el automóvil?';
  await page.app.submit();
  assert.equal(calls, 0);
  assert.match(page.app.state.current.messages.at(-1).content, /No encontré fragmentos/);
  page.$('#use-document').checked = false;
  page.$('#use-document').dispatchEvent(new page.window.Event('change'));
  page.$('#prompt').value = '¿Cuánto cuesta el automóvil?';
  await page.app.submit();
  assert.equal(calls, 1);
  page.close();
});

test('removing a document requires confirmation and clears source snapshots from storage', async () => {
  const page = await setup();
  await page.app.loadModel();
  await page.app.attachDocument(new File(['La garantía dura dos años.'], 'garantia.txt'));
  await page.app.acceptDocument();
  page.$('#prompt').value = 'garantía';
  await page.app.submit();
  assert.ok(page.app.state.current.messages.at(-1).sources.length);
  const cancelled = page.app.removeDocument();
  page.$('#confirm-dialog').close('cancel');
  await cancelled;
  assert.ok(page.app.state.current.document);
  const removing = page.app.removeDocument();
  page.$('#confirm-dialog').close('confirm');
  await removing;
  const stored = (await page.store.list())[0];
  assert.equal(stored.document, undefined);
  assert.ok(stored.messages.every((message) => !message.sources));
  assert.equal(page.$('#document-card').hidden, true);
  assert.equal(page.$('#attach-document').disabled, false);
  page.close();
});

test('cancelling preview leaves no document, and oversized questions preserve the composer draft', async () => {
  const page = await setup();
  await page.app.attachDocument(new File(['La garantía dura dos años.'], 'garantia.txt'));
  page.$('#document-dialog').close();
  await page.app.acceptDocument();
  assert.equal(page.app.state.current.document, undefined);
  await page.app.attachDocument(new File(['La garantía dura dos años.'], 'garantia.txt'));
  await page.app.acceptDocument();
  await page.app.loadModel();
  const text = 'garantía ' + 'x'.repeat(2500);
  page.$('#prompt').value = text;
  await page.app.submit();
  assert.match(page.$('#notice').textContent, /Acorta la pregunta/);
  assert.equal(page.$('#prompt').value, text);
  assert.equal(page.app.state.current.messages.length, 0);
  page.close();
});

test('model changes unload GPU, preserve messages and forward the selected id to loading', async () => {
  const page = await setup({
    cache: {
      async status() {
        return false;
      },
    },
  });
  await page.app.loadModel();
  page.$('#prompt').value = 'Hola';
  await page.app.submit();
  const original = structuredClone(page.app.state.current.messages);
  page.$('#model-select').value = 'Llama-3.2-3B-Instruct-q4f32_1-MLC';
  page.$('#model-select').dispatchEvent(new page.window.Event('change'));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(page.runtime.ready, false);
  assert.deepEqual(page.app.state.current.messages, original);
  let model;
  page.runtime.load = async (progress, id) => {
    model = id;
    page.runtime.ready = true;
  };
  await page.app.loadModel();
  assert.equal(model, 'Llama-3.2-3B-Instruct-q4f32_1-MLC');
  page.$('#prompt').value = 'Otra pregunta';
  await page.app.submit();
  assert.equal(page.app.state.current.messages.at(-1).model, model);
  assert.notEqual(page.app.state.current.messages[1].model, model);
  page.close();
});

test('cache deletion is confirmed, targeted and preserves stored conversations', async () => {
  const removed = [];
  const page = await setup({
    cache: {
      async status() {
        return true;
      },
      async remove(id) {
        removed.push(id);
      },
    },
  });
  await page.app.loadModel();
  page.$('#prompt').value = 'Conservar este mensaje';
  await page.app.submit();
  const before = await page.store.list();
  const cancelled = page.app.deleteModelCache();
  page.$('#confirm-dialog').close('cancel');
  await cancelled;
  assert.equal(removed.length, 0);
  const deletion = page.app.deleteModelCache();
  page.$('#confirm-dialog').close('confirm');
  await deletion;
  assert.deepEqual(removed, [page.app.state.selectedModel]);
  assert.equal(page.runtime.ready, false);
  assert.deepEqual(await page.store.list(), before);
  assert.match(page.$('#cache-status').textContent, /eliminada/);
  page.close();
});

test('PDF page selection persists and citations display the correct page after reload', async () => {
  const { documentFromPages } = await import('../src/documents.js');
  const factory = new IDBFactory();
  const page = await setup({ factory });
  page.app.state.current.document = documentFromPages({ name: 'proyecto.pdf', size: 100 }, [
    { page: 1, text: 'Precio 120 euros' },
    { page: 2, text: 'Entrega septiembre' },
  ]);
  page.app.state.current.useDocument = true;
  page.app.state.conversations.push(page.app.state.current);
  page.app.selectConversation(page.app.state.current);
  page.$('#page-scope').value = '2';
  page.$('#page-scope').dispatchEvent(new page.window.Event('change'));
  await page.app.loadModel();
  page.$('#prompt').value = 'Resume';
  await page.app.submit();
  assert.ok(page.app.state.current.messages.at(-1).sources.every((source) => source.page === 2));
  page.close();
  const restored = await setup({ factory });
  assert.equal(restored.$('#page-scope').value, '2');
  restored.$('[data-source]').click();
  assert.match(restored.$('#source-title').textContent, /Página 2/);
  assert.match(restored.$('#source-text').textContent, /septiembre/);
  restored.close();
});

test('cache failures release controls and cache maintenance blocks generation', async () => {
  let finish;
  const page = await setup({
    cache: {
      status: () =>
        new Promise((_, reject) => {
          finish = reject;
        }),
    },
  });
  await page.app.loadModel();
  page.$('#prompt').value = 'Hola';
  const refreshing = page.app.refreshCache();
  await page.app.submit();
  assert.equal(page.app.state.current.messages.length, 0);
  assert.equal(page.$('#model-select').disabled, true);
  finish(new Error('Storage unavailable'));
  await refreshing;
  assert.equal(page.$('#model-select').disabled, false);
  assert.match(page.$('#cache-status').textContent, /No se pudo/);
  page.close();
});

test('focus mode expands the workspace and persists its preference', async () => {
  const page = await setup();
  assert.equal(page.app.state.focusMode, false);
  page.$('#focus-mode').click();
  assert.equal(page.app.state.focusMode, true);
  assert.equal(page.$('.app').classList.contains('focus-mode'), true);
  assert.equal(page.$('#focus-mode').getAttribute('aria-pressed'), 'true');
  assert.equal(page.window.localStorage.getItem('semilla-focus-mode'), 'true');
  page.$('#focus-mode').click();
  assert.equal(page.app.state.focusMode, false);
  assert.equal(page.window.localStorage.getItem('semilla-focus-mode'), 'false');
  page.close();
});
