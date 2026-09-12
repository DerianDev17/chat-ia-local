import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewSources, sourceReviewText } from '../src/source-review.js';

const review = (content) =>
  reviewSources({ documentMode: true, content, sources: [{ id: 1 }, { id: 2 }] });
test('flags fabricated citations and missing citations without claiming factual verification', () => {
  assert.deepEqual(review('Hecho [1] [999] [999].'), {
    missing: [999],
    cited: [1],
    uncited: false,
  });
  assert.match(sourceReviewText(review('Hecho [999]')), /no disponibles/);
  assert.match(sourceReviewText(review('Hecho sin cita.')), /no incluye citas/);
  assert.match(sourceReviewText(review('Hecho [1]')), /no verifica las afirmaciones/);
  assert.equal(reviewSources({ content: '[999]', documentMode: false }), null);
});
test('ignores code and link labels but inspects table and list references', () => {
  assert.deepEqual(
    review(
      '`array[999]`\n\n```js\nx[998]\n```\n\n[enlace [997]](https://example.com)\n\n- Afirmación [1]',
    ).missing,
    [],
  );
  assert.deepEqual(review('| Dato | Fuente |\n|---|---|\n| A | [2] |').cited, [2]);
});
