import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { ConversationStore } from '../src/storage.js';
import { newConversation } from '../src/conversations.js';
import { documentFromPages } from '../src/documents.js';
import { knowledgeNote, knowledgeDocument, buildKnowledgeContext } from '../src/knowledge.js';

test('retrieves sources across documents and memories while isolating projects and budgets', () => {
  const note = knowledgeNote({
    title: 'Preferencia',
    text: 'El proyecto utiliza pnpm.',
    project: 'Web',
    origin: { conversationId: 'chat', messageId: 'message' },
  });
  const pdf = knowledgeDocument(
    documentFromPages({ name: 'manual.pdf', size: 100 }, [
      { page: 1, text: 'pnpm instala las dependencias.' },
    ]),
    'Web',
  );
  const other = knowledgeNote({ title: 'Privado', text: 'pnpm secreto', project: 'Otro' });
  const result = buildKnowledgeContext('pnpm', [note, pdf, other], ' web ');
  assert.equal(result.sources.length, 2);
  assert.equal(new Set(result.sources.map((source) => source.id)).size, 2);
  assert.equal(result.sources.find((source) => source.name === 'manual.pdf').page, 1);
  assert.equal(
    result.sources.find((source) => source.name === 'Preferencia').origin.messageId,
    'message',
  );
  assert.ok(!JSON.stringify(result).includes('secreto'));
  assert.ok(
    result.messages.reduce(
      (sum, message) => sum + new TextEncoder().encode(message.content).length + 32,
      0,
    ) <= 3000,
  );
  assert.equal(buildKnowledgeContext('astronomía', [note], 'Web').sources.length, 0);
  assert.throws(() => knowledgeNote({ title: 'Nota', text: '😀'.repeat(30000) }), /100 KB/);
});

test('migration retains version 1 chats; deleting chats removes derived memories only', async () => {
  const factory = new IDBFactory();
  const conversation = newConversation();
  await new Promise((resolve, reject) => {
    const request = factory.open('migration', 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore('conversations', { keyPath: 'id' }).put(conversation);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      request.result.close();
      resolve();
    };
  });
  const store = await new ConversationStore(factory, 'migration').open();
  assert.deepEqual(await store.get(conversation.id), conversation);
  const memory = knowledgeNote({
    title: 'Recuerdo',
    text: 'Usar pnpm',
    origin: { conversationId: conversation.id, messageId: 'message' },
  });
  const note = knowledgeNote({ title: 'Nota', text: 'Una nota independiente' });
  assert.equal(await store.saveKnowledge(memory), true);
  await store.saveKnowledge(note);
  const edited = knowledgeNote({ ...memory, text: 'Usar npm' }, memory);
  assert.equal(await store.saveKnowledge(edited, memory.updatedAt), true);
  assert.equal(await store.saveKnowledge(memory, memory.updatedAt), false);
  await store.delete(conversation.id);
  assert.deepEqual(await store.listKnowledge(), [note]);
  assert.equal(await store.saveKnowledge(memory), false);
  await store.deleteKnowledge(note.id);
  assert.equal(await store.saveKnowledge(note, note.updatedAt), false);
  assert.deepEqual(await store.listKnowledge(), []);
  store.close();
});

test('clearing history deletes memories but preserves independently uploaded knowledge', async () => {
  const store = await new ConversationStore(new IDBFactory()).open();
  const conversation = newConversation();
  await store.save(conversation);
  await store.saveKnowledge(
    knowledgeNote({
      title: 'Recuerdo',
      text: 'Preferencia',
      origin: { conversationId: conversation.id },
    }),
  );
  const note = knowledgeNote({ title: 'Nota', text: 'Conocimiento' });
  await store.saveKnowledge(note);
  await store.clear();
  assert.deepEqual(await store.listKnowledge(), [note]);
  store.close();
});

test('corrected or forgotten knowledge is not reintroduced through previous sourced answers', () => {
  const note = knowledgeNote({ title: 'Herramientas', text: 'Usar pnpm', project: 'Web' });
  const first = buildKnowledgeContext('pnpm', [note], 'Web');
  const history = [
    { role: 'user', content: 'pnpm' },
    { role: 'assistant', status: 'complete', content: 'Dato antiguo', sources: first.sources },
  ];
  const edited = knowledgeNote({ ...note, text: 'Usar npm' }, note);
  assert.ok(
    !JSON.stringify(buildKnowledgeContext('npm', [edited], 'Web', history)).includes(
      'Dato antiguo',
    ),
  );
  assert.ok(
    !JSON.stringify(buildKnowledgeContext('pnpm', [], 'Web', history)).includes('Dato antiguo'),
  );
});

test('entry limit is enforced by storage while existing entries can still be edited', async () => {
  const store = await new ConversationStore(new IDBFactory()).open();
  const entries = Array.from({ length: 101 }, (_, i) =>
    knowledgeNote({ title: `Nota ${i}`, text: `Contenido ${i}` }),
  );
  const results = await Promise.all(entries.map((entry) => store.saveKnowledge(entry)));
  assert.equal(results.filter(Boolean).length, 100);
  assert.equal(
    await store.saveKnowledge(
      knowledgeNote({ ...entries[0], text: 'Corregido' }, entries[0]),
      entries[0].updatedAt,
    ),
    true,
  );
  store.close();
});
