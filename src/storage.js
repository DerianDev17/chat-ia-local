const CLEAR_TOMBSTONE_ID = '__semilla_clear__';

const isTombstone = (record) => Boolean(record?.__tombstone);

export class ConversationStore {
  constructor(factory = globalThis.indexedDB, name = 'local-chat') {
    this.factory = factory;
    this.name = name;
    this.queue = Promise.resolve();
  }

  async open() {
    if (!this.factory) throw new Error('El almacenamiento local no está disponible.');
    this.db = await new Promise((resolve, reject) => {
      const request = this.factory.open(this.name, 2);
      let failed = false;
      const fail = (error) => {
        failed = true;
        reject(error);
      };
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('conversations'))
          request.result.createObjectStore('conversations', { keyPath: 'id' });
        if (!request.result.objectStoreNames.contains('knowledge'))
          request.result.createObjectStore('knowledge', { keyPath: 'id' });
      };
      request.onerror = () => fail(request.error);
      request.onblocked = () =>
        fail(new Error('Cierra otras pestañas de Semilla Digital y vuelve a abrir esta página.'));
      request.onsuccess = () => {
        if (failed) {
          request.result.close();
          return;
        }
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
    });
    return this;
  }

  transaction(mode, action, name = 'conversations') {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Almacenamiento no disponible.'));
        return;
      }
      const tx = this.db.transaction(name, mode);
      const result = action(tx.objectStore(Array.isArray(name) ? name[0] : name), tx);
      tx.oncomplete = () => resolve(result?.result ?? result);
      tx.onabort = () =>
        reject(tx.error || result?.error || new Error('No se pudieron guardar los datos.'));
      tx.onerror = () => reject(tx.error || result?.error);
    });
  }

  async list() {
    await this.queue;
    const records = await this.transaction('readonly', (store) => store.getAll());
    return records.filter((record) => !isTombstone(record));
  }

  async get(id) {
    await this.queue;
    const record = await this.transaction('readonly', (store) => store.get(id));
    return isTombstone(record) ? undefined : record;
  }

  write(action, name = 'conversations') {
    const operation = this.queue.then(() => this.transaction('readwrite', action, name));
    this.queue = operation.catch(() => {});
    return operation;
  }

  save(conversation) {
    const snapshot = structuredClone(conversation);
    return this.write((store) => {
      const current = store.get(snapshot.id);
      const cleared = store.get(CLEAR_TOMBSTONE_ID);
      const result = { saved: false };
      let pending = 2;
      const decide = () => {
        pending -= 1;
        if (pending) return;
        const currentRecord = current.result;
        const blockedByDelete =
          isTombstone(currentRecord) && currentRecord.updatedAt >= snapshot.updatedAt;
        const blockedByClear = cleared.result?.updatedAt >= snapshot.updatedAt;
        const blockedByNewerVersion =
          currentRecord &&
          !isTombstone(currentRecord) &&
          currentRecord.updatedAt > snapshot.updatedAt;
        if (blockedByDelete || blockedByClear || blockedByNewerVersion) return;
        store.put(snapshot);
        result.saved = true;
      };
      current.onsuccess = decide;
      cleared.onsuccess = decide;
      return result;
    }).then((result) => result.saved);
  }

  delete(id, expectedUpdatedAt = Number.POSITIVE_INFINITY) {
    return this.write(
      (store, tx) => {
        const current = store.get(id);
        const result = { deleted: false };
        current.onsuccess = () => {
          if (
            current.result &&
            !isTombstone(current.result) &&
            current.result.updatedAt > expectedUpdatedAt
          )
            return;
          store.put({
            id,
            __tombstone: 'conversation',
            updatedAt: Date.now(),
          });
          const knowledge = tx.objectStore('knowledge');
          const entries = knowledge.getAll();
          entries.onsuccess = () => {
            for (const entry of entries.result)
              if (entry.origin?.conversationId === id) knowledge.delete(entry.id);
          };
          result.deleted = true;
        };
        return result;
      },
      ['conversations', 'knowledge'],
    ).then((result) => result.deleted);
  }

  clear() {
    return this.write(
      (store, tx) => {
        const records = store.getAll();
        const result = { cleared: false };
        records.onsuccess = () => {
          for (const record of records.result) store.delete(record.id);
          store.put({
            id: CLEAR_TOMBSTONE_ID,
            __tombstone: 'clear',
            updatedAt: Date.now(),
          });
          result.cleared = true;
          const knowledge = tx.objectStore('knowledge');
          const entries = knowledge.getAll();
          entries.onsuccess = () => {
            for (const entry of entries.result)
              if (entry.origin?.conversationId) knowledge.delete(entry.id);
          };
        };
        return result;
      },
      ['conversations', 'knowledge'],
    ).then((result) => result.cleared);
  }

  async listKnowledge() {
    await this.queue;
    return this.transaction('readonly', (store) => store.getAll(), 'knowledge');
  }

  saveKnowledge(entry, expectedUpdatedAt = null) {
    const snapshot = structuredClone(entry);
    return this.write(
      (store, tx) => {
        const result = { saved: false };
        const current = store.get(snapshot.id);
        current.onsuccess = () => {
          if (expectedUpdatedAt !== null && current.result?.updatedAt !== expectedUpdatedAt) return;
          const put = () => {
            const count = store.count();
            count.onsuccess = () => {
              if (!current.result && count.result >= 100) return;
              store.put(snapshot);
              result.saved = true;
            };
          };
          if (snapshot.origin?.conversationId) {
            const conversation = tx
              .objectStore('conversations')
              .get(snapshot.origin.conversationId);
            conversation.onsuccess = () => {
              if (conversation.result && !isTombstone(conversation.result)) put();
            };
          } else put();
        };
        return result;
      },
      ['knowledge', 'conversations'],
    ).then((result) => result.saved);
  }

  deleteKnowledge(id, expectedUpdatedAt = null) {
    return this.write((store) => {
      const result = { deleted: false };
      const current = store.get(id);
      current.onsuccess = () => {
        if (expectedUpdatedAt !== null && current.result?.updatedAt !== expectedUpdatedAt) return;
        store.delete(id);
        result.deleted = true;
      };
      return result;
    }, 'knowledge').then((result) => result.deleted);
  }
  close() {
    this.db?.close();
  }
}
