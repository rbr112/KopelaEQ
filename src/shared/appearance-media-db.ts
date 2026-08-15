export type StoredImageFit = 'cover' | 'contain';
export type StoredImageMime = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';

export interface StoredImageRecord {
  themeId: string;
  blob: Blob;
  filename: string;
  mimeType: StoredImageMime;
  size: number;
  fit: StoredImageFit;
  updatedAt: number;
}

export const APPEARANCE_DB_NAME = 'kopelaeq-appearance';
export const APPEARANCE_DB_VERSION = 2;
export const ARTWORK_STORE_NAME = 'artwork';
export const BACKGROUND_STORE_NAME = 'background';

export function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed.'));
  });
}


export function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted.'));
    transaction.onerror = () => reject(transaction.error || new Error('IndexedDB transaction failed.'));
  });
}

let dbPromise: Promise<IDBDatabase> | null = null;
export function openAppearanceDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('Local image storage is unavailable in this browser context.'));
      return;
    }
    const request = indexedDB.open(APPEARANCE_DB_NAME, APPEARANCE_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(ARTWORK_STORE_NAME)) db.createObjectStore(ARTWORK_STORE_NAME, { keyPath: 'themeId' });
      if (!db.objectStoreNames.contains(BACKGROUND_STORE_NAME)) db.createObjectStore(BACKGROUND_STORE_NAME, { keyPath: 'themeId' });
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        if (dbPromise) dbPromise = null;
      };
      resolve(db);
    };
    request.onerror = () => reject(request.error || new Error('Could not open local image storage.'));
    request.onblocked = () => reject(new Error('Local image storage is blocked by another KopelaEQ window.'));
  }).catch((error) => {
    dbPromise = null;
    throw error;
  });
  return dbPromise;
}
