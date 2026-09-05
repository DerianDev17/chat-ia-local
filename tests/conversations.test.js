import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildContext,
  exportMarkdown,
  newConversation,
  newMessage,
  recoverConversation,
  validatePrompt,
  INPUT_BUDGET,
} from '../src/conversations.js';

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
