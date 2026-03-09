// Browser Storage Module - Re-exports

export { BrowserStorageProvider } from './provider';
export {
  encryptData,
  decryptData,
  deriveKey,
  isCryptoAvailable,
  generateSalt,
  generateIV,
  DEFAULT_ENCRYPTION_CONFIG,
} from './encryption';
export type { EncryptionConfig } from './encryption';
export { LocalStorageFallback, STORE_KEY_FIELDS } from './fallback';
