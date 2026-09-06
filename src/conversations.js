export const MODEL_ID = 'Llama-3.2-1B-Instruct-q4f32_1-MLC';
export const SYSTEM_MESSAGE =
  'Eres un asistente útil. Responde en español salvo que el usuario pida otro idioma. Sé claro, reconoce la incertidumbre y no inventes fuentes.';
// UTF-8 bytes are a conservative upper bound for this model's byte-level tokens.
// Leave room for the system prompt, chat template, and up to 512 output tokens.
export const INPUT_BUDGET = 2800;
const bytes = (text) => new TextEncoder().encode(text).length;

export function newConversation() {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    title: 'Nueva conversación',
    model: MODEL_ID,
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
}

export function newMessage(role, content = '', status = 'complete') {
  return { id: crypto.randomUUID(), role, content, status, createdAt: Date.now() };
}

export function duplicateConversation(conversation) {
  const copy = recoverConversation(structuredClone(conversation));
  const now = Date.now();
  copy.id = crypto.randomUUID();
  copy.title = `${conversation.title.slice(0, 110)} (copia)`;
  copy.createdAt = now;
  copy.updatedAt = now;
  const originalDocumentId = copy.document?.id;
  if (copy.document) copy.document.id = crypto.randomUUID();
  for (const message of copy.messages) {
    message.id = crypto.randomUUID();
    for (const source of message.sources || []) {
      if (originalDocumentId && source.documentId === originalDocumentId)
        source.documentId = copy.document.id;
    }
  }
  return copy;
}

export function validatePrompt(text) {
  if (!text.trim()) return 'Escribe un mensaje antes de enviarlo.';
  if (bytes(text) + 32 > INPUT_BUDGET)
    return 'Este texto es demasiado largo para el modelo local. Divídelo en partes más pequeñas (aproximadamente 2.000 caracteres por mensaje).';
  return null;
}

export function buildContext(messages) {
  // Keep only complete user/assistant turns. Failed and partial replies remain in
  // the visible history, but must not become factual context for the next turn.
  const latest = messages.findLastIndex((message) => message.role === 'user');
  if (latest < 0) throw new Error('Falta el mensaje del usuario.');
  const last = messages[latest];
  const invalid = validatePrompt(last.content);
  if (invalid) throw new Error(invalid);
  const context = [{ role: 'user', content: last.content }];
  let used = bytes(last.content) + 32;
  let included = 1;
  for (let i = latest - 1; i > 0; i--) {
    const assistant = messages[i];
    const user = messages[i - 1];
    if (
      assistant.role !== 'assistant' ||
      assistant.status !== 'complete' ||
      !assistant.content ||
      user.role !== 'user'
    )
      continue;
    const size = bytes(user.content) + bytes(assistant.content) + 64;
    if (used + size > INPUT_BUDGET) break;
    context.unshift(
      { role: 'user', content: user.content },
      { role: 'assistant', content: assistant.content },
    );
    used += size;
    included += 2;
    i--;
  }
  return {
    messages: [{ role: 'system', content: SYSTEM_MESSAGE }, ...context],
    trimmed: included < latest + 1,
  };
}

export function recoverConversation(conversation) {
  return {
    ...conversation,
    messages: conversation.messages.map((message) =>
      message.status === 'generating' ? { ...message, status: 'interrupted' } : message,
    ),
  };
}

export function exportMarkdown(conversation) {
  return (
    `# ${conversation.title}\n\nModelo: ${conversation.model}\n\n` +
    conversation.messages
      .map((message) => {
        const status =
          message.status !== 'complete'
            ? `\n\n_Estado: ${message.status === 'error' ? 'error' : 'respuesta interrumpida'}_`
            : message.finishReason === 'length'
              ? '\n\n_Límite de longitud alcanzado._'
              : '';
        const sources = message.sources?.length
          ? '\n\n### Fragmentos consultados\n\n' +
            message.sources
              .map(
                (source) =>
                  `Fuente [${source.id}] · ${source.name.replace(/[\r\n]/g, ' ')}${source.page ? ` · Página ${source.page}` : ''}\n\n` +
                  source.text
                    .split('\n')
                    .map((line) => `> ${line}`)
                    .join('\n'),
              )
              .join('\n\n')
          : '';
        return `## ${message.role === 'user' ? 'Tú' : 'Semilla Digital'}\n\n${message.content}${status}${sources}`;
      })
      .join('\n\n---\n\n') +
    '\n'
  );
}
