// Storage Service Facade
// Delegates to platform-specific provider (BrowserStorageProvider, ElectronStorageProvider, or CapacitorStorageProvider)
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
import type { StorageProvider, StoragePlatform } from './storage/types';
import { getStoragePlatform } from './storage/platform';
import { BrowserStorageProvider } from './storage/browser/provider';
import { ElectronStorageProvider } from './storage/electron/provider';
import { CapacitorStorageProvider } from './storage/capacitor/provider';

/**
 * StorageService is a singleton facade that delegates to the appropriate
 * platform-specific StorageProvider implementation.
 *
 * For browser: Uses BrowserStorageProvider (IndexedDB with localStorage fallback)
 * For Electron: Would use ElectronStorageProvider (IPC to main process SQLite)
 * For Capacitor: Uses CapacitorStorageProvider (native preferences + IndexedDB)
 *
 * Note: ElectronStorageProvider is not yet implemented - it would be added
 * when full Electron support is needed. For now, the browser implementation
 * works in both environments.
 */
export class StorageService {
  private static instance: StorageService;
  private provider: StorageProvider | null = null;
  private platform: StoragePlatform | null = null;
  private initialized = false;

  private constructor() {
    console.log('[StorageService] Constructor called');
  }

  /**
   * Initialize the storage service - must be called before using any storage methods
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.platform = await getStoragePlatform();
    console.log('[StorageService] Initialized for platform:', this.platform);
    this.initialized = true;
  }

  /**
   * Lazy provider instantiation - creates provider on first use.
   * This avoids heavy I/O operations during service construction.
   */
  private getProvider(): StorageProvider {
    if (!this.initialized) {
      throw new Error('[StorageService] Not initialized. Call initialize() first.');
    }

    if (!this.provider) {
      const platform = this.platform ?? 'browser';
      const provider = this.createProvider(platform);

      // Type guard: verify provider implements StorageProvider interface
      if (!this.isValidStorageProvider(provider)) {
        throw new Error(
          `[StorageService] Storage provider validation failed for platform: ${platform}. ` +
            'Provider does not implement required StorageProvider interface.'
        );
      }

      this.provider = provider;
    }
    return this.provider;
  }

  /**
   * Type guard to verify an object implements the StorageProvider interface
   */
  private isValidStorageProvider(obj: unknown): obj is StorageProvider {
    if (!obj || typeof obj !== 'object') {
      return false;
    }

    const provider = obj as Record<string, unknown>;

    // Check required methods exist and are functions
    const requiredMethods = [
      'init',
      'setEncryptionPassphrase',
      'clearEncryptionPassphrase',
      'hasEncryptionPassphrase',
      'saveUser',
      'getUser',
      'saveContact',
      'getContact',
      'getAllContacts',
      'saveChat',
      'getChat',
      'getAllChats',
      'saveMessage',
      'getMessagesByChat',
      'saveSettings',
      'getSettings',
      'createBackup',
      'clearAllData',
    ] as const;

    for (const method of requiredMethods) {
      if (typeof provider[method] !== 'function') {
        console.error(`[StorageService] Provider missing required method: ${method}`);
        return false;
      }
    }

    // Check platform property exists and is a valid value
    if (!['browser', 'electron', 'capacitor'].includes(provider.platform as string)) {
      console.error('[StorageService] Provider has invalid platform property:', provider.platform);
      return false;
    }

    return true;
  }

  /**
   * Factory method to create the appropriate storage provider for the platform
   */
  private createProvider(platform: StoragePlatform): StorageProvider {
    let provider: StorageProvider;

    switch (platform) {
      case 'browser':
        provider = new BrowserStorageProvider();
        break;
      case 'electron':
        provider = new ElectronStorageProvider();
        break;
      case 'capacitor':
        provider = new CapacitorStorageProvider();
        break;
      default: {
        // Exhaustiveness check - ensures all platform values are handled
        const _exhaustiveCheck: never = platform;
        console.error('[StorageService] Unknown platform:', _exhaustiveCheck);
        throw new Error(`[StorageService] Unknown platform: ${platform}`);
      }
    }

    console.log('[StorageService] Provider created successfully:', platform);
    return provider;
  }

  static getInstance(): StorageService {
    if (!StorageService.instance) {
      StorageService.instance = new StorageService();
    }
    return StorageService.instance;
  }

  /**
   * Get the current platform
   */
  getPlatform(): StoragePlatform | null {
    return this.platform;
  }

  /** True when using localStorage fallback (IndexedDB unavailable) */
  get usingFallback(): boolean {
    return this.getProvider().usingFallback ?? false;
  }

  /**
   * Initialize the storage backend
   */
  async init(): Promise<void> {
    try {
      // Ensure service is initialized first
      await this.initialize();
      // Then initialize the provider
      return await this.getProvider().init();
    } catch (error) {
      console.error('[StorageService] Failed to initialize storage provider:', error);
      throw error;
    }
  }

  /**
   * Set the encryption passphrase for sensitive data
   */
  setEncryptionPassphrase(passphrase: string): void {
    this.getProvider().setEncryptionPassphrase(passphrase);
  }

  /**
   * Clear the encryption passphrase (e.g., on lock)
   */
  clearEncryptionPassphrase(): void {
    this.getProvider().clearEncryptionPassphrase();
  }

  /**
   * Check if encryption passphrase is set
   */
  hasEncryptionPassphrase(): boolean {
    return this.getProvider().hasEncryptionPassphrase();
  }

  // User operations
  async saveUser(user: User): Promise<void> {
    return this.getProvider().saveUser(user);
  }

  async getUser(): Promise<User | null> {
    return this.getProvider().getUser();
  }

  async deleteUser(): Promise<void> {
    return this.getProvider().deleteUser();
  }

  // Contact operations
  async saveContact(contact: Contact): Promise<void> {
    return this.getProvider().saveContact(contact);
  }

  async getContact(id: string): Promise<Contact | null> {
    return this.getProvider().getContact(id);
  }

  async getContactByFingerprint(fingerprint: string): Promise<Contact | null> {
    return this.getProvider().getContactByFingerprint(fingerprint);
  }

  async getAllContacts(): Promise<Contact[]> {
    return this.getProvider().getAllContacts();
  }

  async deleteContact(id: string): Promise<void> {
    return this.getProvider().deleteContact(id);
  }

  // Chat operations
  async saveChat(chat: Chat): Promise<void> {
    return this.getProvider().saveChat(chat);
  }

  async getChat(id: string): Promise<Chat | null> {
    return this.getProvider().getChat(id);
  }

  async getChatByContactId(contactId: string): Promise<Chat | null> {
    return this.getProvider().getChatByContactId(contactId);
  }

  async getAllChats(): Promise<Chat[]> {
    return this.getProvider().getAllChats();
  }

  async deleteChat(id: string): Promise<void> {
    return this.getProvider().deleteChat(id);
  }

  // Message operations
  async saveMessage(message: Message): Promise<void> {
    return this.getProvider().saveMessage(message);
  }

  async getMessage(id: string): Promise<Message | null> {
    return this.getProvider().getMessage(id);
  }

  async getMessagesByChat(chatId: string, limit = 100, offset = 0): Promise<Message[]> {
    return this.getProvider().getMessagesByChat(chatId, limit, offset);
  }

  async getMessagesByChatId(chatId: string): Promise<Message[]> {
    return this.getProvider().getMessagesByChatId(chatId);
  }

  async getLastMessageSequence(chatId: string): Promise<number> {
    return this.getProvider().getLastMessageSequence(chatId);
  }

  async getAllMessages(): Promise<Message[]> {
    return this.getProvider().getAllMessages();
  }

  async deleteMessage(id: string): Promise<void> {
    return this.getProvider().deleteMessage(id);
  }

  async deleteMessagesByChat(chatId: string): Promise<void> {
    return this.getProvider().deleteMessagesByChat(chatId);
  }

  // Settings operations
  async saveSettings(settings: AppSettings): Promise<void> {
    return this.getProvider().saveSettings(settings);
  }

  async getSettings(): Promise<AppSettings | null> {
    return this.getProvider().getSettings();
  }

  async saveSecuritySettings(settings: SecuritySettings): Promise<void> {
    return this.getProvider().saveSecuritySettings(settings);
  }

  async getSecuritySettings(): Promise<SecuritySettings | null> {
    return this.getProvider().getSecuritySettings();
  }

  // Device operations (multi-device sync)
  async saveDevice(device: DeviceInfo): Promise<void> {
    return this.getProvider().saveDevice(device);
  }

  async getDevice(deviceId: string): Promise<DeviceInfo | null> {
    return this.getProvider().getDevice(deviceId);
  }

  async getDeviceByI2PAddress(i2pAddress: string): Promise<DeviceInfo | null> {
    return this.getProvider().getDeviceByI2PAddress(i2pAddress);
  }

  async getAllDevices(): Promise<DeviceInfo[]> {
    return this.getProvider().getAllDevices();
  }

  async deleteDevice(deviceId: string): Promise<void> {
    return this.getProvider().deleteDevice(deviceId);
  }

  // Backup and restore
  async createBackup(): Promise<BackupData> {
    return this.getProvider().createBackup();
  }

  async restoreBackup(backup: BackupData): Promise<void> {
    return this.getProvider().restoreBackup(backup);
  }

  // Clear all data
  async clearAllData(): Promise<void> {
    return this.getProvider().clearAllData();
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
