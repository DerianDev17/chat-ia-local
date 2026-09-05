import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { ConversationStore } from '../src/storage.js';
import { newConversation, newMessage } from '../src/conversations.js';

test('persists snapshots across reopening, and serializes writes before deletion', async () => {
  const factory = new IDBFactory();
  const store = await new ConversationStore(factory).open();
  const conversation = newConversation();
  conversation.messages.push(newMessage('user', 'Hola'));
  const saving = store.save(conversation);
  conversation.title = 'Cambio todavía no guardado';
  await saving;
  store.close();
  const reopened = await new ConversationStore(factory).open();
  assert.equal((await reopened.list())[0].title, 'Nueva conversación');
  await Promise.all([reopened.save(conversation), reopened.delete(conversation.id)]);
  assert.deepEqual(await reopened.list(), []);
  await reopened.save(conversation);
  await reopened.clear();
  assert.deepEqual(await reopened.list(), []);
  reopened.close();
});

test('surfaces unavailable storage instead of pretending to save', async () => {
  const store = new ConversationStore(null);
  await assert.rejects(store.open(), /no está disponible/);
  await assert.rejects(store.save(newConversation()), /no disponible/);
});
