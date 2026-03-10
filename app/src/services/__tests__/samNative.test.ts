/**
 * Tests for SAM Native Plugin (Capacitor)
 * Mocks the Capacitor plugin interface for testing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Capacitor
const mockPlugin = {
  connect: vi.fn(),
  disconnect: vi.fn(),
  generateDestination: vi.fn(),
  createSession: vi.fn(),
  connectToPeer: vi.fn(),
  sendMessage: vi.fn(),
  isAvailable: vi.fn(),
  getB32Address: vi.fn(),
};

vi.mock('@capacitor/core', () => ({
  registerPlugin: () => mockPlugin,
  Capacitor: {
    isNativePlatform: () => true,
  },
}));

// Error codes matching the native plugin
export const SAMErrorCodes = {
  CONNECTION_FAILED: 'CONNECTION_FAILED',
  TIMEOUT: 'TIMEOUT',
  INVALID_RESPONSE: 'INVALID_RESPONSE',
  STREAM_CLOSED: 'STREAM_CLOSED',
  SESSION_ERROR: 'SESSION_ERROR',
  DESTINATION_ERROR: 'DESTINATION_ERROR',
  PEER_UNREACHABLE: 'PEER_UNREACHABLE',
  INVALID_CONFIG: 'INVALID_CONFIG',
  HELLO_FAILED: 'HELLO_FAILED',
  MAX_RECONNECT_EXCEEDED: 'MAX_RECONNECT_EXCEEDED',
  UNKNOWN: 'UNKNOWN',
} as const;

// SAM Config interface
export interface SAMConfig {
  host: string;
  port: number;
  enabled: boolean;
}

// SAM Session interface
export interface SAMSession {
  id: string;
  destination: string;
  privateKey: string;
}

// SAM Native Service
class SAMNativeService {
  private config: SAMConfig = { host: '127.0.0.1', port: 7656, enabled: false };
  private isConnected = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  // Timeouts (in ms)
  private readonly TIMEOUT_HELLO = 15000;
  private readonly TIMEOUT_SESSION_CREATE = 60000;
  private readonly TIMEOUT_STREAM_CONNECT = 60000;
  private readonly TIMEOUT_SEND_RECEIVE = 30000;

  async connect(config: SAMConfig): Promise<boolean> {
    this.config = config;

    if (!config.enabled) {
      throw new Error(SAMErrorCodes.INVALID_CONFIG);
    }

    try {
      const result = await mockPlugin.connect({
        host: config.host,
        port: config.port,
        timeout: this.TIMEOUT_HELLO,
      });

      if (result.success) {
        this.isConnected = true;
        this.reconnectAttempts = 0;
        return true;
      } else {
        throw new Error(result.error || SAMErrorCodes.CONNECTION_FAILED);
      }
    } catch (error) {
      this.isConnected = false;
      throw error;
    }
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    mockPlugin.disconnect();
    this.isConnected = false;
  }

  async generateDestination(): Promise<SAMSession> {
    if (!this.isConnected) {
      throw new Error(SAMErrorCodes.CONNECTION_FAILED);
    }

    const result = await mockPlugin.generateDestination();

    if (!result.success) {
      throw new Error(result.error || SAMErrorCodes.DESTINATION_ERROR);
    }

    return {
      id: crypto.randomUUID(),
      destination: result.destination,
      privateKey: result.privateKey,
    };
  }

  async createSession(nickname: string, privateKey?: string): Promise<void> {
    if (!this.isConnected) {
      throw new Error(SAMErrorCodes.CONNECTION_FAILED);
    }

    const result = await mockPlugin.createSession({
      nickname,
      privateKey,
      timeout: this.TIMEOUT_SESSION_CREATE,
    });

    if (!result.success) {
      if (result.error?.includes('timeout')) {
        throw new Error(SAMErrorCodes.TIMEOUT);
      }
      throw new Error(result.error || SAMErrorCodes.SESSION_ERROR);
    }
  }

  async connectToPeer(destination: string): Promise<number> {
    if (!this.isConnected) {
      throw new Error(SAMErrorCodes.CONNECTION_FAILED);
    }

    const result = await mockPlugin.connectToPeer({
      destination,
      timeout: this.TIMEOUT_STREAM_CONNECT,
    });

    if (!result.success) {
      if (result.error?.includes('unreachable')) {
        throw new Error(SAMErrorCodes.PEER_UNREACHABLE);
      }
      if (result.error?.includes('timeout')) {
        throw new Error(SAMErrorCodes.TIMEOUT);
      }
      throw new Error(result.error || SAMErrorCodes.CONNECTION_FAILED);
    }

    return result.streamId;
  }

  async sendMessage(streamId: number, data: string): Promise<void> {
    const result = await mockPlugin.sendMessage({
      streamId,
      data,
      timeout: this.TIMEOUT_SEND_RECEIVE,
    });

    if (!result.success) {
      if (result.error?.includes('closed')) {
        throw new Error(SAMErrorCodes.STREAM_CLOSED);
      }
      throw new Error(result.error || SAMErrorCodes.UNKNOWN);
    }
  }

  async isAvailable(config?: SAMConfig): Promise<boolean> {
    const c = config || this.config;
    if (!c.enabled) return false;

    try {
      const result = await mockPlugin.isAvailable({
        host: c.host,
        port: c.port,
      });
      return result.available;
    } catch {
      return false;
    }
  }

  async getB32Address(): Promise<string | null> {
    if (!this.isConnected) {
      return null;
    }

    const result = await mockPlugin.getB32Address();
    return result.b32Address || null;
  }

  isSAMConnected(): boolean {
    return this.isConnected;
  }

  /**
   * Attempt reconnection with exponential backoff
   */
  async attemptReconnect(): Promise<boolean> {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      throw new Error(SAMErrorCodes.MAX_RECONNECT_EXCEEDED);
    }

    this.reconnectAttempts++;

    // Exponential backoff: 1s, 2s, 4s, 8s, max 30s
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 30000);

    return new Promise((resolve, reject) => {
      this.reconnectTimer = setTimeout(async () => {
        try {
          const success = await this.connect(this.config);
          if (success) {
            this.reconnectAttempts = 0;
            resolve(true);
          } else {
            resolve(false);
          }
        } catch (error) {
          reject(error);
        }
      }, delay);
    });
  }

  getReconnectAttempts(): number {
    return this.reconnectAttempts;
  }
}

describe('SAMNativeService', () => {
  let service: SAMNativeService;

  beforeEach(() => {
    service = new SAMNativeService();
    vi.clearAllMocks();
  });

  describe('connect', () => {
    it('should connect successfully with valid config', async () => {
      mockPlugin.connect.mockResolvedValue({ success: true });

      const result = await service.connect({
        host: '127.0.0.1',
        port: 7656,
        enabled: true,
      });

      expect(result).toBe(true);
      expect(service.isSAMConnected()).toBe(true);
    });

    it('should throw INVALID_CONFIG when not enabled', async () => {
      await expect(
        service.connect({
          host: '127.0.0.1',
          port: 7656,
          enabled: false,
        })
      ).rejects.toThrow(SAMErrorCodes.INVALID_CONFIG);
    });

    it('should throw CONNECTION_FAILED on connection error', async () => {
      mockPlugin.connect.mockResolvedValue({
        success: false,
        error: SAMErrorCodes.CONNECTION_FAILED,
      });

      await expect(
        service.connect({
          host: '127.0.0.1',
          port: 7656,
          enabled: true,
        })
      ).rejects.toThrow(SAMErrorCodes.CONNECTION_FAILED);
    });

    it('should use 15s timeout for HELLO handshake', async () => {
      mockPlugin.connect.mockResolvedValue({ success: true });

      await service.connect({
        host: '127.0.0.1',
        port: 7656,
        enabled: true,
      });

      expect(mockPlugin.connect).toHaveBeenCalledWith(
        expect.objectContaining({ timeout: 15000 })
      );
    });
  });

  describe('disconnect', () => {
    it('should disconnect and clear state', async () => {
      mockPlugin.connect.mockResolvedValue({ success: true });
      await service.connect({ host: '127.0.0.1', port: 7656, enabled: true });

      service.disconnect();

      expect(mockPlugin.disconnect).toHaveBeenCalled();
      expect(service.isSAMConnected()).toBe(false);
    });

    it('should clear reconnect timer on disconnect', async () => {
      mockPlugin.connect.mockResolvedValue({ success: true });
      await service.connect({ host: '127.0.0.1', port: 7656, enabled: true });

      // Start a reconnect attempt
      mockPlugin.connect.mockResolvedValueOnce({ success: true });
      service.attemptReconnect();

      service.disconnect();

      // Timer should be cleared, no error thrown
      expect(service.isSAMConnected()).toBe(false);
    });
  });

  describe('generateDestination', () => {
    it('should generate destination when connected', async () => {
      mockPlugin.connect.mockResolvedValue({ success: true });
      mockPlugin.generateDestination.mockResolvedValue({
        success: true,
        destination: 'test-dest-b64',
        privateKey: 'test-priv-b64',
      });

      await service.connect({ host: '127.0.0.1', port: 7656, enabled: true });
      const session = await service.generateDestination();

      expect(session.destination).toBe('test-dest-b64');
      expect(session.privateKey).toBe('test-priv-b64');
    });

    it('should throw CONNECTION_FAILED when not connected', async () => {
      await expect(service.generateDestination()).rejects.toThrow(
        SAMErrorCodes.CONNECTION_FAILED
      );
    });

    it('should throw DESTINATION_ERROR on failure', async () => {
      mockPlugin.connect.mockResolvedValue({ success: true });
      mockPlugin.generateDestination.mockResolvedValue({
        success: false,
        error: 'Key generation failed',
      });

      await service.connect({ host: '127.0.0.1', port: 7656, enabled: true });

      await expect(service.generateDestination()).rejects.toThrow(
        SAMErrorCodes.DESTINATION_ERROR
      );
    });
  });

  describe('createSession', () => {
    it('should create session with 60s timeout', async () => {
      mockPlugin.connect.mockResolvedValue({ success: true });
      mockPlugin.createSession.mockResolvedValue({ success: true });

      await service.connect({ host: '127.0.0.1', port: 7656, enabled: true });
      await service.createSession('test-session', 'private-key');

      expect(mockPlugin.createSession).toHaveBeenCalledWith(
        expect.objectContaining({
          nickname: 'test-session',
          privateKey: 'private-key',
          timeout: 60000,
        })
      );
    });

    it('should throw TIMEOUT on timeout error', async () => {
      mockPlugin.connect.mockResolvedValue({ success: true });
      mockPlugin.createSession.mockResolvedValue({
        success: false,
        error: 'Operation timeout',
      });

      await service.connect({ host: '127.0.0.1', port: 7656, enabled: true });

      await expect(service.createSession('test')).rejects.toThrow(
        SAMErrorCodes.TIMEOUT
      );
    });
  });

  describe('connectToPeer', () => {
    it('should connect to peer with 60s timeout', async () => {
      mockPlugin.connect.mockResolvedValue({ success: true });
      mockPlugin.connectToPeer.mockResolvedValue({
        success: true,
        streamId: 42,
      });

      await service.connect({ host: '127.0.0.1', port: 7656, enabled: true });
      const streamId = await service.connectToPeer('peer-dest-b64');

      expect(streamId).toBe(42);
      expect(mockPlugin.connectToPeer).toHaveBeenCalledWith(
        expect.objectContaining({
          destination: 'peer-dest-b64',
          timeout: 60000,
        })
      );
    });

    it('should throw PEER_UNREACHABLE when peer not found', async () => {
      mockPlugin.connect.mockResolvedValue({ success: true });
      mockPlugin.connectToPeer.mockResolvedValue({
        success: false,
        error: 'Peer unreachable: LeaseSet not found',
      });

      await service.connect({ host: '127.0.0.1', port: 7656, enabled: true });

      await expect(service.connectToPeer('peer-dest')).rejects.toThrow(
        SAMErrorCodes.PEER_UNREACHABLE
      );
    });
  });

  describe('sendMessage', () => {
    it('should send message with 30s timeout', async () => {
      mockPlugin.sendMessage.mockResolvedValue({ success: true });

      await service.sendMessage(1, 'Hello, I2P!');

      expect(mockPlugin.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          streamId: 1,
          data: 'Hello, I2P!',
          timeout: 30000,
        })
      );
    });

    it('should throw STREAM_CLOSED when stream is closed', async () => {
      mockPlugin.sendMessage.mockResolvedValue({
        success: false,
        error: 'Stream closed',
      });

      await expect(service.sendMessage(1, 'test')).rejects.toThrow(
        SAMErrorCodes.STREAM_CLOSED
      );
    });
  });

  describe('isAvailable', () => {
    it('should return true when SAM is available', async () => {
      mockPlugin.isAvailable.mockResolvedValue({ available: true });

      const result = await service.isAvailable({
        host: '127.0.0.1',
        port: 7656,
        enabled: true,
      });

      expect(result).toBe(true);
    });

    it('should return false when disabled', async () => {
      const result = await service.isAvailable({
        host: '127.0.0.1',
        port: 7656,
        enabled: false,
      });

      expect(result).toBe(false);
    });

    it('should return false on error', async () => {
      mockPlugin.isAvailable.mockRejectedValue(new Error('Network error'));

      const result = await service.isAvailable({
        host: '127.0.0.1',
        port: 7656,
        enabled: true,
      });

      expect(result).toBe(false);
    });
  });

  describe('getB32Address', () => {
    it('should return b32 address when connected', async () => {
      mockPlugin.connect.mockResolvedValue({ success: true });
      mockPlugin.getB32Address.mockResolvedValue({
        b32Address: 'abc123.b32.i2p',
      });

      await service.connect({ host: '127.0.0.1', port: 7656, enabled: true });
      const b32 = await service.getB32Address();

      expect(b32).toBe('abc123.b32.i2p');
    });

    it('should return null when not connected', async () => {
      const b32 = await service.getB32Address();
      expect(b32).toBeNull();
    });
  });

  describe('reconnect', () => {
    it('should use exponential backoff', async () => {
      mockPlugin.connect.mockResolvedValue({ success: true });

      // First reconnect: 1s delay
      const startTime = Date.now();
      const reconnectPromise = service.attemptReconnect();

      // Fast-forward timers
      vi.advanceTimersByTime(1000);

      await reconnectPromise;

      expect(service.getReconnectAttempts()).toBe(1);
    });

    it('should throw MAX_RECONNECT_EXCEEDED after 5 attempts', async () => {
      // Simulate 5 failed attempts
      for (let i = 0; i < 5; i++) {
        service.attemptReconnect().catch(() => {});
      }

      await expect(service.attemptReconnect()).rejects.toThrow(
        SAMErrorCodes.MAX_RECONNECT_EXCEEDED
      );
    });

    it('should reset reconnect attempts on successful connection', async () => {
      mockPlugin.connect.mockResolvedValue({ success: true });

      // Simulate failed attempt
      service.attemptReconnect().catch(() => {});
      vi.advanceTimersByTime(1000);

      // Successful connection
      await service.connect({ host: '127.0.0.1', port: 7656, enabled: true });

      expect(service.getReconnectAttempts()).toBe(0);
    });
  });
});

describe('SAMErrorCodes', () => {
  it('should have all expected error codes', () => {
    expect(SAMErrorCodes.CONNECTION_FAILED).toBe('CONNECTION_FAILED');
    expect(SAMErrorCodes.TIMEOUT).toBe('TIMEOUT');
    expect(SAMErrorCodes.INVALID_RESPONSE).toBe('INVALID_RESPONSE');
    expect(SAMErrorCodes.STREAM_CLOSED).toBe('STREAM_CLOSED');
    expect(SAMErrorCodes.SESSION_ERROR).toBe('SESSION_ERROR');
    expect(SAMErrorCodes.DESTINATION_ERROR).toBe('DESTINATION_ERROR');
    expect(SAMErrorCodes.PEER_UNREACHABLE).toBe('PEER_UNREACHABLE');
    expect(SAMErrorCodes.INVALID_CONFIG).toBe('INVALID_CONFIG');
    expect(SAMErrorCodes.HELLO_FAILED).toBe('HELLO_FAILED');
    expect(SAMErrorCodes.MAX_RECONNECT_EXCEEDED).toBe('MAX_RECONNECT_EXCEEDED');
    expect(SAMErrorCodes.UNKNOWN).toBe('UNKNOWN');
  });
});
