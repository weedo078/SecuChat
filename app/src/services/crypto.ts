import * as openpgp from 'openpgp';
import { logger } from '@/utils/logger';
import type { User, Contact } from '@/types';

export class CryptoService {
  private static instance: CryptoService;
  private userKeyPair: { publicKey: string; privateKey: string; fingerprint: string } | null = null;
  private decryptedPrivateKey: openpgp.PrivateKey | null = null;
  private decryptedKeyExpiry: number = 0; // timestamp when key expires
  private static readonly KEY_TTL_MS = 5 * 60 * 1000; // 5 minutes

  // Rate limiting for failed operations
  private failedDecryptAttempts = 0;
  private decryptLockedUntil = 0;
  private failedImportAttempts = 0;
  private importLockedUntil = 0;
  private static readonly MAX_ATTEMPTS = 5;
  private static readonly LOCKOUT_DURATION_MS = 30 * 1000; // 30 seconds

  static getInstance(): CryptoService {
    if (!CryptoService.instance) {
      CryptoService.instance = new CryptoService();
    }
    return CryptoService.instance;
  }
  private isDecryptedKeyValid(): boolean {
    return this.decryptedPrivateKey !== null && Date.now() < this.decryptedKeyExpiry;
  }

  private resetKeyExpiry(): void {
    this.decryptedKeyExpiry = Date.now() + CryptoService.KEY_TTL_MS;
  }

  private checkDecryptLock(): void {
    if (Date.now() < this.decryptLockedUntil) {
      const remaining = Math.ceil((this.decryptLockedUntil - Date.now()) / 1000);
      throw new Error(`Zu viele fehlgeschlagene Versuche. Bitte ${remaining}s warten.`);
    }
  }

  private checkImportLock(): void {
    if (Date.now() < this.importLockedUntil) {
      const remaining = Math.ceil((this.importLockedUntil - Date.now()) / 1000);
      throw new Error(`Zu viele fehlgeschlagene Versuche. Bitte ${remaining}s warten.`);
    }
  }


  /**
   * Generate a new PGP key pair for the user
   * Uses ECC (curve25519) for fast key generation in browser
   */
  async generateKeyPair(username: string, passphrase: string): Promise<{ publicKey: string; privateKey: string; fingerprint: string }> {
    try {
      logger.log('Starting key generation for:', username);
      
      // Sanitize username for PGP user ID (remove special chars, keep alphanumeric and spaces)
      const sanitizedName = username.replace(/[^a-zA-Z0-9\s]/g, '').trim() || 'User';
      // Create email-safe version (no spaces, lowercase)
      const emailSafe = sanitizedName.toLowerCase().replace(/\s+/g, '_');
      
      // Use ECC curve25519 - much faster than RSA in browser
      const { privateKey, publicKey } = await openpgp.generateKey({
        type: 'ecc',
        curve: 'curve25519Legacy',
        userIDs: [{ 
          name: sanitizedName, 
          email: `${emailSafe}@securechat.local` 
        }],
        passphrase,
        format: 'armored',
      });

      logger.log('Key pair generated successfully');

      // Get fingerprint from public key
      const publicKeyObj = await openpgp.readKey({ armoredKey: publicKey });
      const fingerprint = publicKeyObj.getFingerprint().toUpperCase();

      this.userKeyPair = { publicKey, privateKey, fingerprint };
      this.decryptedPrivateKey = await openpgp.readPrivateKey({ armoredKey: privateKey });
      this.resetKeyExpiry();
      
      logger.log('Fingerprint:', fingerprint);
      
      return { publicKey, privateKey, fingerprint };
    } catch (error) {
      logger.error('Error generating key pair:', error);
      throw new Error(`Failed to generate PGP key pair: ${error instanceof Error ? error.message : 'Unknown error'}`, { cause: error });
    }
  }

  /**
   * Import existing key pair
   */
  async importKeyPair(privateKey: string, publicKey: string, passphrase: string): Promise<{ fingerprint: string }> {
    this.checkImportLock();
    try {
      const privateKeyObj = await openpgp.readPrivateKey({ armoredKey: privateKey });
      this.decryptedPrivateKey = await openpgp.decryptKey({
        privateKey: privateKeyObj,
        passphrase,
      });
      this.resetKeyExpiry();

      const publicKeyObj = await openpgp.readKey({ armoredKey: publicKey });
      const fingerprint = publicKeyObj.getFingerprint().toUpperCase();

      this.userKeyPair = { publicKey, privateKey, fingerprint };
      this.failedImportAttempts = 0;
      
      return { fingerprint };
    } catch (error) {
      this.failedImportAttempts++;
      if (this.failedImportAttempts >= CryptoService.MAX_ATTEMPTS) {
        this.importLockedUntil = Date.now() + CryptoService.LOCKOUT_DURATION_MS;
        logger.warn('[Crypto] Too many failed key import attempts, locked for 30s');
      }
      logger.error('Error importing key pair:', error);
      throw new Error('Failed to import PGP key pair', { cause: error });
    }
  }

  /**
   * Encrypt a message for a specific recipient
   */
  async encryptMessage(message: string, recipientPublicKey: string): Promise<string> {
    try {
      const recipientKey = await openpgp.readKey({ armoredKey: recipientPublicKey });

      // Encrypt for both recipient AND sender so the sender can read their own messages later
      const encryptionKeys: openpgp.PublicKey[] = [recipientKey];
      if (this.userKeyPair?.publicKey) {
        const senderKey = await openpgp.readKey({ armoredKey: this.userKeyPair.publicKey });
        encryptionKeys.push(senderKey);
      }

      const encrypted = await openpgp.encrypt({
        message: await openpgp.createMessage({ text: message }),
        encryptionKeys,
        format: 'armored',
      });

      return encrypted;
    } catch (error) {
      logger.error('Error encrypting message:', error);
      throw new Error('Failed to encrypt message', { cause: error });
    }
  }

  /**
   * Decrypt a message with user's private key
   */
  async decryptMessage(encryptedMessage: string, passphrase?: string): Promise<string> {
    this.checkDecryptLock();
    try {
      if (!this.userKeyPair) {
        throw new Error('No key pair loaded');
      }

      let privateKey: openpgp.PrivateKey;
      if (this.isDecryptedKeyValid()) {
        privateKey = this.decryptedPrivateKey!;
        // Extend TTL on use
        this.resetKeyExpiry();
      } else if (passphrase) {
        privateKey = await openpgp.decryptKey({
          privateKey: await openpgp.readPrivateKey({ armoredKey: this.userKeyPair.privateKey }),
          passphrase,
        });
      } else {
        throw new Error('No decrypted key available and no passphrase provided');
      }

      const message = await openpgp.readMessage({ armoredMessage: encryptedMessage });
      
      const { data: decrypted } = await openpgp.decrypt({
        message,
        decryptionKeys: privateKey,
      });

      this.failedDecryptAttempts = 0;
      return decrypted;
    } catch (error) {
      this.failedDecryptAttempts++;
      if (this.failedDecryptAttempts >= CryptoService.MAX_ATTEMPTS) {
        this.decryptLockedUntil = Date.now() + CryptoService.LOCKOUT_DURATION_MS;
        logger.warn('[Crypto] Too many failed decryption attempts, locked for 30s');
      }
      logger.error('Error decrypting message:', error);
      throw new Error('Failed to decrypt message', { cause: error });
    }
  }

  /**
   * Sign a message with user's private key
   */
  async signMessage(message: string, passphrase: string): Promise<string> {
    try {
      if (!this.userKeyPair) {
        throw new Error('No key pair loaded');
      }

      const privateKey = await openpgp.decryptKey({
        privateKey: await openpgp.readPrivateKey({ armoredKey: this.userKeyPair.privateKey }),
        passphrase,
      });

      const signed = await openpgp.sign({
        message: await openpgp.createMessage({ text: message }),
        signingKeys: privateKey,
        format: 'armored',
      });

      return signed;
    } catch (error) {
      logger.error('Error signing message:', error);
      throw new Error('Failed to sign message', { cause: error });
    }
  }

  /**
   * Verify a signature with sender's public key
   */
  async verifySignature(signedMessage: string, senderPublicKey: string): Promise<{ valid: boolean; data: string }> {
    try {
      const publicKey = await openpgp.readKey({ armoredKey: senderPublicKey });
      
      const signed = await openpgp.readMessage({ armoredMessage: signedMessage });
      
      const verificationResult = await openpgp.verify({
        message: signed,
        verificationKeys: publicKey,
      });

      const valid = await verificationResult.signatures[0]?.verified;
      
      return { valid: valid === true, data: verificationResult.data };
    } catch (error) {
      logger.error('Error verifying signature:', error);
      return { valid: false, data: '' };
    }
  }

  /**
   * Get user's fingerprint
   */
  getFingerprint(): string | null {
    return this.userKeyPair?.fingerprint || null;
  }

  /**
   * Get user's public key
   */
  getPublicKey(): string | null {
    return this.userKeyPair?.publicKey || null;
  }

  /**
   * Get user's private key (for backup)
   */
  getPrivateKey(): string | null {
    return this.userKeyPair?.privateKey || null;
  }

  /**
   * Check if key pair is loaded
   */
  hasKeyPair(): boolean {
    return this.userKeyPair !== null;
  }

  /**
   * Clear key pair from memory
   */
  clearKeyPair(): void {
    // Note: JS doesn't support secure memory wiping, but we null references for GC
    this.userKeyPair = null;
    this.decryptedPrivateKey = null;
    this.decryptedKeyExpiry = 0;
    this.failedDecryptAttempts = 0;
    this.failedImportAttempts = 0;
  }

  /**
   * Validate a public key
   */
  async validatePublicKey(armoredKey: string): Promise<{ valid: boolean; fingerprint?: string; error?: string }> {
    try {
      const publicKey = await openpgp.readKey({ armoredKey });
      const fingerprint = publicKey.getFingerprint().toUpperCase();
      return { valid: true, fingerprint };
    } catch {
      return { valid: false, error: 'Invalid PGP public key' };
    }
  }

  /**
   * Export connection file data
   */
  exportConnectionFile(user: User): string {
    const connectionFile = {
      version: '1.0',
      metadata: {
        timestamp: new Date().toISOString(),
        username: user.username,
        deviceId: user.deviceId,
      },
      keys: {
        pgpPublicKey: user.pgpPublicKey,
        fingerprint: user.fingerprint,
      },
      network: {
        p2pIdentifier: user.id,
        protocol: user.i2pAddress ? 'i2p-webrtc' : 'webrtc',
        i2pAddress: user.i2pAddress,
      },
    };

    return JSON.stringify(connectionFile, null, 2);
  }

  /**
   * Import connection file data
   * Supports both new format (v1.0) and legacy QR code format (v2)
   */
  importConnectionFile(jsonData: string): { success: boolean; contact?: Partial<Contact>; error?: string } {
    try {
      const data = JSON.parse(jsonData);
      
      // New format (v1.0)
      if (data.version === '1.0') {
        if (!data.keys?.pgpPublicKey || !data.keys?.fingerprint) {
          return { success: false, error: 'Invalid connection file: missing key data' };
        }

        return {
          success: true,
          contact: {
            name: data.metadata?.username || 'Unknown',
            pgpPublicKey: data.keys.pgpPublicKey,
            fingerprint: data.keys.fingerprint,
            p2pIdentifier: data.network?.p2pIdentifier || '',
            i2pAddress: data.network?.i2pAddress,
          },
        };
      }
      
      // Legacy QR code format (v2) - compact format
      if (data.v === '2' && data.t === 'sc') {
        if (!data.k || !data.f) {
          return { success: false, error: 'Invalid legacy connection file: missing key data' };
        }

        return {
          success: true,
          contact: {
            name: data.n || 'Unknown',
            pgpPublicKey: data.k,
            fingerprint: data.f,
            p2pIdentifier: '',
            i2pAddress: data.i,
          },
        };
      }

      return { success: false, error: 'Unsupported connection file version. Expected v1.0 or legacy v2 format.' };
    } catch {
      return { success: false, error: 'Invalid JSON format' };
    }
  }
}

export const cryptoService = CryptoService.getInstance();
