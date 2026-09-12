import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewSources } from '../src/source-review.js';
import { EVALUATION_CASES, runEvaluationCases } from './evaluation-cases.js';

test('retrieval evaluation covers exact matches, synonyms, follow-ups, scope and absent facts', () => {
  const report = runEvaluationCases();
  assert.equal(report.total, EVALUATION_CASES.length);
  assert.equal(
    report.passed,
    report.total,
    JSON.stringify(
      report.results.filter((result) => !result.passed),
      null,
      2,
    ),
  );
  for (const result of report.results) {
    assert.ok(result.context.messages.length >= 2, `${result.id} produced no model context`);
    assert.ok(result.context.sources.length <= 3, `${result.id} exceeded source limit`);
  }
  console.log(`[evaluación de recuperación] ${report.passed}/${report.total} casos aprobados`);
});

test('citation evaluation distinguishes cited, fabricated and uncited responses', () => {
  const cases = [
    {
      content: 'La garantía dura dos años [1].',
      expected: { cited: [1], missing: [], uncited: false },
    },
    {
      content: 'La garantía dura diez años [9].',
      expected: { cited: [], missing: [9], uncited: false },
    },
    {
      content: 'La respuesta necesita revisión.',
      expected: { cited: [], missing: [], uncited: true },
    },
  ];
  for (const entry of cases) {
    const result = reviewSources({
      documentMode: true,
      content: entry.content,
      sources: [{ id: 1, name: 'contrato.pdf' }],
    });
    assert.deepEqual(result, entry.expected);
  }
  console.log(`[evaluación de citas] ${cases.length}/${cases.length} casos aprobados`);
});

test('evaluation fixtures are deterministic and keep source payloads within budget', () => {
  const first = runEvaluationCases();
  const second = runEvaluationCases();
  assert.deepEqual(
    first.results.map((result) => ({
      id: result.id,
      passed: result.passed,
      sources: result.context.sources.map((source) => source.text),
    })),
    second.results.map((result) => ({
      id: result.id,
      passed: result.passed,
      sources: result.context.sources.map((source) => source.text),
    })),
  );
  for (const result of first.results)
    assert.ok(
      result.context.messages.reduce(
        (sum, message) => sum + new TextEncoder().encode(message.content).length,
        128,
      ) <= 3000,
      result.id,
    );
});
