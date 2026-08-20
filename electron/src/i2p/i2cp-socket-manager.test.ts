import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { I2CPSocketManager } from './i2cp-socket-manager';
import * as net from 'node:net';

/**
 * Synthesize a router→client GET_DATE reply frame.
 *
 * Wire format (per I2CP spec, post-2c24bb9):
 *   [4-byte length BE = 9][1-byte type=32][8-byte Date BE — ms since epoch]
 *
 * The frame is 13 bytes total. `readMessageFromSocket` will pass it to
 * `decodeMessage`, which peels off the type byte and (if body ≥ 2 bytes)
 * reads a 2-byte sessionId; GET_DATE replies have no sessionId, so the
 * decoder will treat the first 2 bytes of the date as the sessionId and
 * the remaining 6 bytes as the payload. For unit testing the
 * `syncRouterClock` listener (which reads the raw frame), this is fine
 * because it parses directly via `chunk[4]` and `chunk.readBigUInt64BE(5)`.
 */
function synthesizeGetDateReply(routerMs: number): Buffer {
  const frame = Buffer.alloc(4 + 1 + 8);
  frame.writeUInt32BE(9, 0);                      // length = 9
  frame.writeUInt8(32, 4);                        // I2CP_MSG.GET_DATE
  frame.writeBigUInt64BE(BigInt(routerMs), 5);    // 8-byte BE ms since epoch
  return frame;
}

// Mock node:net so the TCP connect in initialize() resolves without a real
// I2P router. The real `net.Socket` inherits from EventEmitter and exposes
// `write/destroy/end/destroyed` — we mirror that shape so I2CPSocketManager
// can interact with it as if it were a connected socket.
//
// Phase-2 (2026-08-18): the mock synthesizes the SessionStatus=1 (Created)
// reply on 'connect' so the I2CPSocketManager reaches `sessionReady=true`
// synchronously, which is the precondition the downstream connectTo /
// send / close tests need.
//
// Task 7 (2026-08-19): the mock also synthesizes a GET_DATE reply
// (type=32) on every outbound GET_DATE write so `syncRouterClock()`
// resolves within microseconds instead of waiting for the 15 s production
// timeout. Without this, every `getOrCreate()` call would block for 15 s
// and the test suite would not finish.
vi.mock('node:net', () => {
  let sessionIdCounter = 1;
  // Test-controlled "router" clock. Tests can override this to drive
  // specific clock-skew scenarios through the GET_DATE path. Defaults
  // to local time so the offset stays at 0 in the common case.
  let routerMs = Date.now();
  const makeFakeSocket = () => {
    const s = new EventEmitter() as EventEmitter & {
      write: ReturnType<typeof vi.fn>;
      destroy: ReturnType<typeof vi.fn>;
      end: ReturnType<typeof vi.fn>;
      destroyed: boolean;
    };
    s.write = vi.fn((chunk: Buffer) => {
      // Intercept outbound I2CP frames so we can synthesize matching
      // router replies. Frame layout:
      //   [4-byte len BE][1-byte type][2-byte sessionId BE][payload]
      // We react to:
      //   - GET_DATE (type 32)  → synthesize GET_DATE reply
      //   - DEST_LOOKUP (34)    → synthesize DEST_REPLY (placeholder)
      if (chunk && chunk.length >= 5) {
        const type = chunk.readUInt8(4);
        if (type === 32 /* GET_DATE */) {
          setImmediate(() => s.emit('data', synthesizeGetDateReply(routerMs)));
        } else if (type === 34 /* DestLookup */) {
          const sid = chunk.length >= 7 ? chunk.readUInt16BE(5) : 0;
          // Build DestReply: [2-byte sid][4-byte found=1][65-byte dest]
          const destBlob = Buffer.alloc(65, 0x42); // arbitrary placeholder
          const innerPayload = Buffer.alloc(4 + 65);
          innerPayload.writeUInt32BE(1, 0); // found = 1
          destBlob.copy(innerPayload, 4);
          const innerLen = 1 + 2 + innerPayload.length;
          const reply = Buffer.alloc(4 + innerLen);
          reply.writeUInt32BE(innerLen, 0);
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
      // Match Node's behavior: destroy() emits 'close' asynchronously.
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
      // Synthesize the SessionStatus=Created reply (router→client) on
      // 'connect' so the I2CPSocketManager reaches `sessionReady=true`
      // synchronously after getOrCreate resolves.
      //
      // Wire format MUST match `decodeMessage`:
      //   [4-byte length BE][1-byte type=20][2-byte sessionId BE][payload]
      // The sessionId lives in the BODY (not the header). The payload
      // for SessionStatus is a 4-byte status int (Created = 1).
      //
      // Note: Java I2P historically sends only 1-byte sessionId; the
      // production handler accepts both layouts. Here we send the
      // 2-byte form because that's what `decodeMessage` decodes
      // generically — tests must match the generic decoder.
      const sid = sessionIdCounter++;
      const innerPayload = Buffer.alloc(4);
      innerPayload.writeUInt32BE(1, 0); // status = Created
      const innerLen = 1 + 2 + innerPayload.length; // type + sid + payload
      const frame = Buffer.alloc(4 + innerLen);
      frame.writeUInt32BE(innerLen, 0);
      frame.writeUInt8(20, 4); // I2CP_MSG.SESSION_STATUS
      frame.writeUInt16BE(sid, 5);
      innerPayload.copy(frame, 7);
      setImmediate(() => {
        s.emit('connect');
        // Emit the SessionStatus=Created AFTER 'connect' so the I2CP
        // layer's `readMessageFromSocket` listener is already attached
        // (it's registered right after the connect-await resolves).
        setImmediate(() => s.emit('data', frame));
      });
      return s;
    }),
    // `new net.Socket()` is used in `connectTo()` / `acceptIncoming()`
    // placeholder branches. Provide a no-op factory that returns an
    // EventEmitter-shaped placeholder.
    Socket: vi.fn(() => makeFakeSocket()),
    /**
     * Test-only knob: advance the simulated router clock so the next
     * GET_DATE write returns a frame carrying `ms`. Used by the
     * "syncs routerDateOffsetMs from GET_DATE reply" case to verify
     * the offset is computed as `routerMs - Date.now()`.
     */
    __setRouterClock: (ms: number) => {
      routerMs = ms;
    },
  };
});

// Typed reset helper — avoid `as any` in tests.
function resetSingleton(): void {
  // @ts-expect-error - test-only access to private static
  I2CPSocketManager.instance = null;
}

/**
 * Build a 128-byte IdentityEx privKey blob (Task 5 / spec-2c24bb9 layout):
 *   bytes  0..32 = encPriv  (Ed25519 encryption private)
 *   bytes 32..64 = encPub   (Ed25519 encryption public)
 *   bytes 64..96 = signPriv (Ed25519 signing private)
 *   bytes 96..128 = signPub  (Ed25519 signing public)
 *
 * Tests only care about the B32 derivation and the IdentityEx parsing —
 * the bytes do not have to be on the Ed25519 curve because nothing
 * exercises the underlying crypto. We use a deterministic non-zero
 * pattern so accidental all-zero buffers are easy to spot.
 */
function makeTestPrivKey(seed = 7): Uint8Array {
  const blob = new Uint8Array(128);
  for (let i = 0; i < 128; i++) blob[i] = (i * seed + 1) & 0xff;
  return blob;
}

const baseOpts = () => ({
  host: '127.0.0.1',
  port: 7654,
  privKey: makeTestPrivKey(),
  nickname: 'test',
});

/**
 * Phase-2 helper: the I2CP handshake is now asynchronous (we wait for
 * the router's SessionStatus=Created frame). The mock synthesizes that
 * frame in a setImmediate, so callers that need `sessionReady=true`
 * before exercising connectTo/send/close must await this helper first.
 *
 * Hoisted to module scope so the new Task 7 GET_DATE describe block
 * can reuse it (it was previously nested inside the "(defensive)"
 * describe and therefore not accessible to sibling describes).
 */
async function waitForSessionReady(m: I2CPSocketManager): Promise<void> {
  // The mock fires the SessionStatus frame on the second setImmediate
  // after `connect()` returns. Two microtask flushes are enough in
  // practice; if not, we fall back to a 1 s polling loop.
  for (let i = 0; i < 50; i++) {
    if (m.isSessionReady()) return;
    await new Promise<void>((r) => setTimeout(r, 20));
  }
}

describe('I2CPSocketManager (brief)', () => {
  beforeEach(() => {
    resetSingleton();
  });

  it('requireDestination throws on null/empty', () => {
    expect(() => I2CPSocketManager.requireDestination('')).toThrow();
    expect(() => I2CPSocketManager.requireDestination(null as unknown as string)).toThrow();
  });

  it('getInstance returns null before getOrCreate', () => {
    expect(I2CPSocketManager.getInstance()).toBeNull();
  });

  it('getOrCreate returns same instance on second call', async () => {
    const m1 = await I2CPSocketManager.getOrCreate(baseOpts());
    const m2 = await I2CPSocketManager.getOrCreate(baseOpts());
    expect(m1).toBe(m2);
  });
});

describe('I2CPSocketManager (defensive)', () => {
  beforeEach(() => {
    resetSingleton();
  });

  it('connectTo increments streamIdCounter and registers a stream', async () => {
    const m = await I2CPSocketManager.getOrCreate(baseOpts());
    await waitForSessionReady(m);
    const id1 = await m.connectTo('a'.repeat(52));
    const id2 = await m.connectTo('b'.repeat(52));
    // Monotonically increasing (1 first because streamIdCounter starts at 1).
    expect(id1).toBe(1);
    expect(id2).toBe(2);
    expect(id2).toBeGreaterThan(id1);
    expect(m.getStream(id1)?.peerDestination).toBe('a'.repeat(52));
    expect(m.getStream(id2)?.peerDestination).toBe('b'.repeat(52));
  });

  it('connectTo with empty/null throws (instance-level validator enforced)', async () => {
    const m = await I2CPSocketManager.getOrCreate(baseOpts());
    await expect(m.connectTo('')).rejects.toThrow(/destination/i);
    await expect(
      m.connectTo(null as unknown as string),
    ).rejects.toThrow(/destination/i);
  });

  it('acceptIncoming registers an incoming stream', async () => {
    const m = await I2CPSocketManager.getOrCreate(baseOpts());
    await waitForSessionReady(m);
    const id = await m.acceptIncoming();
    const stream = m.getStream(id);
    expect(stream).toBeDefined();
    expect(stream?.peerDestination).toBe('unknown-peer');
    expect(stream?.isClosed()).toBe(false); // isClosed is false until close() runs
  });

  it('send to unknown streamId throws', async () => {
    const m = await I2CPSocketManager.getOrCreate(baseOpts());
    await expect(m.send(999, new Uint8Array([1, 2, 3]))).rejects.toThrow(/not found/);
  });

  it('close of unknown streamId throws', async () => {
    const m = await I2CPSocketManager.getOrCreate(baseOpts());
    await expect(m.close(999, 'no-such-stream')).rejects.toThrow(/not found/);
  });

  it('close removes stream from registry', async () => {
    const m = await I2CPSocketManager.getOrCreate(baseOpts());
    await waitForSessionReady(m);
    const id = await m.connectTo('a'.repeat(52));
    expect(m.getStream(id)).toBeDefined();
    await m.close(id, 'user');
    expect(m.getStream(id)).toBeUndefined();
  });

  it('disconnect is idempotent', async () => {
    const m = await I2CPSocketManager.getOrCreate(baseOpts());
    await waitForSessionReady(m);
    await m.connectTo('a'.repeat(52));
    expect(m.isConnected()).toBe(true);

    await m.disconnect();
    expect(m.isConnected()).toBe(false);
    expect(I2CPSocketManager.getInstance()).toBeNull();

    // Second disconnect is a no-op (instance is null now, but calling on the
    // saved reference should also be safe).
    await m.disconnect(); // should not throw
    expect(m.isConnected()).toBe(false);
  });

  it('getOrCreate after disconnect returns a fresh instance (singleton reset works)', async () => {
    const m1 = await I2CPSocketManager.getOrCreate(baseOpts());
    await waitForSessionReady(m1);
    await m1.disconnect();
    expect(I2CPSocketManager.getInstance()).toBeNull();

    const m2 = await I2CPSocketManager.getOrCreate(baseOpts());
    await waitForSessionReady(m2);
    expect(m2).not.toBe(m1);
    expect(I2CPSocketManager.getInstance()).toBe(m2);

    // Fresh instance must start streamIdCounter at 1 again (no carry-over).
    const id = await m2.connectTo('a'.repeat(52));
    expect(id).toBe(1);
  });

  it('isConnected reflects socket state', async () => {
    const m = await I2CPSocketManager.getOrCreate(baseOpts());
    await waitForSessionReady(m);
    expect(m.isConnected()).toBe(true);
    await m.disconnect();
    expect(m.isConnected()).toBe(false);
  });
});

describe('I2CPSocketManager GET_DATE clock sync (Task 7)', () => {
  beforeEach(() => {
    resetSingleton();
    // Reset the simulated router clock to local time so the default
    // offset stays at 0 between cases.
    (net as unknown as { __setRouterClock: (ms: number) => void }).__setRouterClock(Date.now());
  });

  it('syncs routerDateOffsetMs from GET_DATE reply (mock injects reply on outbound GET_DATE)', async () => {
    // Drive the simulated router 1234 ms ahead of local time so the
    // computed offset must equal +1234 (give or take a few ms of
    // jitter between Date.now() samples).
    const routerMs = Date.now() + 1234;
    (net as unknown as { __setRouterClock: (ms: number) => void }).__setRouterClock(routerMs);

    const m = await I2CPSocketManager.getOrCreate(baseOpts());
    // Allow the GET_DATE listener + reply round-trip to complete.
    await waitForSessionReady(m);

    // Tolerate a 100 ms jitter window — `syncRouterClock` computes
    // `routerMs - Date.now()` at reply-arrival time, and the local
    // clock keeps ticking between the two Date.now() reads.
    const offset = (m as unknown as { routerDateOffsetMs: number }).routerDateOffsetMs;
    expect(offset).toBeGreaterThanOrEqual(1234 - 100);
    expect(offset).toBeLessThanOrEqual(1234 + 100);
  });

  it('handleIncomingMessage defensive GET_DATE path updates routerDateOffsetMs on later frames', async () => {
    // The mock's outbound GET_DATE handler covers the initial
    // syncRouterClock() round-trip. The 30-minute background refresh
    // would re-trigger that path, but the unref'd setInterval never
    // fires in vitest. To exercise the second code path — the
    // defensive GET_DATE branch in handleIncomingMessage — we have
    // to push a GET_DATE frame directly into the socket.
    //
    // The generic `decodeMessage` strips the first 2 bytes of the
    // body as a sessionId, so to deliver a full 8-byte Date payload
    // to `handleIncomingMessage` we must pad the body to 10 bytes
    // (2 bytes of "sessionId" + 8 bytes of Date). Any value works
    // for the 2-byte prefix because the defensive branch ignores
    // msg.sessionId entirely.
    const m = await I2CPSocketManager.getOrCreate(baseOpts());
    await waitForSessionReady(m);

    const sock = (m as unknown as { socket: { emit: (ev: string, data: Buffer) => boolean } }).socket;
    const newOffset = -9999;
    const routerMs = Date.now() + newOffset;

    // Build: [4-byte len=11][1-byte type=32][2-byte fake sid][8-byte date BE]
    const frame = Buffer.alloc(4 + 1 + 2 + 8);
    frame.writeUInt32BE(11, 0);                    // length = 11 (1 + 2 + 8)
    frame.writeUInt8(32, 4);                      // I2CP_MSG.GET_DATE
    frame.writeUInt16BE(0, 5);                    // fake sessionId (ignored)
    frame.writeBigUInt64BE(BigInt(routerMs), 7);  // 8-byte BE ms since epoch
    sock.emit('data', frame);
    await new Promise<void>((r) => setImmediate(r));

    const offset = (m as unknown as { routerDateOffsetMs: number }).routerDateOffsetMs;
    expect(offset).toBeGreaterThanOrEqual(newOffset - 100);
    expect(offset).toBeLessThanOrEqual(newOffset + 100);
  });
});
