/** Durable local evidence bytes, kept out of localStorage's small JSON quota. */
const DB_NAME = 'suraksha.evidence.v1';
const STORE = 'files';

async function database(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') throw new Error('Evidence storage is unavailable on this device.');
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Could not open evidence storage.'));
  });
}

async function transact<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await database();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = run(tx.objectStore(STORE));
    tx.oncomplete = () => { db.close(); resolve(request.result); };
    tx.onabort = tx.onerror = () => { db.close(); reject(new Error('Evidence could not be saved or read. Check available device storage.')); };
  });
}

export const evidenceStorage = {
  async put(id: string, buffer: ArrayBuffer, mimeType: string): Promise<void> {
    await transact('readwrite', (s) => s.put({ buffer, mimeType }, id));
  },
  async get(id: string): Promise<Blob> {
    const value = await transact<{ buffer: ArrayBuffer; mimeType: string } | undefined>('readonly', (s) => s.get(id));
    if (!value) throw new Error('The original file is not available on this device.');
    return new Blob([value.buffer], { type: value.mimeType });
  },
  async remove(id: string): Promise<void> { await transact('readwrite', (s) => s.delete(id)); },
  async clear(): Promise<void> { await transact('readwrite', (s) => s.clear()); },
};
