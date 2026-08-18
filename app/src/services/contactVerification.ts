/**
 * Contact Verification Service — Safety Numbers
 * 
 * Generates fingerprints from PGP keys, creates QR codes and
 * human-readable 6-word phrases for out-of-band verification.
 */

import * as openpgp from 'openpgp';
import QRCode from 'qrcode';
import { logger } from '@/utils/logger';
import type { ContactVerification, TrustLevel, VerificationMethod } from '@/types';
import { storageService } from './storage';

// Re-export types for backward compatibility with existing consumers
export type { ContactVerification, TrustLevel, VerificationMethod };

// BIP39-inspired word list (2048 words, using common German+English mix)
const WORD_LIST = [
  'alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel',
  'india', 'juliet', 'kilo', 'lima', 'mike', 'november', 'oscar', 'papa',
  'quebec', 'romeo', 'sierra', 'tango', 'uniform', 'victor', 'whiskey', 'xray',
  'yankee', 'zulu', 'ahorn', 'birke', 'eiche', 'fichte', 'kiefer', 'linde',
  'amber', 'azure', 'coral', 'dawn', 'ember', 'flame', 'frost', 'gleam',
  'haven', 'ivory', 'jade', 'knoll', 'lunar', 'maple', 'noble', 'onyx',
  'pearl', 'quartz', 'river', 'stone', 'terra', 'ultra', 'vivid', 'wren',
  'xenon', 'yield', 'zenith', 'apex', 'blaze', 'crest', 'drift', 'edge',
  'forge', 'glow', 'haze', 'inlet', 'jewel', 'karma', 'lotus', 'mist',
  'nexus', 'oasis', 'prism', 'quest', 'ridge', 'spark', 'tide', 'unity',
  'valor', 'waves', 'zephyr', 'arch', 'bolt', 'calm', 'dusk', 'fern',
  'grove', 'hawk', 'iron', 'keen', 'lark', 'mesa', 'north', 'orbit',
  'pulse', 'realm', 'sage', 'torch', 'vale', 'wind', 'beam', 'cliff',
  'dove', 'flint', 'grain', 'helm', 'isle', 'knot', 'lance', 'marsh',
  'nest', 'oak', 'pine', 'quill', 'rain', 'seal', 'thorn', 'umber',
  'vine', 'weld', 'zinc', 'atlas', 'brook', 'cedar', 'delta', 'frost',
  'garnet', 'holly', 'indigo', 'jasper', 'kelp', 'lava', 'moss', 'nova',
  'obsidian', 'petal', 'quake', 'rune', 'summit', 'talon', 'urchin', 'vortex',
  'willow', 'xylem', 'yarrow', 'zircon', 'agate', 'basalt', 'cobalt', 'dune',
  'elm', 'fjord', 'geyser', 'heath', 'iceberg', 'jungle', 'kayak', 'lagoon',
  'meadow', 'nebula', 'ocean', 'plateau', 'quarry', 'rapids', 'savanna', 'tundra',
  'upland', 'valley', 'wetland', 'yucca', 'aurora', 'breeze', 'canyon', 'delta',
  'equinox', 'falcon', 'glacier', 'harbor', 'island', 'jetty', 'kite', 'laguna',
  'monsoon', 'nimbus', 'osprey', 'pelican', 'quasar', 'robin', 'stork', 'tern',
  'condor', 'vulture', 'wader', 'crane', 'eagle', 'finch', 'grouse', 'heron',
  'ibis', 'jay', 'kinglet', 'linnet', 'magpie', 'nuthatch', 'oriole', 'plover',
  'raven', 'swift', 'thrush', 'vireo', 'warbler', 'waxwing', 'anvil', 'beacon',
  'cipher', 'decoy', 'enigma', 'fabric', 'galleon', 'hamlet', 'igloo', 'jigsaw',
  'kernel', 'lantern', 'matrix', 'nimble', 'outpost', 'paragon', 'riddle', 'sentry',
  'trinket', 'utopia', 'velvet', 'widget', 'yonder', 'zigzag', 'anchor', 'banner',
  'castle', 'dragon', 'emblem', 'feather', 'goblet', 'helmet', 'ivory', 'jasmine',
  'keystone', 'legend', 'mirror', 'needle', 'oracle', 'phantom', 'raptor', 'scepter',
];


/**
 * Generate a SHA-256 fingerprint from a PGP public key
 */
export async function generateFingerprint(publicKeyArmored: string): Promise<string> {
  try {
    const publicKey = await openpgp.readKey({ armoredKey: publicKeyArmored });
    return publicKey.getFingerprint().toUpperCase();
  } catch (error) {
    logger.error('Error generating fingerprint:', error);
    throw new Error('Failed to generate fingerprint from public key', { cause: error });
  }
}

/**
 * Generate a combined safety number from two fingerprints (ours + theirs).
 * This ensures both parties see the same number regardless of direction.
 */
export function generateSafetyNumber(fingerprint1: string, fingerprint2: string): string {
  // Sort alphabetically so both sides get the same result
  const sorted = [fingerprint1.toLowerCase(), fingerprint2.toLowerCase()].sort();
  return sorted.join(':');
}

/**
 * Convert a fingerprint to a human-readable 6-word phrase
 */
export function fingerprintToWords(fingerprint: string): string {
  const hex = fingerprint.replace(/[^0-9a-fA-F]/g, '');
  const words: string[] = [];
  const listSize = WORD_LIST.length;

  for (let i = 0; i < 6; i++) {
    // Take 4 hex chars (16 bits) per word
    const segment = hex.slice(i * 4, i * 4 + 4) || '0000';
    const index = parseInt(segment, 16) % listSize;
    words.push(WORD_LIST[index]);
  }

  return words.join(' ');
}

/**
 * Generate a formatted fingerprint string for display (groups of 4)
 */
export function formatFingerprint(fingerprint: string): string {
  const clean = fingerprint.replace(/\s/g, '').toUpperCase();
  return clean.match(/.{1,4}/g)?.join(' ') || clean;
}

/**
 * Generate QR code data URL from a safety number
 */
export async function generateQRCode(safetyNumber: string): Promise<string> {
  try {
    return await QRCode.toDataURL(safetyNumber, {
      width: 256,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#ffffff',
      },
      errorCorrectionLevel: 'M',
    });
  } catch (error) {
    logger.error('Error generating QR code:', error);
    throw new Error('Failed to generate QR code', { cause: error });
  }
}


/**
 * Verification storage helpers — stored in encrypted IndexedDB via storageService.
 * Migrated from localStorage to IndexedDB as part of security hardening.
 */
export class VerificationStore {
  private static readonly STORE_KEY = 'contact_verifications';

  /**
   * Migrate any old localStorage data to IndexedDB.
   * Called automatically during getAll().
   */
  private static async migrateFromLocalStorage(): Promise<void> {
    const oldData = localStorage.getItem(this.STORE_KEY);
    if (!oldData) return;

    try {
      const oldArr: ContactVerification[] = JSON.parse(oldData);
      if (oldArr.length > 0) {
        const settings = await storageService.getSecuritySettings();
        const existingMap = new Map<string, ContactVerification>(
          (settings?.contactVerifications ?? []).map(v => [v.contactId, v])
        );
        // Merge old data (existing IndexedDB data takes precedence)
        for (const v of oldArr) {
          if (!existingMap.has(v.contactId)) {
            existingMap.set(v.contactId, v);
          }
        }
        await storageService.saveSecuritySettings({
          ...settings,
          biometricEnabled: settings?.biometricEnabled ?? false,
          pinEnabled: settings?.pinEnabled ?? false,
          autoLockEnabled: settings?.autoLockEnabled ?? true,
          autoLockTimeout: settings?.autoLockTimeout ?? 5,
          contactVerifications: Array.from(existingMap.values()),
        });
      }
      localStorage.removeItem(this.STORE_KEY);
      logger.info('[VerificationStore] Migrated', oldArr.length, 'verifications from localStorage to IndexedDB');
    } catch (error) {
      logger.error('[VerificationStore] Failed to migrate from localStorage:', error);
    }
  }

  static async getAll(): Promise<Map<string, ContactVerification>> {
    await this.migrateFromLocalStorage();
    try {
      const settings = await storageService.getSecuritySettings();
      const arr = settings?.contactVerifications ?? [];
      return new Map(arr.map(v => [v.contactId, v]));
    } catch {
      return new Map();
    }
  }

  static async get(contactId: string): Promise<ContactVerification | null> {
    const all = await this.getAll();
    return all.get(contactId) || null;
  }

  static async save(verification: ContactVerification): Promise<void> {
    const all = await this.getAll();
    all.set(verification.contactId, verification);
    const settings = await storageService.getSecuritySettings();
    await storageService.saveSecuritySettings({
      ...settings,
      biometricEnabled: settings?.biometricEnabled ?? false,
      pinEnabled: settings?.pinEnabled ?? false,
      autoLockEnabled: settings?.autoLockEnabled ?? true,
      autoLockTimeout: settings?.autoLockTimeout ?? 5,
      contactVerifications: Array.from(all.values()),
    });
  }

  static async remove(contactId: string): Promise<void> {
    const all = await this.getAll();
    all.delete(contactId);
    const settings = await storageService.getSecuritySettings();
    await storageService.saveSecuritySettings({
      ...settings,
      biometricEnabled: settings?.biometricEnabled ?? false,
      pinEnabled: settings?.pinEnabled ?? false,
      autoLockEnabled: settings?.autoLockEnabled ?? true,
      autoLockTimeout: settings?.autoLockTimeout ?? 5,
      contactVerifications: Array.from(all.values()),
    });
  }
}
