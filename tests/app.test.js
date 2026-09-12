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

async function settleKnowledge(page) {
  for (let i = 0; i < 200 && page.app.state.attaching; i++)
    await new Promise((resolve) => setImmediate(resolve));
  assert.equal(page.app.state.attaching, false, 'knowledge operation completed');
}

test('backup preview requires confirmation, safely restores entries and exports all projects', async (t) => {
  const { exportKnowledgeBackup, parseKnowledgeBackup } =
    await import('../src/knowledge-backup.js');
  const { knowledgeNote } = await import('../src/knowledge.js');
  const page = await setup({ supported: false });
  const entries = [
    knowledgeNote({
      title: '<img src=x onerror=alert(1)>',
      text: 'Instalación con pnpm',
      project: 'General',
    }),
    knowledgeNote({ title: 'Otra nota', text: 'Datos de otro proyecto', project: 'Otro' }),
  ];
  const json = exportKnowledgeBackup(entries);
  const file = {
    name: 'copia.json',
    size: new TextEncoder().encode(json).length,
    async arrayBuffer() {
      return new TextEncoder().encode(json).buffer;
    },
  };
  page.$('#open-knowledge').click();
  await settleKnowledge(page);
  Object.defineProperty(page.$('#knowledge-backup-file'), 'files', { value: [file] });
  const preview = async () => {
    page.$('#knowledge-backup-file').dispatchEvent(new page.window.Event('change'));
    await settleKnowledge(page);
  };
  await preview();
  assert.equal(page.$('#import-knowledge-dialog').open, true);
  assert.equal(page.$('#import-knowledge-preview img'), null);
  assert.deepEqual(await page.store.listKnowledge(), []);
  page.$('#import-knowledge-dialog').close();
  assert.deepEqual(await page.store.listKnowledge(), []);
  await preview();
  page.$('#confirm-knowledge-import').click();
  await settleKnowledge(page);
  assert.equal(page.$('#import-knowledge-dialog').open, false);
  assert.equal((await page.store.listKnowledge()).length, 2);
  page.$('#knowledge-search').value = 'instalacion';
  page.$('#knowledge-search').dispatchEvent(new page.window.Event('input'));
  assert.equal(page.$('#knowledge-count').textContent, '1 de 1 entradas');
  page.$('#knowledge-kind').value = 'memory';
  page.$('#knowledge-kind').dispatchEvent(new page.window.Event('change'));
  assert.match(page.$('#knowledge-list').textContent, /No hay coincidencias/);
  let blob;
  t.mock.method(URL, 'createObjectURL', (value) => {
    blob = value;
    return 'blob:test';
  });
  page.window.HTMLAnchorElement.prototype.click = function () {
    assert.equal(this.download, 'semilla-biblioteca.json');
  };
  page.$('#export-knowledge').click();
  await settleKnowledge(page);
  assert.equal(parseKnowledgeBackup(await blob.text()).length, 2);
  await preview();
  page.$('#confirm-knowledge-import').click();
  await settleKnowledge(page);
  assert.match(page.$('#knowledge-status').textContent, /0 entradas importadas; 2 duplicadas/);
  page.close();
});

test('failed import reports the error inside its preview and retains the pending backup', async () => {
  const { exportKnowledgeBackup } = await import('../src/knowledge-backup.js');
  const { knowledgeNote } = await import('../src/knowledge.js');
  const page = await setup({ supported: false });
  const json = exportKnowledgeBackup([knowledgeNote({ title: 'Nota', text: 'Texto' })]);
  page.$('#open-knowledge').click();
  await settleKnowledge(page);
  Object.defineProperty(page.$('#knowledge-backup-file'), 'files', {
    value: [
      {
        name: 'copia.json',
        size: json.length,
        async arrayBuffer() {
          return new TextEncoder().encode(json).buffer;
        },
      },
    ],
  });
  page.$('#knowledge-backup-file').dispatchEvent(new page.window.Event('change'));
  await settleKnowledge(page);
  const original = page.store.importKnowledge.bind(page.store);
  page.store.importKnowledge = async () => {
    throw new Error('Sin espacio');
  };
  page.$('#confirm-knowledge-import').click();
  await settleKnowledge(page);
  assert.equal(page.$('#import-knowledge-dialog').open, true);
  assert.match(page.$('#import-knowledge-status').textContent, /Sin espacio/);
  assert.equal(page.$('#confirm-knowledge-import').disabled, false);
  assert.equal((await page.store.listKnowledge()).length, 0);
  page.store.importKnowledge = original;
  page.$('#confirm-knowledge-import').click();
  await settleKnowledge(page);
  assert.equal((await page.store.listKnowledge()).length, 1);
  page.close();
});

test('remembers a reviewed chat message and retrieves it with citations in a new chat', async () => {
  const calls = [];
  const page = await setup({
    runtime: {
      ready: true,
      async *generate(messages) {
        calls.push(structuredClone(messages));
        yield { choices: [{ delta: { content: 'Utiliza pnpm [1].' } }] };
      },
    },
  });
  page.$('#prompt').value = 'Este proyecto utiliza pnpm';
  await page.app.submit();
  const originalId = page.app.state.current.id;
  page.$('[data-remember]').click();
  await settleKnowledge(page);
  assert.equal((await page.store.listKnowledge()).length, 0);
  page.$('#knowledge-title').value = 'Herramientas';
  page.$('#knowledge-project').value = 'Web';
  page.$('#knowledge-form').dispatchEvent(new page.window.Event('submit', { cancelable: true }));
  await settleKnowledge(page);
  const memory = (await page.store.listKnowledge())[0];
  assert.equal(memory.origin.conversationId, originalId);
  page.$('#knowledge-dialog').close();
  page.$('#new-chat').click();
  page.$('#chat-project').value = 'Web';
  page.$('#use-knowledge').checked = true;
  page.$('#use-knowledge').dispatchEvent(new page.window.Event('change'));
  page.$('#prompt').value = '¿Qué utiliza el proyecto, pnpm?';
  await page.app.submit();
  assert.match(JSON.stringify(calls.at(-1)), /Este proyecto utiliza pnpm/);
  assert.equal(page.app.state.current.messages.at(-1).sources[0].knowledgeId, memory.id);
  page.$('[data-source]').click();
  assert.match(page.$('#source-detail').textContent, /Recuerdo de:/);
  page.$('#source-dialog').close();
  await page.store.deleteKnowledge(memory.id);
  const count = calls.length;
  await page.app.retry(page.app.state.current.messages.at(-1).id);
  assert.equal(calls.length, count);
  assert.match(page.app.state.current.messages.at(-1).content, /No encontré información/);
  assert.equal(page.app.state.current.messages.at(-1).sources.length, 0);
  page.close();
});

test('library previews files, preserves failed edits and confirms forgetting', async () => {
  const page = await setup({ supported: false });
  page.$('#open-knowledge').click();
  await settleKnowledge(page);
  const file = {
    name: 'notas.txt',
    size: 20,
    async arrayBuffer() {
      return new TextEncoder().encode('pnpm para el proyecto').buffer;
    },
  };
  Object.defineProperty(page.$('#knowledge-file'), 'files', { configurable: true, value: [file] });
  page.$('#knowledge-file').dispatchEvent(new page.window.Event('change'));
  await settleKnowledge(page);
  assert.equal((await page.store.listKnowledge()).length, 0);
  assert.equal(page.$('#knowledge-text').readOnly, true);
  page.$('#knowledge-form').dispatchEvent(new page.window.Event('submit', { cancelable: true }));
  await settleKnowledge(page);
  assert.equal((await page.store.listKnowledge())[0].kind, 'document');
  page.$('#knowledge-list [aria-label^="Olvidar"]').click();
  page.$('#forget-dialog').close('cancel');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await page.store.listKnowledge()).length, 1);
  page.$('#knowledge-list [aria-label^="Olvidar"]').click();
  page.$('#forget-dialog').close('confirm');
  await new Promise((resolve) => setImmediate(resolve));
  await settleKnowledge(page);
  assert.equal((await page.store.listKnowledge()).length, 0);
  page.$('#knowledge-title').value = 'Nota';
  page.$('#knowledge-text').value = 'Contenido pendiente';
  page.store.saveKnowledge = async () => {
    throw new Error('Sin espacio');
  };
  page.$('#knowledge-form').dispatchEvent(new page.window.Event('submit', { cancelable: true }));
  await settleKnowledge(page);
  assert.equal(page.$('#knowledge-text').value, 'Contenido pendiente');
  assert.match(page.$('#knowledge-status').textContent, /Sin espacio/);
  assert.equal(page.$('#knowledge-form').inert, false);
  page.close();
});

test('knowledge read failures preserve the draft and release controls without generating', async () => {
  const page = await setup();
  await page.app.loadModel();
  page.app.state.current.useKnowledge = true;
  page.store.listKnowledge = async () => {
    throw new Error('Lectura no disponible');
  };
  page.$('#prompt').value = 'Mi pregunta';
  await page.app.submit();
  assert.equal(page.$('#prompt').value, 'Mi pregunta');
  assert.equal(page.app.state.current.messages.length, 0);
  assert.equal(page.app.state.attaching, false);
  assert.match(page.$('#notice').textContent, /Lectura no disponible/);
  page.close();
});

test('suggestions enter the draft immediately and survive switching conversations', async () => {
  const page = await setup();
  const original = page.app.state.current;
  page.$('[data-prompt]').click();
  const text = page.$('#prompt').value;
  assert.equal(page.app.state.drafts.get(original.id), text);
  page.$('#new-chat').click();
  page.app.selectConversation(original);
  assert.equal(page.$('#prompt').value, text);
  page.close();
});

test('document preferences advance the version and synchronize between tabs', async () => {
  const factory = new IDBFactory();
  const [firstChannel, secondChannel] = channelPair();
  const first = await setup({ factory, channel: firstChannel });
  const { documentFromPages } = await import('../src/documents.js');
  const conversation = first.app.state.current;
  conversation.document = documentFromPages({ name: 'demo.pdf', size: 100 }, [
    { page: 1, text: 'Primera página' },
    { page: 2, text: 'Segunda página' },
  ]);
  first.app.state.conversations.push(conversation);
  first.app.selectConversation(conversation);
  await first.app.save();
  const second = await setup({ factory, channel: secondChannel });
  for (const [selector, property, value] of [
    ['#page-scope', 'documentPage', 2],
    ['#use-document', 'useDocument', false],
  ]) {
    const previous = conversation.updatedAt;
    const updated = new Promise((resolve) => {
      const get = second.store.get.bind(second.store);
      second.store.get = async (id) => {
        const result = await get(id);
        second.store.get = get;
        resolve();
        return result;
      };
    });
    if (selector === '#page-scope') first.$(selector).value = String(value);
    else first.$(selector).checked = value;
    first.$(selector).dispatchEvent(new first.window.Event('change'));
    await updated;
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(conversation.updatedAt > previous);
    assert.equal(second.app.state.current[property], value);
    assert.equal((await first.store.get(conversation.id))[property], value);
  }
  first.app.state.attaching = true;
  first.$('#search').dispatchEvent(new first.window.Event('input'));
  assert.equal(first.$('.history-item').disabled, true);
  first.close();
  second.close();
});
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

test('duplicates from options without loading AI and preserves the original across reload', async () => {
  const factory = new IDBFactory();
  const page = await setup({ factory, supported: false });
  await page.app.attachDocument({
    name: 'notas.txt',
    size: 10,
    async arrayBuffer() {
      return new TextEncoder().encode('Mis notas.').buffer;
    },
  });
  await page.app.acceptDocument();
  const original = structuredClone(page.app.state.current);
  page.$('#prompt').value = 'Borrador original';
  page.$('#conversation-options').click();
  page.$('#duplicate-chat').click();
  await page.store.queue;
  await new Promise((resolve) => setImmediate(resolve));
  const copy = page.app.state.current;
  assert.notEqual(copy.id, original.id);
  assert.equal(copy.title, 'notas.txt (copia)');
  assert.equal(page.$('#prompt').value, '');
  assert.equal(page.$('#manage-dialog').open, false);
  assert.equal(page.runtime.ready, false);
  assert.deepEqual(await page.store.get(original.id), original);
  assert.equal((await page.store.list()).length, 2);
  page.app.selectConversation(page.app.state.conversations.find((c) => c.id === original.id));
  assert.equal(page.$('#prompt').value, 'Borrador original');
  page.close();
  const reopened = await setup({ factory, supported: false });
  const savedCopy = await reopened.store.get(copy.id);
  assert.equal(savedCopy.document.text, original.document.text);
  assert.notEqual(savedCopy.document.id, original.document.id);
  await reopened.store.delete(copy.id);
  assert.deepEqual(await reopened.store.get(original.id), original);
  reopened.close();
});

test('failed duplication preserves history and can be retried; concurrent copies are blocked', async () => {
  const page = await setup();
  await page.app.loadModel();
  page.$('#prompt').value = 'Una pregunta';
  await page.app.submit();
  const original = page.app.state.current;
  const save = page.store.save.bind(page.store);
  for (const rejected of [true, false]) {
    page.store.save = async () => {
      if (rejected) throw new Error('Synthetic quota failure');
      return false;
    };
    await page.app.duplicate();
    assert.equal(page.app.state.current, original);
    assert.equal(page.app.state.conversations.length, 1);
    assert.equal(page.app.state.attaching, false);
    assert.match(page.$('#notice').textContent, /No se pudo guardar la copia/);
  }
  page.store.save = save;
  const pending = page.app.duplicate();
  assert.equal(page.$('#duplicate-chat').disabled, true);
  assert.equal(await page.app.duplicate(), undefined);
  await pending;
  assert.equal((await page.store.list()).length, 2);
  page.app.state.busy = true;
  assert.equal(await page.app.duplicate(), undefined);
  page.app.state.busy = false;
  page.close();
});

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

async function previewConversation(page, json) {
  Object.defineProperty(page.$('#conversation-backup-file'), 'files', {
    configurable: true,
    value: [
      {
        name: 'conversacion.json',
        size: new TextEncoder().encode(json).length,
        async arrayBuffer() {
          return new TextEncoder().encode(json).buffer;
        },
      },
    ],
  });
  page.$('#conversation-backup-file').dispatchEvent(new page.window.Event('change'));
  await settleKnowledge(page);
}

async function settleVersion(page) {
  for (let i = 0; i < 500 && (page.app.state.attaching || page.app.state.busy); i++)
    await new Promise((resolve) => setImmediate(resolve));
  assert.equal(page.app.state.attaching || page.app.state.busy, false);
}

test('editing an earlier question generates a saved version and preserves original turns and draft', async () => {
  const factory = new IDBFactory();
  const contexts = [];
  const page = await setup({
    factory,
    runtime: {
      ready: true,
      async *generate(messages) {
        contexts.push(structuredClone(messages));
        yield { choices: [{ delta: { content: 'Respuesta de prueba' } }] };
      },
    },
  });
  for (const question of ['Primera pregunta', 'Segunda pregunta', 'Tercera pregunta']) {
    page.$('#prompt').value = question;
    await page.app.submit();
  }
  const original = structuredClone(page.app.state.current);
  page.$('#prompt').value = 'Mi borrador';
  page.$('#prompt').dispatchEvent(new page.window.Event('input'));
  page.$(`[data-edit="${original.messages[2].id}"]`).click();
  assert.equal(page.$('#edit-dialog').open, true);
  assert.equal(page.$('#edit-prompt').value, 'Segunda pregunta');
  page.$('#edit-prompt').value = 'Pregunta corregida';
  page.$('#edit-form').dispatchEvent(new page.window.Event('submit', { cancelable: true }));
  await settleVersion(page);
  const version = structuredClone(page.app.state.current);
  assert.notEqual(version.id, original.id);
  assert.equal(version.messages.length, 4);
  assert.deepEqual(
    contexts
      .at(-1)
      .slice(1)
      .map((message) => message.content),
    ['Primera pregunta', 'Respuesta de prueba', 'Pregunta corregida'],
  );
  assert.equal(version.messages.at(-1).status, 'complete');
  assert.deepEqual(await page.store.get(original.id), original);
  assert.match(page.$('#branch-description').textContent, /Pregunta 2.*Chat general/);
  page.$('#open-parent').click();
  assert.equal(page.app.state.current.id, original.id);
  assert.equal(page.$('#prompt').value, 'Mi borrador');
  page.close();
  const reopened = await setup({ factory, supported: false });
  reopened.app.selectConversation(
    reopened.app.state.conversations.find((entry) => entry.id === version.id),
  );
  assert.equal(reopened.$('#open-parent').hidden, false);
  await reopened.store.delete(original.id);
  assert.deepEqual((await reopened.store.get(version.id)).messages, version.messages);
  reopened.close();
});

test('cancelled, invalid and failed edits keep the original; a saved version works without a loaded model', async () => {
  const page = await setup({ supported: false });
  const { newMessage } = await import('../src/conversations.js');
  page.app.state.current.messages.push(
    newMessage('user', 'Pregunta inicial'),
    newMessage('assistant', 'Respuesta'),
  );
  page.app.state.conversations.push(page.app.state.current);
  await page.app.save();
  page.app.selectConversation(page.app.state.current);
  const original = structuredClone(page.app.state.current);
  page.$('[data-edit]').click();
  page.$('#cancel-edit').click();
  assert.equal(page.$('#edit-dialog').open, false);
  assert.equal(page.app.state.conversations.length, 1);
  page.$('[data-edit]').click();
  page.$('#edit-prompt').value = '😀'.repeat(800);
  page.$('#edit-form').dispatchEvent(new page.window.Event('submit', { cancelable: true }));
  assert.match(page.$('#edit-status').textContent, /demasiado largo/);
  const save = page.store.save.bind(page.store);
  page.$('#edit-prompt').value = 'Pregunta corregida';
  for (const failure of [false, new Error('Sin espacio')]) {
    page.store.save = async () => {
      if (failure instanceof Error) throw failure;
      return failure;
    };
    page.$('#edit-form').dispatchEvent(new page.window.Event('submit', { cancelable: true }));
    await settleVersion(page);
    assert.equal(page.$('#edit-dialog').open, true);
    assert.equal(page.$('#edit-prompt').value, 'Pregunta corregida');
    assert.equal(page.app.state.conversations.length, 1);
    assert.match(page.$('#edit-status').textContent, /No se pudo guardar/);
  }
  page.store.save = save;
  page.$('#edit-form').dispatchEvent(new page.window.Event('submit', { cancelable: true }));
  await settleVersion(page);
  assert.equal(page.$('#edit-dialog').open, false);
  assert.equal(page.app.state.current.messages[0].content, 'Pregunta corregida');
  assert.equal(page.app.state.current.messages[1].status, 'interrupted');
  assert.deepEqual(await page.store.get(original.id), original);
  page.close();
});

test('a generation failure retains the saved version and permits retry without altering its parent', async () => {
  let fail = false;
  let page;
  page = await setup({
    runtime: {
      ready: true,
      async *generate() {
        if (fail) {
          assert.equal(
            (await page.store.get(page.app.state.current.id)).messages[0].content,
            'Nueva pregunta',
          );
          throw new Error('Synthetic failure');
        }
        yield { choices: [{ delta: { content: 'Respuesta' } }] };
      },
    },
  });
  page.$('#prompt').value = 'Original';
  await page.app.submit();
  const original = structuredClone(page.app.state.current);
  fail = true;
  page.$('[data-edit]').click();
  page.$('#edit-prompt').value = 'Nueva pregunta';
  page.$('#edit-form').dispatchEvent(new page.window.Event('submit', { cancelable: true }));
  await settleVersion(page);
  assert.equal(page.app.state.current.messages[1].status, 'error');
  fail = false;
  await page.app.retry(page.app.state.current.messages[1].id);
  assert.equal(page.app.state.current.messages[1].status, 'complete');
  assert.deepEqual(await page.store.get(original.id), original);
  page.close();
});

test('conversation import previews inert text, cancels, confirms a new copy and survives reload', async () => {
  const factory = new IDBFactory();
  const page = await setup({ factory });
  await page.app.loadModel();
  page.$('#prompt').value = 'Conversación original';
  await page.app.submit();
  const original = structuredClone(page.app.state.current);
  const backup = {
    schemaVersion: 1,
    ...structuredClone(original),
    title: '<img src=x onerror=alert(1)>',
  };
  backup.messages[1].content = '<script>alert(1)</script> **Respuesta**';
  const json = JSON.stringify(backup);
  page.$('#prompt').value = 'Borrador sin enviar';
  page.$('#prompt').dispatchEvent(new page.window.Event('input'));
  page.runtime.ready = false;
  await previewConversation(page, json);
  assert.equal(page.$('#import-conversation-dialog').open, true);
  assert.equal(page.$('#import-conversation-detail img'), null);
  assert.equal(page.$('#import-conversation-preview script'), null);
  assert.equal((await page.store.list()).length, 1);
  page.$('#cancel-conversation-import').click();
  assert.equal((await page.store.list()).length, 1);
  assert.equal(page.app.state.current.id, original.id);
  assert.equal(page.$('#import-conversation-preview').textContent, '');
  await previewConversation(page, json);
  page.$('#confirm-conversation-import').click();
  page.$('#confirm-conversation-import').click();
  await settleKnowledge(page);
  const copyId = page.app.state.current.id;
  assert.notEqual(copyId, original.id);
  assert.equal((await page.store.list()).length, 2);
  assert.deepEqual(await page.store.get(original.id), original);
  assert.equal(page.$('#messages script'), null);
  assert.equal(page.$('#chat-title img'), null);
  page.app.selectConversation(page.app.state.conversations.find((item) => item.id === original.id));
  assert.equal(page.$('#prompt').value, 'Borrador sin enviar');
  page.close();
  const reopened = await setup({ factory, supported: false });
  assert.equal(reopened.app.state.conversations.length, 2);
  assert.equal((await reopened.store.get(copyId)).title, backup.title);
  reopened.close();
});

test('invalid conversation backups and failed saves preserve history and allow retry', async () => {
  const page = await setup({ supported: false });
  const originalId = page.app.state.current.id;
  await previewConversation(page, '{');
  assert.equal(page.$('#import-conversation-dialog').open, false);
  assert.match(page.$('#notice').textContent, /JSON válido/);
  assert.deepEqual(await page.store.list(), []);
  const json = JSON.stringify({ schemaVersion: 1, ...page.app.state.current });
  await previewConversation(page, json);
  const save = page.store.save.bind(page.store);
  for (const failure of [false, new Error('QuotaExceededError')]) {
    page.store.save = async () => {
      if (failure instanceof Error) throw failure;
      return failure;
    };
    page.$('#confirm-conversation-import').click();
    await settleKnowledge(page);
    assert.equal(page.$('#import-conversation-dialog').open, true);
    assert.match(page.$('#import-conversation-status').textContent, /No se pudo guardar/);
    assert.equal(page.app.state.current.id, originalId);
    assert.equal(page.app.state.conversations.length, 0);
    assert.equal(page.$('#confirm-conversation-import').disabled, false);
  }
  page.store.save = save;
  page.$('#confirm-conversation-import').click();
  await settleKnowledge(page);
  assert.equal((await page.store.list()).length, 1);
  assert.equal(page.$('#import-conversation-dialog').open, false);
  page.close();
});

for (const operation of ['delete', 'clear']) {
  test(`finishing generation after remote ${operation} does not restore the chat`, async () => {
    const factory = new IDBFactory();
    let release;
    let started;
    const ready = new Promise((resolve) => {
      started = resolve;
    });
    const finish = new Promise((resolve) => {
      release = resolve;
    });
    const page = await setup({
      factory,
      runtime: {
        ready: true,
        async *generate() {
          started();
          await finish;
          yield { choices: [{ delta: { content: 'Respuesta tardía' } }] };
        },
      },
    });
    const other = await new ConversationStore(factory).open();
    page.$('#prompt').value = 'Pregunta';
    const generation = page.app.submit();
    await ready;
    await page.store.queue;
    const id = page.app.state.current.id;
    if (operation === 'delete') await other.delete(id);
    else await other.clear();
    release();
    await generation;
    assert.deepEqual(await other.list(), []);
    assert.equal(page.app.state.conversations.length, 0);
    assert.notEqual(page.app.state.current.id, id);
    other.close();
    page.close();
  });
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
  assert.match(page.$('.source-review').textContent, /Referencias no disponibles: \[999\]/);
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

test('persists and clears composer drafts without adding a conversation', async () => {
  const page = await setup();
  const conversationId = page.app.state.current.id;
  const prompt = page.$('#prompt');
  prompt.value = 'Borrador que quiero recuperar';
  prompt.dispatchEvent(new page.window.Event('input'));
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.deepEqual(JSON.parse(page.window.localStorage.getItem('semilla-drafts')), {
    [conversationId]: 'Borrador que quiero recuperar',
  });
  assert.equal(page.$('#draft-status').textContent, 'Borrador guardado');
  assert.equal(page.app.state.conversations.length, 0);

  prompt.value = '';
  prompt.dispatchEvent(new page.window.Event('input'));
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.deepEqual(JSON.parse(page.window.localStorage.getItem('semilla-drafts')), {});
  page.close();
});
