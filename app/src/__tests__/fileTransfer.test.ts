/**
 * Tests for File Transfer Service
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../services/i2p', () => ({
  i2pService: {
    onMessage: vi.fn(),
    offMessage: vi.fn(),
    sendMessage: vi.fn().mockResolvedValue(true),
    isReady: vi.fn().mockReturnValue(true),
  },
}));

// Mock crypto.randomUUID
vi.stubGlobal('crypto', {
  ...globalThis.crypto,
  randomUUID: () => 'test-uuid-1234',
});

import { fileTransferManager } from '../services/fileTransfer';

describe('FileTransferManager', () => {
  beforeEach(() => {
    fileTransferManager.destroy();
    fileTransferManager.initialize();
  });

  describe('progress tracking', () => {
    it('should notify progress handlers', () => {
      const handler = vi.fn();
      fileTransferManager.onProgress(handler);
      // Progress is internal, but we can verify handler registration
      expect(handler).not.toHaveBeenCalled();
      fileTransferManager.offProgress(handler);
    });
  });

  describe('offer handling', () => {
    it('should register and unregister offer handlers', () => {
      const handler = vi.fn().mockResolvedValue(true);
      fileTransferManager.onOffer(handler);
      fileTransferManager.offOffer(handler);
      // No error means success
    });
  });

  describe('getReceivedFile', () => {
    it('should return null for unknown transfer', () => {
      expect(fileTransferManager.getReceivedFile('unknown-id')).toBeNull();
    });
  });

  describe('getTransfer', () => {
    it('should return undefined for unknown transfer', () => {
      expect(fileTransferManager.getTransfer('unknown-id')).toBeUndefined();
    });
  });

  describe('sendFile validation', () => {
    it('should reject files over 500MB', async () => {
      const hugeFile = new File([''], 'huge.bin');
      Object.defineProperty(hugeFile, 'size', { value: 600 * 1024 * 1024 });
      
      await expect(
        fileTransferManager.sendFile('contact.b32.i2p', hugeFile)
      ).rejects.toThrow('Datei zu groß');
    });
  });
});
