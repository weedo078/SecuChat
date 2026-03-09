// LocalStorage Fallback - Phase 2
// Fallback storage for environments where IndexedDB is unavailable
// (e.g., file:// protocol in some browsers)

/** Key field mapping for each object store */
export const STORE_KEY_FIELDS: Record<string, string> = {
  user: 'id',
  contacts: 'id',
  chats: 'id',
  messages: 'id',
  settings: 'key',
  devices: 'deviceId',
};

/**
 * localStorage-based fallback storage
 * Used when IndexedDB is unavailable (common on file:// protocol)
 */
export class LocalStorageFallback {
  private prefix = 'secuchat_';

  private key(store: string): string {
    return `${this.prefix}${store}`;
  }

  private load(store: string): Record<string, unknown> {
    try {
      const raw = localStorage.getItem(this.key(store));
      return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }

  private save(store: string, data: Record<string, unknown>): void {
    localStorage.setItem(this.key(store), JSON.stringify(data));
  }

  put(store: string, keyField: string, value: Record<string, unknown>): void {
    const data = this.load(store);
    const id = value[keyField] as string;
    console.log('[Storage Fallback] Saving to', store, 'id:', id);
    data[id] = value;
    this.save(store, data);
    console.log('[Storage Fallback] Saved, total items in', store, ':', Object.keys(data).length);
  }

  get(store: string, id: string): unknown | null {
    const data = this.load(store);
    return (data[id] as unknown) ?? null;
  }

  getAll(store: string): unknown[] {
    const data = this.load(store);
    const items = Object.values(data);
    console.log('[Storage Fallback] Loading from', store, ', found', items.length, 'items');
    return items;
  }

  remove(store: string, id: string): void {
    const data = this.load(store);
    delete data[id];
    this.save(store, data);
  }

  clear(store: string): void {
    localStorage.removeItem(this.key(store));
  }

  getByIndex(store: string, field: string, value: string): unknown | null {
    const all = this.getAll(store) as Record<string, unknown>[];
    return all.find((item) => item[field] === value) ?? null;
  }

  /** Check if localStorage is available */
  static isAvailable(): boolean {
    try {
      const test = '__storage_test__';
      localStorage.setItem(test, test);
      localStorage.removeItem(test);
      return true;
    } catch {
      return false;
    }
  }
}
