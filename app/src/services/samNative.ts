/**
 * TypeScript Bridge for the Capacitor SAM Native Plugin.
 *
 * This service provides a TypeScript interface to the native Android SAM plugin,
 * replacing the WebSocket-based approach for the Android port.
 *
 * SAM v3.1 Protocol Methods:
 * - initialize(config): Initialize and connect to SAM
 * - generateDestination(): Generate I2P keypair
 * - createSession(nickname, privateKey): Create SAM session
 * - connectTo(destination): Connect to a peer
 * - startAccepting(nickname): Start accepting incoming connections
 * - send(streamId, data): Send data over a stream
 * - closeStream(streamId): Close a specific stream
 * - disconnect(): Close all connections
 *
 * Events:
 * - message: Incoming data from peer
 * - streamConnected: New outgoing/incoming stream established
 * - streamClosed: Stream closed
 * - error: Error occurred
 *
 * For Android: Uses Capacitor native bridge with event listeners
 * For Web/PWA: Falls back to WebSocket proxy (samService)
 */

import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import type { SAMConfig } from './i2pSam';
import { logger } from '@/utils/logger';

// Event interfaces
export interface SAMMessageEvent {
  from: string;
  data: string;
  streamId: number;
  timestamp: number;
}

export interface SAMStreamConnectedEvent {
  type: 'stream_connected';
  peerDestination: string;
  streamId: number;
  timestamp: number;
}

export interface SAMStreamClosedEvent {
  type: 'stream_closed';
  streamId: number;
  reason?: string;
  timestamp: number;
}

export interface SAMErrorEvent {
  type: 'error';
  error: string;
  errorCode?: string;
  streamId: number;
  timestamp: number;
}

// Register the native plugin with event support
const SAMNativePlugin = registerPlugin<{
  // Connection methods
  connect(config: SAMConfig): Promise<{ connected: boolean; error?: string }>;
  disconnect(): Promise<{ disconnected: boolean }>;
  isConnected(): Promise<{ connected: boolean; sessionActive?: boolean; host?: string; port?: number }>;
  getStatus(): Promise<{
    connected: boolean;
    sessionActive: boolean;
    activeStreams: number;
    sessionNickname?: string;
  }>;

  // SAM protocol methods
  generateDestination(options: { signatureType?: string }): Promise<{
    success: boolean;
    publicKey?: string;
    privateKey?: string;
    error?: string;
  }>;
  createSession(options: {
    nickname: string;
    privateKey?: string;
  }): Promise<{ success: boolean; error?: string }>;
  connectTo(options: {
    destination: string;
    timeout?: number;
  }): Promise<{ success: boolean; streamId?: number; error?: string }>;
  startAccepting(options: { nickname: string }): Promise<{ success: boolean; error?: string }>;
  send(options: { streamId: number; data: string }): Promise<{
    success: boolean;
    bytesSent?: number;
    error?: string;
  }>;
  closeStream(options: { streamId: number }): Promise<{ success: boolean; error?: string }>;

  // Event listeners
  addListener(
    eventName: 'message',
    listener: (event: SAMMessageEvent) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'streamConnected',
    listener: (event: SAMStreamConnectedEvent) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'streamClosed',
    listener: (event: SAMStreamClosedEvent) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'error',
    listener: (event: SAMErrorEvent) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'samStatus',
    listener: (event: { status: string }) => void
  ): Promise<PluginListenerHandle>;

  removeAllListeners(): Promise<void>;
}>('SAM');

export interface SAMNativeSession {
  id: string;
  destination: string;
  privateKey: string;
}

export interface SAMStream {
  id: number;
  peerDestination: string;
  connected: boolean;
}

/**
 * Native SAM Service for Android with Event Support.
 * Provides direct TCP access to i2pd SAM interface without WebSocket proxy.
 */
class SAMNativeService {
  private config!: SAMConfig;
  private session: SAMNativeSession | null = null;
  private isInitialized!: boolean;

  private listeners: PluginListenerHandle[] = [];
  private messageHandlers: ((from: string, data: string, streamId: number) => void)[] = [];
  private streamConnectedHandlers: ((streamId: number, peerDestination: string) => void)[] = [];
  private streamClosedHandlers: ((streamId: number, reason?: string) => void)[] = [];
  private errorHandlers: ((error: string, streamId: number) => void)[] = [];

  /**
   * Initialize the native SAM connection
   */
  async initialize(config: SAMConfig): Promise<boolean> {
    // Android native uses port 7656 (direct TCP to i2pd), not 7657 (WebSocket proxy)
    if (config.port === 7657) {
      logger.warn('[SAMNative] Correcting port from 7657 to 7656 for native Android');
      config.port = 7656;
    }

    this.config = config;
    void this.config; // Used for future reference
    if (!config.enabled) {
      logger.log('[SAMNative] SAM disabled in config');
      return false;
    }

    try {
      // Use 'connect' method instead of 'initialize' - the Java plugin has connect()
      const result = await SAMNativePlugin.connect(config);
      if (result.connected) {
        this.isInitialized = true;
        void this.isInitialized; // Used for tracking state
        try {
          await this.setupEventListeners();
          logger.log('[SAMNative] Connected successfully');
        } catch (setupError) {
          logger.error('[SAMNative] Failed to setup event listeners:', setupError);
          await this.disconnect();
          return false;
        }
      } else {
        logger.error('[SAMNative] Connection failed:', result.error);
      }
      return result.connected;
    } catch (error) {
      logger.error('[SAMNative] Connect error:', error);
      return false;
    }
  }

  /**
   * Generate a new I2P destination
   */
  async generateDestination(signatureType = 'EdDSA_SHA512_Ed25519'): Promise<{
    publicKey: string;
    privateKey: string;
  } | null> {
    try {
      const result = await SAMNativePlugin.generateDestination({ signatureType });
      if (result.success && result.publicKey && result.privateKey) {
        this.session = {
          id: crypto.randomUUID(),
          destination: result.publicKey,
          privateKey: result.privateKey,
        };
        return {
          publicKey: result.publicKey,
          privateKey: result.privateKey,
        };
      }
      logger.error('[SAMNative] Generate destination failed:', result.error);
      return null;
    } catch (error) {
      logger.error('[SAMNative] Generate destination error:', error);
      return null;
    }
  }

  /**
   * Create a streaming session
   */
  async createSession(nickname: string, privateKey?: string): Promise<boolean> {
    try {
      const result = await SAMNativePlugin.createSession({ nickname, privateKey });
      if (!result.success) {
        logger.error('[SAMNative] Create session failed:', result.error);
      }
      return result.success;
    } catch (error) {
      logger.error('[SAMNative] Create session error:', error);
      return false;
    }
  }

  private static readonly RETRY_DELAYS = [2000, 5000, 10000, 20000, 30000];
  private static readonly RETRYABLE_PATTERNS = ['INVALID_ID', 'CANT_REACH_PEER', 'LeaseSet not found'];

  private isRetryableError(error: string): boolean {
    return SAMNativeService.RETRYABLE_PATTERNS.some(p => error.includes(p));
  }

  /**
   * Connect to a remote peer with retry logic for transient I2P errors.
   * I2P tunnel building can take 1-10 minutes, so INVALID_ID / CANT_REACH_PEER
   * errors are retried with exponential backoff.
   */
  async connectTo(destination: string, timeout = 60000, maxRetries = 5): Promise<number | null> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await SAMNativePlugin.connectTo({ destination, timeout });
        if (result.success && result.streamId !== undefined) {
          return result.streamId;
        }

        const errMsg = result.error ?? 'unknown error';
        if (attempt < maxRetries && this.isRetryableError(errMsg)) {
          const delay = SAMNativeService.RETRY_DELAYS[attempt] ?? 30000;
          logger.warn(`[SAMNative] Connect attempt ${attempt + 1} failed: ${errMsg}. Retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }

        logger.error('[SAMNative] Connect failed:', errMsg);
        return null;
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        if (attempt < maxRetries && this.isRetryableError(errMsg)) {
          const delay = SAMNativeService.RETRY_DELAYS[attempt] ?? 30000;
          logger.warn(`[SAMNative] Connect attempt ${attempt + 1} threw: ${errMsg}. Retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }

        logger.error('[SAMNative] Connect error:', error);
        return null;
      }
    }

    logger.error(`[SAMNative] Connect failed after ${maxRetries + 1} attempts`);
    return null;
  }

  /**
   * Start accepting incoming connections
   */
  async startAccepting(nickname: string): Promise<boolean> {
    try {
      const result = await SAMNativePlugin.startAccepting({ nickname });
      if (!result.success) {
        logger.error('[SAMNative] Start accepting failed:', result.error);
      }
      return result.success;
    } catch (error) {
      logger.error('[SAMNative] Start accepting error:', error);
      return false;
    }
  }

  /**
   * Send data over a stream
   */
  async send(streamId: number, data: string): Promise<boolean> {
    try {
      const result = await SAMNativePlugin.send({ streamId, data });
      return result.success;
    } catch (error) {
      logger.error('[SAMNative] Send error:', error);
      return false;
    }
  }

  /**
   * Close a specific stream
   */
  async closeStream(streamId: number): Promise<boolean> {
    try {
      const result = await SAMNativePlugin.closeStream({ streamId });
      return result.success;
    } catch (error) {
      logger.error('[SAMNative] Close stream error:', error);
      return false;
    }
  }

  /**
   * Disconnect and cleanup
   */
  async disconnect(): Promise<void> {
    await this.cleanupEventListeners();
    try {
      await SAMNativePlugin.disconnect();
    } catch (error) {
      logger.error('[SAMNative] Disconnect error:', error);
    }
    this.isInitialized = false;
    void this.isInitialized;
  }

  /**
   * Check if connected
   */
  async isConnected(): Promise<{ connected: boolean; sessionActive: boolean }> {
    try {
      const result = await SAMNativePlugin.isConnected();
      return {
        connected: result.connected,
        sessionActive: result.sessionActive ?? false
      };
    } catch (error) {
      logger.error('[SAMNative] IsConnected error:', error);
      return { connected: false, sessionActive: false };
    }
  }

  /**
   * Get detailed status
   */
  async getStatus(): Promise<{
    connected: boolean;
    sessionActive: boolean;
    activeStreams: number;
    sessionNickname?: string;
  }> {
    logger.log('[SAMNative] getStatus called');
    try {
      const result = await SAMNativePlugin.getStatus();
      logger.log('[SAMNative] getStatus result:', result);
      return result;
    } catch (error) {
      logger.error('[SAMNative] GetStatus error:', error);
      return { connected: false, sessionActive: false, activeStreams: 0 };
    }
  }

  /**
   * Register message handler
   */
  onMessage(handler: (from: string, data: string, streamId: number) => void): void {
    this.messageHandlers.push(handler);
  }

  /**
   * Register stream connected handler
   */
  onStreamConnected(handler: (streamId: number, peerDestination: string) => void): void {
    this.streamConnectedHandlers.push(handler);
  }

  /**
   * Register stream closed handler
   */
  onStreamClosed(handler: (streamId: number, reason?: string) => void): void {
    this.streamClosedHandlers.push(handler);
  }

  /**
   * Register error handler
   */
  onError(handler: (error: string, streamId: number) => void): void {
    this.errorHandlers.push(handler);
  }

  /**
   * Remove message handler
   */
  offMessage(handler: (from: string, data: string, streamId: number) => void): void {
    const index = this.messageHandlers.indexOf(handler);
    if (index > -1) {
      this.messageHandlers.splice(index, 1);
    }
  }

  /**
   * Setup Capacitor event listeners
   */
  private async setupEventListeners(): Promise<void> {
    await this.cleanupEventListeners();

    // Message listener
    const messageHandle = await SAMNativePlugin.addListener('message', (event) => {
      logger.log('[SAMNative] Message received from:', event.from.slice(0, 20));
      this.messageHandlers.forEach(h => h(event.from, event.data, event.streamId));
    });
    this.listeners.push(messageHandle);

    // Stream connected listener
    const connectedHandle = await SAMNativePlugin.addListener('streamConnected', (event) => {
      logger.log('[SAMNative] Stream connected:', event.streamId);
      this.streamConnectedHandlers.forEach(h => h(event.streamId, event.peerDestination));
    });
    this.listeners.push(connectedHandle);

    // Stream closed listener
    const closedHandle = await SAMNativePlugin.addListener('streamClosed', (event) => {
      logger.log('[SAMNative] Stream closed:', event.streamId, event.reason);
      this.streamClosedHandlers.forEach(h => h(event.streamId, event.reason));
    });
    this.listeners.push(closedHandle);

    // Error listener
    const errorHandle = await SAMNativePlugin.addListener('error', (event) => {
      logger.error('[SAMNative] Error:', event.error, 'stream:', event.streamId);
      this.errorHandlers.forEach(h => h(event.error, event.streamId));
    });
    this.listeners.push(errorHandle);

    // Status change listener
    const statusHandle = await SAMNativePlugin.addListener('samStatus', (event) => {
      logger.log('[SAMNative] Status change:', event.status);
    });
    this.listeners.push(statusHandle);
  }

  /**
   * Cleanup all event listeners
   */
  private async cleanupEventListeners(): Promise<void> {
    for (const handle of this.listeners) {
      try {
        await handle.remove();
      } catch (error) {
        logger.warn('[SAMNative] Error removing listener:', error);
      }
    }
    this.listeners = [];
  }

  /**
   * Check if plugin is available (native platform)
   */
  isAvailable(): boolean {
    return typeof SAMNativePlugin !== 'undefined' && SAMNativePlugin !== null;
  }

  /**
   * Get current session
   */
  getSession(): SAMNativeSession | null {
    return this.session;
  }

  /**
   * Restore session from stored keys
   */
  restoreSession(destination: string, privateKey: string): void {
    this.session = {
      id: crypto.randomUUID(),
      destination,
      privateKey,
    };
  }

  /**
   * Export session for backup
   */
  exportSession(): { destination: string; privateKey: string } | null {
    if (!this.session) return null;
    return {
      destination: this.session.destination,
      privateKey: this.session.privateKey,
    };
  }
}

export const samNativeService = new SAMNativeService();
