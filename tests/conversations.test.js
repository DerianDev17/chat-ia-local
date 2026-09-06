import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildContext,
  duplicateConversation,
  exportMarkdown,
  newConversation,
  newMessage,
  recoverConversation,
  validatePrompt,
  INPUT_BUDGET,
} from '../src/conversations.js';

test('duplicates independent messages and PDF sources with fresh IDs', () => {
  const original = newConversation();
  original.document = {
    id: 'document-original',
    pages: [{ page: 2, text: 'Texto original' }],
    chunks: [{ id: 1, page: 2, text: 'Texto original' }],
  };
  original.documentPage = 2;
  original.useDocument = false;
  original.messages = [newMessage('assistant', 'Respuesta [1]', 'generating')];
  original.messages[0].sources = [
    { id: 1, documentId: original.document.id, page: 2, text: 'Texto original' },
  ];
  const before = structuredClone(original);
  const copy = duplicateConversation(original);
  assert.notEqual(copy.id, original.id);
  assert.notEqual(copy.document.id, original.document.id);
  assert.notEqual(copy.messages[0].id, original.messages[0].id);
  assert.equal(copy.messages[0].sources[0].documentId, copy.document.id);
  assert.equal(copy.messages[0].sources[0].id, 1);
  assert.equal(copy.messages[0].status, 'interrupted');
  assert.equal(copy.documentPage, 2);
  assert.equal(copy.useDocument, false);
  assert.equal(copy.model, original.model);
  copy.document.pages[0].text = 'Cambio';
  copy.messages[0].sources[0].text = 'Cambio';
  assert.deepEqual(original, before);
});

test('rejects whitespace and UTF-8 input exceeding the local context', () => {
  assert.ok(validatePrompt('  \n '));
  assert.ok(validatePrompt('😀'.repeat(800)));
  assert.equal(validatePrompt('Explícame cómo funciona una bicicleta.'), null);
});

test('retains whole turns within budget without losing the latest question', () => {
  const messages = [];
  for (let i = 0; i < 8; i++)
    messages.push(
      newMessage('user', `Pregunta ${i} ` + 'a'.repeat(220)),
      newMessage('assistant', 'b'.repeat(280)),
    );
  messages.push(newMessage('user', 'Mi pregunta final'));
  const result = buildContext(messages);
  assert.equal(result.trimmed, true);
  assert.equal(result.messages[0].role, 'system');
  assert.equal(result.messages.at(-1).content, 'Mi pregunta final');
  assert.equal(result.messages[1].role, 'user');
  assert.ok(
    result.messages
      .slice(1)
      .reduce((sum, message) => sum + new TextEncoder().encode(message.content).length + 32, 0) <=
      INPUT_BUDGET,
  );
  assert.deepEqual(
    result.messages.slice(1).map((message) => message.role),
    Array.from({ length: result.messages.length - 1 }, (_, i) => (i % 2 ? 'assistant' : 'user')),
  );
});

test('excludes interrupted and failed answers from subsequent model context', () => {
  const result = buildContext([
    newMessage('user', 'Pregunta antigua'),
    newMessage('assistant', 'Respuesta falsa parcial', 'error'),
    newMessage('user', 'Pregunta siguiente'),
    newMessage('assistant', 'Cortada', 'interrupted'),
    newMessage('user', 'Ahora'),
    newMessage('assistant', '', 'generating'),
  ]);
  assert.deepEqual(result.messages.slice(1), [{ role: 'user', content: 'Ahora' }]);
});

test('recovery marks a saved in-flight answer as interrupted without mutating it', () => {
  const conversation = newConversation();
  conversation.messages.push(newMessage('assistant', 'Parte de la respuesta', 'generating'));
  const recovered = recoverConversation(conversation);
  assert.equal(recovered.messages[0].status, 'interrupted');
  assert.equal(conversation.messages[0].status, 'generating');
  assert.match(exportMarkdown(recovered), /Parte de la respuesta/);
  assert.match(exportMarkdown(recovered), /respuesta interrumpida/);
});
