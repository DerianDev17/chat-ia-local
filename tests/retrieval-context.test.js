import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDocumentContext, documentFromPages } from '../src/documents.js';
import { buildKnowledgeContext, knowledgeNote } from '../src/knowledge.js';
import { newMessage } from '../src/conversations.js';

const historyFrom = (question, context) => [
  newMessage('user', question),
  {
    ...newMessage('assistant', 'Respuesta [1]'),
    sources: context.sources,
    retrievalTopic: context.topic,
  },
];

test('follow-ups retain the topic across turns and remain within the context budget', () => {
  const doc = documentFromPages({ name: 'Contrato.pdf', size: 1000 }, [
    { page: 1, text: 'El contrato vence el 30 de junio. Tiene una duración de doce meses.' },
  ]);
  const first = buildDocumentContext('Explica el contrato', doc);
  const second = buildDocumentContext('¿Y cuándo vence?', doc, null, {
    history: historyFrom('Explica el contrato', first),
  });
  assert.equal(second.clarification, false);
  assert.equal(second.sources[0].documentId, doc.id);
  const payload = JSON.parse(second.messages[1].content);
  assert.equal(payload.question, '¿Y cuándo vence?');
  assert.equal(payload.previousQuestion, 'Explica el contrato');
  const third = buildDocumentContext('¿Y cuánto dura?', doc, null, {
    history: historyFrom('¿Y cuándo vence?', second),
  });
  assert.equal(third.topic, 'Explica el contrato');
  assert.ok(
    third.messages.reduce(
      (sum, item) => sum + new TextEncoder().encode(item.content).length,
      128,
    ) <= 3000,
  );
});

test('missing, failed or differently scoped history asks for clarification without sources', () => {
  const doc = documentFromPages({ name: 'Contrato.pdf', size: 1000 }, [
    { page: 1, text: 'El contrato vence en junio.' },
    { page: 2, text: 'Otra página.' },
  ]);
  const history = historyFrom(
    'Explica el contrato',
    buildDocumentContext('Explica el contrato', doc),
  );
  for (const options of [
    {},
    { history: [history[0], { ...history[1], status: 'error' }] },
    { history: [history[0], { ...history[1], sources: [{ documentId: 'other' }] }] },
  ]) {
    const context = buildDocumentContext('¿Y cuándo vence?', doc, null, options);
    assert.equal(context.clarification, true);
    assert.deepEqual(context.sources, []);
  }
  assert.equal(buildDocumentContext('¿Y cuándo vence?', doc, 2, { history }).clarification, true);
});

test('library follow-ups never revive removed, edited or other-project memories', () => {
  const note = knowledgeNote({
    title: 'Contrato',
    text: 'El contrato vence en junio.',
    project: 'Trabajo',
  });
  const history = historyFrom(
    'Explica el contrato',
    buildKnowledgeContext('Explica el contrato', [note], 'Trabajo'),
  );
  assert.equal(
    buildKnowledgeContext('¿Y cuándo vence?', [note], 'Trabajo', history).clarification,
    false,
  );
  for (const [entries, project] of [
    [[], 'Trabajo'],
    [[{ ...note, updatedAt: note.updatedAt + 1 }], 'Trabajo'],
    [[note], 'Personal'],
  ])
    assert.equal(
      buildKnowledgeContext('¿Y cuándo vence?', entries, project, history).clarification,
      true,
    );
});
