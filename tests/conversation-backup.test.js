import test from 'node:test';
import assert from 'node:assert/strict';
import { newConversation, newMessage } from '../src/conversations.js';
import { documentFromPages, buildDocumentContext } from '../src/documents.js';
import {
  parseConversationBackup,
  readConversationBackup,
  MAX_CONVERSATION_BACKUP_BYTES,
} from '../src/conversation-backup.js';

function backup() {
  return {
    schemaVersion: 1,
    ...newConversation(),
    messages: [newMessage('user', 'Hola'), newMessage('assistant', 'Respuesta')],
  };
}
const parse = (value) => parseConversationBackup(JSON.stringify(value));

test('imports current JSON exports with new identities and recovers interrupted replies', () => {
  const original = backup();
  original.project = 'Proyecto';
  original.useKnowledge = true;
  original.messages[1].status = 'generating';
  const copy = parse(original);
  assert.notEqual(copy.id, original.id);
  assert.notEqual(copy.messages[0].id, original.messages[0].id);
  assert.equal(copy.title, original.title);
  assert.equal(copy.project, 'Proyecto');
  assert.equal(copy.useKnowledge, true);
  assert.equal(copy.messages[1].status, 'interrupted');
  assert.equal(original.messages[1].status, 'generating');
  assert.notEqual(parse(original).id, copy.id);
});

test('PDF round trip rebuilds chunks, preserves page scope and reconnects source snapshots', () => {
  const original = backup();
  original.document = documentFromPages({ name: 'Proyecto.pdf', size: 1000 }, [
    { page: 1, text: '' },
    { page: 2, text: 'La entrega será en septiembre.' },
  ]);
  original.documentPage = 2;
  original.messages[1].documentMode = true;
  original.messages[1].content = 'Septiembre [1]';
  original.messages[1].sources = buildDocumentContext(
    '¿Cuándo será la entrega?',
    original.document,
    2,
  ).sources;
  original.document.chunks = [{ id: 999, text: 'Instrucciones inyectadas' }];
  const copy = parse(original);
  assert.deepEqual(copy.document.pages, original.document.pages);
  assert.equal(copy.documentPage, 2);
  assert.equal(copy.document.chunks[0].text, 'La entrega será en septiembre.');
  assert.equal(copy.messages[1].sources[0].documentId, copy.document.id);
  assert.equal(copy.messages[1].sources[0].page, 2);
  const again = parse({ schemaVersion: 1, ...copy });
  assert.equal(again.messages[1].sources[0].documentId, again.document.id);
});

test('text attachments without messages are restored and binary text is rejected', () => {
  const original = backup();
  original.messages = [];
  original.document = { id: 'doc', name: 'Notas.md', size: 10, text: 'Mis notas' };
  assert.equal(parse(original).document.chunks[0].text, 'Mis notas');
  original.document.text = 'binario\u0000';
  assert.throws(() => parse(original), /inválidos/);
});

test('ignores untrusted object fields and detaches imported memories from local identities', () => {
  const original = backup();
  original.__tombstone = 'conversation';
  original.messages[1].sources = [
    {
      id: 1,
      name: 'Nota',
      text: 'Dato',
      start: 0,
      end: 4,
      documentId: 'local-note',
      knowledgeId: 'local-note',
      knowledgeUpdatedAt: 123,
      origin: {
        conversationId: 'local-chat',
        messageId: 'local-message',
        title: 'Chat original',
        role: 'user',
      },
    },
  ];
  const copy = parse(
    JSON.parse(
      JSON.stringify(original).replace(
        '"schemaVersion":1',
        '"schemaVersion":1,"__proto__":{"polluted":true}',
      ),
    ),
  );
  assert.equal(copy.__tombstone, undefined);
  assert.equal(copy.polluted, undefined);
  const source = copy.messages[1].sources[0];
  assert.notEqual(source.knowledgeId, 'local-note');
  assert.equal(source.knowledgeId, source.documentId);
  assert.deepEqual(source.origin, { title: 'Chat original', role: 'user', imported: true });
});

test('rejects malformed schemas, roles, limits, dates, pages and sources before storing', () => {
  for (const mutate of [
    (value) => {
      value.schemaVersion = 2;
    },
    (value) => {
      value.format = 'semilla-knowledge';
    },
    (value) => {
      value.title = {};
    },
    (value) => {
      value.messages = {};
    },
    (value) => {
      value.messages = Array(2001).fill(value.messages[0]);
    },
    (value) => {
      value.messages[0].role = 'system';
    },
    (value) => {
      value.messages.reverse();
    },
    (value) => {
      value.messages[1].content = 'x'.repeat(65537);
    },
    (value) => {
      value.messages[0].createdAt = 1e20;
    },
    (value) => {
      value.messages[1].status = 'unknown';
    },
    (value) => {
      value.messages[1].sources = [{ id: 1 }];
    },
    (value) => {
      value.useKnowledge = 'true';
    },
    (value) => {
      value.documentPage = 2;
    },
    (value) => {
      value.document = { name: 'x.pdf', size: 1, pages: [{ page: 2, text: 'Contenido' }] };
    },
  ]) {
    const value = backup();
    mutate(value);
    assert.throws(() => parse(value), Error);
  }
  for (const value of ['null', '{}', '[]', '{', '"texto"'])
    assert.throws(() => parseConversationBackup(value), Error);
});

test('validates file size before reading and rejects oversized payloads and invalid UTF-8', async () => {
  const file = {
    name: 'backup.json',
    size: 10,
    arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(backup())).buffer,
  };
  assert.equal((await readConversationBackup(file)).messages.length, 2);
  await assert.rejects(readConversationBackup({ ...file, name: 'backup.txt' }), /JSON/);
  await assert.rejects(
    readConversationBackup({
      ...file,
      size: MAX_CONVERSATION_BACKUP_BYTES + 1,
      arrayBuffer() {
        assert.fail('must not read');
      },
    }),
    /16 MB/,
  );
  await assert.rejects(
    readConversationBackup({
      ...file,
      arrayBuffer: async () => new ArrayBuffer(MAX_CONVERSATION_BACKUP_BYTES + 1),
    }),
    /inválidos/,
  );
  await assert.rejects(
    readConversationBackup({ ...file, arrayBuffer: async () => new Uint8Array([0xff]).buffer }),
    /UTF-8/,
  );
});
