import test from 'node:test';
import assert from 'node:assert/strict';
import { readDocument, splitDocument, MAX_DOCUMENT_BYTES } from '../src/documents.js';
import { ConversationStore } from '../src/storage.js';
import { newConversation } from '../src/conversations.js';
import { IDBFactory } from 'fake-indexeddb';

const file = (text, name = 'apuntes.txt') => new File([text], name);

test('reads UTF-8 text and preserves original text and stable fragment offsets', async () => {
  const text = 'Línea con acentos: ñáé y emoji 😀.\n'.repeat(150);
  const document = await readDocument(file(text, 'Apuntes.MD'));
  assert.equal(document.text, text);
  assert.ok(document.chunks.length > 1);
  for (const [index, chunk] of document.chunks.entries()) {
    assert.equal(chunk.id, index + 1);
    assert.equal(chunk.text, text.slice(chunk.start, chunk.end));
    assert.ok(new TextEncoder().encode(chunk.text).length <= 600);
    assert.doesNotMatch(chunk.text, /\uFFFD/);
  }
  assert.equal(document.chunks.map((chunk) => chunk.text).join(''), text);
  assert.deepEqual(splitDocument(text), document.chunks);
});

test('rejects unsupported, oversized, empty, invalid UTF-8 and binary files', async () => {
  await assert.rejects(readDocument(file('texto', 'datos.pdf')), /\.txt o \.md/);
  await assert.rejects(readDocument(file('x'.repeat(MAX_DOCUMENT_BYTES + 1))), /100 KB/);
  await assert.rejects(readDocument(file('   \n')), /vacío/);
  await assert.rejects(readDocument(file('abc\x00')), /binarios/);
  await assert.rejects(readDocument(new File([new Uint8Array([0xff])], 'x.txt')), /UTF-8/);
  await assert.rejects(
    readDocument({
      name: 'x.txt',
      size: 1,
      async arrayBuffer() {
        return new ArrayBuffer(MAX_DOCUMENT_BYTES + 1);
      },
    }),
    /100 KB/,
  );
});

test('stores a document without messages, restores it and deletes it with its conversation', async () => {
  const factory = new IDBFactory();
  const store = await new ConversationStore(factory).open();
  const conversation = newConversation();
  conversation.document = await readDocument(
    file('<script>not executable</script>\nApuntes personales'),
  );
  await store.save(conversation);
  store.close();
  const reopened = await new ConversationStore(factory).open();
  assert.deepEqual((await reopened.list())[0].document, conversation.document);
  await reopened.delete(conversation.id);
  assert.deepEqual(await reopened.list(), []);
  reopened.close();
});
