import { newConversation, newMessage } from './conversations.js';
import { documentFromPages, splitDocument, MAX_DOCUMENT_BYTES } from './documents.js';

export const MAX_CONVERSATION_BACKUP_BYTES = 16 * 1024 * 1024;
const bytes = (value) => new TextEncoder().encode(value).length;
const invalid = () => {
  throw new Error('La copia contiene datos inválidos o supera los límites de importación.');
};
function text(value, limit, empty = false) {
  if (typeof value !== 'string' || (!empty && !value.trim()) || bytes(value) > limit) invalid();
  return value;
}
function integer(value, max = 8640000000000000, min = 0) {
  if (!Number.isSafeInteger(value) || value < min || value > max) invalid();
  return value;
}
function flag(value, fallback = false) {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') invalid();
  return value;
}

function restoreDocument(source) {
  if (!source || typeof source !== 'object') invalid();
  const name = text(source.name, 720);
  if (name.length > 180) invalid();
  const size = integer(source.size, 10 * 1024 * 1024, 1);
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
    return documentFromPages({ name, size }, pages);
  }
  const content = text(source.text, MAX_DOCUMENT_BYTES);
  if (size > MAX_DOCUMENT_BYTES || /[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(content)) invalid();
  return {
    id: crypto.randomUUID(),
    name,
    size: bytes(content),
    text: content,
    chunks: splitDocument(content),
    createdAt: Date.now(),
  };
}

// Rebuild a whitelist of fields. Imported IDs cannot address existing local data,
// and supplied chunks are never trusted as retrieval input.
export function parseConversationBackup(json) {
  if (typeof json !== 'string' || bytes(json) > MAX_CONVERSATION_BACKUP_BYTES) invalid();
  let backup;
  try {
    backup = JSON.parse(json);
  } catch {
    throw new Error('El archivo no contiene JSON válido.');
  }
  if (!backup || backup.schemaVersion !== 1 || backup.format !== undefined)
    throw new Error('Elige un JSON de conversación exportado por Semilla Digital (versión 1).');
  if (!Array.isArray(backup.messages) || backup.messages.length > 2000) invalid();
  const copy = newConversation();
  copy.title = text(backup.title, 720);
  if (copy.title.length > 180) invalid();
  copy.model = text(backup.model, 256);
  if (backup.createdAt !== undefined) integer(backup.createdAt);
  if (backup.updatedAt !== undefined) integer(backup.updatedAt);
  if (backup.project !== undefined) {
    copy.project = text(backup.project, 320);
    if (copy.project.length > 80) invalid();
  }
  copy.useKnowledge = flag(backup.useKnowledge);
  copy.useDocument = flag(backup.useDocument, true);
  const ids = new Map();
  const remap = (id) => {
    text(id, 256);
    if (!ids.has(id)) ids.set(id, crypto.randomUUID());
    return ids.get(id);
  };
  if (backup.branch !== undefined) {
    if (!backup.branch || typeof backup.branch !== 'object') invalid();
    copy.branch = {
      parentId: remap(backup.branch.parentId),
      parentTitle: text(backup.branch.parentTitle, 720),
      messageId: remap(backup.branch.messageId),
      messageIndex: integer(backup.branch.messageIndex, 1000000),
      context: text(backup.branch.context, 1200),
    };
  }
  if (backup.document !== undefined) {
    copy.document = restoreDocument(backup.document);
    ids.set(text(backup.document.id, 256), copy.document.id);
  }
  copy.documentPage = backup.documentPage ?? null;
  if (copy.documentPage !== null) {
    integer(copy.documentPage, 100, 1);
    if (!copy.document?.pages?.some((page) => page.page === copy.documentPage)) invalid();
  }
  copy.messages = backup.messages.map((message, index) => {
    if (!message || message.role !== (index % 2 ? 'assistant' : 'user')) invalid();
    if (!['complete', 'generating', 'interrupted', 'error'].includes(message.status)) invalid();
    if (message.role === 'user' && message.status !== 'complete') invalid();
    const restored = newMessage(
      message.role,
      text(message.content, 64 * 1024, message.role === 'assistant'),
      message.status === 'generating' ? 'interrupted' : message.status,
    );
    restored.createdAt = integer(message.createdAt);
    restored.documentMode = flag(message.documentMode);
    if (message.retrievalTopic !== undefined)
      restored.retrievalTopic = text(message.retrievalTopic, 64 * 1024, true);
    if (message.model !== undefined) restored.model = text(message.model, 256);
    if (message.finishReason !== undefined) restored.finishReason = text(message.finishReason, 64);
    if (message.documentPage != null) restored.documentPage = integer(message.documentPage, 100, 1);
    if (message.sources !== undefined) {
      if (!Array.isArray(message.sources) || message.sources.length > 3) invalid();
      const sourceIds = new Set();
      restored.sources = message.sources.map((source) => {
        if (!source || typeof source !== 'object') invalid();
        const id = integer(source.id, 1000000, 1);
        if (sourceIds.has(id)) invalid();
        sourceIds.add(id);
        const result = {
          id,
          name: text(source.name, 720),
          text: text(source.text, 4096),
          start: integer(source.start, 1024 * 1024),
          end: integer(source.end, 1024 * 1024),
          documentId: remap(source.documentId),
        };
        if (result.end - result.start !== result.text.length) invalid();
        if (source.page !== undefined) result.page = integer(source.page, 100, 1);
        if (result.documentId === copy.document?.id) {
          if (copy.document.text.slice(result.start, result.end) !== result.text) invalid();
          if (result.page && !copy.document.pages?.some((page) => page.page === result.page))
            invalid();
        }
        if (source.knowledgeId !== undefined) {
          result.knowledgeId = remap(source.knowledgeId);
          result.knowledgeUpdatedAt = integer(source.knowledgeUpdatedAt);
        }
        if (source.project !== undefined) result.project = text(source.project, 320);
        if (source.origin !== undefined) {
          if (!source.origin || !['user', 'assistant'].includes(source.origin.role)) invalid();
          result.origin = {
            title: text(source.origin.title, 1000),
            role: source.origin.role,
            imported: true,
          };
        }
        return result;
      });
    }
    return restored;
  });
  return copy;
}

export async function readConversationBackup(file) {
  if (
    !file ||
    !/\.json$/i.test(file.name) ||
    !file.size ||
    file.size > MAX_CONVERSATION_BACKUP_BYTES
  )
    throw new Error('Elige un archivo JSON de conversación de hasta 16 MB.');
  const buffer = await file.arrayBuffer();
  if (buffer.byteLength > MAX_CONVERSATION_BACKUP_BYTES) invalid();
  let json;
  try {
    json = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    throw new Error('La copia debe usar codificación UTF-8.');
  }
  return parseConversationBackup(json);
}
