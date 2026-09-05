import test from 'node:test';
import assert from 'node:assert/strict';
import { getDocument as createPdf } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
const fontPath =
  join(
    dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json')),
    'standard_fonts',
  ).replaceAll('\\', '/') + '/';
const getDocument = (options) => createPdf({ ...options, standardFontDataUrl: fontPath });
import { extractPdfPages } from '../src/pdf-reader.js';
import { documentFromPages, buildDocumentContext, readDocument } from '../src/documents.js';
import { makePdf } from './pdf-fixture.js';

test('extracts a real PDF, preserves blank pages, and confines retrieval to the selected page', async () => {
  const pages = await extractPdfPages(makePdf(), getDocument);
  assert.equal(pages.length, 3);
  assert.match(pages[0].text, /120 euros/);
  assert.match(pages[1].text, /septiembre/);
  assert.equal(pages[2].text, '');
  const document = documentFromPages({ name: 'proyecto.pdf', size: 1000 }, pages);
  assert.deepEqual(
    document.chunks.map((chunk) => chunk.page),
    [1, 2],
  );
  for (const chunk of document.chunks)
    assert.equal(document.text.slice(chunk.start, chunk.end), chunk.text);
  const context = buildDocumentContext('Resume el documento', document, 2);
  assert.ok(context.sources.length);
  assert.ok(context.sources.every((source) => source.page === 2));
  assert.doesNotMatch(JSON.stringify(context.messages), /120 euros/);
  assert.equal(buildDocumentContext('Resume', document, 3).sources.length, 0);
});

test('rejects malformed, textless and oversized PDFs', async () => {
  await assert.rejects(
    extractPdfPages(new TextEncoder().encode('not a PDF'), getDocument),
    /dañado/,
  );
  await assert.rejects(extractPdfPages(makePdf(['']), getDocument), /OCR/);
  await assert.rejects(extractPdfPages(makePdf(Array(101).fill('x')), getDocument), /100 páginas/);
  await assert.rejects(readDocument({ name: 'huge.pdf', size: 11 * 1024 * 1024 }), /10 MB/);
});

test('destroys parser resources on password and text budget failures', async () => {
  let destroyed = 0;
  const password = () => ({
    promise: Promise.reject(Object.assign(new Error(), { name: 'PasswordException' })),
    async destroy() {
      destroyed++;
    },
  });
  await assert.rejects(extractPdfPages(new Uint8Array(), password), /contraseña/);
  assert.equal(destroyed, 1);
  const large = (options) => {
    assert.equal(options.isEvalSupported, false);
    assert.equal(options.enableXfa, false);
    return {
      promise: Promise.resolve({
        numPages: 1,
        async getPage() {
          return {
            async getTextContent() {
              return { items: [{ str: 'x'.repeat(512 * 1024 + 1) }] };
            },
          };
        },
      }),
      async destroy() {
        destroyed++;
      },
    };
  };
  await assert.rejects(extractPdfPages(new Uint8Array(), large), /512 KB/);
  assert.equal(destroyed, 2);
});
