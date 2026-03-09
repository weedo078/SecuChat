// Storage Provider Types - Phase 1
// Defines the interface and types for the storage abstraction layer

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

/**
 * Platform type for storage provider selection
 */
export type StoragePlatform = 'browser' | 'electron';

/**
 * Storage provider interface - abstracted storage operations
 * Implemented by BrowserStorageProvider and ElectronStorageProvider
 */
export interface StorageProvider {
  /** Platform identifier */
  readonly platform: StoragePlatform;

  /** True when using localStorage fallback (IndexedDB unavailable) */
  readonly usingFallback?: boolean;

  /** Initialize the storage backend */
  init(): Promise<void>;

  /** Set encryption passphrase for sensitive data */
  setEncryptionPassphrase(passphrase: string): void;

  /** Clear encryption passphrase */
  clearEncryptionPassphrase(): void;

  /** Check if encryption passphrase is set */
  hasEncryptionPassphrase(): boolean;

  // User operations
  saveUser(user: User): Promise<void>;
  getUser(): Promise<User | null>;
  deleteUser(): Promise<void>;

  // Contact operations
  saveContact(contact: Contact): Promise<void>;
  getContact(id: string): Promise<Contact | null>;
  getContactByFingerprint(fingerprint: string): Promise<Contact | null>;
  getAllContacts(): Promise<Contact[]>;
  deleteContact(id: string): Promise<void>;

  // Chat operations
  saveChat(chat: Chat): Promise<void>;
  getChat(id: string): Promise<Chat | null>;
  getChatByContactId(contactId: string): Promise<Chat | null>;
  getAllChats(): Promise<Chat[]>;
  deleteChat(id: string): Promise<void>;

  // Message operations
  saveMessage(message: Message): Promise<void>;
  getMessage(id: string): Promise<Message | null>;
  getMessagesByChat(chatId: string, limit?: number, offset?: number): Promise<Message[]>;
  getMessagesByChatId(chatId: string): Promise<Message[]>;
  getLastMessageSequence(chatId: string): Promise<number>;
  getAllMessages(): Promise<Message[]>;
  deleteMessage(id: string): Promise<void>;
  deleteMessagesByChat(chatId: string): Promise<void>;

  // Settings operations
  saveSettings(settings: AppSettings): Promise<void>;
  getSettings(): Promise<AppSettings | null>;
  saveSecuritySettings(settings: SecuritySettings): Promise<void>;
  getSecuritySettings(): Promise<SecuritySettings | null>;

  // Device operations (multi-device sync)
  saveDevice(device: DeviceInfo): Promise<void>;
  getDevice(deviceId: string): Promise<DeviceInfo | null>;
  getDeviceByI2PAddress(i2pAddress: string): Promise<DeviceInfo | null>;
  getAllDevices(): Promise<DeviceInfo[]>;
  deleteDevice(deviceId: string): Promise<void>;

  // Backup and restore
  createBackup(): Promise<BackupData>;
  restoreBackup(backup: BackupData): Promise<void>;

  // Clear all data
  clearAllData(): Promise<void>;
}

/**
 * Configuration options for storage initialization
 */
export interface StorageConfig {
  /** Platform to use for storage */
  platform: StoragePlatform;
  /** Database name (browser) or path (electron) */
  dbName?: string;
  /** Database version (browser IndexedDB) */
  dbVersion?: number;
}

/**
 * Encrypted data structure for AES-GCM encrypted fields
 */
export interface EncryptedField {
  /** Base64 encoded encrypted data with salt+iv prepended */
  encrypted: string;
  /** Marker to identify encrypted fields */
  _encrypted: true;
}

/**
 * Type guard for encrypted fields
 */
export function isEncryptedField(value: unknown): value is EncryptedField {
  return (
    typeof value === 'object' &&
    value !== null &&
    '_encrypted' in value &&
    (value as EncryptedField)._encrypted === true &&
    'encrypted' in value &&
    typeof (value as EncryptedField).encrypted === 'string'
  );
}

/**
 * Storage operation result type
 */
export interface StorageResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * IPC channel names for electron storage (must match electron/src/storage/ipc-handlers.ts)
 */
export const StorageIpcChannels = {
  INIT: 'storage:init',
  SET_PASSPHRASE: 'storage:setPassphrase',
  CLEAR_PASSPHRASE: 'storage:clearPassphrase',
  HAS_PASSPHRASE: 'storage:hasPassphrase',

  // User
  SAVE_USER: 'storage:saveUser',
  GET_USER: 'storage:getUser',
  DELETE_USER: 'storage:deleteUser',

  // Contacts
  SAVE_CONTACT: 'storage:saveContact',
  GET_CONTACT: 'storage:getContact',
  GET_CONTACT_BY_FINGERPRINT: 'storage:getContactByFingerprint',
  GET_ALL_CONTACTS: 'storage:getAllContacts',
  DELETE_CONTACT: 'storage:deleteContact',

  // Chats
  SAVE_CHAT: 'storage:saveChat',
  GET_CHAT: 'storage:getChat',
  GET_CHAT_BY_CONTACT_ID: 'storage:getChatByContactId',
  GET_ALL_CHATS: 'storage:getAllChats',
  DELETE_CHAT: 'storage:deleteChat',

  // Messages
  SAVE_MESSAGE: 'storage:saveMessage',
  GET_MESSAGE: 'storage:getMessage',
  GET_MESSAGES_BY_CHAT: 'storage:getMessagesByChat',
  GET_MESSAGES_BY_CHAT_ID: 'storage:getMessagesByChatId',
  GET_LAST_SEQUENCE: 'storage:getLastSequence',
  GET_ALL_MESSAGES: 'storage:getAllMessages',
  DELETE_MESSAGE: 'storage:deleteMessage',
  DELETE_MESSAGES_BY_CHAT: 'storage:deleteMessagesByChat',

  // Settings
  SAVE_SETTINGS: 'storage:saveSettings',
  GET_SETTINGS: 'storage:getSettings',
  SAVE_SECURITY_SETTINGS: 'storage:saveSecuritySettings',
  GET_SECURITY_SETTINGS: 'storage:getSecuritySettings',

  // Devices
  SAVE_DEVICE: 'storage:saveDevice',
  GET_DEVICE: 'storage:getDevice',
  GET_DEVICE_BY_I2P: 'storage:getDeviceByI2p',
  GET_ALL_DEVICES: 'storage:getAllDevices',
  DELETE_DEVICE: 'storage:deleteDevice',

  // Backup
  CREATE_BACKUP: 'storage:createBackup',
  RESTORE_BACKUP: 'storage:restoreBackup',
  CLEAR_ALL_DATA: 'storage:clearAllData',
} as const;

/**
 * Type for IPC channel names
 */
export type StorageIpcChannel = (typeof StorageIpcChannels)[keyof typeof StorageIpcChannels];
