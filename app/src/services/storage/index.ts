// Storage Module - Re-exports
// Central entry point for all storage-related exports

// Types
export type {
  StorageProvider,
  StoragePlatform,
  StorageConfig,
  EncryptedField,
  StorageResult,
  StorageIpcChannel,
} from './types';

export { StorageIpcChannels, isEncryptedField } from './types';

// Platform detection
export {
  isElectron,
  isBrowser,
  getStoragePlatform,
  isSecureStorageAvailable,
  getPlatformCapabilities,
  logPlatformDetection,
} from './platform';
export type { PlatformCapabilities } from './platform';

// Browser implementation (lazy-loaded to avoid issues in non-browser envs)
export {
  BrowserStorageProvider,
} from './browser/provider';

// Electron implementation
export {
  ElectronStorageProvider,
} from './electron/provider';

export {
  encryptData,
  decryptData,
  deriveKey,
} from './browser/encryption';

export type { EncryptionConfig } from './browser/encryption';

export { LocalStorageFallback } from './browser/fallback';
