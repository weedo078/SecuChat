// Storage Service Facade
// Delegates to platform-specific provider (BrowserStorageProvider or ElectronStorageProvider)
// Maintains backward compatibility with existing code

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
import type { StorageProvider } from './storage/types';
import { getStoragePlatform } from './storage/platform';
import { BrowserStorageProvider } from './storage/browser/provider';

/**
 * StorageService is a singleton facade that delegates to the appropriate
 * platform-specific StorageProvider implementation.
 *
 * For browser: Uses BrowserStorageProvider (IndexedDB with localStorage fallback)
 * For Electron: Would use ElectronStorageProvider (IPC to main process SQLite)
 *
 * Note: ElectronStorageProvider is not yet implemented - it would be added
 * when full Electron support is needed. For now, the browser implementation
 * works in both environments.
 */
export class StorageService {
  private static instance: StorageService;
  private provider: StorageProvider;

  private constructor() {
    const platform = getStoragePlatform();
    console.log('[StorageService] Initializing for platform:', platform);

    this.provider = new BrowserStorageProvider();
  }

  static getInstance(): StorageService {
    if (!StorageService.instance) {
      StorageService.instance = new StorageService();
    }
    return StorageService.instance;
  }

  /** True when using localStorage fallback (IndexedDB unavailable) */
  get usingFallback(): boolean {
    return this.provider.usingFallback ?? false;
  }

  /**
   * Initialize the storage backend
   */
  async init(): Promise<void> {
    try {
      return await this.provider.init();
    } catch (error) {
      console.error('[StorageService] Failed to initialize storage provider:', error);
      throw error;
    }
  }

  /**
   * Set the encryption passphrase for sensitive data
   */
  setEncryptionPassphrase(passphrase: string): void {
    this.provider.setEncryptionPassphrase(passphrase);
  }

  /**
   * Clear the encryption passphrase (e.g., on lock)
   */
  clearEncryptionPassphrase(): void {
    this.provider.clearEncryptionPassphrase();
  }

  /**
   * Check if encryption passphrase is set
   */
  hasEncryptionPassphrase(): boolean {
    return this.provider.hasEncryptionPassphrase();
  }

  // User operations
  async saveUser(user: User): Promise<void> {
    return this.provider.saveUser(user);
  }

  async getUser(): Promise<User | null> {
    return this.provider.getUser();
  }

  async deleteUser(): Promise<void> {
    return this.provider.deleteUser();
  }

  // Contact operations
  async saveContact(contact: Contact): Promise<void> {
    return this.provider.saveContact(contact);
  }

  async getContact(id: string): Promise<Contact | null> {
    return this.provider.getContact(id);
  }

  async getContactByFingerprint(fingerprint: string): Promise<Contact | null> {
    return this.provider.getContactByFingerprint(fingerprint);
  }

  async getAllContacts(): Promise<Contact[]> {
    return this.provider.getAllContacts();
  }

  async deleteContact(id: string): Promise<void> {
    return this.provider.deleteContact(id);
  }

  // Chat operations
  async saveChat(chat: Chat): Promise<void> {
    return this.provider.saveChat(chat);
  }

  async getChat(id: string): Promise<Chat | null> {
    return this.provider.getChat(id);
  }

  async getChatByContactId(contactId: string): Promise<Chat | null> {
    return this.provider.getChatByContactId(contactId);
  }

  async getAllChats(): Promise<Chat[]> {
    return this.provider.getAllChats();
  }

  async deleteChat(id: string): Promise<void> {
    return this.provider.deleteChat(id);
  }

  // Message operations
  async saveMessage(message: Message): Promise<void> {
    return this.provider.saveMessage(message);
  }

  async getMessage(id: string): Promise<Message | null> {
    return this.provider.getMessage(id);
  }

  async getMessagesByChat(chatId: string, limit = 100, offset = 0): Promise<Message[]> {
    return this.provider.getMessagesByChat(chatId, limit, offset);
  }

  async getMessagesByChatId(chatId: string): Promise<Message[]> {
    return this.provider.getMessagesByChatId(chatId);
  }

  async getLastMessageSequence(chatId: string): Promise<number> {
    return this.provider.getLastMessageSequence(chatId);
  }

  async getAllMessages(): Promise<Message[]> {
    return this.provider.getAllMessages();
  }

  async deleteMessage(id: string): Promise<void> {
    return this.provider.deleteMessage(id);
  }

  async deleteMessagesByChat(chatId: string): Promise<void> {
    return this.provider.deleteMessagesByChat(chatId);
  }

  // Settings operations
  async saveSettings(settings: AppSettings): Promise<void> {
    return this.provider.saveSettings(settings);
  }

  async getSettings(): Promise<AppSettings | null> {
    return this.provider.getSettings();
  }

  async saveSecuritySettings(settings: SecuritySettings): Promise<void> {
    return this.provider.saveSecuritySettings(settings);
  }

  async getSecuritySettings(): Promise<SecuritySettings | null> {
    return this.provider.getSecuritySettings();
  }

  // Device operations (multi-device sync)
  async saveDevice(device: DeviceInfo): Promise<void> {
    return this.provider.saveDevice(device);
  }

  async getDevice(deviceId: string): Promise<DeviceInfo | null> {
    return this.provider.getDevice(deviceId);
  }

  async getDeviceByI2PAddress(i2pAddress: string): Promise<DeviceInfo | null> {
    return this.provider.getDeviceByI2PAddress(i2pAddress);
  }

  async getAllDevices(): Promise<DeviceInfo[]> {
    return this.provider.getAllDevices();
  }

  async deleteDevice(deviceId: string): Promise<void> {
    return this.provider.deleteDevice(deviceId);
  }

  // Backup and restore
  async createBackup(): Promise<BackupData> {
    return this.provider.createBackup();
  }

  async restoreBackup(backup: BackupData): Promise<void> {
    return this.provider.restoreBackup(backup);
  }

  // Clear all data
  async clearAllData(): Promise<void> {
    return this.provider.clearAllData();
  }
}

// Export singleton instance
export const storageService = StorageService.getInstance();

// Re-export types for convenience
export type {
  StorageProvider,
  StoragePlatform,
  StorageConfig,
} from './storage/types';

export {
  StorageIpcChannels,
  isEncryptedField,
} from './storage/types';

export {
  isElectron,
  isBrowser,
  getStoragePlatform,
  getPlatformCapabilities,
} from './storage/platform';
