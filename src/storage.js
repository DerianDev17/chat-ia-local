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
      const request = this.factory.open(this.name, 1);
      let failed = false;
      const fail = (error) => {
        failed = true;
        reject(error);
      };
      request.onupgradeneeded = () =>
        request.result.createObjectStore('conversations', { keyPath: 'id' });
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

  transaction(mode, action) {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Almacenamiento no disponible.'));
        return;
      }
      const tx = this.db.transaction('conversations', mode);
      const result = action(tx.objectStore('conversations'));
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

  write(action) {
    const operation = this.queue.then(() => this.transaction('readwrite', action));
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
    return this.write((store) => {
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
        result.deleted = true;
      };
      return result;
    }).then((result) => result.deleted);
  }

  clear() {
    return this.write((store) => {
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
      };
      return result;
    }).then((result) => result.cleared);
  }
  close() {
    this.db?.close();
  }
}
