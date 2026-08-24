import { join } from 'node:path';
import { app } from 'electron';
import * as net from 'node:net';
import { I2CPSocketManager } from './i2cp-socket-manager';
import { IdentityStore } from './identity-store';
import { generateEd25519Destination } from './destination-gen';

/**
 * Bootstrap-Race-Ring-Buffer capacity. Deliberately IMPROVED over
 * Android's single shared Deque (I2PPlugin.java:38-66): per-channel FIFOs
 * prevent a chatty channel (e.g. i2pMessage) from starving others.
 * Same eviction policy (FIFO at 64) and same drain-on-first-listener
 * semantics.
 */
const BUFFER_CAPACITY = 64;

/**
 * I2P availability probe timeout. Matches the Android probe's TCP-connect
 * budget so a slow / hung router cannot block the renderer's startup for
 * more than two seconds.
 */
const I2P_AVAILABILITY_TIMEOUT_MS = 2_000;

interface BufferedEvent {
  name: string;
  data: Record<string, unknown>;
}

/**
 * Phase-3 IPC bridge surface that the renderer's preload bridge (Task 8)
 * will call into. Singleton mirrors Android `I2PPlugin.java`.
 *
 * Key invariant: events fired BEFORE a renderer-side listener attaches must
 * still be delivered to that listener. The Bootstrap-Race-Ring-Buffer
 * (Android I2PPlugin.java:38-66) guarantees this by buffering up to
 * `BUFFER_CAPACITY` events PER CHANNEL and delivering them on first
 * listener registration for that channel.
 *
 * Lifecycle note: `disconnect()` clears the socketManager but does NOT
 * reset the singleton. The renderer may call `start()` again to reconnect;
 * doing so re-uses the same I2PPlugin instance and re-initializes the
 * socketManager. The Android reference clears `instance` in `disconnect()`
 * but here we intentionally diverge because the Electron IPC plugin is
 * expected to survive multiple connect cycles within the same app session.
 */
export class I2PPlugin {
  private static instance: I2PPlugin | null = null;

  private socketManager: I2CPSocketManager | null = null;
  private readonly identityStore: IdentityStore;
  /**
   * Per-channel ring buffers. A deliberate improvement over Android's
   * single shared deque (I2PPlugin.java:38-66) so a chatty channel
   * cannot starve the others. Same eviction policy (FIFO at 64) and
   * drain-on-first-listener semantics.
   */
  private readonly eventBuffers: Map<string, BufferedEvent[]> = new Map();
  private readonly activeListeners: Map<string, Set<(data: unknown) => void>> = new Map();
  /**
   * Tracks which event names have already drained their buffered history to
   * at least one listener. Subsequent `onI2pXxx` subscriptions must NOT
   * replay history; they only receive events fired AFTER they attached.
   */
  private readonly primedEvents: Set<string> = new Set();

  private constructor() {
    // IdentityStore path: <userData>/i2p_identity.bin. We always construct
    // IdentityStore eagerly so tests can prime it before start() is called.
    this.identityStore = new IdentityStore(join(app.getPath('userData'), 'i2p_identity.bin'));
  }

  static getInstance(): I2PPlugin {
    if (!I2PPlugin.instance) {
      I2PPlugin.instance = new I2PPlugin();
    }
    return I2PPlugin.instance;
  }

  async start(opts: { host?: string; port?: number; nickname?: string }): Promise<{ b32Address: string }> {
    const host = opts.host ?? '127.0.0.1';
    const port = opts.port ?? 7654;
    const nickname = opts.nickname ?? 'SecuChat';

    let privKey = await this.identityStore.loadOrNull();
    if (!privKey) {
      // Generate new Ed25519 destination. Real crypto lands in Task 7 —
      // until then the helper throws so the failure mode is visible.
      privKey = await this.generateNewPrivKey();
      await this.identityStore.save(privKey);
      // Validate save (mirrors Android I2PPlugin.java:119-123 — detect
      // partial writes before the socketManager depends on the key).
      const verify = await this.identityStore.loadOrNull();
      if (!verify || verify.length !== privKey.length) {
        throw new Error('Failed to persist I2P identity');
      }
    }

    this.socketManager = await I2CPSocketManager.getOrCreate({ host, port, privKey, nickname });
    this.startAcceptLoop();

    const b32Address = this.socketManager.getB32Address();
    this.emitOrBuffer('i2pStatus', { connected: true, b32Address });
    return { b32Address: b32Address! };
  }

  async connectTo(opts: { destination: string }): Promise<{ streamId: number }> {
    if (!this.socketManager) throw new Error('not started');
    const streamId = await this.socketManager.connectTo(opts.destination);
    const handle = this.socketManager.getStream(streamId);
    if (!handle) throw new Error('handle null');

    // Wire the I2PSocketHandle lifecycle events into our buffered event bus
    // so the renderer gets the same `i2pMessage` / `i2pStreamClosed` shape
    // it would get from a server-initiated stream.
    handle.setOnData((ev) => {
      this.emitOrBuffer('i2pMessage', {
        streamId: ev.streamId,
        data: new TextDecoder().decode(ev.data),
        peerDestination: ev.peerDestination,
      });
    });
    handle.setOnClose((ev) => {
      this.emitOrBuffer('i2pStreamClosed', {
        streamId: ev.streamId,
        reason: ev.reason,
        peerDestination: ev.peerDestination,
      });
    });
    // startReadThread() is idempotent and the actual I2PSocketHandle API
    // requires explicit invocation — it is NOT auto-started by the
    // constructor. Brief line 151 calls this; we keep that call.
    handle.startReadThread();

    this.emitOrBuffer('i2pStreamConnected', { streamId, peerDestination: opts.destination });
    return { streamId };
  }

  async acceptIncoming(): Promise<void> {
    // No-op: the accept loop runs as a background task inside startAcceptLoop().
    // This method is kept for parity with the Android reference and so the
    // IPC handler in Task 8 can forward the renderer's "begin accepting"
    // intent without conditional logic on the Electron side.
  }

  async send(opts: { streamId: number; data: string }): Promise<{ success: boolean }> {
    if (!this.socketManager) throw new Error('not started');
    // CRITICAL: do NOT append `\n` here — `I2PSocketHandle.send()` already
    // appends it (commit a9572cf). Pre-pending would double-frame the
    // message and the receiver's newline-splitter would emit an empty
    // trailing line. The brief's `Buffer.from(opts.data + '\n', 'utf-8')`
    // is wrong for our Task-3 handle implementation.
    const data = Buffer.from(opts.data, 'utf-8');
    await this.socketManager.send(opts.streamId, data);
    return { success: true };
  }

  async close(opts: { streamId: number; reason?: string }): Promise<{ success: boolean }> {
    if (!this.socketManager) throw new Error('not started');
    await this.socketManager.close(opts.streamId, opts.reason ?? 'user closed');
    return { success: true };
  }

  async disconnect(): Promise<void> {
    if (this.socketManager) {
      await this.socketManager.disconnect();
      this.socketManager = null;
    }
    // Note: `I2CPSocketManager.disconnect()` resets its own singleton so a
    // subsequent `start()` on this plugin re-creates a fresh manager. We
    // intentionally do NOT reset `I2PPlugin.instance` here — see class-level
    // comment for rationale.
    this.emitOrBuffer('i2pStatus', { connected: false });
  }

  async getB32Address(): Promise<{ b32Address: string }> {
    if (!this.socketManager) throw new Error('not started');
    return { b32Address: this.socketManager.getB32Address()! };
  }

  async isI2pAvailable(): Promise<{ available: boolean }> {
    // Cheap TCP-connect probe to the I2P router's I2CP port. Uses the
    // imported `net` module (consistent with Task-5 I2CPSocketManager)
    // rather than `require('node:net')` so the import is statically
    // traceable and tree-shakeable.
    return new Promise((resolve) => {
      const socket = net.connect(7654, '127.0.0.1');
      const timeout = setTimeout(() => {
        socket.destroy();
        resolve({ available: false });
      }, I2P_AVAILABILITY_TIMEOUT_MS);
      socket.once('connect', () => {
        clearTimeout(timeout);
        socket.destroy();
        resolve({ available: true });
      });
      socket.once('error', () => {
        clearTimeout(timeout);
        resolve({ available: false });
      });
    });
  }

  // ─── Event Registration (renderer-side surface) ────────────────────────────

  onI2pStatus(cb: (data: { connected: boolean; b32Address?: string }) => void): () => void {
    return this.registerEvent('i2pStatus', cb);
  }

  onI2pMessage(
    cb: (data: { streamId: number; data: string; peerDestination?: string; type?: string }) => void,
  ): () => void {
    return this.registerEvent('i2pMessage', cb);
  }

  onI2pStreamConnected(
    cb: (data: { streamId: number; peerDestination: string; type?: string }) => void,
  ): () => void {
    return this.registerEvent('i2pStreamConnected', cb);
  }

  onI2pStreamClosed(cb: (data: { streamId: number; reason: string }) => void): () => void {
    return this.registerEvent('i2pStreamClosed', cb);
  }

  // ─── Internal: Bootstrap-Race-Ring-Buffer (Android I2PPlugin.java:38-66) ─

  private registerEvent(eventName: string, cb: (data: never) => void): () => void {
    // The callback signature is intentionally typed with `never` so the
    // public `onI2pXxx` methods (each with their own narrow payload type)
    // can be passed without contravariance complaints. At runtime we cast
    // through `unknown` because TypeScript can't verify the structural
    // relationship between the public typed callback and `never`.
    const wrapped = cb as unknown as (data: unknown) => void;
    let listeners = this.activeListeners.get(eventName);
    if (!listeners) {
      listeners = new Set();
      this.activeListeners.set(eventName, listeners);
    }
    listeners.add(wrapped);
    // Drain the per-channel buffer exactly once — the first listener
    // registered for a given eventName receives the buffered history for
    // that channel. Subsequent listeners subscribe to live events only;
    // replaying history would surprise callers who joined mid-stream.
    if (!this.primedEvents.has(eventName)) {
      this.primedEvents.add(eventName);
      this.drainBuffer(eventName);
    }
    return () => {
      this.activeListeners.get(eventName)?.delete(wrapped);
    };
  }

  private emitOrBuffer(eventName: string, data: Record<string, unknown>): void {
    let buffer = this.eventBuffers.get(eventName);
    if (!buffer) {
      buffer = [];
      this.eventBuffers.set(eventName, buffer);
    }
    if (buffer.length >= BUFFER_CAPACITY) {
      buffer.shift(); // FIFO-evict oldest.
    }
    buffer.push({ name: eventName, data });
    this.fireListeners(eventName, data);
  }

  private fireListeners(eventName: string, data: unknown): void {
    const listeners = this.activeListeners.get(eventName);
    if (!listeners) return;
    // Copy to avoid mutation during iteration if a listener unsubscribes.
    for (const cb of [...listeners]) {
      cb(data);
    }
  }

  private drainBuffer(eventName: string): void {
    const buffer = this.eventBuffers.get(eventName);
    if (!buffer) return;
    while (buffer.length > 0) {
      const ev = buffer.shift()!;
      this.fireListeners(ev.name, ev.data);
    }
  }

  // ─── Test Hook ────────────────────────────────────────────────────────────
  // Public so tests can simulate async lifecycle events without spinning up
  // a real I2P router. Not part of the IPC bridge surface — Task 8 will not
  // expose this to the renderer.

  simulateEmit(eventName: string, data: Record<string, unknown>): void {
    this.emitOrBuffer(eventName, data);
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private startAcceptLoop(): void {
    // Subscribe to the I2CPSocketManager's peer-initiated stream events.
    // The socketManager fires exactly once per RECEIVE_MESSAGE_BEGIN with
    // a previously-unknown streamId; for each such event we look up the
    // freshly-created I2PSocketHandle and wire its lifecycle into our
    // buffered event bus so the renderer sees the same shape it sees for
    // client-initiated streams.
    //
    // No polling here: the socketManager pushes the event synchronously
    // from inside its inbound-message reader, so the listener runs in the
    // same tick the router delivers the BEGIN frame. Unsubscribe is left
    // dangling on purpose — the I2CPSocketManager is a singleton with the
    // same lifetime as this I2PPlugin, and a stale unsubscribe could not
    // meaningfully outlive `disconnect()` since the socketManager is reset
    // there too.
    if (!this.socketManager) return;
    this.socketManager.onIncomingStream(({ streamId, peerB32 }) => {
      const handle = this.socketManager!.getStream(streamId);
      if (!handle) {
        console.error(
          `I2PPlugin.startAcceptLoop: no I2PSocketHandle for incoming stream ${streamId} — ignoring`,
        );
        return;
      }
      handle.setOnData((ev) => {
        this.emitOrBuffer('i2pMessage', {
          streamId: ev.streamId,
          data: new TextDecoder().decode(ev.data),
          peerDestination: ev.peerDestination,
        });
      });
      handle.setOnClose((ev) => {
        this.emitOrBuffer('i2pStreamClosed', {
          streamId: ev.streamId,
          reason: ev.reason,
          peerDestination: ev.peerDestination,
        });
      });
      handle.startReadThread();
      this.emitOrBuffer('i2pStreamConnected', {
        streamId,
        peerDestination: peerB32 === 'unknown-peer' ? handle.peerDestination : peerB32,
      });
    });
  }

  private async generateNewPrivKey(): Promise<Uint8Array> {
    // Task 7: real Ed25519 destination generation. The 384-byte privKey
    // blob is IdentityStore-compatible and the b32Address derived from it
    // is wire-compatible with the Android Java side's b32 for the same key.
    const dest = await generateEd25519Destination();
    return dest.privKey;
  }
}