import { buildDocumentContext, splitDocument, MAX_DOCUMENT_BYTES } from './documents.js';
import { matchesSearch } from './search-language.js';

export const DEFAULT_PROJECT = 'General';
const bytes = (text) => new TextEncoder().encode(text).length;
export function projectName(value = '') {
  return value.trim().normalize('NFC').slice(0, 80) || DEFAULT_PROJECT;
}
const projectKey = (value) => projectName(value).toLocaleLowerCase('es');

export function knowledgeNote({ title, text, project, origin }, previous = null) {
  if (!title.trim() || !text.trim()) throw new Error('Escribe un título y un texto.');
  if (bytes(text) > MAX_DOCUMENT_BYTES) throw new Error('La nota supera el límite de 100 KB.');
  const now = Math.max(Date.now(), (previous?.updatedAt || 0) + 1);
  return {
    id: previous?.id || crypto.randomUUID(),
    kind: origin ? 'memory' : 'note',
    title: title.trim().slice(0, 120),
    project: projectName(project),
    text,
    chunks: splitDocument(text),
    ...(origin ? { origin: structuredClone(origin) } : {}),
    createdAt: previous?.createdAt || now,
    updatedAt: now,
  };
}

export function knowledgeDocument(document, project) {
  return {
    id: crypto.randomUUID(),
    kind: 'document',
    title: document.name,
    project: projectName(project),
    document: structuredClone(document),
    text: document.text,
    chunks: structuredClone(document.chunks),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export function projectKnowledge(entries, project) {
  return entries.filter((entry) => projectKey(entry.project) === projectKey(project));
}

export function searchKnowledge(entries, query = '', kind = '') {
  return entries.filter(
    (entry) =>
      (!kind || entry.kind === kind) && matchesSearch(query, `${entry.title}\n${entry.text}`),
  );
}

export function buildKnowledgeContext(question, entries, project, history = []) {
  const selected = projectKnowledge(entries, project);
  const originals = new Map();
  const chunks = [];
  for (const entry of selected) {
    for (const chunk of entry.chunks) {
      const id = chunks.length + 1;
      chunks.push({ ...chunk, id });
      originals.set(id, { entry, chunk });
    }
  }
  const context = buildDocumentContext(question, { chunks }, null, {
    history,
    isCurrentSource: (source) =>
      selected.some(
        (entry) => entry.id === source.knowledgeId && entry.updatedAt === source.knowledgeUpdatedAt,
      ),
  });
  context.kind = 'knowledge';
  context.total = chunks.length;
  context.sources = context.sources.map((source) => {
    const { entry } = originals.get(source.id);
    return {
      ...source,
      knowledgeId: entry.id,
      knowledgeUpdatedAt: entry.updatedAt,
      documentId: entry.document?.id || entry.id,
      name: entry.title,
      project: entry.project,
      ...(entry.origin ? { origin: structuredClone(entry.origin) } : {}),
    };
  });
  // Preserve recent complete turns only when they fit alongside the retrieved data.
  let used = context.messages.reduce((sum, message) => sum + bytes(message.content) + 32, 0);
  for (let i = history.length - 1; i > 0; i--) {
    const assistant = history[i];
    const user = history[i - 1];
    if (
      assistant.sources?.some(
        (source) =>
          source.knowledgeId &&
          !selected.some(
            (entry) =>
              entry.id === source.knowledgeId && entry.updatedAt === source.knowledgeUpdatedAt,
          ),
      )
    )
      continue;
    if (
      assistant.role !== 'assistant' ||
      assistant.status !== 'complete' ||
      !assistant.content ||
      user.role !== 'user'
    )
      continue;
    const cost = bytes(user.content) + bytes(assistant.content) + 64;
    if (used + cost > 3000) break;
    context.messages.splice(
      1,
      0,
      { role: 'user', content: user.content },
      { role: 'assistant', content: assistant.content },
    );
    used += cost;
    i--;
  }
  return context;
}
