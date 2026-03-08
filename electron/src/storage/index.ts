// Electron Storage Module - Re-exports
// Main process storage implementation using SQLite

export { initializeDatabase, closeDatabase, getDatabase, getDatabasePath, runTransaction } from './database';
export {
  StorageRepository,
  type User,
  type Contact,
  type Chat,
  type Message,
  type DeviceInfo,
  type AppSettings,
  type SecuritySettings,
  type BackupData,
} from './repository';
export {
  encryptData,
  decryptData,
  deriveKey,
  generateSalt,
  generateIV,
  appearsEncrypted,
  DEFAULT_ENCRYPTION_CONFIG,
} from './encryption';
export type { EncryptionConfig } from './encryption';
export { registerStorageIpcHandlers, unregisterStorageIpcHandlers } from './ipc-handlers';
