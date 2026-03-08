// AES-GCM Encryption Utilities for Electron - Phase 3
// Node.js crypto implementation matching browser version exactly

import { pbkdf2Sync, randomBytes, createCipheriv, createDecipheriv } from 'crypto';

/**
 * Configuration for encryption operations
 * MUST match app/src/services/storage/browser/encryption.ts
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

/** Default encryption configuration */
export const DEFAULT_ENCRYPTION_CONFIG: EncryptionConfig = {
  iterations: 100000,
  saltLength: 16,
  ivLength: 12,
  keyLength: 256,
};

/**
 * Derive an AES-GCM key from a passphrase using PBKDF2
 * Uses Node.js crypto for synchronous operation
 * @param passphrase - User's passphrase
 * @param salt - Random salt
 * @param config - Optional encryption config
 * @returns Buffer containing the derived key
 */
export function deriveKey(
  passphrase: string,
  salt: Buffer,
  config: EncryptionConfig = DEFAULT_ENCRYPTION_CONFIG
): Buffer {
  const keyLengthBytes = config.keyLength / 8;
  return pbkdf2Sync(passphrase, salt, config.iterations, keyLengthBytes, 'sha256');
}

/**
 * Encrypt data with AES-GCM
 * Format: salt(16) + iv(12) + ciphertext + authTag(16)
 * @param data - String data to encrypt
 * @param passphrase - Encryption passphrase
 * @param config - Optional encryption config
 * @returns Base64 encoded encrypted data
 */
export function encryptData(
  data: string,
  passphrase: string,
  config: EncryptionConfig = DEFAULT_ENCRYPTION_CONFIG
): string {
  const salt = randomBytes(config.saltLength);
  const iv = randomBytes(config.ivLength);
  const key = deriveKey(passphrase, salt, config);

  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(data, 'utf-8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Combine: salt + iv + ciphertext + authTag
  const combined = Buffer.concat([salt, iv, encrypted, authTag]);
  return combined.toString('base64');
}

/**
 * Decrypt AES-GCM encrypted data
 * @param encryptedBase64 - Base64 encoded encrypted data
 * @param passphrase - Encryption passphrase
 * @param config - Optional encryption config
 * @returns Decrypted string
 * @throws Error if decryption fails (wrong passphrase or corrupted data)
 */
export function decryptData(
  encryptedBase64: string,
  passphrase: string,
  config: EncryptionConfig = DEFAULT_ENCRYPTION_CONFIG
): string {
  const combined = Buffer.from(encryptedBase64, 'base64');

  const minLength = config.saltLength + config.ivLength + 1 + 16; // salt + iv + min 1 byte data + authTag
  if (combined.length < minLength) {
    throw new Error('Encrypted data too short');
  }

  const salt = combined.subarray(0, config.saltLength);
  const iv = combined.subarray(config.saltLength, config.saltLength + config.ivLength);
  const authTagStart = combined.length - 16;
  const encrypted = combined.subarray(config.saltLength + config.ivLength, authTagStart);
  const authTag = combined.subarray(authTagStart);

  const key = deriveKey(passphrase, salt, config);

  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf-8');
}

/**
 * Generate a random salt for key derivation
 */
export function generateSalt(length: number = 16): Buffer {
  return randomBytes(length);
}

/**
 * Generate a random IV for encryption
 */
export function generateIV(length: number = 12): Buffer {
  return randomBytes(length);
}

/**
 * Check if a string appears to be encrypted (base64 and has minimum length)
 * This is a heuristic check, not cryptographic verification
 */
export function appearsEncrypted(data: string): boolean {
  if (!data || typeof data !== 'string') return false;

  // Check if it looks like base64
  const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
  if (!base64Regex.test(data)) return false;

  // Check minimum length for our format (salt + iv + authTag = 44 bytes = ~59 base64 chars)
  const minBase64Length = Math.ceil((16 + 12 + 16) / 3) * 4;
  if (data.length < minBase64Length) return false;

  return true;
}
