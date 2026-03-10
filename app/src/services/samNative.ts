/**
 * TypeScript Bridge for the Capacitor SAM Native Plugin.
 *
 * This service provides a TypeScript interface to the native Android SAM plugin,
 * replacing the WebSocket-based approach for the Android port.
 *
 * SAM v3.1 Protocol Methods:
 * - connect(host, port): Connect to i2pd SAM (localhost:7656)
 * - disconnect(): Close connection
 * - sendCommand(cmd): Send raw SAM command
 * - sendCommandAndWait(cmd): Send command and await response
 * - readResponse(): Poll for response
 * - hello(): Perform HELLO handshake
 * - generateDestination(): Generate I2P keypair
 * - createSession(id, destination): Create SAM session
 *
 * For Android: Uses Capacitor native bridge
 * For Web/PWA: Falls back to WebSocket proxy (samService)
 */

import { registerPlugin } from '@capacitor/core';
import { logger } from '@/utils/logger';

// Register the native plugin
const SAM = registerPlugin<{
  connect(options: { host: string; port: number }): Promise<{ connected: boolean; error?: string }>;
  disconnect(): Promise<{ disconnected: boolean }>;
  sendCommand(options: { command: string }): Promise<{ success: boolean }>;
  sendCommandAndWait(options: { command: string }): Promise<{ success: boolean; response?: string; error?: string }>;
  readResponse(): Promise<{ hasData: boolean; response?: string }>;
  isConnected(): Promise<{ connected: boolean; host?: string; port?: number }>;
  hello(): Promise<{ success: boolean; version?: string; error?: string }>;
  generateDestination(options?: { signatureType?: string }): Promise<{ success: boolean; pub?: string; priv?: string; error?: string }>;
  createSession(options: { id: string; destination: string; style?: string }): Promise<{ success: boolean; error?: string }>;
}>('SAM');

export interface SAMNativeConfig {
  host: string;
  port: number;
  enabled: boolean;
}

export interface SAMNativeSession {
  id: string;
  destination: string;
  privateKey: string;
}

/**
 * Check if running on native Android platform
 */
function isNativePlatform(): boolean {
  return typeof (window as unknown as { capacitor?: unknown }).capacitor !== 'undefined';
}

/**
 * Native SAM Service for Android.
 * Provides direct TCP access to i2pd SAM interface without WebSocket proxy.
 */
class SAMNativeService {
  private config: SAMNativeConfig = { host: '127.0.0.1', port: 7656, enabled: false };
  private session: SAMNativeSession | null = null;
  private connected = false;
  private helloCompleted = false;
  private sessionNickname: string | null = null;

  private messageHandlers: ((from: string, data: string) => void)[] = [];
  private streamHandlers: ((stream: SAMStream) => void)[] = [];

  /**
   * Connect to SAM bridge via native TCP socket.
   */
  async connect(config: SAMNativeConfig): Promise<boolean> {
    this.config = config;

    if (!config.enabled) {
      logger.log('[SAMNative] SAM disabled in config');
      return false;
    }

    if (!isNativePlatform()) {
      logger.warn('[SAMNative] Not on native platform, cannot use native SAM');
      return false;
    }

    try {
      logger.log(`[SAMNative] Connecting to ${config.host}:${config.port}`);

      const result = await SAM.connect({ host: config.host, port: config.port });

      if (result.connected) {
        this.connected = true;
        logger.log('[SAMNative] Connected successfully');
        return true;
      } else {
        logger.error('[SAMNative] Connection failed:', result.error);
        return false;
      }
    } catch (error) {
      logger.error('[SAMNative] Connect error:', error);
      return false;
    }
  }

  /**
   * Disconnect from SAM bridge.
   */
  async disconnect(): Promise<void> {
    try {
      await SAM.disconnect();
      this.connected = false;
      this.helloCompleted = false;
      this.sessionNickname = null;
      logger.log('[SAMNative] Disconnected');
    } catch (error) {
      logger.error('[SAMNative] Disconnect error:', error);
    }
  }

  /**
   * Check if connected to SAM.
   */
  async isAvailable(): Promise<boolean> {
    if (!isNativePlatform()) return false;

    try {
      const result = await SAM.isConnected();
      return result.connected;
    } catch {
      return false;
    }
  }

  /**
   * Send raw SAM command (fire and forget).
   */
  async sendCommand(command: string): Promise<boolean> {
    try {
      const result = await SAM.sendCommand({ command });
      return result.success;
    } catch (error) {
      logger.error('[SAMNative] sendCommand error:', error);
      return false;
    }
  }

  /**
   * Send SAM command and wait for response.
   */
  async sendCommandAndWait(command: string): Promise<string | null> {
    try {
      const result = await SAM.sendCommandAndWait({ command });

      if (result.success && result.response) {
        return result.response;
      } else {
        logger.warn('[SAMNative] Command failed:', result.error);
        return null;
      }
    } catch (error) {
      logger.error('[SAMNative] sendCommandAndWait error:', error);
      return null;
    }
  }

  /**
   * Read response from SAM (non-blocking poll).
   */
  async readResponse(): Promise<string | null> {
    try {
      const result = await SAM.readResponse();
      return result.hasData ? result.response || null : null;
    } catch (error) {
      logger.error('[SAMNative] readResponse error:', error);
      return null;
    }
  }

  /**
   * Perform SAM HELLO handshake.
   */
  async hello(): Promise<boolean> {
    try {
      const result = await SAM.hello();

      if (result.success) {
        this.helloCompleted = true;
        logger.log('[SAMNative] HELLO successful, version:', result.version);
        return true;
      } else {
        logger.error('[SAMNative] HELLO failed:', result.error);
        return false;
      }
    } catch (error) {
      logger.error('[SAMNative] HELLO error:', error);
      return false;
    }
  }

  /**
   * Generate new I2P destination keypair.
   */
  async generateDestination(signatureType = 'EdDSA_SHA512_Ed25519'): Promise<SAMNativeSession | null> {
    try {
      const result = await SAM.generateDestination({ signatureType });

      if (result.success && result.pub && result.priv) {
        this.session = {
          id: crypto.randomUUID(),
          destination: result.pub,
          privateKey: result.priv,
        };
        logger.log('[SAMNative] Destination generated');
        return this.session;
      } else {
        logger.error('[SAMNative] DEST GENERATE failed:', result.error);
        return null;
      }
    } catch (error) {
      logger.error('[SAMNative] generateDestination error:', error);
      return null;
    }
  }

  /**
   * Create SAM streaming session.
   */
  async createSession(nickname: string, privateKey?: string): Promise<boolean> {
    const dest = privateKey || this.session?.privateKey;

    if (!dest) {
      logger.error('[SAMNative] No private key available for session creation');
      return false;
    }

    try {
      const result = await SAM.createSession({
        id: nickname,
        destination: dest,
        style: 'STREAM',
      });

      if (result.success) {
        this.sessionNickname = nickname;
        logger.log('[SAMNative] Session created:', nickname);
        return true;
      } else {
        logger.error('[SAMNative] SESSION CREATE failed:', result.error);
        return false;
      }
    } catch (error) {
      logger.error('[SAMNative] createSession error:', error);
      return false;
    }
  }

  /**
   * Get current connection status.
   */
  isConnected(): boolean {
    return this.connected && this.helloCompleted;
  }

  /**
   * Get current session.
   */
  getSession(): SAMNativeSession | null {
    return this.session;
  }

  /**
   * Restore session from stored keys.
   */
  restoreSession(destination: string, privateKey: string): void {
    this.session = {
      id: crypto.randomUUID(),
      destination,
      privateKey,
    };
  }

  /**
   * Export session for backup.
   */
  exportSession(): { destination: string; privateKey: string } | null {
    if (!this.session) return null;
    return {
      destination: this.session.destination,
      privateKey: this.session.privateKey,
    };
  }

  /**
   * Register message handler for incoming data.
   */
  onMessage(handler: (from: string, data: string) => void): void {
    this.messageHandlers.push(handler);
  }

  /**
   * Register stream handler for new connections.
   */
  onStream(handler: (stream: SAMStream) => void): void {
    this.streamHandlers.push(handler);
  }

  /**
   * Get the native plugin instance for advanced usage.
   */
  getNativePlugin() {
    return SAM;
  }
}

// Interface for stream compatibility with existing code
export interface SAMStream {
  id: number;
  peerDestination: string;
  connected: boolean;
}

export const samNativeService = new SAMNativeService();
