import type { User, Contact, Chat, Message, AppSettings, SecuritySettings, BackupData, DeviceInfo } from '@/types';

const DB_NAME = 'SecureChatDB';
const DB_VERSION = 2;

// Encryption utilities for sensitive data
async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey']
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt.buffer as ArrayBuffer,
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptData(data: string, passphrase: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);
  const encoder = new TextEncoder();
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(data)
  );
  const combined = new Uint8Array(salt.length + iv.length + encrypted.byteLength);
  combined.set(salt);
  combined.set(iv, salt.length);
  combined.set(new Uint8Array(encrypted), salt.length + iv.length);
  return btoa(String.fromCharCode(...combined));
}

async function decryptData(encryptedBase64: string, passphrase: string): Promise<string> {
  const combined = new Uint8Array(atob(encryptedBase64).split('').map(c => c.charCodeAt(0)));
  const salt = combined.slice(0, 16);
  const iv = combined.slice(16, 28);
  const encrypted = combined.slice(28);
  const key = await deriveKey(passphrase, salt);
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    encrypted
  );
  return new TextDecoder().decode(decrypted);
}

/**
 * localStorage-based fallback storage for environments where IndexedDB is unavailable
 * (e.g. file:// protocol in some browsers).
 */
class LocalStorageFallback {
  private prefix = 'secuchat_';

  private key(store: string): string {
    return `${this.prefix}${store}`;
  }

  private load(store: string): Record<string, unknown> {
    try {
      const raw = localStorage.getItem(this.key(store));
      return raw ? JSON.parse(raw) : {};
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
    data[id] = value;
    this.save(store, data);
  }

  get(store: string, id: string): unknown | null {
    const data = this.load(store);
    return data[id] ?? null;
  }

  getAll(store: string): unknown[] {
    return Object.values(this.load(store));
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
    return all.find(item => item[field] === value) ?? null;
  }
}

/** Key field for each object store */
const STORE_KEY_FIELDS: Record<string, string> = {
  user: 'id',
  contacts: 'id',
  chats: 'id',
  messages: 'id',
  settings: 'key',
  devices: 'deviceId',
};

export class StorageService {
  private static instance: StorageService;
  private db: IDBDatabase | null = null;
  private fallback: LocalStorageFallback | null = null;
  private encryptionPassphrase: string | null = null;
  private _usingFallback = false;
  private _initPromise: Promise<void> | null = null;

  /** True when IndexedDB was unavailable and localStorage fallback is active */
  get usingFallback(): boolean {
    return this._usingFallback;
  }

  static getInstance(): StorageService {
    if (!StorageService.instance) {
      StorageService.instance = new StorageService();
    }
    return StorageService.instance;
  }

  /**
   * Set the encryption passphrase for sensitive data
   */
  setEncryptionPassphrase(passphrase: string): void {
    this.encryptionPassphrase = passphrase;
  }

  /**
   * Clear the encryption passphrase (e.g., on lock)
   */
  clearEncryptionPassphrase(): void {
    this.encryptionPassphrase = null;
  }

  /**
   * Check if encryption passphrase is set
   */
  hasEncryptionPassphrase(): boolean {
    return this.encryptionPassphrase !== null;
  }

  /**
   * Initialize the database.
   * Attempts IndexedDB first; falls back to localStorage if IndexedDB is
   * unavailable (common on file:// protocol).
   *
   * Idempotent: safe to call multiple times — subsequent calls are no-ops
   * if already initialized. Concurrent calls share a single in-flight Promise.
   */
  async init(): Promise<void> {
    // Already initialized — return immediately
    if (this.db !== null || this._usingFallback) {
      return;
    }
    // Deduplicate concurrent init calls
    if (this._initPromise) {
      return this._initPromise;
    }
    this._initPromise = this._doInit().finally(() => {
      this._initPromise = null;
    });
    return this._initPromise;
  }

  private async _doInit(): Promise<void> {
    // Detect environments where IndexedDB is known to be broken
    const isFileProtocol = typeof location !== 'undefined' && location.protocol === 'file:';

    try {
      if (typeof indexedDB === 'undefined') {
        throw new Error('IndexedDB API not available');
      }
      await this.initIndexedDB();
      console.log('[Storage] IndexedDB initialized successfully');
    } catch (error) {
      console.warn('[Storage] IndexedDB init failed, falling back to localStorage:', error);
      if (isFileProtocol) {
        console.info('[Storage] Running on file:// protocol — IndexedDB may not be fully supported. Using localStorage fallback.');
      }
      this.initLocalStorageFallback();
    }
  }

  private async initIndexedDB(): Promise<void> {
    return new Promise((resolve, reject) => {
      let request: IDBOpenDBRequest;
      try {
        request = indexedDB.open(DB_NAME, DB_VERSION);
      } catch (err) {
        reject(err);
        return;
      }

      // Timeout — some browsers hang silently on file://
      const timeout = setTimeout(() => {
        reject(new Error('IndexedDB open timed out'));
      }, 5000);

      request.onerror = () => {
        clearTimeout(timeout);
        reject(request.error);
      };
      request.onsuccess = () => {
        clearTimeout(timeout);
        this.db = request.result;

        // Handle unexpected close (e.g. storage cleared by browser).
        // Null out the reference so the next init() call will re-open it.
        this.db.onclose = () => {
          console.warn('[Storage] IndexedDB connection closed unexpectedly — will reconnect on next access');
          this.db = null;
          // Proactively re-open so the connection is ready for the next operation
          this.initIndexedDB().catch((err) => {
            console.error('[Storage] Failed to reconnect IndexedDB after unexpected close:', err);
          });
        };

        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // User store
        if (!db.objectStoreNames.contains('user')) {
          db.createObjectStore('user', { keyPath: 'id' });
        }

        // Contacts store
        if (!db.objectStoreNames.contains('contacts')) {
          const contactStore = db.createObjectStore('contacts', { keyPath: 'id' });
          contactStore.createIndex('fingerprint', 'fingerprint', { unique: true });
        }

        // Chats store
        if (!db.objectStoreNames.contains('chats')) {
          const chatStore = db.createObjectStore('chats', { keyPath: 'id' });
          chatStore.createIndex('contactId', 'contactId', { unique: false });
        }

        // Messages store
        if (!db.objectStoreNames.contains('messages')) {
          const messageStore = db.createObjectStore('messages', { keyPath: 'id' });
          messageStore.createIndex('chatId', 'chatId', { unique: false });
          messageStore.createIndex('timestamp', 'timestamp', { unique: false });
          messageStore.createIndex('sequenceNumber', 'sequenceNumber', { unique: false });
        }

        // Settings store
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }

        // Devices store (for multi-device sync)
        if (!db.objectStoreNames.contains('devices')) {
          const deviceStore = db.createObjectStore('devices', { keyPath: 'deviceId' });
          deviceStore.createIndex('i2pAddress', 'i2pAddress', { unique: true });
        }
      };

      request.onblocked = () => {
        console.warn('[Storage] IndexedDB open blocked — another connection may be open');
      };
    });
  }

  private initLocalStorageFallback(): void {
    this.fallback = new LocalStorageFallback();
    this._usingFallback = true;
    console.log('[Storage] localStorage fallback initialized');
  }

  /**
   * Get a store reference (IndexedDB mode only)
   */
  private getStore(storeName: string, mode: IDBTransactionMode = 'readonly'): IDBObjectStore {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    const transaction = this.db.transaction(storeName, mode);
    return transaction.objectStore(storeName);
  }

  /** Helper: put a record (works with both backends) */
  private async putRecord(storeName: string, value: Record<string, unknown>): Promise<void> {
    if (this.fallback) {
      this.fallback.put(storeName, STORE_KEY_FIELDS[storeName], value);
      return;
    }
    const store = this.getStore(storeName, 'readwrite');
    return new Promise((resolve, reject) => {
      const request = store.put(value);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /** Helper: get a single record by key */
  private async getRecord(storeName: string, key: string): Promise<unknown | null> {
    if (this.fallback) {
      return this.fallback.get(storeName, key);
    }
    const store = this.getStore(storeName);
    return new Promise((resolve, reject) => {
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
  }

  /** Helper: get all records from a store */
  private async getAllRecords(storeName: string): Promise<unknown[]> {
    if (this.fallback) {
      return this.fallback.getAll(storeName);
    }
    const store = this.getStore(storeName);
    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /** Helper: delete a record by key */
  private async deleteRecord(storeName: string, key: string): Promise<void> {
    if (this.fallback) {
      this.fallback.remove(storeName, key);
      return;
    }
    const store = this.getStore(storeName, 'readwrite');
    return new Promise((resolve, reject) => {
      const request = store.delete(key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /** Helper: clear an entire store */
  private async clearStore(storeName: string): Promise<void> {
    if (this.fallback) {
      this.fallback.clear(storeName);
      return;
    }
    const store = this.getStore(storeName, 'readwrite');
    return new Promise((resolve, reject) => {
      const request = store.clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /** Helper: get a record by index field value */
  private async getByIndex(storeName: string, field: string, value: string): Promise<unknown | null> {
    if (this.fallback) {
      return this.fallback.getByIndex(storeName, field, value);
    }
    const store = this.getStore(storeName);
    return new Promise((resolve, reject) => {
      const index = store.index(field);
      const request = index.get(value);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
  }

  // User operations
  async saveUser(user: User): Promise<void> {
    // Encrypt sensitive fields if passphrase is set
    let userToStore = user;
    if (this.encryptionPassphrase && (user.pgpPrivateKey || user.i2pPrivateKey)) {
      userToStore = { ...user };
      if (user.pgpPrivateKey) {
        userToStore.pgpPrivateKey = await encryptData(user.pgpPrivateKey, this.encryptionPassphrase);
      }
      if (user.i2pPrivateKey) {
        userToStore.i2pPrivateKey = await encryptData(user.i2pPrivateKey, this.encryptionPassphrase);
      }
    }
    await this.putRecord('user', userToStore as unknown as Record<string, unknown>);
  }

  async getUser(): Promise<User | null> {
    const users = await this.getAllRecords('user') as User[];
    if (users.length === 0) return null;
    let user = users[0];
    // Decrypt sensitive fields if passphrase is set
    if (this.encryptionPassphrase && (user.pgpPrivateKey || user.i2pPrivateKey)) {
      try {
        user = { ...user };
        if (user.pgpPrivateKey) {
          user.pgpPrivateKey = await decryptData(user.pgpPrivateKey, this.encryptionPassphrase);
        }
        if (user.i2pPrivateKey) {
          user.i2pPrivateKey = await decryptData(user.i2pPrivateKey, this.encryptionPassphrase);
        }
      } catch (error) {
        console.error('Failed to decrypt user data:', error);
        // Rethrow so callers (e.g. unlockApp) know decryption failed (wrong passphrase).
        // Swallowing here would return a user with an encrypted blob as pgpPrivateKey,
        // which then causes a misleading "Misformed armored text" error downstream.
        throw new Error('Falsches Passwort oder Daten beschädigt');
      }
    }
    return user;
  }

  async deleteUser(): Promise<void> {
    await this.clearStore('user');
  }

  // Contact operations
  async saveContact(contact: Contact): Promise<void> {
    await this.putRecord('contacts', contact as unknown as Record<string, unknown>);
  }

  async getContact(id: string): Promise<Contact | null> {
    return await this.getRecord('contacts', id) as Contact | null;
  }

  async getContactByFingerprint(fingerprint: string): Promise<Contact | null> {
    return await this.getByIndex('contacts', 'fingerprint', fingerprint) as Contact | null;
  }

  async getAllContacts(): Promise<Contact[]> {
    return await this.getAllRecords('contacts') as Contact[];
  }

  async deleteContact(id: string): Promise<void> {
    await this.deleteRecord('contacts', id);
  }

  // Chat operations
  async saveChat(chat: Chat): Promise<void> {
    await this.putRecord('chats', chat as unknown as Record<string, unknown>);
  }

  async getChat(id: string): Promise<Chat | null> {
    return await this.getRecord('chats', id) as Chat | null;
  }

  async getChatByContactId(contactId: string): Promise<Chat | null> {
    return await this.getByIndex('chats', 'contactId', contactId) as Chat | null;
  }

  async getAllChats(): Promise<Chat[]> {
    return await this.getAllRecords('chats') as Chat[];
  }

  async deleteChat(id: string): Promise<void> {
    await this.deleteRecord('chats', id);
  }

  // Message operations
  async saveMessage(message: Message): Promise<void> {
    // IMPORTANT: Never store decryptedContent in database for security
    const messageToStore = { ...message };
    delete (messageToStore as { decryptedContent?: string }).decryptedContent;
    await this.putRecord('messages', messageToStore as unknown as Record<string, unknown>);
  }

  async getMessage(id: string): Promise<Message | null> {
    return await this.getRecord('messages', id) as Message | null;
  }

  async getMessagesByChat(chatId: string, limit: number = 100, offset: number = 0): Promise<Message[]> {
    if (this.fallback) {
      const all = await this.getAllRecords('messages') as Message[];
      const filtered = all
        .filter(m => m.chatId === chatId)
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      return filtered.slice(offset, offset + limit);
    }
    const store = this.getStore('messages');
    return new Promise((resolve, reject) => {
      const index = store.index('timestamp');
      const request = index.openCursor(null, 'prev');
      const messages: Message[] = [];
      let skipped = 0;

      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          const message = cursor.value as Message;
          if (message.chatId === chatId) {
            if (skipped < offset) {
              skipped++;
            } else if (messages.length < limit) {
              messages.push(message);
            }
          }
          cursor.continue();
        } else {
          resolve(messages);
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  async getMessagesByChatId(chatId: string): Promise<Message[]> {
    if (this.fallback) {
      const all = await this.getAllRecords('messages') as Message[];
      return all
        .filter(m => m.chatId === chatId)
        .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    }
    const store = this.getStore('messages');
    return new Promise((resolve, reject) => {
      const index = store.index('chatId');
      const request = index.getAll(chatId);
      request.onsuccess = () => {
        const messages = request.result as Message[];
        messages.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
        resolve(messages);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async getLastMessageSequence(chatId: string): Promise<number> {
    const messages = await this.getMessagesByChatId(chatId);
    if (messages.length === 0) return 0;
    return Math.max(...messages.map(m => m.sequenceNumber));
  }

  async getAllMessages(): Promise<Message[]> {
    const messages = await this.getAllRecords('messages') as Message[];
    messages.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    return messages;
  }

  async deleteMessage(id: string): Promise<void> {
    await this.deleteRecord('messages', id);
  }

  async deleteMessagesByChat(chatId: string): Promise<void> {
    const messages = await this.getMessagesByChatId(chatId);
    for (const message of messages) {
      await this.deleteMessage(message.id);
    }
  }

  // Settings operations
  async saveSettings(settings: AppSettings): Promise<void> {
    await this.putRecord('settings', { key: 'appSettings', ...settings } as unknown as Record<string, unknown>);
  }

  async getSettings(): Promise<AppSettings | null> {
    const result = await this.getRecord('settings', 'appSettings') as Record<string, unknown> | null;
    if (!result) return null;
    const settings = { ...result };
    delete settings.key;
    return settings as unknown as AppSettings;
  }

  async saveSecuritySettings(settings: SecuritySettings): Promise<void> {
    await this.putRecord('settings', { key: 'securitySettings', ...settings } as unknown as Record<string, unknown>);
  }

  async getSecuritySettings(): Promise<SecuritySettings | null> {
    const result = await this.getRecord('settings', 'securitySettings') as Record<string, unknown> | null;
    if (!result) return null;
    const settings = { ...result };
    delete settings.key;
    return settings as unknown as SecuritySettings;
  }

  // Device operations (multi-device sync)
  async saveDevice(device: DeviceInfo): Promise<void> {
    await this.putRecord('devices', device as unknown as Record<string, unknown>);
  }

  async getDevice(deviceId: string): Promise<DeviceInfo | null> {
    return await this.getRecord('devices', deviceId) as DeviceInfo | null;
  }

  async getDeviceByI2PAddress(i2pAddress: string): Promise<DeviceInfo | null> {
    return await this.getByIndex('devices', 'i2pAddress', i2pAddress) as DeviceInfo | null;
  }

  async getAllDevices(): Promise<DeviceInfo[]> {
    return await this.getAllRecords('devices') as DeviceInfo[];
  }

  async deleteDevice(deviceId: string): Promise<void> {
    await this.deleteRecord('devices', deviceId);
  }

  // Backup and restore
  async createBackup(): Promise<BackupData> {
    const user = await this.getUser();
    const contacts = await this.getAllContacts();
    const chats = await this.getAllChats();
    const messages = await this.getAllMessages();
    const devices = await this.getAllDevices();

    // Ensure no decrypted content is included in backup for security
    const sanitizedMessages = messages.map(msg => {
      const sanitized = { ...msg };
      delete (sanitized as { decryptedContent?: string }).decryptedContent;
      return sanitized;
    });

    return {
      version: '2.0',
      timestamp: new Date().toISOString(),
      user: user!,
      contacts,
      chats,
      messages: sanitizedMessages,
      devices,
    };
  }

  async restoreBackup(backup: BackupData): Promise<void> {
    // Clear existing data
    await this.deleteUser();
    
    const allContacts = await this.getAllContacts();
    for (const contact of allContacts) {
      await this.deleteContact(contact.id);
    }

    const allChats = await this.getAllChats();
    for (const chat of allChats) {
      await this.deleteChat(chat.id);
    }

    // Delete all existing messages
    const allMessages = await this.getAllMessages();
    for (const message of allMessages) {
      await this.deleteMessage(message.id);
    }

    // Delete all existing devices
    const allDevices = await this.getAllDevices();
    for (const device of allDevices) {
      await this.deleteDevice(device.deviceId);
    }

    // Restore data
    if (backup.user) {
      await this.saveUser(backup.user);
    }

    for (const contact of backup.contacts) {
      await this.saveContact(contact);
    }

    for (const chat of backup.chats) {
      await this.saveChat(chat);
    }

    for (const message of backup.messages) {
      await this.saveMessage(message);
    }

    for (const device of backup.devices || []) {
      await this.saveDevice(device);
    }
  }

  // Clear all data
  async clearAllData(): Promise<void> {
    const stores = ['user', 'contacts', 'chats', 'messages', 'settings', 'devices'];
    for (const storeName of stores) {
      await this.clearStore(storeName);
    }
  }
}

export const storageService = StorageService.getInstance();
