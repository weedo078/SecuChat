/**
 * I2P Service — High-level API for I2P communication
 *
 * Sits on top of SAMService. Manages identity, peers, message routing.
 * Requires i2pd + sam-proxy running locally.
 */

import nacl from 'tweetnacl';
import { toBase32, uint8ArrayToBase64, base64ToUint8Array } from '@/utils/base32';
import { samService, type SAMConfig } from './i2pSam';
import { logger } from '@/utils/logger';
import { platformService } from './platform';
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
  leasesetPublished?: boolean;  // true when inbound tunnels are ready
}

class I2PService {
  private identity: I2PIdentity | null = null;
  private peers: Map<string, I2PPeer> = new Map();
  private ownDevices: Set<string> = new Set();
  // Track in-flight connectToPeer calls to prevent connect storms
  private pendingConnects: Map<string, Promise<I2PPeer>> = new Map();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- incoming messages have dynamic structure
  private messageHandlers: ((from: string, message: any) => void)[] = [];
  private statusHandlers: ((status: I2PStatus) => void)[] = [];

  private currentStatus: I2PStatus = {
    samConnected: false,
    samAvailable: false,
    address: null,
    leasesetPublished: false,
  };
  private tunnelCheckInterval: ReturnType<typeof setInterval> | null = null;

  /**
   * Initialize I2P service — connects to SAM via proxy
   */
  async initialize(config?: SAMConfig): Promise<I2PStatus> {
    // DEV/TEST: optionaler SAM-Bridge-Host via localStorage (z.B. Emulator→10.0.2.2, Telefon→Host-LAN-IP)
    const hostOverride = (typeof localStorage !== 'undefined'
      ? localStorage.getItem('secuchat_sam_host')
      : null) || '';
    const defaultPort = platformService.isAndroidNative() ? 7656 : 7657;
    const samConfig: SAMConfig = config || {
      host: hostOverride || '127.0.0.1',
      port: defaultPort,
      enabled: true,
    };

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
      // CRITICAL: We MUST have a persistent SAM destination - TRANSIENT doesn't publish LeaseSets
      let newDestinationGenerated = false;
      if (!this.identity?.samDestination) {
        logger.log('[I2P] Generating new SAM destination (none exists in identity)');
        const session = await samService.generateDestination();
        if (this.identity) {
          // SESSION CREATE needs the PRIVATE key (PRIV= from DEST GENERATE)
          this.identity.samDestination = session.privateKey;
          newDestinationGenerated = true;
          // Notify that a new destination was generated - caller must persist it
          this.currentStatus.newDestinationGenerated = true;
          logger.log('[I2P] New SAM destination generated, caller must persist it');
        }
      } else {
        logger.log('[I2P] Using existing SAM destination from identity');
      }

      // Verify we have a valid destination before creating session
      const sessionPrivKey = this.identity?.samDestination;
      if (!sessionPrivKey) {
        throw new Error('SAM destination not available. Identity must be restored with samDestination before initializing I2P.');
      }

      // Create session — use timestamp-based nickname so i2pd never rejects
      // with DUPLICATED_ID (old sessions stay alive ~5 min after TCP drop)
      const sessionNick = `sc-${Date.now()}`;
      await samService.createSession(sessionNick, sessionPrivKey);

      // Start accepting incoming streams on a dedicated socket (SAM v3.1 spec).
      // Each accepted connection gets its own WebSocket so the session socket
      // is never corrupted by mixing ACCEPT responses with CONNECT handshakes.
      samService.startAcceptLoop();

      // Get our address and sync it into the identity object so that
      // exportIdentity() and contact exports always carry the real SAM b32.
      const b32 = await samService.getB32Address();
      if (b32 && this.identity) {
        this.identity.b32Address = b32;
      }
      logger.log(`[I2P] Session created. Our b32 address: ${b32?.slice(0, 30)}...`);

      this.currentStatus = {
        samConnected: true,
        samAvailable: true,
        address: b32 || this.getAddress(),
        newDestinationGenerated,
        leasesetPublished: false,
      };

      this.setupSAMListeners();
      this.notifyStatusChange();
      
      // Start checking for tunnel readiness (LeaseSet publication)
      this.startTunnelCheck();
      
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
   * Generate new I2P identity (Ed25519 keypair for local addressing).
   *
   * Preserves any samDestination that was already set via setSamDestination()
   * (e.g. by the auto-onboarding path which generates the SAM destination
   * via the native plugin before generateIdentity() runs). Without this
   * guard, a fresh identity object would drop the SAM destination and the
   * user record would be saved without one.
   */
  async generateIdentity(): Promise<I2PIdentity> {
    const keypair = nacl.sign.keyPair();
    const b32Address = toBase32(keypair.publicKey) + '.b32.i2p';

    // Preserve SAM destination if it was set before identity creation
    const existingSamDestination = this.identity?.samDestination;

    this.identity = {
      publicKey: keypair.publicKey,
      privateKey: keypair.secretKey,
      b32Address,
      ...(existingSamDestination ? { samDestination: existingSamDestination } : {}),
    };

    // Zero the raw keypair bytes — identity now holds the only copy
    keypair.secretKey.fill(0);

    // If SAM is connected AND we don't already have a SAM destination
    // (e.g. set via setSamDestination() before generateIdentity()), reuse
    // it. Otherwise generate a fresh one.
    // This fixes a race where the auto-onboarding path sets the destination
    // via the native plugin first, then calls generateIdentity() which
    // would otherwise overwrite it with a second one.
    if (samService.isSAMConnected() && !this.identity.samDestination) {
      try {
        const session = await samService.generateDestination();
        // SESSION CREATE needs the PRIVATE key (PRIV= from DEST GENERATE)
        this.identity.samDestination = session.privateKey;
        // Use the SAM-derived b32 address instead
        const samB32 = await samService.getB32Address();
        if (samB32) {
          this.identity.b32Address = samB32;
        }
      } catch (error) {
        logger.warn('[I2P] Failed to create SAM destination:', error);
      }
    } else if (samService.isSAMConnected()) {
      // We already have a SAM destination; just sync the b32 address from SAM
      try {
        const samB32 = await samService.getB32Address();
        if (samB32) {
          this.identity.b32Address = samB32;
        }
      } catch (error) {
        logger.warn('[I2P] Failed to read SAM b32:', error);
      }
    }

    this.notifyStatusChange();
    return this.identity;
  }

  /**
   * Restore identity from stored keys
   */
  async restoreIdentity(publicKeyB64: string, privateKeyB64: string, samDestination?: string, i2pAddress?: string): Promise<I2PIdentity> {
    logger.log('[I2P] restoreIdentity called, samDestination present:', !!samDestination, 'i2pAddress present:', !!i2pAddress);
    const publicKey = base64ToUint8Array(publicKeyB64);
    const privateKey = base64ToUint8Array(privateKeyB64);

    // Use the stored I2P address (which should be the SAM b32) if available
    // Otherwise fall back to Ed25519-derived address for backwards compatibility
    const b32Address = i2pAddress || (toBase32(publicKey) + '.b32.i2p');
    logger.log('[I2P] Using b32 address:', b32Address.slice(0, 30) + '...');

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
   * Set SAM destination for the current identity.
   *
   * Defensive: if no identity exists yet (auto-onboarding race where
   * generateIdentity() and a SAM connect run interleaved and the identity
   * reference is lost), we lazily create a minimal identity from the SAM
   * destination's public key. Caller should still call restoreIdentity() or
   * generateIdentity() to populate the Ed25519 keypair.
   */
  setSamDestination(samDestination: string): void {
    if (!this.identity) {
      // No identity yet — create a minimal placeholder so the destination
      // is not silently dropped. generateIdentity() / restoreIdentity() will
      // overwrite this with the real Ed25519 keys.
      this.identity = {
        publicKey: new Uint8Array(32),
        privateKey: new Uint8Array(64),
        b32Address: '',
        samDestination,
      };
      logger.warn('[I2P] setSamDestination called without identity — created placeholder, caller must populate keys');
      this.notifyStatusChange();
      return;
    }
    this.identity.samDestination = samDestination;
    this.notifyStatusChange();
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
   * Connect to a peer via I2P SAM.
   * Deduplicates concurrent calls for the same peer to prevent connect storms.
   */
  async connectToPeer(b32Address: string, publicKey?: Uint8Array): Promise<I2PPeer> {
    // If a connect is already in flight for this peer, piggyback on it
    const pending = this.pendingConnects.get(b32Address);
    if (pending) {
      logger.log(`[I2P] Connect already in flight for: ${b32Address.slice(0, 20)}`);
      return pending;
    }

    const connectPromise = this.doConnectToPeer(b32Address, publicKey);
    this.pendingConnects.set(b32Address, connectPromise);

    try {
      return await connectPromise;
    } finally {
      this.pendingConnects.delete(b32Address);
    }
  }

  private async doConnectToPeer(b32Address: string, publicKey?: Uint8Array): Promise<I2PPeer> {
    logger.log(`[I2P] Connecting to peer: ${b32Address.slice(0, 20)}...`);
    logger.log(`[I2P] Our address: ${this.getAddress()?.slice(0, 20)}..., leasesetPublished: ${this.currentStatus.leasesetPublished}`);

    if (!this.currentStatus.samConnected) {
      logger.warn('[I2P] Cannot connect - SAM not connected');
      throw new Error('I2P nicht verbunden. Starten Sie i2pd und sam-proxy.');
    }

    const existing = this.peers.get(b32Address);
    if (
      existing?.status === 'connected' &&
      existing.samStreamId != null &&
      samService.isStreamOpen(existing.samStreamId)
    ) {
      logger.log('[I2P] Peer already connected:', b32Address.slice(0, 20));
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
      logger.log('[I2P] Calling samService.connectTo for:', b32Address.slice(0, 20));
      const stream = await samService.connectTo(b32Address);
      peer.samStreamId = stream.id;
      peer.status = 'connected';
      peer.lastSeen = Date.now();
      logger.log('[I2P] Peer connected successfully:', b32Address.slice(0, 20), 'stream:', stream.id);
    } catch (error) {
      logger.error('[I2P] Failed to connect to peer:', error);
      peer.status = 'disconnected';
      
      // Provide user-friendly error message
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('LeaseSet not found') || errorMessage.includes('CANT_REACH_PEER')) {
        throw new Error(
          'Peer nicht erreichbar. Mögliche Ursachen:\n' +
          '• Der andere Nutzer ist offline\n' +
          '• i2pd baut noch Verbindungen auf (1-3 Min warten)\n' +
          '• Falsche I2P-Adresse im Kontakt\n' +
          '• Firewall blockiert Verbindung'
        );
      }
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

    // Check if stream socket is actually still open
    const streamStillOpen = peer?.samStreamId != null && samService.isStreamOpen(peer.samStreamId);
    if (!peer || peer.status !== 'connected' || !peer.samStreamId || !streamStillOpen) {
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
        logger.error('[I2P] Failed to send message:', error);
        return false;
      }
    }

    try {
      await samService.send(peer.samStreamId, JSON.stringify(message));
      return true;
    } catch (error) {
      logger.warn('[I2P] Send failed, attempting reconnect:', error);
      peer.status = 'disconnected';
      // Try reconnect + resend once
      try {
        await this.connectToPeer(to);
        const reconnectedPeer = this.peers.get(to);
        if (!reconnectedPeer?.samStreamId) {
          throw new Error('Peer nicht verbunden nach Reconnect');
        }
        await samService.send(reconnectedPeer.samStreamId, JSON.stringify(message));
        return true;
      } catch (retryError) {
        logger.error('[I2P] Failed to send message after reconnect:', retryError);
        return false;
      }
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
      logger.log('[I2P] New incoming stream:', stream.id);
    });

    // When SAM auto-reconnects and restores the session, update our status
    // and restart the accept loop for the new session.
    samService.onReconnect(() => {
      logger.log('[I2P] SAM session restored after reconnect');
      this.currentStatus = {
        ...this.currentStatus,
        samConnected: true,
        samAvailable: true,
        error: undefined,
      };
      this.notifyStatusChange();
      samService.startAcceptLoop();
    });
  }

  /**
   * Poll i2pd web console to check if inbound tunnels are established
   * This indicates the LeaseSet is published and we're reachable
   */
  private startTunnelCheck(): void {
    // Stop any existing check
    this.stopTunnelCheck();
    
    // Check every 5 seconds for up to 2 minutes
    let attempts = 0;
    const maxAttempts = 24; // 2 minutes
    
    this.tunnelCheckInterval = setInterval(async () => {
      attempts++;
      const ready = await this.checkTunnelsReady();
      
      if (ready) {
        logger.log('[I2P] Tunnels ready, LeaseSet published');
        this.currentStatus.leasesetPublished = true;
        this.stopTunnelCheck();
        this.notifyStatusChange();
      } else if (attempts >= maxAttempts) {
        logger.warn('[I2P] Tunnel check timeout - may need manual port forwarding');
        this.stopTunnelCheck();
      }
    }, 5000);
  }
  
  private stopTunnelCheck(): void {
    if (this.tunnelCheckInterval) {
      clearInterval(this.tunnelCheckInterval);
      this.tunnelCheckInterval = null;
    }
  }
  
  /**
   * Check i2pd web console API for tunnel status
   */
  private async checkTunnelsReady(): Promise<boolean> {
    try {
      const response = await fetch('http://127.0.0.1:7070/?page=i2p_tunnels_json', {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
      });
      
      if (!response.ok) return false;
      
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = await response.json() as Record<string, any>;
      
      // Check if we have any inbound tunnels with 'established' status
      const inboundTunnels = data.inbound || [];
      const hasEstablishedInbound = inboundTunnels.some(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (t: any) => t.status === 'established' || t.status === 'building'
      );
      
      // Also check local destinations (SAM sessions should appear here)
      const localDests = data.destinations || [];
      const hasLocalDestination = localDests.length > 0;
      
      return hasEstablishedInbound && hasLocalDestination;
    } catch {
      // If we can't reach the API, assume we're in a restricted environment
      // Fall back to SAM connected status
      return this.currentStatus.samConnected;
    }
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
    // CAUTION: exports private key material. Caller must handle securely.
    return {
      publicKey: uint8ArrayToBase64(this.identity.publicKey),
      privateKey: uint8ArrayToBase64(this.identity.privateKey),
      b32Address: this.identity.b32Address,
      samDestination: this.identity.samDestination,
    };
  }

  disconnect(): void {
    if (this.identity) {
      // Zero private key bytes before dropping reference
      this.identity.privateKey.fill(0);
    }
    this.identity = null;
    this.peers.clear();
    samService.shutdown();
    this.currentStatus = {
      samConnected: false,
      samAvailable: false,
      address: null,
    };
    this.notifyStatusChange();
  }
}

export const i2pService = new I2PService();
// DEV/TEST: global exposure for CDP-driven E2E tests
if (typeof window !== 'undefined') {
  (window as unknown as { __i2pDebug?: unknown }).__i2pDebug = i2pService;
}
