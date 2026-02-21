/**
 * I2P Service — High-level API for I2P communication
 *
 * Sits on top of SAMService. Manages identity, peers, message routing.
 * Requires i2pd + sam-proxy running locally.
 */

import nacl from 'tweetnacl';
import { toBase32, uint8ArrayToBase64, base64ToUint8Array } from '@/utils/base32';
import { samService, type SAMConfig } from './i2pSam';
export { samService, type SAMConfig };

export interface I2PIdentity {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
  b32Address: string;
  samDestination?: string;
}

export interface I2PPeer {
  b32Address: string;
  publicKey: Uint8Array;
  samStreamId?: number;
  status: 'connecting' | 'connected' | 'disconnected';
  lastSeen: number;
  isOwnDevice?: boolean;
}

export interface I2PStatus {
  samConnected: boolean;
  samAvailable: boolean;
  address: string | null;
  error?: string;
  newDestinationGenerated?: boolean;
}

class I2PService {
  private identity: I2PIdentity | null = null;
  private peers: Map<string, I2PPeer> = new Map();
  private ownDevices: Set<string> = new Set();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- incoming messages have dynamic structure
  private messageHandlers: ((from: string, message: any) => void)[] = [];
  private statusHandlers: ((status: I2PStatus) => void)[] = [];

  private currentStatus: I2PStatus = {
    samConnected: false,
    samAvailable: false,
    address: null,
  };

  /**
   * Initialize I2P service — connects to SAM via proxy
   */
  async initialize(config?: SAMConfig): Promise<I2PStatus> {
    const samConfig: SAMConfig = config || { host: '127.0.0.1', port: 7657, enabled: true };

    // Check if SAM proxy is available
    const samAvailable = await samService.isAvailable(samConfig);

    if (!samAvailable) {
      this.currentStatus = {
        samConnected: false,
        samAvailable: false,
        address: null,
        error: 'SAM-Proxy nicht erreichbar. Starten Sie sam-proxy und i2pd.',
      };
      this.notifyStatusChange();
      return this.currentStatus;
    }

    try {
      const connected = await samService.connect(samConfig);
      if (!connected) {
        this.currentStatus = {
          samConnected: false,
          samAvailable: true,
          address: null,
          error: 'SAM-Verbindung fehlgeschlagen.',
        };
        this.notifyStatusChange();
        return this.currentStatus;
      }

      // Generate or use existing destination
      let newDestinationGenerated = false;
      if (!this.identity?.samDestination) {
        const session = await samService.generateDestination();
        if (this.identity) {
          this.identity.samDestination = session.destination;
          newDestinationGenerated = true;
        }
      }

      // Create session for accepting connections
      const sessionPrivKey = this.identity?.samDestination || undefined;
      await samService.createSession('securechat', sessionPrivKey);

      // Start accepting incoming connections
      // Note: STREAM ACCEPT on a new SAM connection is needed per the spec,
      // but for the main session we set it up here
      try {
        await samService.accept('securechat');
      } catch (err) {
        console.warn('[I2P] Accept setup deferred:', err);
      }

      // Get our address
      const b32 = await samService.getB32Address();

      this.currentStatus = {
        samConnected: true,
        samAvailable: true,
        address: b32 || this.getAddress(),
        newDestinationGenerated,
      };

      this.setupSAMListeners();
      this.notifyStatusChange();
      return this.currentStatus;

    } catch (error) {
      this.currentStatus = {
        samConnected: false,
        samAvailable: true,
        address: null,
        error: error instanceof Error ? error.message : 'Unbekannter Fehler',
      };
      this.notifyStatusChange();
      return this.currentStatus;
    }
  }

  /**
   * Generate new I2P identity (Ed25519 keypair for local addressing)
   */
  async generateIdentity(): Promise<I2PIdentity> {
    const keypair = nacl.sign.keyPair();
    const b32Address = toBase32(keypair.publicKey) + '.b32.i2p';

    this.identity = {
      publicKey: keypair.publicKey,
      privateKey: keypair.secretKey,
      b32Address,
    };

    // If SAM is connected, also generate SAM destination
    if (samService.isSAMConnected()) {
      try {
        const session = await samService.generateDestination();
        this.identity.samDestination = session.destination;
        // Use the SAM-derived b32 address instead
        const samB32 = await samService.getB32Address();
        if (samB32) {
          this.identity.b32Address = samB32;
        }
      } catch (error) {
        console.warn('[I2P] Failed to create SAM destination:', error);
      }
    }

    this.notifyStatusChange();
    return this.identity;
  }

  /**
   * Restore identity from stored keys
   */
  async restoreIdentity(publicKeyB64: string, privateKeyB64: string, samDestination?: string): Promise<I2PIdentity> {
    const publicKey = base64ToUint8Array(publicKeyB64);
    const privateKey = base64ToUint8Array(privateKeyB64);
    const b32Address = toBase32(publicKey) + '.b32.i2p';

    this.identity = {
      publicKey,
      privateKey,
      b32Address,
      samDestination,
    };

    this.notifyStatusChange();
    return this.identity;
  }

  /**
   * Set SAM destination for the current identity
   */
  setSamDestination(samDestination: string): void {
    if (this.identity) {
      this.identity.samDestination = samDestination;
      this.notifyStatusChange();
    }
  }

  getIdentity(): I2PIdentity | null {
    return this.identity;
  }

  getAddress(): string | null {
    return this.identity?.b32Address || null;
  }

  getStatus(): I2PStatus {
    return this.currentStatus;
  }

  isReady(): boolean {
    return this.currentStatus.samConnected && this.identity !== null;
  }

  /**
   * Multi-device support
   */
  addOwnDevice(b32Address: string): void {
    this.ownDevices.add(b32Address);
  }

  isOwnDevice(b32Address: string): boolean {
    return this.ownDevices.has(b32Address);
  }

  /**
   * Connect to a peer via I2P SAM
   */
  async connectToPeer(b32Address: string, publicKey?: Uint8Array): Promise<I2PPeer> {
    if (!this.currentStatus.samConnected) {
      throw new Error('I2P nicht verbunden. Starten Sie i2pd und sam-proxy.');
    }

    const existing = this.peers.get(b32Address);
    if (existing?.status === 'connected') {
      return existing;
    }

    const peer: I2PPeer = {
      b32Address,
      publicKey: publicKey || new Uint8Array(32),
      status: 'connecting',
      lastSeen: Date.now(),
      isOwnDevice: this.isOwnDevice(b32Address),
    };

    this.peers.set(b32Address, peer);

    try {
      const stream = await samService.connectTo(b32Address, 'securechat');
      peer.samStreamId = stream.id;
      peer.status = 'connected';
      peer.lastSeen = Date.now();
    } catch (error) {
      console.error('[I2P] Failed to connect to peer:', error);
      peer.status = 'disconnected';
      throw error;
    }

    return peer;
  }

  /**
   * Send message to peer
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- message structure varies by type
  async sendMessage(to: string, message: any): Promise<boolean> {
    const peer = this.peers.get(to);

    if (!peer || peer.status !== 'connected' || !peer.samStreamId) {
      // Try to connect first
      try {
        await this.connectToPeer(to);
        const updatedPeer = this.peers.get(to);
        if (!updatedPeer?.samStreamId) {
          throw new Error('Peer nicht verbunden');
        }
        await samService.send(updatedPeer.samStreamId, JSON.stringify(message));
        return true;
      } catch (error) {
        console.error('[I2P] Failed to send message:', error);
        return false;
      }
    }

    try {
      await samService.send(peer.samStreamId, JSON.stringify(message));
      return true;
    } catch (error) {
      console.error('[I2P] Failed to send message:', error);
      peer.status = 'disconnected';
      return false;
    }
  }

  /**
   * Send file to peer (chunked over I2P)
   */
  async sendFile(to: string, file: File): Promise<string> {
    const peer = this.peers.get(to);
    if (!peer?.samStreamId) {
      throw new Error('Peer nicht verbunden');
    }

    // Validate file size (max 50MB)
    const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB in bytes
    if (file.size > MAX_FILE_SIZE) {
      throw new Error(`Datei zu groß. Maximale Größe: 50MB`);
    }

    const fileId = crypto.randomUUID();
    const chunkSize = 8192;
    const totalChunks = Math.ceil(file.size / chunkSize);

    // Send file metadata
    await samService.send(peer.samStreamId, JSON.stringify({
      type: 'file-offer',
      id: fileId,
      filename: file.name,
      mimeType: file.type,
      size: file.size,
      totalChunks,
    }));

    // Send chunks
    for (let i = 0; i < totalChunks; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, file.size);
      const chunk = file.slice(start, end);
      const arrayBuffer = await chunk.arrayBuffer();

      await samService.send(peer.samStreamId, JSON.stringify({
        type: 'file-chunk',
        id: fileId,
        chunkIndex: i,
        totalChunks,
        data: uint8ArrayToBase64(new Uint8Array(arrayBuffer)),
      }));

      // Small delay to avoid overwhelming I2P tunnels
      if (i < totalChunks - 1) {
        await new Promise(r => setTimeout(r, 50));
      }
    }

    // Send completion
    await samService.send(peer.samStreamId, JSON.stringify({
      type: 'file-complete',
      id: fileId,
    }));

    return fileId;
  }

  /**
   * Event handlers
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- incoming messages have dynamic structure
  onMessage(handler: (from: string, message: any) => void): void {
    this.messageHandlers.push(handler);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- incoming messages have dynamic structure
  offMessage(handler: (from: string, message: any) => void): void {
    this.messageHandlers = this.messageHandlers.filter(h => h !== handler);
  }

  onStatusChange(handler: (status: I2PStatus) => void): void {
    this.statusHandlers.push(handler);
  }

  offStatusChange(handler: (status: I2PStatus) => void): void {
    this.statusHandlers = this.statusHandlers.filter(h => h !== handler);
  }

  private setupSAMListeners(): void {
    samService.onMessage((from, data) => {
      try {
        const message = JSON.parse(data);
        this.messageHandlers.forEach(handler => handler(from, message));
      } catch {
        this.messageHandlers.forEach(handler => handler(from, data));
      }
    });

    samService.onStream((stream) => {
      console.log('[I2P] New incoming stream:', stream.id);
    });
  }

  private notifyStatusChange(): void {
    this.statusHandlers.forEach(handler => handler(this.currentStatus));
  }

  getPeerStatus(b32Address: string): 'connected' | 'disconnected' | 'connecting' | 'unknown' {
    return this.peers.get(b32Address)?.status || 'unknown';
  }

  disconnectPeer(b32Address: string): void {
    this.peers.delete(b32Address);
  }

  getConnectedPeers(): string[] {
    return Array.from(this.peers.entries())
      .filter(([, p]) => p.status === 'connected')
      .map(([addr]) => addr);
  }

  exportIdentity(): { publicKey: string; privateKey: string; b32Address: string; samDestination?: string } | null {
    if (!this.identity) return null;
    return {
      publicKey: uint8ArrayToBase64(this.identity.publicKey),
      privateKey: uint8ArrayToBase64(this.identity.privateKey),
      b32Address: this.identity.b32Address,
      samDestination: this.identity.samDestination,
    };
  }

  disconnect(): void {
    this.peers.clear();
    samService.disconnect();
    this.currentStatus = {
      samConnected: false,
      samAvailable: false,
      address: null,
    };
    this.notifyStatusChange();
  }
}

export const i2pService = new I2PService();
