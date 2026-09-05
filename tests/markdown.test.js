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

test('model links cannot invoke protocol handlers or navigate relative to the app', () => {
  const window = new JSDOM('').window;
  const protocols = [
    'javascript:alert(1)',
    'data:text/html,hello',
    'vbscript:msgbox(1)',
    'file:///secret',
    'mailto:someone@example.com',
    'tel:123',
    'sms:123',
    'ftp://example.com',
    '//example.com',
    '/admin',
    '#prompt',
  ];
  for (const href of protocols) {
    const clean = renderMarkdown(`<a href="${href}">Link</a>`, createDOMPurify(window));
    assert.doesNotMatch(clean, /href=/i, href);
  }
  const safe = renderMarkdown(
    '[Referencia](https://example.com/reference)',
    createDOMPurify(window),
  );
  assert.match(safe, /href="https:\/\/example.com\/reference"/);
  window.close();
});

test('malformed and obfuscated markup cannot escape the allowed HTML surface', () => {
  const window = new JSDOM('').window;
  const payloads = [
    '<a href="java&#x73;cript:alert(1)">x</a>',
    '<a href="java\nscript:alert(1)">x</a>',
    '<math><mtext><table><mglyph><style><!--</style><img title="--><img src=x onerror=alert(1)>">',
    '<svg><a xlink:href="javascript:alert(1)">x</a></svg>',
    '<form id="prompt"><input name="__proto__"></form><base href="https://evil.example/">',
  ];
  for (const payload of payloads) {
    const container = window.document.createElement('div');
    container.innerHTML = renderMarkdown(payload, createDOMPurify(window));
    assert.equal(container.querySelector('script,svg,math,form,input,base,img,style,iframe'), null);
    for (const element of container.querySelectorAll('*')) {
      for (const attribute of element.attributes)
        assert.ok(['href', 'title', 'start'].includes(attribute.name));
      if (element.hasAttribute('href')) assert.match(element.getAttribute('href'), /^https?:\/\//i);
    }
  }
  window.close();
});
