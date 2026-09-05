import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';

GlobalWorkerOptions.workerSrc = workerUrl;

import { extractPdfPages } from './pdf-reader.js';
export const readPdfPages = (buffer) =>
  extractPdfPages(buffer, getDocument, {
    cMapUrl: new URL('./pdfjs/cmaps/', document.baseURI).href,
    standardFontDataUrl: new URL('./pdfjs/standard_fonts/', document.baseURI).href,
  });
