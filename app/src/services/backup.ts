import type { BackupData, AppSettings, SecuritySettings } from '@/types';
import { storageService } from '@/services/storage';
import { logger } from '@/utils/logger';

const BACKUP_VERSION = '3.0';
const BACKUP_MAGIC = 'SECUCHAT_BACKUP';

export interface BackupFile {
  magic: string;
  version: string;
  encrypted: boolean;
  timestamp: string;
  data: string; // JSON string (plain or AES-encrypted base64)
}

export interface BackupContents extends BackupData {
  settings?: AppSettings;
  securitySettings?: SecuritySettings;
}

// AES-GCM encryption for backup files
async function deriveBackupKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt.buffer as ArrayBuffer, iterations: 200000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptBackup(data: string, password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveBackupKey(password, salt);
  const encoder = new TextEncoder();
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(data)
  );
  // Combine: salt(16) + iv(12) + ciphertext
  const combined = new Uint8Array(salt.length + iv.length + encrypted.byteLength);
  combined.set(salt);
  combined.set(iv, salt.length);
  combined.set(new Uint8Array(encrypted), salt.length + iv.length);
  return btoa(String.fromCharCode(...combined));
}

async function decryptBackup(encryptedBase64: string, password: string): Promise<string> {
  const combined = new Uint8Array(atob(encryptedBase64).split('').map(c => c.charCodeAt(0)));
  const salt = combined.slice(0, 16);
  const iv = combined.slice(16, 28);
  const encrypted = combined.slice(28);
  const key = await deriveBackupKey(password, salt);
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    encrypted
  );
  return new TextDecoder().decode(decrypted);
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
  encrypted?: boolean;
  version?: string;
  timestamp?: string;
  username?: string;
  contactCount?: number;
  messageCount?: number;
}

export class BackupService {
  private static instance: BackupService;

  static getInstance(): BackupService {
    if (!BackupService.instance) {
      BackupService.instance = new BackupService();
    }
    return BackupService.instance;
  }

  /**
   * Create a full backup of all app data
   */
  async createBackup(password?: string): Promise<BackupFile> {
    logger.log('[Backup] Creating backup...');
    
    const backup = await storageService.createBackup();
    const settings = await storageService.getSettings();
    const securitySettings = await storageService.getSecuritySettings();

    const contents: BackupContents = {
      ...backup,
      version: BACKUP_VERSION,
      settings: settings || undefined,
      securitySettings: securitySettings || undefined,
    };

    const jsonData = JSON.stringify(contents);
    const isEncrypted = !!password;

    const backupFile: BackupFile = {
      magic: BACKUP_MAGIC,
      version: BACKUP_VERSION,
      encrypted: isEncrypted,
      timestamp: new Date().toISOString(),
      data: isEncrypted ? await encryptBackup(jsonData, password!) : jsonData,
    };

    logger.log(`[Backup] Created backup: ${contents.contacts.length} contacts, ${contents.messages.length} messages, encrypted: ${isEncrypted}`);
    return backupFile;
  }

  /**
   * Validate a backup file without restoring it
   */
  validateBackupFile(fileContent: string): ValidationResult {
    try {
      const parsed = JSON.parse(fileContent);
      
      // Check if it's the new format (v3.0 with magic header)
      if (parsed.magic === BACKUP_MAGIC) {
        const result: ValidationResult = {
          valid: true,
          encrypted: parsed.encrypted,
          version: parsed.version,
          timestamp: parsed.timestamp,
        };

        // If not encrypted, peek at the data
        if (!parsed.encrypted) {
          try {
            const data = JSON.parse(parsed.data) as BackupContents;
            result.username = data.user?.username;
            result.contactCount = data.contacts?.length ?? 0;
            result.messageCount = data.messages?.length ?? 0;
          } catch {
            // data field is invalid JSON
            return { valid: false, error: 'Ungültige Backup-Daten' };
          }
        }
        return result;
      }

      // Check if it's a legacy v2.0 backup (direct BackupData)
      if (parsed.version === '2.0' && parsed.user && Array.isArray(parsed.contacts)) {
        return {
          valid: true,
          encrypted: false,
          version: parsed.version,
          timestamp: parsed.timestamp,
          username: parsed.user?.username,
          contactCount: parsed.contacts?.length ?? 0,
          messageCount: parsed.messages?.length ?? 0,
        };
      }

      // Check if it's a key-only backup from onboarding
      if (parsed.version === '2.0' && parsed.type === 'backup' && parsed.pgpPublicKey) {
        return {
          valid: true,
          encrypted: false,
          version: 'keys-only',
          timestamp: parsed.exportedAt,
          username: parsed.username,
          contactCount: 0,
          messageCount: 0,
        };
      }

      // Check if it's a PGP-encrypted backup (old format from Settings)
      if (typeof parsed === 'string' || (typeof fileContent === 'string' && fileContent.startsWith('-----BEGIN PGP'))) {
        return {
          valid: true,
          encrypted: true,
          version: 'legacy-pgp',
        };
      }

      return { valid: false, error: 'Unbekanntes Backup-Format' };
    } catch {
      // Maybe it's raw PGP-encrypted text
      if (fileContent.startsWith('-----BEGIN PGP')) {
        return { valid: true, encrypted: true, version: 'legacy-pgp' };
      }
      return { valid: false, error: 'Ungültiges JSON-Format' };
    }
  }

  /**
   * Restore a backup file
   */
  async restoreBackup(fileContent: string, password?: string): Promise<BackupContents> {
    const parsed = JSON.parse(fileContent);
    let contents: BackupContents;

    // New format (v3.0)
    if (parsed.magic === BACKUP_MAGIC) {
      let dataStr: string;
      if (parsed.encrypted) {
        if (!password) throw new Error('Backup ist verschlüsselt. Bitte Passwort eingeben.');
        try {
          dataStr = await decryptBackup(parsed.data, password);
        } catch {
          throw new Error('Falsches Passwort oder beschädigte Backup-Datei.');
        }
      } else {
        dataStr = parsed.data;
      }
      contents = JSON.parse(dataStr);
    }
    // Legacy v2.0 BackupData
    else if (parsed.version === '2.0' && parsed.user && Array.isArray(parsed.contacts)) {
      contents = parsed;
    }
    // Keys-only backup from onboarding
    else if (parsed.version === '2.0' && parsed.type === 'backup' && parsed.pgpPublicKey) {
      // Convert keys-only backup to full backup format
      contents = {
        version: '2.0',
        timestamp: parsed.exportedAt || new Date().toISOString(),
        user: {
          id: crypto.randomUUID(),
          username: parsed.username || 'Imported User',
          deviceId: crypto.randomUUID(),
          deviceName: parsed.deviceName || 'Imported Device',
          pgpPublicKey: parsed.pgpPublicKey,
          pgpPrivateKey: parsed.pgpPrivateKey,
          fingerprint: parsed.fingerprint,
          i2pAddress: parsed.i2pAddress || '',
          i2pPublicKey: parsed.i2pPublicKey,
          i2pPrivateKey: parsed.i2pPrivateKey,
          createdAt: parsed.exportedAt || new Date().toISOString(),
        },
        contacts: [],
        chats: [],
        messages: [],
        devices: [],
      };
    } else {
      throw new Error('Unbekanntes Backup-Format');
    }

    // Validate required fields
    if (!contents.user) throw new Error('Backup enthält keine Benutzerdaten');
    if (!Array.isArray(contents.contacts)) contents.contacts = [];
    if (!Array.isArray(contents.chats)) contents.chats = [];
    if (!Array.isArray(contents.messages)) contents.messages = [];
    if (!Array.isArray(contents.devices)) contents.devices = [];

    // Restore to storage
    await storageService.restoreBackup(contents);

    // Restore settings if present
    if (contents.settings) {
      await storageService.saveSettings(contents.settings);
    }
    if (contents.securitySettings) {
      await storageService.saveSecuritySettings(contents.securitySettings);
    }

    logger.log(`[Backup] Restored: ${contents.contacts.length} contacts, ${contents.messages.length} messages`);
    return contents;
  }

  /**
   * Export backup as downloadable file
   */
  downloadBackup(backupFile: BackupFile, username: string): void {
    const json = JSON.stringify(backupFile, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const date = new Date().toISOString().split('T')[0];
    link.download = `secuchat-backup-${username}-${date}.secuchat`;
    link.click();
    URL.revokeObjectURL(url);
  }

  /**
   * Read a file and return its text content
   */
  readFile(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target?.result as string);
      reader.onerror = () => reject(new Error('Datei konnte nicht gelesen werden'));
      reader.readAsText(file);
    });
  }
}

export const backupService = BackupService.getInstance();
