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

export class StorageService {
  private static instance: StorageService;
  private db: IDBDatabase | null = null;
  private encryptionPassphrase: string | null = null;

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
   * Initialize the database
   */
  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
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
    });
  }

  /**
   * Get a store reference
   */
  private getStore(storeName: string, mode: IDBTransactionMode = 'readonly'): IDBObjectStore {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    const transaction = this.db.transaction(storeName, mode);
    return transaction.objectStore(storeName);
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
    const store = this.getStore('user', 'readwrite');
    return new Promise((resolve, reject) => {
      const request = store.put(userToStore);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getUser(): Promise<User | null> {
    const store = this.getStore('user');
    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = async () => {
        const users = request.result;
        if (users.length === 0) {
          resolve(null);
          return;
        }
        let user = users[0] as User;
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
            // Return user without decrypted keys if decryption fails
          }
        }
        resolve(user);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async deleteUser(): Promise<void> {
    const store = this.getStore('user', 'readwrite');
    return new Promise((resolve, reject) => {
      const request = store.clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // Contact operations
  async saveContact(contact: Contact): Promise<void> {
    const store = this.getStore('contacts', 'readwrite');
    return new Promise((resolve, reject) => {
      const request = store.put(contact);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getContact(id: string): Promise<Contact | null> {
    const store = this.getStore('contacts');
    return new Promise((resolve, reject) => {
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  async getContactByFingerprint(fingerprint: string): Promise<Contact | null> {
    const store = this.getStore('contacts');
    return new Promise((resolve, reject) => {
      const index = store.index('fingerprint');
      const request = index.get(fingerprint);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  async getAllContacts(): Promise<Contact[]> {
    const store = this.getStore('contacts');
    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async deleteContact(id: string): Promise<void> {
    const store = this.getStore('contacts', 'readwrite');
    return new Promise((resolve, reject) => {
      const request = store.delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // Chat operations
  async saveChat(chat: Chat): Promise<void> {
    const store = this.getStore('chats', 'readwrite');
    return new Promise((resolve, reject) => {
      const request = store.put(chat);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getChat(id: string): Promise<Chat | null> {
    const store = this.getStore('chats');
    return new Promise((resolve, reject) => {
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  async getChatByContactId(contactId: string): Promise<Chat | null> {
    const store = this.getStore('chats');
    return new Promise((resolve, reject) => {
      const index = store.index('contactId');
      const request = index.get(contactId);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  async getAllChats(): Promise<Chat[]> {
    const store = this.getStore('chats');
    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async deleteChat(id: string): Promise<void> {
    const store = this.getStore('chats', 'readwrite');
    return new Promise((resolve, reject) => {
      const request = store.delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // Message operations
  async saveMessage(message: Message): Promise<void> {
    const store = this.getStore('messages', 'readwrite');
    return new Promise((resolve, reject) => {
      const request = store.put(message);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getMessage(id: string): Promise<Message | null> {
    const store = this.getStore('messages');
    return new Promise((resolve, reject) => {
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  async getMessagesByChat(chatId: string, limit: number = 100, offset: number = 0): Promise<Message[]> {
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
    const store = this.getStore('messages');
    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => {
        const messages = request.result as Message[];
        messages.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
        resolve(messages);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async deleteMessage(id: string): Promise<void> {
    const store = this.getStore('messages', 'readwrite');
    return new Promise((resolve, reject) => {
      const request = store.delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async deleteMessagesByChat(chatId: string): Promise<void> {
    const messages = await this.getMessagesByChatId(chatId);
    for (const message of messages) {
      await this.deleteMessage(message.id);
    }
  }

  // Settings operations
  async saveSettings(settings: AppSettings): Promise<void> {
    const store = this.getStore('settings', 'readwrite');
    return new Promise((resolve, reject) => {
      const request = store.put({ key: 'appSettings', ...settings });
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getSettings(): Promise<AppSettings | null> {
    const store = this.getStore('settings');
    return new Promise((resolve, reject) => {
      const request = store.get('appSettings');
      request.onsuccess = () => {
        const result = request.result;
        if (result) {
          const settings = { ...result };
          delete settings.key;
          resolve(settings as AppSettings);
        } else {
          resolve(null);
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  async saveSecuritySettings(settings: SecuritySettings): Promise<void> {
    const store = this.getStore('settings', 'readwrite');
    return new Promise((resolve, reject) => {
      const request = store.put({ key: 'securitySettings', ...settings });
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getSecuritySettings(): Promise<SecuritySettings | null> {
    const store = this.getStore('settings');
    return new Promise((resolve, reject) => {
      const request = store.get('securitySettings');
      request.onsuccess = () => {
        const result = request.result;
        if (result) {
          const settings = { ...result };
          delete settings.key;
          resolve(settings as SecuritySettings);
        } else {
          resolve(null);
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  // Device operations (multi-device sync)
  async saveDevice(device: DeviceInfo): Promise<void> {
    const store = this.getStore('devices', 'readwrite');
    return new Promise((resolve, reject) => {
      const request = store.put(device);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getDevice(deviceId: string): Promise<DeviceInfo | null> {
    const store = this.getStore('devices');
    return new Promise((resolve, reject) => {
      const request = store.get(deviceId);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  async getDeviceByI2PAddress(i2pAddress: string): Promise<DeviceInfo | null> {
    const store = this.getStore('devices');
    return new Promise((resolve, reject) => {
      const index = store.index('i2pAddress');
      const request = index.get(i2pAddress);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  async getAllDevices(): Promise<DeviceInfo[]> {
    const store = this.getStore('devices');
    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async deleteDevice(deviceId: string): Promise<void> {
    const store = this.getStore('devices', 'readwrite');
    return new Promise((resolve, reject) => {
      const request = store.delete(deviceId);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // Backup and restore
  async createBackup(): Promise<BackupData> {
    const user = await this.getUser();
    const contacts = await this.getAllContacts();
    const chats = await this.getAllChats();
    const messages = await this.getAllMessages();
    const devices = await this.getAllDevices();

    return {
      version: '2.0',
      timestamp: new Date().toISOString(),
      user: user!,
      contacts,
      chats,
      messages,
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
      const store = this.getStore(storeName, 'readwrite');
      await new Promise<void>((resolve, reject) => {
        const request = store.clear();
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    }
  }
}

export const storageService = StorageService.getInstance();
