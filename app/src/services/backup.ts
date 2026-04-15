import type { BackupData, AppSettings, SecuritySettings, Message } from '@/types';
import { storageService } from '@/services/storage';
import { logger } from '@/utils/logger';
import { Encrypter, Decrypter, generateIdentity, identityToRecipient } from 'age-encryption';
import { encryptData, decryptData } from './storage/browser/encryption';

const BACKUP_VERSION = '3.0-age';
const BACKUP_MAGIC = 'SECUCHAT_BACKUP';
const KEY_VERSION = '1.0-age';
const KEY_MAGIC = 'SECUCHAT_BACKUP_KEY';

export interface BackupFile {
  magic: string;
  version: string;
  timestamp: string;
  username: string;
  data: string; // Age-encrypted base64
  publicKey: string; // Age public key (age1...)
}

export interface BackupKeyFile {
  magic: string;
  version: string;
  type: 'age-private-key';
  username: string;
  privateKey: string; // Will be encrypted if passphrase provided
  publicKey: string; // Age recipient (age1...)
  createdAt: string;
  encrypted?: boolean; // Flag indicating if privateKey is encrypted
  encryptionVersion?: string; // 'v1' for AES-GCM encrypted
}

export interface BackupContents extends BackupData {
  settings?: AppSettings;
  securitySettings?: SecuritySettings;
}

export interface BackupResult {
  backupFile: BackupFile;
  keyFile: BackupKeyFile;
}

export interface ValidationResult {
  valid: boolean;
  version?: string;
  username?: string;
  error?: string;
  requiresKey: boolean;
}

/**
 * Convert Uint8Array to base64 string (browser-compatible)
 */
function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Convert base64 string to Uint8Array (browser-compatible)
 */
function base64ToUint8(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Generate a new Age key pair for backup encryption
 */
export async function generateAgeKeyPair(): Promise<{ publicKey: string; privateKey: string }> {
  const identity = await generateIdentity();
  const recipient = await identityToRecipient(identity);

  return {
    publicKey: recipient,
    privateKey: identity,
  };
}

/**
 * Encrypt data with Age public key
 */
export async function encryptWithAge(data: string, publicKey: string): Promise<string> {
  const e = new Encrypter();
  e.addRecipient(publicKey);
  const encrypted = await e.encrypt(data);
  return uint8ToBase64(encrypted);
}

/**
 * Decrypt data with Age private key
 */
export async function decryptWithAge(encryptedBase64: string, privateKey: string): Promise<string> {
  const d = new Decrypter();
  d.addIdentity(privateKey);
  const encrypted = base64ToUint8(encryptedBase64);
  return await d.decrypt(encrypted, 'text');
}

/**
 * Create a full backup with Age encryption
 * Returns both the encrypted backup and the private key
 */
export async function createBackup(passphrase?: string): Promise<BackupResult> {
  const user = await storageService.getUser();
  if (!user) throw new Error('No user found');

  const contacts = await storageService.getAllContacts();
  const chats = await storageService.getAllChats();
  const allMessages: Message[] = [];

  for (const chat of chats) {
    const chatMessages = await storageService.getMessagesByChatId(chat.id);
    allMessages.push(...chatMessages);
  }

  const settings = await storageService.getSettings();
  const securitySettings = await storageService.getSecuritySettings();

  const backupContents: BackupContents = {
    version: BACKUP_VERSION,
    timestamp: new Date().toISOString(),
    user,
    contacts,
    chats,
    messages: allMessages,
    devices: await storageService.getAllDevices(),
    settings: settings || undefined,
    securitySettings: securitySettings || undefined,
  };

  // Generate Age keys for this backup
  const { publicKey, privateKey } = await generateAgeKeyPair();

  // Encrypt backup data
  const jsonData = JSON.stringify(backupContents);
  const encryptedData = await encryptWithAge(jsonData, publicKey);

  const timestamp = new Date().toISOString();

  const backupFile: BackupFile = {
    magic: BACKUP_MAGIC,
    version: BACKUP_VERSION,
    timestamp,
    username: user.username,
    data: encryptedData,
    publicKey,
  };

  const keyFile: BackupKeyFile = {
    magic: KEY_MAGIC,
    version: KEY_VERSION,
    type: 'age-private-key',
    username: user.username,
    privateKey,
    publicKey,
    createdAt: timestamp,
  };

  // Encrypt private key if passphrase provided
  if (passphrase) {
    keyFile.privateKey = await encryptData(keyFile.privateKey, passphrase);
    keyFile.encrypted = true;
    keyFile.encryptionVersion = 'v1';
  }

  logger.info('[Backup] Created Age-encrypted backup for user:', user.username);

  return { backupFile, keyFile };
}

/**
 * Restore from Age-encrypted backup
 * Requires both the backup file and the key file
 */
export async function restoreBackup(
  backupContent: string,
  keyContent: string,
  passphrase?: string,
): Promise<BackupContents> {
  let backupFile: BackupFile;
  let keyFile: BackupKeyFile;

  try {
    backupFile = JSON.parse(backupContent) as BackupFile;
  } catch {
    throw new Error('Ungültige Backup-Datei');
  }

  try {
    keyFile = JSON.parse(keyContent) as BackupKeyFile;
  } catch {
    throw new Error('Ungültige BackupKey-Datei');
  }

  // Validate files
  if (backupFile.magic !== BACKUP_MAGIC) {
    throw new Error('Ungültige Backup-Datei (falsches Format)');
  }
  if (keyFile.magic !== KEY_MAGIC) {
    throw new Error('Ungültige BackupKey-Datei (falsches Format)');
  }
  if (backupFile.publicKey !== keyFile.publicKey) {
    throw new Error('Backup und Key passen nicht zusammen! Stellen Sie sicher, dass beide Dateien vom selben Backup stammen.');
  }

  // Decrypt private key if encrypted
  if (keyFile.encrypted && passphrase) {
    keyFile.privateKey = await decryptData(keyFile.privateKey, passphrase);
  } else if (keyFile.encrypted && !passphrase) {
    throw new Error('Backup-Key ist passwortgeschützt. Bitte Passwort eingeben.');
  }

  // Decrypt
  const decrypted = await decryptWithAge(backupFile.data, keyFile.privateKey);
  const contents = JSON.parse(decrypted) as BackupContents;

  logger.info('[Backup] Restored backup for user:', contents.user.username);
  return contents;
}

/**
 * Validate a backup file without the key
 * Returns metadata and checks if key is required
 */
export function validateBackupFile(content: string): ValidationResult {
  try {
    const backup = JSON.parse(content) as Partial<BackupFile>;

    if (backup.magic !== BACKUP_MAGIC) {
      return { valid: false, error: 'Ungültige Backup-Datei', requiresKey: false };
    }

    if (backup.version === BACKUP_VERSION) {
      // Age-encrypted backup
      return {
        valid: true,
        version: backup.version,
        username: backup.username,
        requiresKey: true,
      };
    }

    return { valid: false, error: 'Unbekannte Backup-Version', requiresKey: false };
  } catch {
    return { valid: false, error: 'Ungültiges Dateiformat', requiresKey: false };
  }
}

/**
 * Read a file and return its contents as string
 */
export function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

/**
 * Trigger download of backup file
 */
export function downloadBackup(backupFile: BackupFile): void {
  const blob = new Blob([JSON.stringify(backupFile, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `Backup_${backupFile.username}_${new Date().toISOString().split('T')[0]}.secuchat`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Trigger download of backup key file
 */
export function downloadBackupKey(keyFile: BackupKeyFile): void {
  const blob = new Blob([JSON.stringify(keyFile, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `BackupKey_${keyFile.username}.secuchat`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  logger.info('[Backup] Key file downloaded for user:', keyFile.username);
}

// Export all functions as backupService
export const backupService = {
  generateAgeKeyPair,
  encryptWithAge,
  decryptWithAge,
  createBackup,
  restoreBackup,
  validateBackupFile,
  readFile,
  downloadBackup,
  downloadBackupKey,
};

export default backupService;
