import { documentFromPages, splitDocument, MAX_DOCUMENT_BYTES } from './documents.js';
import { knowledgeDocument, knowledgeNote } from './knowledge.js';

export const MAX_BACKUP_BYTES = 64 * 1024 * 1024;
const bytes = (text) => new TextEncoder().encode(text).length;
const invalid = () => {
  throw new Error('La copia contiene datos inválidos o supera los límites de la biblioteca.');
};
function text(value, limit, allowEmpty = false) {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim()) || bytes(value) > limit)
    invalid();
  return value;
}

export function exportKnowledgeBackup(entries) {
  const backup = {
    format: 'semilla-knowledge',
    schemaVersion: 1,
    entries: entries.map((entry) => ({
      kind: entry.kind,
      title: entry.title,
      project: entry.project,
      ...(entry.kind === 'document'
        ? {
            document: {
              name: entry.document.name,
              size: entry.document.size,
              ...(entry.document.pages ? { pages: entry.document.pages } : { text: entry.text }),
            },
          }
        : { text: entry.text }),
      ...(entry.origin
        ? {
            origin: {
              title: entry.origin.title || 'Conversación',
              role: entry.origin.role || 'user',
            },
          }
        : {}),
    })),
  };
  const json = JSON.stringify(backup, null, 2);
  if (bytes(json) > MAX_BACKUP_BYTES) throw new Error('La copia supera el límite de 64 MB.');
  return json;
}

export function parseKnowledgeBackup(json) {
  if (typeof json !== 'string' || bytes(json) > MAX_BACKUP_BYTES) invalid();
  let backup;
  try {
    backup = JSON.parse(json);
  } catch {
    throw new Error('El archivo no contiene JSON válido.');
  }
  if (backup?.format !== 'semilla-knowledge' || backup.schemaVersion !== 1)
    throw new Error('Elige una copia de Biblioteca y memoria de Semilla Digital (versión 1).');
  if (!Array.isArray(backup.entries) || backup.entries.length > 100) invalid();
  return backup.entries.map((entry) => {
    if (!entry || !['note', 'memory', 'document'].includes(entry.kind)) invalid();
    const title = text(entry.title, entry.kind === 'document' ? 720 : 480);
    const project = text(entry.project, 320);
    if (title.length > (entry.kind === 'document' ? 180 : 120) || project.length > 80) invalid();
    if (entry.kind !== 'document') {
      let origin;
      if (entry.kind === 'memory') {
        if (!entry.origin || !['user', 'assistant'].includes(entry.origin.role)) invalid();
        origin = { title: text(entry.origin.title, 1000), role: entry.origin.role, imported: true };
      }
      return knowledgeNote({ title, project, text: text(entry.text, MAX_DOCUMENT_BYTES), origin });
    }
    const source = entry.document;
    if (
      !source ||
      !Number.isSafeInteger(source.size) ||
      source.size <= 0 ||
      source.size > 10 * 1024 * 1024
    )
      invalid();
    const name = text(source.name, 720);
    if (name.length > 180) invalid();
    let document;
    if (source.pages !== undefined) {
      if (!Array.isArray(source.pages) || !source.pages.length || source.pages.length > 100)
        invalid();
      let total = 0;
      const pages = source.pages.map((page, index) => {
        if (!page || page.page !== index + 1) invalid();
        const content = text(page.text, 512 * 1024, true);
        total += bytes(content);
        if (total > 512 * 1024) invalid();
        return { page: page.page, text: content };
      });
      if (!pages.some((page) => page.text.trim())) invalid();
      document = documentFromPages({ name, size: source.size }, pages);
    } else {
      const content = text(source.text, MAX_DOCUMENT_BYTES);
      if (source.size > MAX_DOCUMENT_BYTES) invalid();
      document = {
        id: crypto.randomUUID(),
        name,
        size: bytes(content),
        text: content,
        chunks: splitDocument(content),
        createdAt: Date.now(),
      };
    }
    return { ...knowledgeDocument(document, project), title };
  });
}

export async function readKnowledgeBackup(file) {
  if (!file || !/\.json$/i.test(file.name) || !file.size || file.size > MAX_BACKUP_BYTES)
    throw new Error('Elige un archivo JSON de hasta 64 MB.');
  const buffer = await file.arrayBuffer();
  if (buffer.byteLength > MAX_BACKUP_BYTES) invalid();
  let json;
  try {
    json = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    throw new Error('La copia debe usar codificación UTF-8.');
  }
  return parseKnowledgeBackup(json);
}
