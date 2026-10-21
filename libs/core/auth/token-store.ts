import { Injectable } from '@angular/core';

export interface StoredTokens {
  readonly token: string;
  readonly refreshToken: string;
  readonly idToken?: string;
}

const DB = 'fullstar-auth';
const STORE = 'tokens';
const KEY = 'session';

/**
 * Schema §8.1: the installed PWA keeps its refresh token in IndexedDB. Every failure (private
 * window, blocked storage) falls back to signing in again; nothing here is required to work.
 */
@Injectable({ providedIn: 'root' })
export class TokenStore {
  async read(): Promise<StoredTokens | null> {
    try {
      const value = await this.run<unknown>('readonly', (store) => store.get(KEY));
      return isStoredTokens(value) ? value : null;
    } catch {
      return null;
    }
  }

  async write(tokens: StoredTokens): Promise<void> {
    try {
      await this.run('readwrite', (store) => store.put(tokens, KEY));
    } catch {
      // Storage unavailable: the session lasts until the tab closes
    }
  }

  async clear(): Promise<void> {
    try {
      await this.run('readwrite', (store) => store.delete(KEY));
    } catch {
      // Nothing stored
    }
  }

  private async run<T>(
    mode: IDBTransactionMode,
    action: (store: IDBObjectStore) => IDBRequest,
  ): Promise<T> {
    const db = await open();
    try {
      return await new Promise<T>((resolve, reject) => {
        const request = action(db.transaction(STORE, mode).objectStore(STORE));
        request.onsuccess = () => resolve(request.result as T);
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  }
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function isStoredTokens(value: unknown): value is StoredTokens {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record['token'] === 'string' && typeof record['refreshToken'] === 'string';
}
