import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import createDOMPurify from 'dompurify';
import { renderMarkdown } from '../src/markdown.js';

test('renders useful Markdown while blocking scripts, event handlers and tracking images', () => {
  const window = new JSDOM('').window;
  const clean = renderMarkdown(
    '**Hola**\n\n```js\nconst x = 1;\n```\n\n<script>alert(1)</script><img src="https://tracker.example/x" onerror="alert(1)"><a href="javascript:alert(1)">click</a><iframe src="https://tracker.example"></iframe><svg onload="alert(1)"></svg>',
    createDOMPurify(window),
  );
  assert.match(clean, /<strong>Hola<\/strong>/);
  assert.match(clean, /<pre><code>const x = 1;/);
  assert.doesNotMatch(clean, /<script|<img|<iframe|<svg|onerror|onload|javascript:/i);
  window.close();
});
