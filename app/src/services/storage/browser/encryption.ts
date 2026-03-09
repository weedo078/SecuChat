// AES-GCM Encryption Utilities - Phase 2
// Extracted from original storage.ts for reuse across platforms

/**
 * Configuration for encryption operations
 */
export interface EncryptionConfig {
  /** PBKDF2 iterations (default: 100000) */
  iterations: number;
  /** Salt length in bytes (default: 16) */
  saltLength: number;
  /** IV length in bytes (default: 12 for GCM) */
  ivLength: number;
  /** Key length in bits (default: 256) */
  keyLength: number;
}

/** Default encryption configuration - must match across browser and electron */
export const DEFAULT_ENCRYPTION_CONFIG: EncryptionConfig = {
  iterations: 100000,
  saltLength: 16,
  ivLength: 12,
  keyLength: 256,
};

/**
 * Derive an AES-GCM key from a passphrase using PBKDF2
 * @param passphrase - User's passphrase
 * @param salt - Random salt (should be unique per encryption)
 * @param config - Optional encryption config
 * @returns CryptoKey for AES-GCM operations
 */
export async function deriveKey(
  passphrase: string,
  salt: Uint8Array,
  config: EncryptionConfig = DEFAULT_ENCRYPTION_CONFIG
): Promise<CryptoKey> {
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
      iterations: config.iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: config.keyLength },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt data with AES-GCM
 * Format: salt(16) + iv(12) + ciphertext
 * @param data - String data to encrypt
 * @param passphrase - Encryption passphrase
 * @param config - Optional encryption config
 * @returns Base64 encoded encrypted data
 */
export async function encryptData(
  data: string,
  passphrase: string,
  config: EncryptionConfig = DEFAULT_ENCRYPTION_CONFIG
): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(config.saltLength));
  const iv = crypto.getRandomValues(new Uint8Array(config.ivLength));
  const key = await deriveKey(passphrase, salt, config);
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
  return btoa(String.fromCharCode.apply(null, Array.from(combined)));
}

/**
 * Decrypt AES-GCM encrypted data
 * @param encryptedBase64 - Base64 encoded encrypted data
 * @param passphrase - Encryption passphrase
 * @param config - Optional encryption config
 * @returns Decrypted string
 * @throws Error if decryption fails (wrong passphrase or corrupted data)
 */
export async function decryptData(
  encryptedBase64: string,
  passphrase: string,
  config: EncryptionConfig = DEFAULT_ENCRYPTION_CONFIG
): Promise<string> {
  const combined = new Uint8Array(
    atob(encryptedBase64)
      .split('')
      .map((c) => c.charCodeAt(0))
  );

  if (combined.length < config.saltLength + config.ivLength) {
    throw new Error('Encrypted data too short');
  }

  const salt = combined.slice(0, config.saltLength);
  const iv = combined.slice(config.saltLength, config.saltLength + config.ivLength);
  const encrypted = combined.slice(config.saltLength + config.ivLength);
  const key = await deriveKey(passphrase, salt, config);
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    encrypted
  );
  return new TextDecoder().decode(decrypted);
}

/**
 * Check if the Web Crypto API is available
 */
export function isCryptoAvailable(): boolean {
  return (
    typeof crypto !== 'undefined' &&
    typeof crypto.subtle !== 'undefined' &&
    typeof crypto.getRandomValues === 'function'
  );
}

/**
 * Generate a random salt for key derivation
 */
export function generateSalt(length: number = 16): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

/**
 * Generate a random IV for encryption
 */
export function generateIV(length: number = 12): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}
