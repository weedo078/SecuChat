/**
 * Tests for Status Messages Service (Read Receipts & Typing)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock i2pService before importing
vi.mock('../services/i2p', () => ({
  i2pService: {
    onMessage: vi.fn(),
    offMessage: vi.fn(),
    sendMessage: vi.fn().mockResolvedValue(true),
    isReady: vi.fn().mockReturnValue(true),
  },
}));

import { statusMessenger } from '../services/statusMessages';
import { i2pService } from '../services/i2p';

describe('StatusMessenger', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Reset by re-initializing
    statusMessenger.destroy();
    statusMessenger.initialize('test-user-id');
  });

  afterEach(() => {
    vi.useRealTimers();
    statusMessenger.destroy();
  });

  describe('sendTyping', () => {
    it('should send typing status via i2p', () => {
      statusMessenger.sendTyping('contact-address.b32.i2p');
      expect(i2pService.sendMessage).toHaveBeenCalledWith(
        'contact-address.b32.i2p',
        expect.objectContaining({
          type: 'status',
          statusType: 'typing',
          isTyping: true,
        })
      );
    });

    it('should debounce multiple typing calls', () => {
      (i2pService.sendMessage as ReturnType<typeof vi.fn>).mockClear();
      statusMessenger.sendTyping('debounce-contact.b32.i2p');
      statusMessenger.sendTyping('debounce-contact.b32.i2p');
      statusMessenger.sendTyping('debounce-contact.b32.i2p');
      // Should only send isTyping=true once (first call), subsequent calls just reset the timer
      const typingCalls = (i2pService.sendMessage as ReturnType<typeof vi.fn>).mock.calls
        .filter((c: unknown[]) => (c[1] as Record<string, unknown>)?.statusType === 'typing' && (c[1] as Record<string, unknown>)?.isTyping === true);
      expect(typingCalls.length).toBe(1);
    });

    it('should send stop-typing after 3s timeout', () => {
      statusMessenger.sendTyping('contact.b32.i2p');
      vi.advanceTimersByTime(3000);
      expect(i2pService.sendMessage).toHaveBeenCalledWith(
        'contact.b32.i2p',
        expect.objectContaining({
          statusType: 'typing',
          isTyping: false,
        })
      );
    });
  });

  describe('stopTyping', () => {
    it('should immediately send stop-typing', () => {
      statusMessenger.sendTyping('contact.b32.i2p');
      (i2pService.sendMessage as ReturnType<typeof vi.fn>).mockClear();
      statusMessenger.stopTyping('contact.b32.i2p');
      expect(i2pService.sendMessage).toHaveBeenCalledWith(
        'contact.b32.i2p',
        expect.objectContaining({
          statusType: 'typing',
          isTyping: false,
        })
      );
    });
  });

  describe('sendReadReceipt', () => {
    it('should send read receipt', () => {
      statusMessenger.sendReadReceipt('contact.b32.i2p', 'msg-123');
      expect(i2pService.sendMessage).toHaveBeenCalledWith(
        'contact.b32.i2p',
        expect.objectContaining({
          type: 'status',
          statusType: 'read',
          messageId: 'msg-123',
        })
      );
    });
  });

  describe('sendDeliveredReceipt', () => {
    it('should send delivered receipt', () => {
      statusMessenger.sendDeliveredReceipt('contact.b32.i2p', 'msg-456');
      expect(i2pService.sendMessage).toHaveBeenCalledWith(
        'contact.b32.i2p',
        expect.objectContaining({
          statusType: 'delivered',
          messageId: 'msg-456',
        })
      );
    });
  });
});
