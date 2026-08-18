import * as net from 'node:net';
import { I2PSocketHandle } from './i2p-socket-handle';
import { StreamingConnection } from './streaming-protocol';

export interface I2CPSocketManagerOpts {
  host: string;
  port: number;
  privKey: Uint8Array;
  nickname: string;
}

/**
 * Phase-2 minimum-viable implementation. Full I2CP-Session-Handshake
 * (CreateSessionMessage + SessionStatusMessage parsing + LeaseSet-Publishing)
 * is a Phase-2-follow-up and lives behind this skeleton.
 *
 * Singleton mirrors Android `I2CPSocketManager.java` static-method pattern.
 */
export class I2CPSocketManager {
  private static instance: I2CPSocketManager | null = null;

  /**
   * Monotonically-increasing streamId. Strictly positive per I2CP/Streaming
   * spec; never decremented even on close/disconnect so a future reconnect
   * (Phase 6) cannot collide with an in-flight streamId still being acked.
   */
  private streamIdCounter = 1;

  private outgoingStreams: Map<number, I2PSocketHandle> = new Map();
  private incomingStreams: Map<number, I2PSocketHandle> = new Map();
  private streamingConnections: Map<number, StreamingConnection> = new Map();
  private disconnected = true; // starts disconnected until initialize() resolves
  private b32Address: string | null = null;
  private socket: net.Socket | null = null;

  private constructor(private readonly opts: I2CPSocketManagerOpts) {
    // Initialize TCP socket to I2P router (7654).
    // (Full I2CP session handshake implemented in next iteration.)
  }

  static async getOrCreate(opts: I2CPSocketManagerOpts): Promise<I2CPSocketManager> {
    if (!I2CPSocketManager.instance) {
      I2CPSocketManager.instance = new I2CPSocketManager(opts);
      await I2CPSocketManager.instance.initialize();
    }
    return I2CPSocketManager.instance;
  }

  static getInstance(): I2CPSocketManager | null {
    return I2CPSocketManager.instance;
  }

  /**
   * Static validator (matches Android `I2CPSocketManager.java:84` —
   * package-private helper for unit-testability). Throws on null/empty
   * input; the offending input is included (length-capped) for debuggability
   * without leaking the full destination into logs.
   */
  static requireDestination(destinationB32: string | null | undefined): void {
    if (typeof destinationB32 !== 'string' || destinationB32.length === 0) {
      // Avoid leaking the full input. Stringified form is safe but we cap
      // length so a giant blob cannot blow up an error log.
      const safe = JSON.stringify(destinationB32 ?? '<null/undefined>').slice(0, 64);
      throw new Error(`destination B32 required (got: ${safe})`);
    }
  }

  private async initialize(): Promise<void> {
    const sock = net.connect(this.opts.port, this.opts.host);
    this.socket = sock;
    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error): void => {
        sock.removeListener('connect', onConnect);
        reject(err);
      };
      const onConnect = (): void => {
        sock.removeListener('error', onError);
        resolve();
      };
      sock.once('connect', onConnect);
      sock.once('error', onError);
      const timer = setTimeout(() => {
        sock.removeListener('connect', onConnect);
        sock.removeListener('error', onError);
        sock.destroy();
        reject(new Error('connect timeout'));
      }, 15_000);
      // Don't keep the event loop alive just for this timer.
      timer.unref();
    });

    // (Send CreateSessionMessage with Properties — Phase 2 follow-up.)
    // The full handshake needs SessionStatusMessage parsing and is out of
    // scope for this Phase-2 MVP. The placeholder b32 sentinel is returned
    // until then so callers can assert `isConnected()` instead of guessing.
    this.b32Address = 'placeholder-b32-will-be-set-by-i2p-router';
    this.disconnected = false;
  }

  async connectTo(destinationB32: string): Promise<number> {
    I2CPSocketManager.requireDestination(destinationB32);
    // (Lookup Destination via RequestDestinationMessage, then send Open packet.)
    // Simplified: returns streamId immediately.
    const streamId = this.streamIdCounter++;
    // Placeholder handle (real implementation wires a StreamingConnection
    // over a per-stream I2CP socket). For Phase 2 the underlying net.Socket
    // is never connected — the handle is register-only.
    const handle = new I2PSocketHandle(streamId, new net.Socket(), destinationB32);
    this.outgoingStreams.set(streamId, handle);
    return streamId;
  }

  async acceptIncoming(): Promise<number> {
    // (Accept incoming Streaming SYN packet, return streamId.)
    // Phase-2-Follow-up: real implementation will create a StreamingConnection
    // and wire it to the I2CP message stream for the duration of the session.
    const streamId = this.streamIdCounter++;
    const handle = new I2PSocketHandle(streamId, new net.Socket(), 'unknown-peer');
    this.incomingStreams.set(streamId, handle);
    return streamId;
  }

  async send(streamId: number, data: Uint8Array): Promise<void> {
    const handle = this.outgoingStreams.get(streamId) ?? this.incomingStreams.get(streamId);
    if (!handle) throw new Error(`stream ${streamId} not found`);
    await handle.send(data);
  }

  async close(streamId: number, reason: string): Promise<void> {
    // Look up first, then delete. (`Map.delete()` returns boolean; the
    // previous one-liner `||`-shortcut always evaluated truthy and skipped
    // the close-handle path.)
    const outHandle = this.outgoingStreams.get(streamId);
    if (outHandle) {
      this.outgoingStreams.delete(streamId);
      this.streamingConnections.delete(streamId); // best-effort
      try {
        await outHandle.close(reason);
      } catch (err) {
        // (Close the StreamingConnection) — surface the error so callers
        // know the close didn't fully complete; do not throw because we
        // already removed the handle from the registry.
        console.error(`I2CPSocketManager.close(${streamId}) outgoing handle error:`, err);
      }
      return;
    }
    const inHandle = this.incomingStreams.get(streamId);
    if (inHandle) {
      this.incomingStreams.delete(streamId);
      this.streamingConnections.delete(streamId);
      try {
        await inHandle.close(reason);
      } catch (err) {
        console.error(`I2CPSocketManager.close(${streamId}) incoming handle error:`, err);
      }
      return;
    }
    throw new Error(`stream ${streamId} not found`);
  }

  async disconnect(): Promise<void> {
    this.disconnected = true;
    // Close each handle independently and surface (do not silently drop) any
    // errors. Each try/catch ensures that one misbehaving handle cannot
    // strand the rest of the streams open.
    for (const [id, h] of this.outgoingStreams) {
      try {
        await h.close('disconnect');
      } catch (err) {
        console.error(`I2CPSocketManager.disconnect() outgoing[${id}] error:`, err);
      }
    }
    for (const [id, h] of this.incomingStreams) {
      try {
        await h.close('disconnect');
      } catch (err) {
        console.error(`I2CPSocketManager.disconnect() incoming[${id}] error:`, err);
      }
    }
    this.outgoingStreams.clear();
    this.incomingStreams.clear();
    this.streamingConnections.clear();
    try {
      this.socket?.destroy();
    } catch (err) {
      console.error('I2CPSocketManager.disconnect() socket destroy error:', err);
    }
    this.socket = null;
    // Reset the singleton so a subsequent `getOrCreate` produces a fresh
    // instance with a fresh state and a fresh streamIdCounter.
    I2CPSocketManager.instance = null;
    // Note: we do NOT reset streamIdCounter on this instance because the
    // instance is about to be GC'd. The next `getOrCreate` constructs a new
    // instance which starts its counter at 1.
  }

  getB32Address(): string | null {
    return this.b32Address;
  }

  isConnected(): boolean {
    return (
      !this.disconnected &&
      this.socket !== null &&
      !this.socket.destroyed
    );
  }

  getStream(streamId: number): I2PSocketHandle | undefined {
    return this.outgoingStreams.get(streamId) ?? this.incomingStreams.get(streamId);
  }
}
