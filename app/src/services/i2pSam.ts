/**
 * I2P SAM v3.1 Protocol Client
 *
 * Connects to i2pd SAM via a WebSocket proxy (sam-proxy).
 * The proxy bridges WebSocket ↔ TCP so the browser can talk to SAM.
 *
 * SAM protocol flow:
 *   1. HELLO VERSION → HELLO REPLY RESULT=OK
 *   2. DEST GENERATE  → DEST REPLY PUB=... PRIV=...
 *   3. SESSION CREATE → SESSION STATUS RESULT=OK DESTINATION=...
 *   4. STREAM CONNECT / STREAM ACCEPT
 *
 * Default proxy port: 7657 (the proxy forwards to SAM on 7656)
 */

export interface SAMConfig {
  host: string;
  port: number;      // WebSocket proxy port (default 7657)
  enabled: boolean;
}

export interface SAMSession {
  id: string;
  destination: string;   // Base64 public destination
  privateKey: string;    // Base64 private key
}

export interface SAMStream {
  id: number;
  peerDestination: string;
  connected: boolean;
}

import { logger } from '@/utils/logger';
type ResponseResolver = (response: string) => void;

class SAMService {
  private socket: WebSocket | null = null;
  private config: SAMConfig = { host: '127.0.0.1', port: 7657, enabled: false };
  private session: SAMSession | null = null;
  private streams: Map<number, SAMStream> = new Map();
  private isConnected = false;
  private helloCompleted = false;
  private nextStreamId = 1;

  // Sequential command queue: SAM responses are order-matched
  private pendingResolvers: ResponseResolver[] = [];
  private messageHandlers: ((from: string, data: string) => void)[] = [];
  private streamHandlers: ((stream: SAMStream) => void)[] = [];
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 3;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private isReconnecting = false;

  /**
   * Check if SAM proxy is reachable
   */
  async isAvailable(config?: SAMConfig): Promise<boolean> {
    const c = config || this.config;
    if (!c.enabled) return false;

    try {
      return await new Promise<boolean>((resolve) => {
        const ws = new WebSocket(`ws://${c.host}:${c.port}`);
        const timeout = setTimeout(() => { ws.close(); resolve(false); }, 3000);

        ws.onopen = () => {
          clearTimeout(timeout);
          // Send HELLO to verify SAM is behind the proxy
          ws.send('HELLO VERSION MIN=3.1 MAX=3.1\n');
        };

        ws.onmessage = (ev) => {
          clearTimeout(timeout);
          const ok = typeof ev.data === 'string' && ev.data.includes('RESULT=OK');
          ws.close();
          resolve(ok);
        };

        ws.onerror = () => { clearTimeout(timeout); resolve(false); };
      });
    } catch {
      return false;
    }
  }

  /**
   * Connect to SAM via WebSocket proxy and perform HELLO handshake
   */
  async connect(config: SAMConfig): Promise<boolean> {
    this.config = config;
    if (!config.enabled) return false;

    // Clean up previous connection
    this.disconnect();

    try {
      this.socket = new WebSocket(`ws://${config.host}:${config.port}`);

      const connected = await new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => { resolve(false); }, 10000);

        this.socket!.onopen = () => {
          clearTimeout(timeout);
          this.isConnected = true;
          this.reconnectAttempts = 0;
          logger.log('[SAM] WebSocket connected to proxy');
          resolve(true);
        };

        this.socket!.onerror = () => { clearTimeout(timeout); resolve(false); };
      });

      if (!connected) {
        this.isConnected = false;
        return false;
      }

      // Wire up message handler
      this.socket!.onmessage = (ev) => this.handleMessage(ev.data as string);
      this.socket!.onclose = () => {
        logger.log('[SAM] Connection closed');
        this.isConnected = false;
        this.helloCompleted = false;
        this.attemptReconnect();
      };

      // Perform SAM HELLO handshake
      const helloResp = await this.sendRaw('HELLO VERSION MIN=3.1 MAX=3.1');
      if (!helloResp.includes('RESULT=OK')) {
        console.error('[SAM] HELLO failed:', helloResp);
        this.disconnect();
        return false;
      }

      this.helloCompleted = true;
      logger.log('[SAM] HELLO handshake completed');
      return true;

    } catch (error) {
      console.error('[SAM] Connect failed:', error);
      this.isConnected = false;
      return false;
    }
  }

  /**
   * Generate a new I2P destination keypair
   */
  async generateDestination(signatureType = 'EdDSA_SHA512_Ed25519'): Promise<SAMSession> {
    this.requireConnected();

    const resp = await this.sendRaw(`DEST GENERATE SIGNATURE_TYPE=${signatureType}`);

    // Response: DEST REPLY PUB=<base64> PRIV=<base64>
    const pubMatch = resp.match(/PUB=([^\s]+)/);
    const privMatch = resp.match(/PRIV=([^\s]+)/);

    if (!pubMatch || !privMatch) {
      throw new Error(`DEST GENERATE failed: ${resp}`);
    }

    this.session = {
      id: crypto.randomUUID(),
      destination: pubMatch[1],
      privateKey: privMatch[1],
    };

    return this.session;
  }

  /**
   * Create a streaming session
   */
  async createSession(nickname: string, privateKey?: string): Promise<void> {
    this.requireConnected();

    const dest = privateKey || this.session?.privateKey;
    const destParam = dest ? `DESTINATION=${dest}` : 'DESTINATION=TRANSIENT';
    const resp = await this.sendRaw(
      `SESSION CREATE STYLE=STREAM ID=${nickname} ${destParam}`
    );

    if (!resp.includes('RESULT=OK')) {
      throw new Error(`SESSION CREATE failed: ${resp}`);
    }

    // Parse destination from response if available
    const destMatch = resp.match(/DESTINATION=([^\s]+)/);
    if (destMatch && !this.session) {
      this.session = {
        id: crypto.randomUUID(),
        destination: destMatch[1],
        privateKey: dest || '',
      };
    }

      logger.log('[SAM] Session created:', nickname);
  }

  /**
   * Connect to a remote I2P peer via STREAM CONNECT
   * NOTE: STREAM CONNECT requires its own SAM connection (separate socket)
   * For simplicity, we reuse the main socket which works for sequential ops.
   */
  async connectTo(destination: string, nickname: string): Promise<SAMStream> {
    this.requireConnected();

    const resp = await this.sendRaw(
      `STREAM CONNECT ID=${nickname} DESTINATION=${destination} SILENT=false`
    );

    if (!resp.includes('RESULT=OK')) {
      throw new Error(`STREAM CONNECT failed: ${resp}`);
    }

    const streamId = this.nextStreamId++;
    const stream: SAMStream = {
      id: streamId,
      peerDestination: destination,
      connected: true,
    };
    this.streams.set(streamId, stream);
    this.streamHandlers.forEach(h => h(stream));
    return stream;
  }

  /**
   * Accept incoming connections
   */
  async accept(nickname: string): Promise<void> {
    this.requireConnected();

    const resp = await this.sendRaw(`STREAM ACCEPT ID=${nickname} SILENT=false`);

    if (resp.includes('RESULT=OK')) {
      logger.log('[SAM] Accepting connections on:', nickname);
    }
    // STREAM ACCEPT may also immediately return a connection
    // with the peer destination appended
    const destMatch = resp.match(/DESTINATION=([^\s]+)/);
    if (destMatch) {
      this.handleIncomingStream(destMatch[1]);
    }
  }

  /**
   * Send data over a stream
   */
  async send(streamId: number, data: string): Promise<void> {
    const stream = this.streams.get(streamId);
    if (!stream?.connected) {
      throw new Error('Stream not connected');
    }
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('Socket not open');
    }
    // After STREAM CONNECT, the socket becomes a raw data pipe
    this.socket.send(data);
  }

  /**
   * Compute the .b32.i2p address from a Base64 destination
   * Real I2P: SHA-256 of the destination bytes → Base32 encode
   */
  async computeB32Address(destinationBase64: string): Promise<string> {
    // I2P uses modified Base64: '-' instead of '+', '~' instead of '/', no padding
    const standard = destinationBase64
      .replace(/-/g, '+')
      .replace(/~/g, '/')
      + '='.repeat((4 - destinationBase64.length % 4) % 4);
    const binaryStr = atob(standard);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
    const hashArray = new Uint8Array(hashBuffer);
    return toBase32(hashArray) + '.b32.i2p';
  }

  /**
   * Get computed b32 address of current session
   */
  async getB32Address(): Promise<string | null> {
    if (!this.session) return null;
    return this.computeB32Address(this.session.destination);
  }

  /**
   * Get the raw Base64 destination
   */
  getDestination(): string | null {
    return this.session?.destination || null;
  }

  /**
   * Event handlers
   */
  onMessage(handler: (from: string, data: string) => void): void {
    this.messageHandlers.push(handler);
  }

  onStream(handler: (stream: SAMStream) => void): void {
    this.streamHandlers.push(handler);
  }

  /**
   * Check connection status
   */
  isSAMConnected(): boolean {
    return this.isConnected && this.helloCompleted;
  }

  /**
   * Disconnect everything
   */
  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.streams.forEach(s => { s.connected = false; });
    this.streams.clear();
    // Reject all pending resolvers before clearing
    this.pendingResolvers.forEach(resolver => {
      resolver('ERROR RESULT=DISCONNECTED');
    });
    this.pendingResolvers = [];
    this.socket?.close();
    this.socket = null;
    this.isConnected = false;
    this.helloCompleted = false;
    this.isReconnecting = false;
    this.session = null;
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

  /**
   * Restore session from backup
   */
  restoreSession(destination: string, privateKey: string): void {
    this.session = {
      id: crypto.randomUUID(),
      destination,
      privateKey,
    };
  }

  // --- Internal methods ---

  private requireConnected(): void {
    if (!this.isConnected || !this.helloCompleted) {
      throw new Error('SAM not connected');
    }
  }

  /**
   * Send a raw SAM command and wait for the next response line
   */
  private sendRaw(command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
        reject(new Error('Socket not open'));
        return;
      }

      const wrappedResolve = (response: string) => {
        clearTimeout(timeout);
        resolve(response);
      };

      // SESSION CREATE can take longer while i2pd builds its first tunnels
      const isSlowCommand = command.startsWith('SESSION ') || command.startsWith('DEST ');
      const timeout = setTimeout(() => {
        // Remove this resolver from the queue
        const idx = this.pendingResolvers.indexOf(wrappedResolve);
        if (idx !== -1) this.pendingResolvers.splice(idx, 1);
        reject(new Error(`SAM command timeout: ${command.split(' ').slice(0, 2).join(' ')}`));
      }, isSlowCommand ? 30000 : 10000);

      this.pendingResolvers.push(wrappedResolve);
      this.socket.send(command);
    });
  }

  /**
   * Handle incoming SAM messages from the proxy
   */
  private handleMessage(data: string): void {
    logger.log('[SAM] ←', data);

    // SAM protocol responses start with known prefixes
    const isSAMResponse =
      data.startsWith('HELLO ') ||
      data.startsWith('DEST ') ||
      data.startsWith('SESSION ') ||
      data.startsWith('STREAM ') ||
      data.startsWith('NAMING ');

    if (isSAMResponse && this.pendingResolvers.length > 0) {
      const resolver = this.pendingResolvers.shift()!;
      resolver(data);
      return;
    }

    // Check for incoming stream connection (STREAM STATUS from accept)
    if (data.startsWith('STREAM STATUS') && data.includes('RESULT=OK')) {
      const destMatch = data.match(/DESTINATION=([^\s]+)/);
      if (destMatch) {
        this.handleIncomingStream(destMatch[1]);
      }
      return;
    }

    // Raw data from a connected peer
    this.messageHandlers.forEach(h => h('peer', data));
  }

  private handleIncomingStream(peerDestination: string): void {
    const streamId = this.nextStreamId++;
    const stream: SAMStream = {
      id: streamId,
      peerDestination,
      connected: true,
    };
    this.streams.set(streamId, stream);
    this.streamHandlers.forEach(h => h(stream));
    logger.log('[SAM] Incoming stream from:', peerDestination.slice(0, 20) + '...');
  }

  private attemptReconnect(): void {
    if (this.isReconnecting || this.reconnectAttempts >= this.maxReconnectAttempts) return;
    this.isReconnecting = true;
    this.reconnectAttempts++;
    // Exponential backoff with jitter: min(30s, 1000 * 2^attempt) + random(0-1s)
    const baseDelay = Math.min(30000, 1000 * Math.pow(2, this.reconnectAttempts));
    const jitter = Math.random() * 1000;
    const delay = baseDelay + jitter;
    logger.log(`[SAM] Reconnecting in ${Math.round(delay / 1000)}s... (attempt ${this.reconnectAttempts})`);
    this.reconnectTimer = setTimeout(() => {
      this.connect(this.config)
        .catch(() => {})
        .finally(() => {
          this.isReconnecting = false;
        });
    }, delay);
  }
}

// Base32 encoding helper (RFC 4648)
const BASE32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';

function toBase32(data: Uint8Array): string {
  let output = '';
  let bits = 0;
  let value = 0;
  for (const byte of data) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

export const samService = new SAMService();
