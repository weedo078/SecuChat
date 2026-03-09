// Electron Storage Provider - Phase 3
// IPC-based storage provider for Electron renderer process
// Uses window.electronAPI to communicate with main process SQLite backend

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
import { StorageIpcChannels } from '../types';

/**
 * IPC response type from main process
 */
interface IpcResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Electron storage provider using IPC to main process
 * Communicates with SQLite backend via IPC handlers
 */
export class ElectronStorageProvider implements StorageProvider {
  readonly platform = 'electron' as const;
  private _hasPassphrase = false;

  /**
   * Initialize the storage backend
   * Ensures the SQLite database is ready
   */
  async init(): Promise<void> {
    console.log('[Storage] Initializing Electron storage provider');
    const result = await this.invokeIpc(StorageIpcChannels.INIT);
    if (!result.success) {
      throw new Error(result.error || 'Failed to initialize storage');
    }
    console.log('[Storage] Electron storage provider initialized');
  }

  /**
   * Invoke an IPC channel and handle the response
   */
  private async invokeIpc<T>(channel: string, ...args: unknown[]): Promise<IpcResponse<T>> {
    if (typeof window === 'undefined' || !window.electronAPI) {
      throw new Error('Electron API not available');
    }

    // Use the storage invoke method from electronAPI
    const response = await window.electronAPI.storageInvoke(channel, ...args) as IpcResponse<T>;
    return response;
  }

  /**
   * Extract data from IPC response or throw error
   */
  private extractData<T>(response: IpcResponse<T>): T | null {
    if (!response.success) {
      throw new Error(response.error || 'Storage operation failed');
    }
    return response.data ?? null;
  }

  // Passphrase management
  setEncryptionPassphrase(_passphrase: string): void {
    // Cache the state locally for synchronous access
    this._hasPassphrase = true;
    // Sync with main process (fire and forget)
    this.invokeIpc(StorageIpcChannels.SET_PASSPHRASE, _passphrase).catch((error) => {
      console.error('[Storage] Failed to set passphrase:', error);
      // Revert local state on error
      this._hasPassphrase = false;
    });
  }

  clearEncryptionPassphrase(): void {
    // Clear local state immediately
    this._hasPassphrase = false;
    // Sync with main process (fire and forget)
    this.invokeIpc(StorageIpcChannels.CLEAR_PASSPHRASE).catch((error) => {
      console.error('[Storage] Failed to clear passphrase:', error);
    });
  }

  hasEncryptionPassphrase(): boolean {
    // Return cached state (synchronous)
    return this._hasPassphrase;
  }

  // User operations
  async saveUser(user: User): Promise<void> {
    const response = await this.invokeIpc(StorageIpcChannels.SAVE_USER, user);
    if (!response.success) {
      throw new Error(response.error || 'Failed to save user');
    }
  }

  async getUser(): Promise<User | null> {
    const response = await this.invokeIpc<User>(StorageIpcChannels.GET_USER);
    return this.extractData(response);
  }

  async deleteUser(): Promise<void> {
    const response = await this.invokeIpc(StorageIpcChannels.DELETE_USER);
    if (!response.success) {
      throw new Error(response.error || 'Failed to delete user');
    }
  }

  // Contact operations
  async saveContact(contact: Contact): Promise<void> {
    const response = await this.invokeIpc(StorageIpcChannels.SAVE_CONTACT, contact);
    if (!response.success) {
      throw new Error(response.error || 'Failed to save contact');
    }
  }

  async getContact(id: string): Promise<Contact | null> {
    const response = await this.invokeIpc<Contact>(StorageIpcChannels.GET_CONTACT, id);
    return this.extractData(response);
  }

  async getContactByFingerprint(fingerprint: string): Promise<Contact | null> {
    const response = await this.invokeIpc<Contact>(
      StorageIpcChannels.GET_CONTACT_BY_FINGERPRINT,
      fingerprint
    );
    return this.extractData(response);
  }

  async getAllContacts(): Promise<Contact[]> {
    const response = await this.invokeIpc<Contact[]>(StorageIpcChannels.GET_ALL_CONTACTS);
    return this.extractData(response) ?? [];
  }

  async deleteContact(id: string): Promise<void> {
    const response = await this.invokeIpc(StorageIpcChannels.DELETE_CONTACT, id);
    if (!response.success) {
      throw new Error(response.error || 'Failed to delete contact');
    }
  }

  // Chat operations
  async saveChat(chat: Chat): Promise<void> {
    const response = await this.invokeIpc(StorageIpcChannels.SAVE_CHAT, chat);
    if (!response.success) {
      throw new Error(response.error || 'Failed to save chat');
    }
  }

  async getChat(id: string): Promise<Chat | null> {
    const response = await this.invokeIpc<Chat>(StorageIpcChannels.GET_CHAT, id);
    return this.extractData(response);
  }

  async getChatByContactId(contactId: string): Promise<Chat | null> {
    const response = await this.invokeIpc<Chat>(
      StorageIpcChannels.GET_CHAT_BY_CONTACT_ID,
      contactId
    );
    return this.extractData(response);
  }

  async getAllChats(): Promise<Chat[]> {
    const response = await this.invokeIpc<Chat[]>(StorageIpcChannels.GET_ALL_CHATS);
    return this.extractData(response) ?? [];
  }

  async deleteChat(id: string): Promise<void> {
    const response = await this.invokeIpc(StorageIpcChannels.DELETE_CHAT, id);
    if (!response.success) {
      throw new Error(response.error || 'Failed to delete chat');
    }
  }

  // Message operations
  async saveMessage(message: Message): Promise<void> {
    // Strip decryptedContent before saving (same as browser provider)
    const messageToStore = { ...message };
    delete (messageToStore as { decryptedContent?: string }).decryptedContent;

    const response = await this.invokeIpc(StorageIpcChannels.SAVE_MESSAGE, messageToStore);
    if (!response.success) {
      throw new Error(response.error || 'Failed to save message');
    }
  }

  async getMessage(id: string): Promise<Message | null> {
    const response = await this.invokeIpc<Message>(StorageIpcChannels.GET_MESSAGE, id);
    return this.extractData(response);
  }

  async getMessagesByChat(chatId: string, limit = 100, offset = 0): Promise<Message[]> {
    const response = await this.invokeIpc<Message[]>(
      StorageIpcChannels.GET_MESSAGES_BY_CHAT,
      chatId,
      limit,
      offset
    );
    return this.extractData(response) ?? [];
  }

  async getMessagesByChatId(chatId: string): Promise<Message[]> {
    const response = await this.invokeIpc<Message[]>(
      StorageIpcChannels.GET_MESSAGES_BY_CHAT_ID,
      chatId
    );
    return this.extractData(response) ?? [];
  }

  async getLastMessageSequence(chatId: string): Promise<number> {
    const response = await this.invokeIpc<number>(
      StorageIpcChannels.GET_LAST_SEQUENCE,
      chatId
    );
    return this.extractData(response) ?? 0;
  }

  async getAllMessages(): Promise<Message[]> {
    const response = await this.invokeIpc<Message[]>(StorageIpcChannels.GET_ALL_MESSAGES);
    return this.extractData(response) ?? [];
  }

  async deleteMessage(id: string): Promise<void> {
    const response = await this.invokeIpc(StorageIpcChannels.DELETE_MESSAGE, id);
    if (!response.success) {
      throw new Error(response.error || 'Failed to delete message');
    }
  }

  async deleteMessagesByChat(chatId: string): Promise<void> {
    const response = await this.invokeIpc(StorageIpcChannels.DELETE_MESSAGES_BY_CHAT, chatId);
    if (!response.success) {
      throw new Error(response.error || 'Failed to delete messages by chat');
    }
  }

  // Settings operations
  async saveSettings(settings: AppSettings): Promise<void> {
    const response = await this.invokeIpc(StorageIpcChannels.SAVE_SETTINGS, settings);
    if (!response.success) {
      throw new Error(response.error || 'Failed to save settings');
    }
  }

  async getSettings(): Promise<AppSettings | null> {
    const response = await this.invokeIpc<AppSettings>(StorageIpcChannels.GET_SETTINGS);
    return this.extractData(response);
  }

  async saveSecuritySettings(settings: SecuritySettings): Promise<void> {
    const response = await this.invokeIpc(
      StorageIpcChannels.SAVE_SECURITY_SETTINGS,
      settings
    );
    if (!response.success) {
      throw new Error(response.error || 'Failed to save security settings');
    }
  }

  async getSecuritySettings(): Promise<SecuritySettings | null> {
    const response = await this.invokeIpc<SecuritySettings>(
      StorageIpcChannels.GET_SECURITY_SETTINGS
    );
    return this.extractData(response);
  }

  // Device operations
  async saveDevice(device: DeviceInfo): Promise<void> {
    const response = await this.invokeIpc(StorageIpcChannels.SAVE_DEVICE, device);
    if (!response.success) {
      throw new Error(response.error || 'Failed to save device');
    }
  }

  async getDevice(deviceId: string): Promise<DeviceInfo | null> {
    const response = await this.invokeIpc<DeviceInfo>(
      StorageIpcChannels.GET_DEVICE,
      deviceId
    );
    return this.extractData(response);
  }

  async getDeviceByI2PAddress(i2pAddress: string): Promise<DeviceInfo | null> {
    const response = await this.invokeIpc<DeviceInfo>(
      StorageIpcChannels.GET_DEVICE_BY_I2P,
      i2pAddress
    );
    return this.extractData(response);
  }

  async getAllDevices(): Promise<DeviceInfo[]> {
    const response = await this.invokeIpc<DeviceInfo[]>(StorageIpcChannels.GET_ALL_DEVICES);
    return this.extractData(response) ?? [];
  }

  async deleteDevice(deviceId: string): Promise<void> {
    const response = await this.invokeIpc(StorageIpcChannels.DELETE_DEVICE, deviceId);
    if (!response.success) {
      throw new Error(response.error || 'Failed to delete device');
    }
  }

  // Backup and restore
  async createBackup(): Promise<BackupData> {
    const response = await this.invokeIpc<BackupData>(StorageIpcChannels.CREATE_BACKUP);
    const data = this.extractData(response);
    if (!data) {
      throw new Error('Failed to create backup');
    }
    return data;
  }

  async restoreBackup(backup: BackupData): Promise<void> {
    const response = await this.invokeIpc(StorageIpcChannels.RESTORE_BACKUP, backup);
    if (!response.success) {
      throw new Error(response.error || 'Failed to restore backup');
    }
  }

  async clearAllData(): Promise<void> {
    const response = await this.invokeIpc(StorageIpcChannels.CLEAR_ALL_DATA);
    if (!response.success) {
      throw new Error(response.error || 'Failed to clear all data');
    }
  }
}
