import { describe, it, expect, beforeEach, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promises as fs } from 'node:fs';
import { I2PPlugin } from './i2p-plugin';

// Mock the `electron` module so the constructor's `app.getPath('userData')`
// call works outside an Electron runtime. We point userData at a tmpdir so
// IdentityStore can be primed via `plugin['identityStore'].save(...)` in
// lifecycle tests.
vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'userData') return tmpdir();
      return tmpdir();
    },
  },
}));

/**
 * Build a 128-byte IdentityEx privKey blob (Task 5 / spec-2c24bb9 layout):
 *   bytes  0..32 = encPriv
 *   bytes 32..64 = encPub
 *   bytes 64..96 = signPriv
 *   bytes 96..128 = signPub
 *
 * Mirrors the helper in i2cp-socket-manager.test.ts — kept duplicated
 * rather than extracted to a shared fixture file so this file remains
 * self-contained for parallel vitest workers.
 */
function makeTestPrivKey(seed = 7): Uint8Array {
  const blob = new Uint8Array(128);
  for (let i = 0; i < 128; i++) blob[i] = (i * seed + 1) & 0xff;
  return blob;
}

// Mock node:net so I2CPSocketManager.initialize() resolves without a real I2P
// router, mirroring the pattern used by i2cp-socket-manager.test.ts.
// The fake socket's `write` must invoke its callback (asynchronously, like
// the real Node Socket does) so `I2PSocketHandle.send()` does not hang.
// Note the variadic argument shape — Node callers pass either (chunk, cb) or
// (chunk, encoding, cb); we accept the callback in either slot.
//
// Phase-2 (2026-08-18): the mock synthesizes the SessionStatus=1 (Created)
// reply on 'connect' so the I2CPSocketManager reaches `sessionReady=true`
// and connectTo/send/close can proceed.
//
// Task 7 (2026-08-19): also synthesizes a GET_DATE reply on every
// outbound GET_DATE write so `syncRouterClock()` resolves immediately
// instead of hitting the 15 s production timeout.
vi.mock('node:net', () => {
  let sessionIdCounter = 1;
  const makeFakeSocket = () => {
    const s = new (require('node:events').EventEmitter)();
    s.write = vi.fn((...args: unknown[]) => {
      // Last positional is the callback (per Node's Duplex.write contract).
      const cb = args[args.length - 1];
      if (typeof cb === 'function') {
        setImmediate(() => cb(null));
      }
      // Intercept outbound frames so we can synthesize matching router
      // replies. We react to:
      //   - GET_DATE (type 32)  → synthesize GET_DATE reply
      //   - DEST_LOOKUP (34)    → synthesize DEST_REPLY (placeholder)
      const chunk = args[0];
      if (chunk && Buffer.isBuffer(chunk) && chunk.length >= 5) {
        const type = chunk.readUInt8(4);
        if (type === 32 /* GET_DATE */) {
          const routerMs = Date.now();
          // I2CP wire format: [4-byte length=body][1-byte type][8-byte date BE].
          // Per Java-I2P's I2CPMessageImpl.writeMessage the length is the BODY
          // length (does NOT include the 1-byte type). body = 8 bytes (date only).
          const frame = Buffer.alloc(4 + 1 + 8);
          frame.writeUInt32BE(8, 0);                   // length = 8 body bytes (NO type)
          frame.writeUInt8(32, 4);                     // I2CP_MSG.GET_DATE
          frame.writeBigUInt64BE(BigInt(routerMs), 5); // 8-byte BE ms since epoch
          setImmediate(() => s.emit('data', frame));
        } else if (type === 34 /* DestLookup */) {
          const sid = chunk.length >= 7 ? chunk.readUInt16BE(5) : 0;
          const destBlob = Buffer.alloc(65, 0x42); // placeholder dest
          const innerPayload = Buffer.alloc(4 + 65);
          innerPayload.writeUInt32BE(1, 0); // found = 1
          destBlob.copy(innerPayload, 4);
          // body = 2-byte sid + innerPayload (4 found-flag + 65 dest). Length is
          // the body length ONLY — the 1-byte type is NOT counted.
          const bodyLen = 2 + innerPayload.length;
          const reply = Buffer.alloc(4 + 1 + bodyLen);
          reply.writeUInt32BE(bodyLen, 0);
          reply.writeUInt8(35, 4); // I2CP_MSG.DEST_REPLY
          reply.writeUInt16BE(sid, 5);
          innerPayload.copy(reply, 7);
          setImmediate(() => s.emit('data', reply));
        }
      }
      return true;
    });
    s.destroy = vi.fn(() => {
      s.destroyed = true;
      setImmediate(() => s.emit('close'));
      return s;
    });
    s.end = vi.fn();
    s.destroyed = false;
    return s;
  };
  return {
    connect: vi.fn((_port: number, _host: string) => {
      const s = makeFakeSocket();
      // Synthesize SessionStatus=Created on 'connect' (see
      // i2cp-socket-manager.test.ts for full wire-format explanation).
      // Wire format MUST match `decodeMessage`:
      //   [4-byte length BE][1-byte type=20][2-byte sessionId BE][4-byte status BE]
      // Java I2P historically sends 1-byte sessionId; the production
      // handler accepts both, but tests use the 2-byte form (the form
      // that `decodeMessage` decodes generically).
      const sid = sessionIdCounter++;
      const innerPayload = Buffer.alloc(4);
      innerPayload.writeUInt32BE(1, 0); // status = Created
      // body = 2-byte sid + innerPayload (4-byte status). Per I2CP spec the
      // 4-byte length prefix counts ONLY the body bytes — the 1-byte type
      // is NOT included (Java's I2CPMessageImpl.writeMessage is authoritative).
      const bodyLen = 2 + innerPayload.length;
      const frame = Buffer.alloc(4 + 1 + bodyLen);
      frame.writeUInt32BE(bodyLen, 0);
      frame.writeUInt8(20, 4); // I2CP_MSG.SESSION_STATUS
      frame.writeUInt16BE(sid, 5);
      innerPayload.copy(frame, 7);
      setImmediate(() => {
        s.emit('connect');
        setImmediate(() => s.emit('data', frame));
      });
      return s;
    }),
    Socket: vi.fn(() => makeFakeSocket()),
  };
});

// Typed reset helper for the singleton — test-only access. Avoids `as any` in
// test bodies per the brief constraint of no untyped escapes.
function resetSingleton(): void {
  // @ts-expect-error - test-only access to private static
  I2PPlugin.instance = null;
}

describe('I2PPlugin bootstrap race (brief)', () => {
  beforeEach(() => {
    resetSingleton();
  });

  it('buffers events fired before listener registration', () => {
    const plugin = I2PPlugin.getInstance();
    // Simulate events fired before any listener attaches.
    plugin.simulateEmit('i2pStatus', { connected: true });
    plugin.simulateEmit('i2pMessage', { streamId: 1, data: 'early' });

    const messages: Array<{ streamId: number; data: string }> = [];
    plugin.onI2pMessage((ev) => messages.push(ev));

    // After listener registers, the buffer should be drained in FIFO order.
    expect(messages).toHaveLength(1);
    expect(messages[0]?.data).toBe('early');
  });

  it('FIFO-evicts at 64 entries', () => {
    const plugin = I2PPlugin.getInstance();
    for (let i = 0; i < 70; i++) {
      plugin.simulateEmit('i2pMessage', { streamId: i, data: `msg-${i}` });
    }
    const messages: Array<{ streamId: number; data: string }> = [];
    plugin.onI2pMessage((ev) => messages.push(ev));
    // Should have drained the last 64 (i=6 through i=69).
    expect(messages).toHaveLength(64);
    expect(messages[0]?.data).toBe('msg-6');
    expect(messages[63]?.data).toBe('msg-69');
  });
});

describe('I2PPlugin bootstrap race (defensive)', () => {
  beforeEach(() => {
    resetSingleton();
  });

  it('drains buffer for all four event types in FIFO order', () => {
    const plugin = I2PPlugin.getInstance();
    // Pre-buffer 1 of each event type.
    plugin.simulateEmit('i2pStatus', { connected: true, b32Address: 'pre-b32' });
    plugin.simulateEmit('i2pMessage', { streamId: 7, data: 'pre-msg' });
    plugin.simulateEmit('i2pStreamConnected', { streamId: 7, peerDestination: 'peer-a' });
    plugin.simulateEmit('i2pStreamClosed', { streamId: 7, reason: 'peer-disconnected' });

    // Register listeners in reverse order — drain should still emit them
    // in original FIFO order (the buffer is a single shared queue).
    const statuses: Array<{ connected: boolean }> = [];
    const messages: Array<{ streamId: number; data: string }> = [];
    const connected: Array<{ streamId: number; peerDestination: string }> = [];
    const closed: Array<{ streamId: number; reason: string }> = [];

    plugin.onI2pStreamClosed((ev) => closed.push(ev));
    plugin.onI2pStreamConnected((ev) => connected.push(ev));
    plugin.onI2pMessage((ev) => messages.push(ev));
    plugin.onI2pStatus((ev) => statuses.push(ev));

    expect(statuses).toEqual([{ connected: true, b32Address: 'pre-b32' }]);
    expect(messages).toEqual([{ streamId: 7, data: 'pre-msg' }]);
    expect(connected).toEqual([{ streamId: 7, peerDestination: 'peer-a' }]);
    expect(closed).toEqual([{ streamId: 7, reason: 'peer-disconnected' }]);
  });

  it('does not replay already-drained events on second subscription', () => {
    const plugin = I2PPlugin.getInstance();
    plugin.simulateEmit('i2pMessage', { streamId: 1, data: 'once' });

    const first: Array<{ streamId: number; data: string }> = [];
    const unsubscribe = plugin.onI2pMessage((ev) => first.push(ev));
    expect(first).toHaveLength(1);

    // Unsubscribe then re-subscribe: a fresh listener must NOT see history.
    unsubscribe();
    const second: Array<{ streamId: number; data: string }> = [];
    plugin.onI2pMessage((ev) => second.push(ev));
    expect(second).toHaveLength(0);
  });

  it('two listeners on the same event both fire (broadcast)', () => {
    const plugin = I2PPlugin.getInstance();

    // Both listeners attach BEFORE the event fires — broadcast is for
    // live events, not history replay. With "first listener drains history,
    // subsequent listeners subscribe to live events", `a` is the prime
    // listener and `b` joins later; both still receive the live event.
    const a: string[] = [];
    const b: string[] = [];
    plugin.onI2pMessage((ev) => a.push(ev.data));
    plugin.onI2pMessage((ev) => b.push(ev.data));

    plugin.simulateEmit('i2pMessage', { streamId: 1, data: 'hello' });

    expect(a).toEqual(['hello']);
    expect(b).toEqual(['hello']);
  });

  it('unsubscribe function removes the listener', () => {
    const plugin = I2PPlugin.getInstance();

    const received: string[] = [];
    const unsubscribe = plugin.onI2pMessage((ev) => received.push(ev.data));

    plugin.simulateEmit('i2pMessage', { streamId: 1, data: 'before' });
    expect(received).toEqual(['before']);

    unsubscribe();

    plugin.simulateEmit('i2pMessage', { streamId: 2, data: 'after' });
    expect(received).toEqual(['before']);  // 'after' never delivered
  });

  it('buffer and listener fire simultaneously (live event reaches both)', () => {
    const plugin = I2PPlugin.getInstance();

    // Register listener first so live events go directly to it.
    const live: string[] = [];
    plugin.onI2pMessage((ev) => live.push(ev.data));

    // Now emit — this both fires the listener AND would buffer if a future
    // subscriber appeared. The buffer should accumulate past events only.
    plugin.simulateEmit('i2pMessage', { streamId: 1, data: 'live' });
    expect(live).toEqual(['live']);

    // A second subscriber should NOT see the past event (it was already
    // delivered live and is no longer in the buffer).
    const second: string[] = [];
    plugin.onI2pMessage((ev) => second.push(ev.data));
    expect(second).toEqual([]);
  });
});

describe('I2PPlugin lifecycle (defensive)', () => {
  beforeEach(() => {
    resetSingleton();
  });

  it('getInstance returns the same singleton across calls', () => {
    const a = I2PPlugin.getInstance();
    const b = I2PPlugin.getInstance();
    expect(a).toBe(b);
  });

  it('send() before start() throws "not started"', async () => {
    const plugin = I2PPlugin.getInstance();
    await expect(plugin.send({ streamId: 1, data: 'hi' })).rejects.toThrow(/not started/);
  });

  it('connectTo() before start() throws "not started"', async () => {
    const plugin = I2PPlugin.getInstance();
    await expect(plugin.connectTo({ destination: 'a'.repeat(52) })).rejects.toThrow(/not started/);
  });

  it('close() before start() throws "not started"', async () => {
    const plugin = I2PPlugin.getInstance();
    await expect(plugin.close({ streamId: 1 })).rejects.toThrow(/not started/);
  });

  it('getB32Address() before start() throws "not started"', async () => {
    const plugin = I2PPlugin.getInstance();
    await expect(plugin.getB32Address()).rejects.toThrow(/not started/);
  });

  it('start() returns the b32Address from I2CPSocketManager', async () => {
    const plugin = I2PPlugin.getInstance();
    // Plant a 128-byte IdentityEx blob so `start()` reuses it instead
    // of generating a fresh one. Task 5 spec: 2-key Ed25519.
    const privKey = makeTestPrivKey();
    const store = plugin['identityStore'];
    await store.save(privKey);

    const { b32Address } = await plugin.start({ host: '127.0.0.1', port: 7654 });
    expect(typeof b32Address).toBe('string');
    expect(b32Address.length).toBeGreaterThan(0);
  });

  /**
   * Phase-2 helper: the I2CP handshake is asynchronous (we wait for the
   * router's SessionStatus=Created frame). The mock synthesizes that
   * frame in a setImmediate; callers that need the socket ready before
   * exercising connectTo/send/close must await this first.
   */
  async function waitForSessionReady(): Promise<void> {
    for (let i = 0; i < 50; i++) {
      const sm = I2PPlugin.getInstance()['socketManager'];
      if (sm && (sm as unknown as { isSessionReady: () => boolean }).isSessionReady()) return;
      await new Promise<void>((r) => setTimeout(r, 20));
    }
  }

  it('send() after start() forwards to socketManager.send without appending \\n', async () => {
    const plugin = I2PPlugin.getInstance();
    const privKey = makeTestPrivKey();
    const store = plugin['identityStore'];
    await store.save(privKey);
    await plugin.start({ host: '127.0.0.1', port: 7654 });
    await waitForSessionReady();

    const { streamId } = await plugin.connectTo({ destination: 'b'.repeat(52) });
    const socketManager = plugin['socketManager']!;
    // Cast through unknown to satisfy vitest's spy type — `I2CPSocketManager`
    // exposes a private member shape we don't want to widen in production
    // types just for tests.
    const sendSpy = vi.spyOn(socketManager as unknown as { send: (...a: unknown[]) => Promise<void> }, 'send');

    await plugin.send({ streamId, data: 'hello' });
    // I2PPlugin must NOT append `\n` itself — I2PSocketHandle.send appends it.
    expect(sendSpy).toHaveBeenCalledWith(streamId, Buffer.from('hello', 'utf-8'));
    sendSpy.mockRestore();
  });

  it('connectTo() emits i2pStreamConnected', async () => {
    const plugin = I2PPlugin.getInstance();
    const privKey = makeTestPrivKey();
    const store = plugin['identityStore'];
    await store.save(privKey);
    await plugin.start({ host: '127.0.0.1', port: 7654 });
    await waitForSessionReady();

    const connected: Array<{ streamId: number; peerDestination: string }> = [];
    plugin.onI2pStreamConnected((ev) => connected.push(ev));

    const dest = 'c'.repeat(52);
    await plugin.connectTo({ destination: dest });

    expect(connected).toHaveLength(1);
    expect(connected[0]?.peerDestination).toBe(dest);
  });

  it('probeI2pOnce() returns a result without throwing when port is closed', async () => {
    // Port 7654 is not listening in this test environment — we only assert
    // that the call resolves (true OR false), not the exact boolean, since
    // a developer machine could have an I2P router running. The retry
    // loop on top of this method is exercised separately below; calling
    // probeI2pOnce() directly keeps this test fast (~2s, not 55s).
    const plugin = I2PPlugin.getInstance();
    const result = await plugin['probeI2pOnce']();
    expect(typeof result.available).toBe('boolean');
  });

  it('isI2pAvailable() retries with backoff and resolves false when router never comes up', async () => {
    // Use fake timers so the ~55s retry schedule does not actually delay
    // the suite. We stub probeI2pOnce to always fail and assert that the
    // retry loop runs the configured number of attempts before resolving.
    vi.useFakeTimers();
    const plugin = I2PPlugin.getInstance();
    const probeSpy = vi
      .spyOn(plugin as unknown as { probeI2pOnce: () => Promise<{ available: boolean }> }, 'probeI2pOnce')
      .mockResolvedValue({ available: false });

    const promise = plugin.isI2pAvailable();
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.available).toBe(false);
    expect(probeSpy).toHaveBeenCalledTimes(5); // matches I2P_AVAILABILITY_RETRY_DELAYS_MS length

    probeSpy.mockRestore();
    vi.useRealTimers();
  });

  it('isI2pAvailable() resolves true on the first probe when router is already up', async () => {
    vi.useFakeTimers();
    const plugin = I2PPlugin.getInstance();
    const probeSpy = vi
      .spyOn(plugin as unknown as { probeI2pOnce: () => Promise<{ available: boolean }> }, 'probeI2pOnce')
      .mockResolvedValueOnce({ available: true });

    const promise = plugin.isI2pAvailable();
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.available).toBe(true);
    expect(probeSpy).toHaveBeenCalledTimes(1);

    probeSpy.mockRestore();
    vi.useRealTimers();
  });
});

describe('I2PPlugin.generateNewPrivKey (Task 7 wiring)', () => {
  beforeEach(() => {
    resetSingleton();
  });

  it('start() with no pre-existing identity generates and persists a 128-byte Ed25519 privKey (2-key: encryption + signing)', async () => {
    const plugin = I2PPlugin.getInstance();
    const store = plugin['identityStore'];

    // Wipe the on-disk identity so we test the "no pre-existing identity"
    // path. Other tests in this file share the same tmpdir-backed store
    // and may have left a file behind.
    try {
      await fs.unlink(join(tmpdir(), 'i2p_identity.bin'));
    } catch {
      // file wasn't there — that's the precondition we want
    }
    expect(await store.loadOrNull()).toBeNull();

    // After start(), the store must contain a freshly generated 128-byte
    // privKey blob (Task 5 spec — 2-key Ed25519 with encryption + signing).
    await plugin.start({ host: '127.0.0.1', port: 7654 });
    const persisted = await store.loadOrNull();
    expect(persisted).not.toBeNull();
    expect(persisted?.length).toBe(128);

    // The persisted bytes must round-trip through computeB32FromPrivKey
    // and produce a valid [.b32.i2p] address.
    const { computeB32FromPrivKey } = await import('./destination-gen');
    const b32 = await computeB32FromPrivKey(persisted!);
    expect(b32).toMatch(/^[a-z2-7]{52}\.b32\.i2p$/);
  });

  it('start() with a pre-existing identity does NOT regenerate (existing path preserved)', async () => {
    const plugin = I2PPlugin.getInstance();
    const store = plugin['identityStore'];

    // Plant a known 128-byte IdentityEx blob. Use a non-zero byte
    // pattern so we can detect any accidental re-generation.
    const fingerprint = makeTestPrivKey(7);
    await store.save(fingerprint);

    await plugin.start({ host: '127.0.0.1', port: 7654 });
    const persisted = await store.loadOrNull();
    expect(persisted).toEqual(fingerprint);
  });
});