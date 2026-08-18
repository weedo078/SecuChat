// Capacitor Storage Provider
// Uses @capacitor/preferences for settings and IndexedDB for large data
// Hybrid approach: Settings use native preferences, messages use IndexedDB

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
import { BrowserStorageProvider } from '../browser/provider';
import {
  nativeSettingsStorage,
  nativeBackup,
  isNativeStorageAvailable,
  initNativeStorage,
} from '@/services/nativeStorage';

/**
 * CapacitorStorageProvider - Hybrid storage for native apps
 *
 * Strategy:
 * - Settings: Use @capacitor/preferences (persists across app restarts)
 * - User/Contacts/Chats/Messages: Use IndexedDB (via BrowserStorageProvider)
 * - Backups: Use @capacitor/filesystem
 *
 * This provides the best of both worlds:
 * - Critical settings are stored natively and persist reliably
 * - Large data uses IndexedDB (better performance for queries)
 * - Backups can be saved to device storage
 */
export class CapacitorStorageProvider implements StorageProvider {
  readonly platform = 'capacitor' as const;
  readonly usingFallback = false;

  private browserProvider: BrowserStorageProvider;
  private nativeAvailable: boolean;

  constructor() {
    this.browserProvider = new BrowserStorageProvider();
    this.nativeAvailable = isNativeStorageAvailable();
  }

  /**
   * Initialize the storage backend
   */
  async init(): Promise<void> {
    console.log('[CapacitorStorage] Initializing...');

    if (this.nativeAvailable) {
      try {
        await initNativeStorage();
        console.log('[CapacitorStorage] Native storage initialized');
      } catch (error) {
        console.error('[CapacitorStorage] Native storage init failed:', error);
        this.nativeAvailable = false;
      }
    }

    // Always initialize browser provider for IndexedDB
    await this.browserProvider.init();

    console.log('[CapacitorStorage] Initialized (native available:', this.nativeAvailable, ')');
  }

  /**
   * Set encryption passphrase for sensitive data
   */
  setEncryptionPassphrase(passphrase: string): void {
    this.browserProvider.setEncryptionPassphrase(passphrase);
  }

  /**
   * Clear encryption passphrase
   */
  clearEncryptionPassphrase(): void {
    this.browserProvider.clearEncryptionPassphrase();
  }

  /**
   * Check if encryption passphrase is set
   */
  hasEncryptionPassphrase(): boolean {
    return this.browserProvider.hasEncryptionPassphrase();
  }

  // ==========================================
  // User operations - use IndexedDB
  // ==========================================

  async saveUser(user: User): Promise<void> {
    return this.browserProvider.saveUser(user);
  }

  async getUser(): Promise<User | null> {
    return this.browserProvider.getUser();
  }

  async deleteUser(): Promise<void> {
    return this.browserProvider.deleteUser();
  }

  // ==========================================
  // Contact operations - use IndexedDB
  // ==========================================

  async saveContact(contact: Contact): Promise<void> {
    return this.browserProvider.saveContact(contact);
  }

  async getContact(id: string): Promise<Contact | null> {
    return this.browserProvider.getContact(id);
  }

  async getContactByFingerprint(fingerprint: string): Promise<Contact | null> {
    return this.browserProvider.getContactByFingerprint(fingerprint);
  }

  async getAllContacts(): Promise<Contact[]> {
    return this.browserProvider.getAllContacts();
  }

  async deleteContact(id: string): Promise<void> {
    return this.browserProvider.deleteContact(id);
  }

  // ==========================================
  // Chat operations - use IndexedDB
  // ==========================================

  async saveChat(chat: Chat): Promise<void> {
    return this.browserProvider.saveChat(chat);
  }

  async getChat(id: string): Promise<Chat | null> {
    return this.browserProvider.getChat(id);
  }

  async getChatByContactId(contactId: string): Promise<Chat | null> {
    return this.browserProvider.getChatByContactId(contactId);
  }

  async getAllChats(): Promise<Chat[]> {
    return this.browserProvider.getAllChats();
  }

  async deleteChat(id: string): Promise<void> {
    return this.browserProvider.deleteChat(id);
  }

  // ==========================================
  // Message operations - use IndexedDB
  // ==========================================

  async saveMessage(message: Message): Promise<void> {
    return this.browserProvider.saveMessage(message);
  }

  async getMessage(id: string): Promise<Message | null> {
    return this.browserProvider.getMessage(id);
  }

  async getMessagesByChat(chatId: string, limit?: number, offset?: number): Promise<Message[]> {
    return this.browserProvider.getMessagesByChat(chatId, limit, offset);
  }

  async getMessagesByChatId(chatId: string): Promise<Message[]> {
    return this.browserProvider.getMessagesByChatId(chatId);
  }

  async getLastMessageSequence(chatId: string): Promise<number> {
    return this.browserProvider.getLastMessageSequence(chatId);
  }

  async getAllMessages(): Promise<Message[]> {
    return this.browserProvider.getAllMessages();
  }

  async deleteMessage(id: string): Promise<void> {
    return this.browserProvider.deleteMessage(id);
  }

  async deleteMessagesByChat(chatId: string): Promise<void> {
    return this.browserProvider.deleteMessagesByChat(chatId);
  }

  // ==========================================
  // Settings operations - use native preferences
  // ==========================================

  async saveSettings(settings: AppSettings): Promise<void> {
    if (this.nativeAvailable) {
      await nativeSettingsStorage.saveSettings(settings);
      // Also save to IndexedDB as backup
      await this.browserProvider.saveSettings(settings);
    } else {
      await this.browserProvider.saveSettings(settings);
    }
  }

  async getSettings(): Promise<AppSettings | null> {
    if (this.nativeAvailable) {
      // Try native first
      const nativeSettings = await nativeSettingsStorage.getSettings();
      if (nativeSettings) {
        return nativeSettings;
      }

      // Fallback to IndexedDB (migration path)
      const dbSettings = await this.browserProvider.getSettings();
      if (dbSettings) {
        // Migrate to native storage
        await nativeSettingsStorage.saveSettings(dbSettings);
        return dbSettings;
      }
    }

    return this.browserProvider.getSettings();
  }

  async saveSecuritySettings(settings: SecuritySettings): Promise<void> {
    if (this.nativeAvailable) {
      await nativeSettingsStorage.saveSecuritySettings(settings);
      // Also save to IndexedDB as backup
      await this.browserProvider.saveSecuritySettings(settings);
    } else {
      await this.browserProvider.saveSecuritySettings(settings);
    }
  }

  async getSecuritySettings(): Promise<SecuritySettings | null> {
    if (this.nativeAvailable) {
      // Try native first
      const nativeSettings = await nativeSettingsStorage.getSecuritySettings();
      if (nativeSettings) {
        return nativeSettings;
      }

      // Fallback to IndexedDB (migration path)
      const dbSettings = await this.browserProvider.getSecuritySettings();
      if (dbSettings) {
        // Migrate to native storage
        await nativeSettingsStorage.saveSecuritySettings(dbSettings);
        return dbSettings;
      }
    }

    return this.browserProvider.getSecuritySettings();
  }

  // ==========================================
  // Device operations - use IndexedDB
  // ==========================================

  async saveDevice(device: DeviceInfo): Promise<void> {
    return this.browserProvider.saveDevice(device);
  }

  async getDevice(deviceId: string): Promise<DeviceInfo | null> {
    return this.browserProvider.getDevice(deviceId);
  }

  async getDeviceByI2PAddress(i2pAddress: string): Promise<DeviceInfo | null> {
    return this.browserProvider.getDeviceByI2PAddress(i2pAddress);
  }

  async getAllDevices(): Promise<DeviceInfo[]> {
    return this.browserProvider.getAllDevices();
  }

  async deleteDevice(deviceId: string): Promise<void> {
    return this.browserProvider.deleteDevice(deviceId);
  }

  // ==========================================
  // Backup and restore - use native filesystem
  // ==========================================

  async createBackup(): Promise<BackupData> {
    const backup = await this.browserProvider.createBackup();

    // Also save to device storage if native is available
    if (this.nativeAvailable) {
      try {
        const filename = `secuchat-backup-${new Date().toISOString().split('T')[0]}.json`;
        await nativeBackup.createBackup(filename, JSON.stringify(backup, null, 2));
      } catch (error) {
        console.warn('[CapacitorStorage] Failed to save backup to device:', error);
      }
    }

    return backup;
  }

  async restoreBackup(backup: BackupData): Promise<void> {
    return this.browserProvider.restoreBackup(backup);
  }

  // ==========================================
  // Clear all data
  // ==========================================

  async clearAllData(): Promise<void> {
    // Clear native preferences
    if (this.nativeAvailable) {
      try {
        await nativeSettingsStorage.clearSettings();
      } catch (error) {
        console.warn('[CapacitorStorage] Failed to clear native settings:', error);
      }
    }

    // Clear IndexedDB
    return this.browserProvider.clearAllData();
  }
}
