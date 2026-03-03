import type { BackupData, AppSettings, SecuritySettings } from '@/types';
import { storageService } from '@/services/storage';
import { logger } from '@/utils/logger';
import * as age from 'age-encryption';

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
  publicKey: string; // Age public key used for encryption
}

export interface BackupKeyFile {
  magic: string;
  version: string;
  type: 'age-private-key';
  username: string;
  privateKey: string; // Base64-encoded Age private key
  publicKey: string; // Base64-encoded Age public key
  createdAt: string;
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
 * Generate a new Age key pair for backup encryption
 */
export function generateAgeKeyPair(): { publicKey: string; privateKey: string } {
  const identity = age.generateIdentity();
  const recipient = age.identityToRecipient(identity);
  
  return {
    publicKey: Buffer.from(recipient).toString('base64'),
    privateKey: Buffer.from(identity).toString('base64')
  };
}

/**
 * Encrypt data with Age public key
 */
export async function encryptWithAge(data: string, publicKeyBase64: string): Promise<string> {
  const recipient = age.parseRecipient(Buffer.from(publicKeyBase64, 'base64'));
  const plaintext = Buffer.from(data, 'utf-8');
  const encrypted = await age.encrypt(plaintext, [recipient]);
  return Buffer.from(encrypted).toString('base64');
}

/**
 * Decrypt data with Age private key
 */
export async function decryptWithAge(encryptedBase64: string, privateKeyBase64: string): Promise<string> {
  const identity = age.parseIdentity(Buffer.from(privateKeyBase64, 'base64'));
  const encrypted = Buffer.from(encryptedBase64, 'base64');
  const decrypted = await age.decrypt(encrypted, [identity]);
  return Buffer.from(decrypted).toString('utf-8');
}

/**
 * Create a full backup with Age encryption
 * Returns both the encrypted backup and the private key
 */
export async function createBackup(): Promise<BackupResult> {
  const user = await storageService.getUser();
  if (!user) throw new Error('No user found');

  const contacts = await storageService.getContacts();
  const chats = await storageService.getChats();
  const messages: Record<string, unknown[]> = {};
  
  for (const chat of chats) {
    messages[chat.id] = await storageService.getMessages(chat.id);
  }
  
  const settings = await storageService.getSettings();
  const securitySettings = await storageService.getSecuritySettings();

  const backupContents: BackupContents = {
    user: {
      id: user.id,
      username: user.username,
      deviceId: user.deviceId,
      deviceName: user.deviceName,
      fingerprint: user.fingerprint,
      pgpPublicKey: user.pgpPublicKey,
      i2pAddress: user.i2pAddress,
      i2pPublicKey: user.i2pPublicKey,
      createdAt: user.createdAt,
    },
    contacts: contacts.map(c => ({
      id: c.id,
      username: c.username,
      fingerprint: c.fingerprint,
      pgpPublicKey: c.pgpPublicKey,
      i2pAddress: c.i2pAddress,
      i2pPublicKey: c.i2pPublicKey,
      verified: c.verified,
      addedAt: c.addedAt,
    })),
    chats: chats.map(c => ({
      id: c.id,
      contactId: c.contactId,
      createdAt: c.createdAt,
      lastMessageAt: c.lastMessageAt,
    })),
    messages,
    settings: settings || undefined,
    securitySettings: securitySettings || undefined,
  };

  // Generate Age keys for this backup
  const { publicKey, privateKey } = generateAgeKeyPair();
  
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

  logger.info('[Backup] Created Age-encrypted backup for user:', user.username);
  
  return { backupFile, keyFile };
}

/**
 * Restore from Age-encrypted backup
 * Requires both the backup file and the key file
 */
export async function restoreBackup(
  backupContent: string,
  keyContent: string
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
