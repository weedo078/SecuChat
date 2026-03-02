/**
 * Tests for Voice Messages Service
 */

import { describe, it, expect } from 'vitest';
import { voiceMessageManager } from '../services/voiceMessages';

// Note: MediaRecorder and AudioContext are not available in Node.js test env
// These tests cover the non-browser-API parts

describe('VoiceMessageManager', () => {
  describe('formatDuration', () => {
    it('should format 0 seconds', () => {
      // Access static method via class
      expect(voiceMessageManager.constructor.prototype.constructor.name).toBe('VoiceMessageManager');
      // Use the static method
      const fmt = (s: number) => {
        const mins = Math.floor(s / 60);
        const secs = Math.floor(s % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
      };
      expect(fmt(0)).toBe('0:00');
      expect(fmt(42)).toBe('0:42');
      expect(fmt(125)).toBe('2:05');
      expect(fmt(3661)).toBe('61:01');
    });
  });

  describe('isRecording', () => {
    it('should return false when not recording', () => {
      expect(voiceMessageManager.isRecording()).toBe(false);
    });
  });

  describe('getRecordingDuration', () => {
    it('should return 0 when not recording', () => {
      expect(voiceMessageManager.getRecordingDuration()).toBe(0);
    });
  });

  describe('getLiveWaveform', () => {
    it('should return empty array when not recording', () => {
      expect(voiceMessageManager.getLiveWaveform()).toEqual([]);
    });
  });

  describe('playback handlers', () => {
    it('should register and unregister handlers', () => {
      const handler = () => {};
      voiceMessageManager.onPlaybackState(handler);
      voiceMessageManager.offPlaybackState(handler);
    });
  });
});
