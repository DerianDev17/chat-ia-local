import test from 'node:test';
import assert from 'node:assert/strict';
import { contentSecurityPolicy, securityHeaders, securityPlugin } from '../security.config.js';

test('production CSP blocks script injection, embeds and arbitrary connections while allowing model origins', () => {
  const csp = contentSecurityPolicy();
  const directives = new Map(
    csp.split('; ').map((part) => {
      const [name, ...values] = part.split(' ');
      return [name, values];
    }),
  );
  assert.deepEqual(directives.get('script-src'), ["'self'", "'wasm-unsafe-eval'"]);
  for (const name of ['object-src', 'base-uri', 'form-action', 'frame-src', 'frame-ancestors'])
    assert.deepEqual(directives.get(name), ["'none'"]);
  assert.deepEqual(directives.get('worker-src'), ["'self'"]);
  assert.ok(directives.get('connect-src').includes('https://huggingface.co'));
  assert.ok(directives.get('connect-src').includes('https://raw.githubusercontent.com'));
  assert.doesNotMatch(csp, /ws:|wss:|https:;|https: /);
  assert.match(contentSecurityPolicy({ development: true }), /ws:\/\/127.0.0.1/);
  assert.doesNotMatch(contentSecurityPolicy({ meta: true }), /frame-ancestors/);
});

test('HTML fallback and static hosting headers are emitted from the same policy', () => {
  const plugin = securityPlugin();
  const tags = plugin.transformIndexHtml.handler('', {});
  assert.equal(tags[0].attrs.content, contentSecurityPolicy({ meta: true }));
  let file;
  plugin.generateBundle.call({
    emitFile(asset) {
      file = asset;
    },
  });
  assert.equal(file.fileName, '_headers');
  for (const [name, value] of Object.entries(securityHeaders()))
    assert.ok(file.source.includes(`${name}: ${value}`));
  assert.equal(securityHeaders()['Referrer-Policy'], 'no-referrer');
});
