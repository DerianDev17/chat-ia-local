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
        fail(new Error('Cierra otras pestañas de Local y vuelve a abrir esta página.'));
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
      const request = action(tx.objectStore('conversations'));
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = () =>
        reject(tx.error || request.error || new Error('No se pudieron guardar los datos.'));
      tx.onerror = () => reject(tx.error || request.error);
    });
  }

  async list() {
    await this.queue;
    return this.transaction('readonly', (store) => store.getAll());
  }

  write(action) {
    const operation = this.queue.then(() => this.transaction('readwrite', action));
    this.queue = operation.catch(() => {});
    return operation;
  }

  save(conversation) {
    const snapshot = structuredClone(conversation);
    return this.write((store) => store.put(snapshot));
  }

  delete(id) {
    return this.write((store) => store.delete(id));
  }
  clear() {
    return this.write((store) => store.clear());
  }
  close() {
    this.db?.close();
  }
}
