import test from 'node:test';
import assert from 'node:assert/strict';
import { citedSources } from '../src/documents.js';

test('source usage is derived only from citations matching supplied knowledge sources', () => {
  const message = {
    knowledgeMode: true,
    content: 'Usa [1] y no inventes [9].',
    sources: [
      { id: 1, knowledgeId: 'memory-a', name: 'Preferencia' },
      { id: 2, knowledgeId: 'memory-b', name: 'Otra nota' },
    ],
  };
  assert.deepEqual(
    citedSources(message).map((source) => source.name),
    ['Preferencia'],
  );
  assert.deepEqual(citedSources({ ...message, content: 'Respuesta sin citas.' }), []);
});
