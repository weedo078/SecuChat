/**
 * Tests for Contact Verification Service
 */

import { describe, it, expect } from 'vitest';
import {
  generateSafetyNumber,
  fingerprintToWords,
  formatFingerprint,
} from '../services/contactVerification';

describe('Contact Verification', () => {
  const fingerprint1 = 'ABCDEF1234567890ABCDEF1234567890ABCDEF12';
  const fingerprint2 = '1234567890ABCDEF1234567890ABCDEF12345678';

  describe('generateSafetyNumber', () => {
    it('should produce consistent safety numbers regardless of order', () => {
      const sn1 = generateSafetyNumber(fingerprint1, fingerprint2);
      const sn2 = generateSafetyNumber(fingerprint2, fingerprint1);
      expect(sn1).toBe(sn2);
    });

    it('should return a non-empty string', () => {
      const sn = generateSafetyNumber(fingerprint1, fingerprint2);
      expect(sn.length).toBeGreaterThan(0);
    });

    it('should contain both fingerprints', () => {
      const sn = generateSafetyNumber(fingerprint1, fingerprint2);
      expect(sn).toContain(':');
    });
  });

  describe('fingerprintToWords', () => {
    it('should return exactly 6 words', () => {
      const words = fingerprintToWords(fingerprint1);
      expect(words.split(' ')).toHaveLength(6);
    });

    it('should be deterministic', () => {
      const w1 = fingerprintToWords(fingerprint1);
      const w2 = fingerprintToWords(fingerprint1);
      expect(w1).toBe(w2);
    });

    it('should produce different phrases for different fingerprints', () => {
      const w1 = fingerprintToWords(fingerprint1);
      const w2 = fingerprintToWords(fingerprint2);
      expect(w1).not.toBe(w2);
    });
  });

  describe('formatFingerprint', () => {
    it('should group fingerprint in blocks of 4', () => {
      const formatted = formatFingerprint('ABCDEF1234567890');
      expect(formatted).toBe('ABCD EF12 3456 7890');
    });

    it('should uppercase the result', () => {
      const formatted = formatFingerprint('abcdef');
      expect(formatted).toBe('ABCD EF');
    });
  });
});
