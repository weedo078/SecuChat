/**
 * I2P Service — High-level API for I2P communication
 *
 * Sits on top of SAMService. Manages identity, peers, message routing.
 * Requires i2pd + sam-proxy running locally.
 */

/**
 * Sentinel b32 returned by the Electron I2CP stub until the real handshake
 * lands. MUST NOT be persisted. Source of truth:
 * `electron/tests/e2e/_helpers/probeI2CP.ts`. Duplicated locally to avoid a
 * renderer→electron/ cross-package import.
 */
const B32_PLACEHOLDER = 'placeholder-b32-will-be-set-by-i2p-router';

import nacl from 'tweetnacl';
import { toBase32, uint8ArrayToBase64, tryBase64ToUint8Array } from '@/utils/base32';
import { samService, type SAMConfig } from './i2pSam';
import { logger } from '@/utils/logger';
import { i2pPlugin } from './i2pPlugin';
import { platformService } from './platform';
import { type ElectronI2PAPI } from './electronI2pTypes';
export { samService, type SAMConfig };
export type { ElectronI2PAPI };

/**
 * Typed view of the `window.electronAPI` IPC surface used by the Electron
 * Desktop path. Mirrors the surface exposed by `electron/src/preload.ts`
 * (Task 8). Keep this in sync with that file; the renderer never reaches
 * Electron without going through `getElectronI2P()` below.
 */

/** Wire shape of `i2pMessage` events emitted by the Electron main process. */
interface ElectronI2PMessageEvent {
  streamId: number;
  data: string;
  peerDestination?: string;
  type?: string;
}

interface ElectronI2PStreamConnectedEvent {
  streamId: number;
  peerDestination?: string;
}

interface ElectronI2PStreamClosedEvent {
  streamId: number;
  reason?: string;
}

/**
 * Returns the typed Electron IPC bridge, or `null` if we're not running
 * inside Electron (browser, Capacitor/Android, or no `electronAPI` exposed
 * by preload). Use this everywhere instead of inline `(window as any)` casts
 * — keeps the rest of the file strictly typed.
 */
function getElectronI2P(): ElectronI2PAPI | null {
  if (typeof window === 'undefined') return null;
  const api = (window as unknown as { electronAPI?: ElectronI2PAPI }).electronAPI;
  return api ?? null;
}

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
   * Unsubscribe handles for the IPC event listeners registered by
   * `initializeViaElectronI2P`. Stored on the instance so `disconnect()`
   * can tear them down — otherwise a re-`initialize()` would stack
   * listeners and every inbound `i2pMessage` would be delivered N times.
   */
  private electronI2pUnsubs: Array<() => void> = [];

  /**
   * Initialize I2P service — dispatches to the platform-specific backend.
   * Priority: Capacitor/Android → Electron/Desktop → SAM-bridge (browser).
   */
  async initialize(config?: SAMConfig): Promise<I2PStatus> {
    if (platformService.isAndroidNative()) {
      return this.initializeViaI2PPlugin(config);
    }
    if (platformService.isElectron()) {
      return this.initializeViaElectronI2P(config);
    }
    return this.initializeViaSAMBridge(config); // browser fallback (Phase-5 removal)
  }

  private async initializeViaI2PPlugin(config?: SAMConfig): Promise<I2PStatus> {
    void config;
    const hostOverride = (typeof localStorage !== 'undefined'
      ? localStorage.getItem('secuchat_sam_host')
      : null) || '';
    try {
      const result = await i2pPlugin.initialize({
        host: hostOverride || '127.0.0.1',
        port: 7654,
        enabled: true,
      });
      this.currentStatus = {
        samConnected: true,
        samAvailable: true,
        address: result.b32Address,
        leasesetPublished: true,
      };
      if (result.b32Address && this.identity) {
        this.identity.b32Address = result.b32Address;
      }
      i2pPlugin.onMessage((from, data) => {
        try {
          const message = JSON.parse(data);
          this.messageHandlers.forEach(handler => handler(from, message));
        } catch {
          this.messageHandlers.forEach(handler => handler(from, data));
        }
      });
      i2pPlugin.onStreamConnected((streamId, peerDestination) => {
        logger.log('[I2P] stream connected:', streamId, peerDestination);
      });
      i2pPlugin.onStreamClosed((streamId, reason) => {
        logger.log('[I2P] stream closed:', streamId, reason);
      });
      await i2pPlugin.startAccepting();

      // Sync the live SAM b32 into the persisted user record. The native
      // plugin derives the b32 from whatever private key it currently has
      // loaded (which can change after `pm clear` + re-onboarding, or
      // after the IdentityStore generated a new destination because the
      // previous one failed to persist). Without this back-sync, the User
      // object in storage keeps a stale b32 and every STREAM CONNECT to
      // a peer fails with "LeaseSet not found" because no LeaseSet is
      // published under that address.
      await this.syncB32ToUser();

      this.notifyStatusChange();
      return this.currentStatus;
    } catch (e) {
      this.currentStatus = {
        samConnected: false,
        samAvailable: false,
        address: null,
        error: e instanceof Error ? e.message : 'I2P-Plugin init failed',
      };
      this.notifyStatusChange();
      return this.currentStatus;
    }
  }

  private async syncB32ToUser(): Promise<void> {
    // Resolve the live b32 from whichever backend is currently driving us.
    // On Capacitor/Android we read from the native plugin; on Electron we
    // round-trip through the IPC bridge. Both branches share the same
    // user-record write-back below so a stale `user.i2pAddress` does not
    // poison STREAM CONNECT attempts with "LeaseSet not found".
    const liveB32 = await this.getLiveB32();
    if (!liveB32) return;

    // Guard: Electron I2CP stub returns a sentinel until the real handshake lands.
    // Refuse to persist — would poison STREAM CONNECT / QR / contacts.
    if (liveB32 === B32_PLACEHOLDER) {
      logger.warn('[I2P] syncB32ToUser: Phase-2 stub sentinel — refusing to persist');
      return;
    }
    try {
      const { storageService } = await import('./storage');
      const user = await storageService.getUser();
      if (!user) return;
      if (user.i2pAddress === liveB32) return;
      await storageService.saveUser({ ...user, i2pAddress: liveB32 });
      logger.log(
        '[I2P] synced stale user.i2pAddress to live b32:',
        user.i2pAddress?.slice(0, 12),
        '→',
        liveB32.slice(0, 12),
      );
    } catch (e) {
      logger.warn('[I2P] failed to persist live b32 to user record:', e);
    }
  }

  /**
   * Read the live b32 address from whichever I2P backend is active.
   * Returns `null` if no backend is reachable.
   */
  private async getLiveB32(): Promise<string | null> {
    if (platformService.isAndroidNative()) {
      return i2pPlugin.getB32Address();
    }
    const electronI2p = getElectronI2P();
    if (electronI2p) {
      try {
        const result = await electronI2p.i2pInvoke('getB32Address') as { b32Address: string };
        return result.b32Address ?? null;
      } catch {
        return null;
      }
    }
    // SAM-bridge path uses samService.getB32Address(); we don't reach it
    // here because syncB32ToUser is only called from the Electron/I2PPlugin
    // init paths today. Keep this explicit so a future refactor doesn't
    // silently lose the b32.
    return null;
  }

  /**
   * Initialize I2P through the Electron `electronAPI.i2pInvoke` /
   * `onI2pEvent` IPC bridge (wired in Task 8/9 by `electron/src/preload.ts`
   * + `electron/src/main.ts`). This is the Desktop path; it replaces the
   * legacy SAM-bridge flow which spoke HTTP+WS to a separately-spawned
   * sam-proxy.
   *
   * Failure modes (all return I2PStatus, never throw):
   *   - `window.electronAPI` undefined → "Electron-API nicht verfügbar"
   *   - I2P router not installed (isAvailable=false) → "I2P-Router nicht installiert..."
   *   - start/acceptIncoming throws → propagates the message
   */
  private async initializeViaElectronI2P(config?: SAMConfig): Promise<I2PStatus> {
    void config;

    // Drop any previously-registered event listeners from an earlier
    // init — the IPC bridge would otherwise fire every i2pMessage event
    // N times where N = previous init count.
    this.clearElectronI2pListeners();

    const electronI2p = getElectronI2P();
    if (!electronI2p) {
      this.currentStatus = {
        samConnected: false,
        samAvailable: false,
        address: null,
        error: 'Electron-API nicht verfügbar',
      };
      this.notifyStatusChange();
      return this.currentStatus;
    }

    try {
      const { available } = await electronI2p.i2pInvoke('isAvailable') as { available: boolean };
      if (!available) {
        this.currentStatus = {
          samConnected: false,
          samAvailable: false,
          address: null,
          error: 'I2P-Router nicht installiert. Bitte Java I2P installieren.',
        };
        this.notifyStatusChange();
        return this.currentStatus;
      }

      const result = await electronI2p.i2pInvoke('start', {
        host: '127.0.0.1',
        port: 7654,
        nickname: 'SecuChat',
      }) as { b32Address: string };

      // Phase-2 stub guard: real SessionStatus handshake not yet landed → plugin returns
      // a sentinel b32. Skip syncB32ToUser / acceptIncoming / leasesetPublished=true
      // so we never persist or share a fake b32. A re-init will fill in the real value.
      if (result.b32Address === B32_PLACEHOLDER) {
        this.currentStatus = {
          samConnected: false,
          samAvailable: true,
          address: null,
          leasesetPublished: false,
          error: 'I2CP Phase-2 stub — b32 not yet bound',
        };
        this.notifyStatusChange();
        return this.currentStatus;
      }

      this.currentStatus = {
        samConnected: true,
        samAvailable: true,
        address: result.b32Address,
        // Phase-6: verify via LeaseSet lookup. Today the IPC plugin has
        // no dedicated "isLeaseSetPublished" query — start() returning a
        // b32 implies a session, but inbound-tunnel readiness is not
        // guaranteed until i2pd's netdb accepts the published LeaseSet
        // (which can take 30-60s after start on first boot). Until then
        // the connectTo path will retry on LeaseSet-not-found.
        leasesetPublished: true,
      };

      // Wire event listeners. Each subscribe call returns an unsubscribe
      // function; we collect them so disconnect() can clean up.
      this.electronI2pUnsubs.push(
        electronI2p.onI2pEvent('i2pMessage', (raw: unknown) => {
          const data = raw as ElectronI2PMessageEvent;
          try {
            const message = JSON.parse(data.data);
            this.messageHandlers.forEach((h) => h(data.peerDestination ?? '', message));
          } catch {
            this.messageHandlers.forEach((h) => h(data.peerDestination ?? '', data.data));
          }
        }),
        electronI2p.onI2pEvent('i2pStreamConnected', (raw: unknown) => {
          const data = raw as ElectronI2PStreamConnectedEvent;
          logger.log('[I2P] stream connected:', data.streamId, data.peerDestination);
        }),
        electronI2p.onI2pEvent('i2pStreamClosed', (raw: unknown) => {
          const data = raw as ElectronI2PStreamClosedEvent;
          logger.log('[I2P] stream closed:', data.streamId, data.reason);
        }),
      );

      await electronI2p.i2pInvoke('acceptIncoming');

      // Sync the live b32 into the persisted user record — same rationale
      // as the Android path: the stored User.i2pAddress can drift from
      // the session's actual b32 after re-keying or re-onboarding.
      await this.syncB32ToUser();

      this.notifyStatusChange();
      return this.currentStatus;
    } catch (e) {
      this.clearElectronI2pListeners();
      this.currentStatus = {
        samConnected: false,
        samAvailable: false,
        address: null,
        error: e instanceof Error ? e.message : 'I2P init failed',
      };
      this.notifyStatusChange();
      return this.currentStatus;
    }
  }

  /** Unsubscribe every IPC event listener we registered. Idempotent. */
  private clearElectronI2pListeners(): void {
    for (const unsub of this.electronI2pUnsubs) {
      try {
        unsub();
      } catch {
        // Listener may already be detached (e.g. window closed); ignore.
      }
    }
    this.electronI2pUnsubs = [];
  }

  private async initializeViaSAMBridge(config?: SAMConfig): Promise<I2PStatus> {
    // DEV/TEST: optionaler SAM-Bridge-Host via localStorage (z.B. Emulator→10.0.2.2, Telefon→Host-LAN-IP)
    const hostOverride = (typeof localStorage !== 'undefined'
      ? localStorage.getItem('secuchat_sam_host')
      : null) || '';
    const defaultPort = 7657;
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

      let newDestinationGenerated = false;
      if (!this.identity?.samDestination) {
        logger.log('[I2P] Generating new SAM destination (none exists in identity)');
        const session = await samService.generateDestination();
        if (this.identity) {
          this.identity.samDestination = session.privateKey;
          newDestinationGenerated = true;
          this.currentStatus.newDestinationGenerated = true;
          logger.log('[I2P] New SAM destination generated, caller must persist it');
        }
      } else {
        logger.log('[I2P] Using existing SAM destination from identity');
      }

      const sessionPrivKey = this.identity?.samDestination;
      if (!sessionPrivKey) {
        throw new Error('SAM destination not available. Identity must be restored with samDestination before initializing I2P.');
      }

      const sessionNick = `sc-${Date.now()}`;
      await samService.createSession(sessionNick, sessionPrivKey);

      samService.startAcceptLoop();
      const b32 = await samService.getB32Address();
      if (b32 && this.identity) this.identity.b32Address = b32;
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
    const publicKey = tryBase64ToUint8Array(publicKeyB64);
    const privateKey = tryBase64ToUint8Array(privateKeyB64);

    // Defensive: a corrupted storage entry (e.g. an older build that
    // JSON-serialized a Uint8Array as {"0":1,"1":2,...}) breaks base64
    // decoding and would otherwise crash AppContext init. Fall back to a
    // freshly generated identity so the UI recovers — the peer must
    // re-import the new b32.
    if (!publicKey || !privateKey) {
      logger.warn('[I2P] restoreIdentity: stored keys are not valid base64 — regenerating identity');
      return this.generateIdentity();
    }

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
   *
   * @param opts.maxRetries retry budget handed down to the SAM layer. Callers that
   *   poll on their own schedule (periodic status check) should pass 0 so a failed
   *   attempt returns immediately instead of occupying the peer slot for ~67 s.
   */
  async connectToPeer(
    b32Address: string,
    publicKey?: Uint8Array,
    opts?: { maxRetries?: number }
  ): Promise<I2PPeer> {
    // If a connect is already in flight for this peer, piggyback on it
    const pending = this.pendingConnects.get(b32Address);
    if (pending) {
      logger.log(`[I2P] Connect already in flight for: ${b32Address.slice(0, 20)}`);
      return pending;
    }

    const connectPromise = this.doConnectToPeer(b32Address, publicKey, opts?.maxRetries);
    this.pendingConnects.set(b32Address, connectPromise);

    try {
      return await connectPromise;
    } finally {
      this.pendingConnects.delete(b32Address);
    }
  }

  private async doConnectToPeer(
    b32Address: string,
    publicKey?: Uint8Array,
    maxRetries = 3
  ): Promise<I2PPeer> {
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
      (platformService.isAndroidNative() || samService.isStreamOpen(existing.samStreamId))
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
      logger.log(`[I2P] Calling ${platformService.isAndroidNative() ? 'i2pPlugin' : 'samService'}.connectTo for:`, b32Address.slice(0, 20));
      const streamId = platformService.isAndroidNative()
        ? await i2pPlugin.connectTo(b32Address, 60000, maxRetries)
        : (await samService.connectTo(b32Address, maxRetries)).id;
      peer.samStreamId = streamId;
      peer.status = 'connected';
      peer.lastSeen = Date.now();
      logger.log('[I2P] Peer connected successfully:', b32Address.slice(0, 20), 'stream:', streamId);
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
          '• Firewall blockiert Verbindung',
          { cause: error }
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
    try {
      await this.sendMessageOrThrow(to, message);
      return true;
    } catch (error) {
      logger.error('[I2P] Failed to send message:', error);
      return false;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- message structure varies by type
  private async sendMessageOrThrow(to: string, message: any): Promise<void> {
    const payload = JSON.stringify(message);
    const peer = this.peers.get(to);

    const streamStillOpen = peer?.samStreamId != null && (platformService.isAndroidNative() || samService.isStreamOpen(peer.samStreamId));
    if (!peer || peer.status !== 'connected' || !peer.samStreamId || !streamStillOpen) {
      if (peer) {
        peer.status = 'disconnected';
      }
      await this.connectToPeer(to);
      const updatedPeer = this.peers.get(to);
      if (!updatedPeer?.samStreamId || !(platformService.isAndroidNative() || samService.isStreamOpen(updatedPeer.samStreamId))) {
        throw new Error('Peer nicht verbunden oder Stream nach Connect nicht offen');
      }
      if (platformService.isAndroidNative()) {
        const sent = await i2pPlugin.send(updatedPeer.samStreamId, payload);
        if (!sent) throw new Error('I2P-Plugin konnte Nachricht nicht senden');
      } else {
        await samService.send(updatedPeer.samStreamId, payload);
      }
      return;
    }

    try {
      if (platformService.isAndroidNative()) {
        const sent = await i2pPlugin.send(peer.samStreamId, payload);
        if (!sent) throw new Error('I2P-Plugin konnte Nachricht nicht senden');
      } else {
        await samService.send(peer.samStreamId, payload);
      }
    } catch (error) {
      logger.warn('[I2P] Send failed, attempting reconnect:', error);
      peer.status = 'disconnected';
      // Try reconnect + resend once
      try {
        await this.connectToPeer(to);
        const reconnectedPeer = this.peers.get(to);
        if (!reconnectedPeer?.samStreamId || (platformService.isAndroidNative() ? false : !samService.isStreamOpen(reconnectedPeer.samStreamId))) {
          throw new Error('Peer nicht verbunden nach Reconnect', { cause: error });
        }
        if (platformService.isAndroidNative()) {
          const sent = await i2pPlugin.send(reconnectedPeer.samStreamId, payload);
          if (!sent) throw new Error('I2P-Plugin konnte Nachricht nicht senden', { cause: error });
        } else {
          await samService.send(reconnectedPeer.samStreamId, payload);
        }
      } catch (retryError) {
        console.error('[I2P] Failed to send message after reconnect:', retryError);
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
    if (platformService.isAndroidNative()) {
      const sent = await i2pPlugin.send(peer.samStreamId, JSON.stringify({
        type: 'file-offer',
        id: fileId,
        filename: file.name,
        mimeType: file.type,
        size: file.size,
        totalChunks,
      }));
      if (!sent) throw new Error('I2P-Plugin konnte Datei-Offer nicht senden');
    } else {
      await samService.send(peer.samStreamId, JSON.stringify({
        type: 'file-offer',
        id: fileId,
        filename: file.name,
        mimeType: file.type,
        size: file.size,
        totalChunks,
      }));
    }

    // Send chunks
    for (let i = 0; i < totalChunks; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, file.size);
      const chunk = file.slice(start, end);
      const arrayBuffer = await chunk.arrayBuffer();

      if (platformService.isAndroidNative()) {
        const sent = await i2pPlugin.send(peer.samStreamId, JSON.stringify({
          type: 'file-chunk',
          id: fileId,
          chunkIndex: i,
          totalChunks,
          data: uint8ArrayToBase64(new Uint8Array(arrayBuffer)),
        }));
        if (!sent) throw new Error('I2P-Plugin konnte Datei-Chunk nicht senden');
      } else {
        await samService.send(peer.samStreamId, JSON.stringify({
          type: 'file-chunk',
          id: fileId,
          chunkIndex: i,
          totalChunks,
          data: uint8ArrayToBase64(new Uint8Array(arrayBuffer)),
        }));
      }

      // Small delay to avoid overwhelming I2P tunnels
      if (i < totalChunks - 1) {
        await new Promise(r => setTimeout(r, 50));
      }
    }

    // Send completion
    if (platformService.isAndroidNative()) {
      const sent = await i2pPlugin.send(peer.samStreamId, JSON.stringify({
        type: 'file-complete',
        id: fileId,
      }));
      if (!sent) throw new Error('I2P-Plugin konnte Datei-Completion nicht senden');
    } else {
      await samService.send(peer.samStreamId, JSON.stringify({
        type: 'file-complete',
        id: fileId,
      }));
    }

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
    if (platformService.isAndroidNative()) {
      void i2pPlugin.disconnect().catch(error => logger.warn('[I2P] Plugin disconnect failed:', error));
    }
    // Electron Desktop path: tear down IPC listeners + ask main to close
    // the I2CP session. Order matters — unsubscribe first so we don't
    // observe a half-torn-down session.
    this.clearElectronI2pListeners();
    const electronI2p = getElectronI2P();
    if (electronI2p && !platformService.isAndroidNative()) {
      void electronI2p.i2pInvoke('disconnect').catch(error =>
        logger.warn('[I2P] Electron disconnect failed:', error),
      );
    }
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
