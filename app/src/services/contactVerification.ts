/**
 * Contact Verification Service — Safety Numbers
 * 
 * Generates fingerprints from PGP keys, creates QR codes and
 * human-readable 6-word phrases for out-of-band verification.
 */

import * as openpgp from 'openpgp';
import QRCode from 'qrcode';
import { logger } from '@/utils/logger';

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

export type TrustLevel = 'unverified' | 'verified' | 'blocked';
export type VerificationMethod = 'qr' | 'manual' | 'none';

export interface ContactVerification {
  contactId: string;
  publicKeyFingerprint: string;
  trustLevel: TrustLevel;
  verifiedAt?: string;
  verificationMethod: VerificationMethod;
}

/**
 * Generate a SHA-256 fingerprint from a PGP public key
 */
export async function generateFingerprint(publicKeyArmored: string): Promise<string> {
  try {
    const publicKey = await openpgp.readKey({ armoredKey: publicKeyArmored });
    return publicKey.getFingerprint().toUpperCase();
  } catch (error) {
    logger.error('Error generating fingerprint:', error);
    throw new Error('Failed to generate fingerprint from public key');
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
    throw new Error('Failed to generate QR code');
  }
}

/**
 * Verification storage helpers — stored in IndexedDB via storageService
 */
export class VerificationStore {
  private static STORE_KEY = 'contact_verifications';

  static async getAll(): Promise<Map<string, ContactVerification>> {
    try {
      const raw = localStorage.getItem(this.STORE_KEY);
      if (!raw) return new Map();
      const arr: ContactVerification[] = JSON.parse(raw);
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
    localStorage.setItem(this.STORE_KEY, JSON.stringify(Array.from(all.values())));
  }

  static async remove(contactId: string): Promise<void> {
    const all = await this.getAll();
    all.delete(contactId);
    localStorage.setItem(this.STORE_KEY, JSON.stringify(Array.from(all.values())));
  }
}
