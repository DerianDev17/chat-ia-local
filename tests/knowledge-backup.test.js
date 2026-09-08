import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { ConversationStore } from '../src/storage.js';
import {
  knowledgeNote,
  knowledgeDocument,
  buildKnowledgeContext,
  searchKnowledge,
} from '../src/knowledge.js';
import { documentFromPages } from '../src/documents.js';
import {
  exportKnowledgeBackup,
  parseKnowledgeBackup,
  readKnowledgeBackup,
} from '../src/knowledge-backup.js';

test('round trips PDF pages, notes and independent memories with reconstructed sources', () => {
  const pdf = knowledgeDocument(
    documentFromPages({ name: 'guía.pdf', size: 100 }, [
      { page: 1, text: 'La instalación usa pnpm.' },
      { page: 2, text: '' },
    ]),
    'Web',
  );
  const memory = knowledgeNote({
    title: 'Preferencia',
    project: 'Web',
    text: 'Usar pnpm',
    origin: { conversationId: 'old', messageId: 'msg', role: 'user', title: 'Chat original' },
  });
  const exported = exportKnowledgeBackup([pdf, memory]);
  const restored = parseKnowledgeBackup(exported);
  assert.notEqual(restored[0].id, pdf.id);
  assert.notEqual(restored[0].document.id, pdf.document.id);
  assert.deepEqual(restored[0].document.pages, pdf.document.pages);
  assert.equal(restored[1].kind, 'memory');
  assert.equal(restored[1].origin.conversationId, undefined);
  assert.equal(restored[1].origin.imported, true);
  assert.equal(restored[1].origin.title, 'Chat original');
  const context = buildKnowledgeContext('pnpm', restored, 'Web');
  assert.equal(context.sources.length, 2);
  assert.equal(context.sources.find((source) => source.name === 'guía.pdf').page, 1);
  const again = parseKnowledgeBackup(exportKnowledgeBackup(restored));
  assert.equal(again[1].kind, 'memory');
});

test('restores documents with long filenames accepted by the library', () => {
  const name = 'á'.repeat(150) + '.pdf';
  const document = knowledgeDocument(
    documentFromPages({ name, size: 100 }, [{ page: 1, text: 'Contenido' }]),
    'General',
  );
  const restored = parseKnowledgeBackup(exportKnowledgeBackup([document]));
  assert.equal(restored[0].title, name);
  assert.equal(restored[0].document.name, name);
});

test('rejects invalid schemas, malformed pages, excessive text and invalid files', async () => {
  const wrap = (entry) =>
    JSON.stringify({ format: 'semilla-knowledge', schemaVersion: 1, entries: [entry] });
  const note = { kind: 'note', title: 'Nota', project: 'General', text: 'Hola' };
  for (const json of [
    '{',
    'null',
    '{"schemaVersion":2}',
    wrap({ ...note, kind: 'system' }),
    wrap({ ...note, text: 'a'.repeat(102401) }),
    wrap({ ...note, title: null }),
    wrap({
      ...note,
      kind: 'document',
      document: { name: 'a.pdf', size: 100, pages: [{ page: 4, text: 'Texto' }] },
    }),
  ])
    assert.throws(() => parseKnowledgeBackup(json));
  const payload = JSON.parse(wrap(note));
  payload.entries[0].id = '__semilla_clear__';
  payload.entries[0].chunks = [{ text: 'Inyección' }];
  const restored = parseKnowledgeBackup(JSON.stringify(payload))[0];
  assert.notEqual(restored.id, '__semilla_clear__');
  assert.equal(restored.chunks[0].text, 'Hola');
  await assert.rejects(
    readKnowledgeBackup({
      name: 'bad.json',
      size: 1,
      async arrayBuffer() {
        return new Uint8Array([255]).buffer;
      },
    }),
    /UTF-8/,
  );
});

test('import is atomic at capacity, skips duplicates and never overwrites entries', async () => {
  const store = await new ConversationStore(new IDBFactory()).open();
  const originals = Array.from({ length: 99 }, (_, i) =>
    knowledgeNote({ title: `Nota ${i}`, text: `Contenido ${i}`, project: 'Web' }),
  );
  await store.importKnowledge(originals);
  const extra = [
    knowledgeNote({ title: 'A', text: 'Nuevo A', project: 'Web' }),
    knowledgeNote({ title: 'B', text: 'Nuevo B', project: 'Web' }),
  ];
  await assert.rejects(store.importKnowledge(extra), /100 entradas/);
  assert.equal((await store.listKnowledge()).length, 99);
  const duplicate = { ...originals[0], id: crypto.randomUUID(), project: ' web ' };
  assert.deepEqual(
    await store.importKnowledge([duplicate, extra[0], { ...extra[0], id: crypto.randomUUID() }]),
    { imported: 1, skipped: 2 },
  );
  assert.equal(
    (await store.listKnowledge()).find((entry) => entry.id === originals[0].id).title,
    'Nota 0',
  );
  store.close();
});

test('search matches accents, titles and contents and combines the type filter', () => {
  const notes = [
    knowledgeNote({ title: 'Instalación', text: 'Usar pnpm' }),
    knowledgeNote({
      title: 'Entrega',
      text: 'En septiembre',
      origin: { title: 'Chat', role: 'user' },
    }),
  ];
  assert.deepEqual(searchKnowledge(notes, 'instalacion PNPM', 'note'), [notes[0]]);
  assert.deepEqual(searchKnowledge(notes, 'septiembre', 'memory'), [notes[1]]);
  assert.deepEqual(searchKnowledge(notes, 'septiembre', 'document'), []);
});
