// Browser Storage Provider - Phase 2
// IndexedDB-based implementation with AES-GCM encryption

import type {
  User,
  Contact,
  Chat,
  Message,
  AppSettings,
  SecuritySettings,
  BackupData,
  DeviceInfo,
} from '@/types';
import type { StorageProvider } from '../types';
import { encryptData, decryptData } from './encryption';
import { LocalStorageFallback, STORE_KEY_FIELDS } from './fallback';

const DB_NAME = 'SecureChatDB';
const DB_VERSION = 2;

/**
 * Browser storage provider using IndexedDB
 * Falls back to localStorage if IndexedDB is unavailable
 */
export class BrowserStorageProvider implements StorageProvider {
  readonly platform = 'browser' as const;
  private db: IDBDatabase | null = null;
  private fallback: LocalStorageFallback | null = null;
  private encryptionPassphrase: string | null = null;
  private _usingFallback = false;
  private _initPromise: Promise<void> | null = null;

  /** True when IndexedDB was unavailable and localStorage fallback is active */
  get usingFallback(): boolean {
    return this._usingFallback;
  }

  /**
   * Initialize the database.
   * Attempts IndexedDB first; falls back to localStorage if unavailable.
   * Idempotent: safe to call multiple times.
   */
  async init(): Promise<void> {
    if (this.db !== null || this._usingFallback) {
      return;
    }
    if (this._initPromise) {
      return this._initPromise;
    }
    this._initPromise = this._doInit().finally(() => {
      this._initPromise = null;
    });
    return this._initPromise;
  }

  private async _doInit(): Promise<void> {
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
        console.info('[Storage] Running on file:// protocol — using localStorage fallback.');
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

        this.db.onclose = () => {
          console.warn('[Storage] IndexedDB connection closed unexpectedly');
          this.db = null;
          this.initIndexedDB().catch((err) => {
            console.error('[Storage] Failed to reconnect IndexedDB:', err);
          });
        };

        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        if (!db.objectStoreNames.contains('user')) {
          db.createObjectStore('user', { keyPath: 'id' });
        }

        if (!db.objectStoreNames.contains('contacts')) {
          const contactStore = db.createObjectStore('contacts', { keyPath: 'id' });
          contactStore.createIndex('fingerprint', 'fingerprint', { unique: true });
        }

        if (!db.objectStoreNames.contains('chats')) {
          const chatStore = db.createObjectStore('chats', { keyPath: 'id' });
          chatStore.createIndex('contactId', 'contactId', { unique: false });
        }

        if (!db.objectStoreNames.contains('messages')) {
          const messageStore = db.createObjectStore('messages', { keyPath: 'id' });
          messageStore.createIndex('chatId', 'chatId', { unique: false });
          messageStore.createIndex('timestamp', 'timestamp', { unique: false });
          messageStore.createIndex('sequenceNumber', 'sequenceNumber', { unique: false });
        }

        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }

        if (!db.objectStoreNames.contains('devices')) {
          const deviceStore = db.createObjectStore('devices', { keyPath: 'deviceId' });
          deviceStore.createIndex('i2pAddress', 'i2pAddress', { unique: true });
        }
      };

      request.onblocked = () => {
        console.warn('[Storage] IndexedDB open blocked');
      };
    });
  }

  private initLocalStorageFallback(): void {
    this.fallback = new LocalStorageFallback();
    this._usingFallback = true;
    console.log('[Storage] localStorage fallback initialized');
  }

  private getStore(storeName: string, mode: IDBTransactionMode = 'readonly'): IDBObjectStore {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    const transaction = this.db.transaction(storeName, mode);
    return transaction.objectStore(storeName);
  }

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

  // Encryption methods
  setEncryptionPassphrase(passphrase: string): void {
    this.encryptionPassphrase = passphrase;
  }

  clearEncryptionPassphrase(): void {
    this.encryptionPassphrase = null;
  }

  hasEncryptionPassphrase(): boolean {
    return this.encryptionPassphrase !== null;
  }

  // User operations
  async saveUser(user: User): Promise<void> {
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
    const users = (await this.getAllRecords('user')) as User[];
    if (users.length === 0) return null;
    let user = users[0];
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
    return (await this.getRecord('contacts', id)) as Contact | null;
  }

  async getContactByFingerprint(fingerprint: string): Promise<Contact | null> {
    return (await this.getByIndex('contacts', 'fingerprint', fingerprint)) as Contact | null;
  }

  async getAllContacts(): Promise<Contact[]> {
    return (await this.getAllRecords('contacts')) as Contact[];
  }

  async deleteContact(id: string): Promise<void> {
    await this.deleteRecord('contacts', id);
  }

  // Chat operations
  async saveChat(chat: Chat): Promise<void> {
    await this.putRecord('chats', chat as unknown as Record<string, unknown>);
  }

  async getChat(id: string): Promise<Chat | null> {
    return (await this.getRecord('chats', id)) as Chat | null;
  }

  async getChatByContactId(contactId: string): Promise<Chat | null> {
    return (await this.getByIndex('chats', 'contactId', contactId)) as Chat | null;
  }

  async getAllChats(): Promise<Chat[]> {
    return (await this.getAllRecords('chats')) as Chat[];
  }

  async deleteChat(id: string): Promise<void> {
    await this.deleteRecord('chats', id);
  }

  // Message operations
  async saveMessage(message: Message): Promise<void> {
    const messageToStore = { ...message };
    delete (messageToStore as { decryptedContent?: string }).decryptedContent;
    await this.putRecord('messages', messageToStore as unknown as Record<string, unknown>);
  }

  async getMessage(id: string): Promise<Message | null> {
    return (await this.getRecord('messages', id)) as Message | null;
  }

  async getMessagesByChat(chatId: string, limit = 100, offset = 0): Promise<Message[]> {
    if (this.fallback) {
      const all = (await this.getAllRecords('messages')) as Message[];
      const filtered = all
        .filter((m) => m.chatId === chatId)
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
      const all = (await this.getAllRecords('messages')) as Message[];
      return all
        .filter((m) => m.chatId === chatId)
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
    return Math.max(...messages.map((m) => m.sequenceNumber));
  }

  async getAllMessages(): Promise<Message[]> {
    const messages = (await this.getAllRecords('messages')) as Message[];
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
    await this.putRecord('settings', {
      key: 'appSettings',
      ...settings,
    } as unknown as Record<string, unknown>);
  }

  async getSettings(): Promise<AppSettings | null> {
    const result = (await this.getRecord('settings', 'appSettings')) as Record<string, unknown> | null;
    if (!result) return null;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { key: _key, ...settings } = result;
    return settings as unknown as AppSettings;
  }

  async saveSecuritySettings(settings: SecuritySettings): Promise<void> {
    await this.putRecord('settings', {
      key: 'securitySettings',
      ...settings,
    } as unknown as Record<string, unknown>);
  }

  async getSecuritySettings(): Promise<SecuritySettings | null> {
    const result = (await this.getRecord('settings', 'securitySettings')) as Record<string, unknown> | null;
    if (!result) return null;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { key: _key, ...settings } = result;
    return settings as unknown as SecuritySettings;
  }

  // Device operations
  async saveDevice(device: DeviceInfo): Promise<void> {
    await this.putRecord('devices', device as unknown as Record<string, unknown>);
  }

  async getDevice(deviceId: string): Promise<DeviceInfo | null> {
    return (await this.getRecord('devices', deviceId)) as DeviceInfo | null;
  }

  async getDeviceByI2PAddress(i2pAddress: string): Promise<DeviceInfo | null> {
    return (await this.getByIndex('devices', 'i2pAddress', i2pAddress)) as DeviceInfo | null;
  }

  async getAllDevices(): Promise<DeviceInfo[]> {
    return (await this.getAllRecords('devices')) as DeviceInfo[];
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

    const sanitizedMessages = messages.map((msg) => {
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
    await this.clearAllData();

    const allContacts = await this.getAllContacts();
    for (const contact of allContacts) {
      await this.deleteContact(contact.id);
    }

    const allChats = await this.getAllChats();
    for (const chat of allChats) {
      await this.deleteChat(chat.id);
    }

    const allMessages = await this.getAllMessages();
    for (const message of allMessages) {
      await this.deleteMessage(message.id);
    }

    const allDevices = await this.getAllDevices();
    for (const device of allDevices) {
      await this.deleteDevice(device.deviceId);
    }

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

  async clearAllData(): Promise<void> {
    const stores = ['user', 'contacts', 'chats', 'messages', 'settings', 'devices'];
    for (const storeName of stores) {
      await this.clearStore(storeName);
    }
  }
}
