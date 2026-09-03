import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { I2CPSocketManager } from './i2cp-socket-manager';
import * as net from 'node:net';
import { IdentityEx } from './i2cp-identity';
import { encodeMapping } from './i2cp-protobuf';
import { I2CP_MSG, encodeMessage } from './i2cp-protocol';

/**
 * Synthesize a router→client GET_DATE reply frame.
 *
 * Wire format (per I2CP spec, post-2c24bb9):
 *   [4-byte length BE = 8 (body length)][1-byte type=32][8-byte Date BE — ms since epoch]
 *
 * The frame is 13 bytes total. The 4-byte length is the BODY length (doWriteMessage
 * result), NOT including the 1-byte type. `readMessageFromSocket` will pass it to
 * `decodeMessage`, which peels off the type byte and (if body ≥ 2 bytes)
 * reads a 2-byte sessionId; GET_DATE replies have no sessionId, so the
 * decoder will treat the first 2 bytes of the date as the sessionId and
 * the remaining 6 bytes as the payload. For unit testing the
 * `syncRouterClock` listener (which reads the raw frame), this is fine
 * because it parses directly via `chunk[4]` and `chunk.readBigUInt64BE(5)`.
 */
function synthesizeGetDateReply(routerMs: number): Buffer {
  const frame = Buffer.alloc(4 + 1 + 8);
  frame.writeUInt32BE(8, 0);                      // length = 8 body bytes (date only, NO type)
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
          // body = sid(2) + innerPayload; length = body.length, NOT including the 1-byte type
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
      //   [4-byte length BE = bodyLen][1-byte type=20][2-byte sessionId BE][payload]
      // The length is the BODY length (does NOT include the 1-byte type).
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
      const bodyLen = 2 + innerPayload.length; // sid + payload (NO type byte)
      const frame = Buffer.alloc(4 + 1 + bodyLen);
      frame.writeUInt32BE(bodyLen, 0);
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

    // Build: [4-byte len=8][1-byte type=32][8-byte date BE]
    // GET_DATE is in SID_LESS_TYPES (per I2CP spec, no per-session routing id),
    // so the decoder does NOT strip any leading 2 bytes as a sessionId — the
    // body is just the 8-byte Date BE. length = 8 (body only, NO type).
    const frame = Buffer.alloc(4 + 1 + 8);
    frame.writeUInt32BE(8, 0);                     // length = 8 (body only, NO type)
    frame.writeUInt8(32, 4);                      // I2CP_MSG.GET_DATE
    frame.writeBigUInt64BE(BigInt(routerMs), 5);  // 8-byte BE ms since epoch
    sock.emit('data', frame);
    await new Promise<void>((r) => setImmediate(r));

    const offset = (m as unknown as { routerDateOffsetMs: number }).routerDateOffsetMs;
    expect(offset).toBeGreaterThanOrEqual(newOffset - 100);
    expect(offset).toBeLessThanOrEqual(newOffset + 100);
  });
});

/**
 * I2CP wire-protocol hello byte — the very first byte sent after TCP-connect
 * MUST be a single 0x2A (42). Both Java-I2P's ClientListenerRunner.validate()
 * and i2pd's I2CP.cpp::ReadProtocolByte() reject the connection with FIN if
 * the first byte is anything else. This was the root-cause of the "smoke
 * test connects to 127.0.0.1:7654 but receives 0 frames" symptom that
 * PR #209 (spec-compliance) could not catch via mocks alone.
 */
describe('I2CPSocketManager I2CP hello byte (0x2A)', () => {
  beforeEach(() => {
    resetSingleton();
  });

  it('writes a single 0x2A byte as the very first chunk on the TCP socket', async () => {
    // The mock factory `vi.mock('node:net', ...)` returns the fake socket
    // from `vi.mocked(net.connect).mock.results[i].value`. Grab it after
    // `getOrCreate` returns and inspect the FIRST write call.
    await I2CPSocketManager.getOrCreate(baseOpts());
    // The connect mock has been called exactly once by now; its first
    // result is the fake socket we want to introspect.
    const sock = vi.mocked(net.connect).mock.results.at(-1)?.value as
      | {
          write: { mock: { calls: Array<[Buffer]> } };
        }
      | undefined;
    expect(sock).toBeDefined();
    const firstWrite = sock!.write.mock.calls[0]?.[0];
    expect(firstWrite).toBeDefined();
    // Node.js net.Socket.write accepts string | Buffer | Uint8Array; we
    // emit a Buffer and the runtime accepts it as a Uint8Array view.
    expect(Buffer.isBuffer(firstWrite)).toBe(true);
    const first = firstWrite as Buffer;
    // MUST be exactly 1 byte, value 0x2A. No 4-byte length prefix — this
    // byte is OUTSIDE the framed I2CP wire format.
    expect(first.length).toBe(1);
    expect(first[0]).toBe(0x2a);
  });

  it('hello byte precedes any framed I2CP messages (GET_DATE / CreateSession)', async () => {
    await I2CPSocketManager.getOrCreate(baseOpts());
    const sock = vi.mocked(net.connect).mock.results.at(-1)?.value as
      | {
          write: { mock: { calls: Array<[Buffer]> } };
        }
      | undefined;
    expect(sock).toBeDefined();
    const writes = sock!.write.mock.calls.map((c) => c[0] as Buffer);
    expect(writes.length).toBeGreaterThan(1); // hello + GET_DATE + CreateSession
    // Hello byte is ALWAYS the first write.
    expect(writes[0].length).toBe(1);
    expect(writes[0][0]).toBe(0x2a);
    // Subsequent writes are framed I2CP messages (start with 4-byte length).
    for (let i = 1; i < writes.length; i++) {
      expect(writes[i].length).toBeGreaterThanOrEqual(5);
      // Framed messages have a length prefix at byte 0..3 — hello byte
      // alone would be misinterpreted as a "length = 0x2A = 42" frame
      // with 38 trailing payload bytes if it were accidentally emitted
      // inside the I2CP layer. By sending it as the raw first byte on
      // the TCP socket, we sidestep the framing entirely.
      expect(writes[i].length).toBeGreaterThanOrEqual(4 + 1);
    }
  });
});

/**
 * SessionStatus body-parsing variants.
 *
 * Java-I2P 0.9.34+ uses a compact 3-byte SessionStatus body:
 *   [2-byte msgId BE][1-byte status]
 * Older routers send 5- or 6-byte variants. The production decoder
 * (`decodeMessage`) strips the 2-byte msgId and passes the remaining
 * payload to `handleIncomingMessage`. The parser must accept ALL three
 * variants so the handshake completes regardless of the router version.
 *
 * These tests override the connect mock to NOT auto-emit a 6-byte
 * SessionStatus=Created, then emit a synthesised SessionStatus frame in
 * the desired variant. This gives the parser a clean run — the i2cpSessionId
 * state at the end reflects only the test-controlled frame.
 */
describe('I2CPSocketManager SessionStatus body-format variants', () => {
  beforeEach(() => {
    resetSingleton();
  });

  /**
   * Emit a SessionStatus frame on the given socket. The body is the
   * raw bytes that follow the [4-byte length][1-byte type=20] prefix.
   */
  function emitSessionStatusFrame(sock: EventEmitter, bodyBytes: Buffer): void {
    // Per I2CP wire format: [4-byte length BE = bodyLen][1-byte type=20][bodyBytes]
    const frame = Buffer.alloc(4 + 1 + bodyBytes.length);
    frame.writeUInt32BE(bodyBytes.length, 0);
    frame.writeUInt8(20, 4); // I2CP_MSG.SESSION_STATUS
    bodyBytes.copy(frame, 5);
    setImmediate(() => sock.emit('data', frame));
  }

  it('Java-I2P 0.9.34+ compact 3-byte form: [2-byte msgId BE][1-byte status=Created]', async () => {
    // Standard flow: getOrCreate resolves after the mock emits a 6-byte
    // SessionStatus=Created on the connect-time socket. We then emit a
    // 3-byte frame and verify the parser processes it (sessionId updates).
    const m = await I2CPSocketManager.getOrCreate(baseOpts());
    const sock = vi.mocked(net.connect).mock.results.at(-1)?.value as EventEmitter | undefined;
    expect(sock).toBeDefined();

    // Capture the sessionId from the auto-emit so we can verify the
    // custom frame updates it.
    const before = (m as unknown as { i2cpSessionId: number }).i2cpSessionId;

    // Emit a 3-byte SessionStatus: msgId=20900, status=1 (Created).
    // Body layout: [2-byte msgId BE][1-byte status] — the status byte MUST
    // be written at offset 2 (after the 2-byte msgId), NOT at offset 1
    // (which would overwrite the low byte of the msgId and turn 20900
    // into 0x5101 = 20737).
    const msgId = 20900;
    const body = Buffer.alloc(3);
    body.writeUInt16BE(msgId, 0);
    body.writeUInt8(1, 2); // status = Created
    emitSessionStatusFrame(sock!, body);

    // Wait for the parser to process the frame.
    await new Promise<void>((r) => setTimeout(r, 50));
    expect(m.isSessionReady()).toBe(true);
    // sessionId is recovered from the msgId (the router ties them 1:1
    // on CreateSession in Java-I2P 0.9.34+).
    expect((m as unknown as { i2cpSessionId: number }).i2cpSessionId).toBe(msgId);
    expect(msgId).not.toBe(before); // sanity: the value actually changed
  });

  it('legacy 5-byte form: [1-byte sid][4-byte status=Created]', async () => {
    const m = await I2CPSocketManager.getOrCreate(baseOpts());
    const sock = vi.mocked(net.connect).mock.results.at(-1)?.value as EventEmitter | undefined;
    expect(sock).toBeDefined();

    const before = (m as unknown as { i2cpSessionId: number }).i2cpSessionId;

    // Emit a 5-byte SessionStatus: sid=42, status=1 (Created).
    const body = Buffer.alloc(5);
    body.writeUInt8(42, 0);          // sid
    body.writeUInt32BE(1, 1);        // status = Created
    emitSessionStatusFrame(sock!, body);

    await new Promise<void>((r) => setTimeout(r, 50));
    expect(m.isSessionReady()).toBe(true);
    expect((m as unknown as { i2cpSessionId: number }).i2cpSessionId).toBe(42);
    expect(42).not.toBe(before);
  });
});

/**
 * Spec G §5.2 State-Machine-Tests for the 7 LeaseSetState transitions in
 * `I2CPSocketManager`:
 *   - idle → awaiting-router-request (after SESSION_STATUS=Created)
 *   - awaiting-router-request → validating → signing → submitted → published-assumed (happy path)
 *   - awaiting-router-request → failed (after 60s timeout without REQUEST_LEASE_SET)
 *   - parseErrorCount escalation (5 errors → DESTROY_SESSION → state=failed)
 *   - Cleanup after disconnect() (all 3 Timer-Handles null, leaseSetState === 'idle')
 */
describe('I2CPSocketManager LeaseSetState transitions (Task 6 / Spec G §5.2)', () => {
  beforeEach(() => {
    resetSingleton();
    // Reset the simulated router clock between cases so the
    // publishedSeconds time-window check stays deterministic.
    (net as unknown as { __setRouterClock: (ms: number) => void }).__setRouterClock(Date.now());
  });

  afterEach(() => {
    // Safety net: if Test 3 (the only test using fake timers) throws
    // before its try/finally runs, make sure we leave the global timer
    // state clean for the next describe.
    vi.useRealTimers();
  });

  /**
   * Build a LeaseSet2 body (the `payload` portion of a REQUEST_VARIABLE_LEASE_SET
   * message — see i2cp-lease-set-request.ts parseLeaseSetRequest for the inverse).
   * Mirrors the local `makeRequestPayload` helper from
   * i2cp-lease-set-request.test.ts so we don't depend on that file's internals.
   */
  function buildLeaseSet2Body(
    identity: IdentityEx,
    overrides: Partial<{
      publishedSeconds: number;
      expiresSeconds: number;
      leases: Array<{
        tunnelGw: Uint8Array;
        tunnelId: number;
        endDateSeconds: number;
      }>;
    }> = {},
  ): Buffer {
    const publishedSeconds = overrides.publishedSeconds ?? 1_700_000_000;
    const expiresSeconds = overrides.expiresSeconds ?? 600;
    const leases = overrides.leases ?? [
      {
        tunnelGw: new Uint8Array(32).fill(0xab),
        tunnelId: 0x11223344,
        endDateSeconds: publishedSeconds + 600,
      },
    ];
    const options = encodeMapping(new Map([['i2cp.leaseSetType', '3']]));
    const parts: Buffer[] = [
      Buffer.from([3]), // storeType = 3 (LeaseSet2)
      identity.toByteArray(),
    ];
    const published = Buffer.alloc(4);
    published.writeUInt32BE(publishedSeconds, 0);
    parts.push(published);
    const expires = Buffer.alloc(2);
    expires.writeUInt16BE(expiresSeconds, 0);
    parts.push(expires);
    const flags = Buffer.alloc(2);
    flags.writeUInt16BE(0, 0);
    parts.push(flags);
    const optLen = Buffer.alloc(2);
    optLen.writeUInt16BE(options.length, 0);
    parts.push(optLen, options);
    parts.push(Buffer.from([1])); // numKeys = 1
    const encType = Buffer.alloc(2);
    encType.writeUInt16BE(0, 0);
    const encLen = Buffer.alloc(2);
    encLen.writeUInt16BE(32, 0);
    parts.push(encType, encLen, Buffer.from(identity.encryptionPublicKey));
    parts.push(Buffer.from([leases.length]));
    for (const lease of leases) {
      const tid = Buffer.alloc(4);
      tid.writeUInt32BE(lease.tunnelId, 0);
      const end = Buffer.alloc(4);
      end.writeUInt32BE(lease.endDateSeconds, 0);
      parts.push(Buffer.from(lease.tunnelGw), tid, end);
    }
    return Buffer.concat(parts);
  }

  /** Capture the fake socket the manager is currently bound to. */
  function getSocket(m: I2CPSocketManager): EventEmitter & {
    write: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
    destroyed: boolean;
  } {
    return (m as unknown as { socket: EventEmitter & { write: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn>; destroyed: boolean } }).socket;
  }

  /**
   * Microtask-poll helper — does NOT use setTimeout so it remains compatible
   * with `vi.useFakeTimers({ toFake: ['setTimeout', ...] })` in the timeout
   * test. setImmediate is left un-faked, so the connect-time handshake
   * (SessionStatus=Created frame emission) still drives normally.
   */
  async function flushUntilReady(m: I2CPSocketManager): Promise<void> {
    for (let i = 0; i < 100; i++) {
      if (m.isSessionReady()) return;
      await new Promise<void>((r) => setImmediate(r));
    }
  }

  it('Test 1: idle → awaiting-router-request after SESSION_STATUS=Created', async () => {
    // After getOrCreate() + flushUntilReady, the mock's SessionStatus=Created
    // frame has been processed by handleIncomingMessage, which sets
    // leaseSetState='awaiting-router-request' (see socket-manager.ts:391).
    const m = await I2CPSocketManager.getOrCreate(baseOpts());
    await flushUntilReady(m);
    expect(m.isSessionReady()).toBe(true);
    expect(m.getLeaseSetState()).toBe('awaiting-router-request');
  });

  it('Test 2: awaiting-router-request → published-assumed happy path', async () => {
    const m = await I2CPSocketManager.getOrCreate(baseOpts());
    await flushUntilReady(m);
    expect(m.getLeaseSetState()).toBe('awaiting-router-request');

    // Build a valid REQUEST_VARIABLE_LEASE_SET frame. The destination bytes
    // must equal IdentityEx.fromPrivKey(opts.privKey) — that's what
    // validateParsedLeaseSetRequest compares against. We also need
    // publishedSeconds within ±300s (past) / +60s (future) of the router
    // clock and lease.endDateSeconds > now+30 to pass every validator.
    const identity = IdentityEx.fromPrivKey(baseOpts().privKey);
    const sid = (m as unknown as { i2cpSessionId: number }).i2cpSessionId;
    const now = Math.floor(Date.now() / 1000);
    const body = buildLeaseSet2Body(identity, {
      publishedSeconds: now,
      expiresSeconds: 600,
      leases: [
        {
          tunnelGw: new Uint8Array(32).fill(0xab),
          tunnelId: 0x11223344,
          endDateSeconds: now + 600,
        },
      ],
    });
    const frame = encodeMessage({
      type: I2CP_MSG.REQUEST_VARIABLE_LEASE_SET,
      sessionId: sid,
      payload: body,
    });

    // Push it through the mock socket so the existing readMessageFromSocket
    // listener decodes it and dispatches to handleRequestLeaseSet.
    const sock = getSocket(m);
    sock.emit('data', frame);
    await new Promise<void>((r) => setImmediate(r));

    expect(m.getLeaseSetState()).toBe('published-assumed');
    const info = m.getLeaseSetInfo();
    expect(info).not.toBeNull();
    expect(info?.leases).toBeGreaterThan(0);
    expect(info?.leases).toBe(1);
    expect(info?.state).toBe('published-assumed');
  });

  it('Test 3: awaiting-router-request → failed after 60s timeout', async () => {
    // Fake ONLY setTimeout/setInterval — setImmediate stays real so the
    // mock's connect-time SessionStatus frame still fires normally. The
    // setTimeout(60_000) armed by startLeaseSetRequestTimeout() IS a fake
    // timer, so vi.advanceTimersByTimeAsync can fire it without waiting 60s.
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
    });
    try {
      const m = await I2CPSocketManager.getOrCreate(baseOpts());
      await flushUntilReady(m);
      expect(m.getLeaseSetState()).toBe('awaiting-router-request');

      // Advance past the 60s budget. 60_001 ms is one tick past
      // LEASE_SET_REQUEST_TIMEOUT_MS (60_000).
      await vi.advanceTimersByTimeAsync(60_001);

      expect(m.getLeaseSetState()).toBe('failed');
    } finally {
      vi.useRealTimers();
    }
  });

  it('Test 4: parseErrorCount escalation → disconnect after 6 malformed frames', async () => {
    const m = await I2CPSocketManager.getOrCreate(baseOpts());
    await flushUntilReady(m);
    expect(m.getLeaseSetState()).toBe('awaiting-router-request');

    // Build 6 frames with a WRONG destination (different IdentityEx). The
    // parser succeeds but validateParsedLeaseSetRequest throws
    // "LeaseSet request destination mismatch" on every one, incrementing
    // parseErrorCount. After the 6th error, parseErrorCount > MAX_PARSE_ERRORS
    // (5) and disconnect() is invoked.
    const wrongIdentity = IdentityEx.fromPrivKey(makeTestPrivKey(99));
    const sid = (m as unknown as { i2cpSessionId: number }).i2cpSessionId;
    const now = Math.floor(Date.now() / 1000);
    const body = buildLeaseSet2Body(wrongIdentity, {
      publishedSeconds: now,
      expiresSeconds: 600,
      leases: [
        {
          tunnelGw: new Uint8Array(32).fill(0xcd),
          tunnelId: 0x55667788,
          endDateSeconds: now + 600,
        },
      ],
    });
    const frame = encodeMessage({
      type: I2CP_MSG.REQUEST_VARIABLE_LEASE_SET,
      sessionId: sid,
      payload: body,
    });

    const sock = getSocket(m);
    for (let i = 0; i < 6; i++) {
      sock.emit('data', frame);
      await new Promise<void>((r) => setImmediate(r));
    }

    // Spec: after the 6th invalid frame, state should be 'failed' AND the
    // socket should have been destroyed. NOTE: handleRequestLeaseSet's
    // catch block sets state='failed' and then calls disconnect(); the
    // current disconnect() implementation unconditionally resets state
    // to 'idle' (overriding the 'failed' marker). See Concerns in the
    // task-6 report. We assert what the spec asks for; the test surfaces
    // the regression if the implementation is patched.
    expect(m.getLeaseSetState()).toBe('failed');
    expect(sock.destroyed).toBe(true);
  });

  it('Test 5: published-assumed → idle after disconnect, all 3 timers null', async () => {
    // Drive the manager into 'published-assumed' first (re-uses Test 2 setup).
    const m = await I2CPSocketManager.getOrCreate(baseOpts());
    await flushUntilReady(m);

    const identity = IdentityEx.fromPrivKey(baseOpts().privKey);
    const sid = (m as unknown as { i2cpSessionId: number }).i2cpSessionId;
    const now = Math.floor(Date.now() / 1000);
    const body = buildLeaseSet2Body(identity, {
      publishedSeconds: now,
      expiresSeconds: 600,
      leases: [
        {
          tunnelGw: new Uint8Array(32).fill(0xab),
          tunnelId: 0x11223344,
          endDateSeconds: now + 600,
        },
      ],
    });
    const frame = encodeMessage({
      type: I2CP_MSG.REQUEST_VARIABLE_LEASE_SET,
      sessionId: sid,
      payload: body,
    });
    const sock = getSocket(m);
    sock.emit('data', frame);
    await new Promise<void>((r) => setImmediate(r));
    expect(m.getLeaseSetState()).toBe('published-assumed');

    // Sanity: published-assumed arms the expiry watchdog (a timer).
    expect(
      (m as unknown as { leaseSetExpiryWatchdog: NodeJS.Timeout | null }).leaseSetExpiryWatchdog,
    ).not.toBeNull();
    expect(
      (m as unknown as { getDateRefreshTimer: NodeJS.Timeout | null }).getDateRefreshTimer,
    ).not.toBeNull();

    await m.disconnect();

    expect(m.getLeaseSetState()).toBe('idle');
    // All 3 Timer-Handles must be nulled by disconnect().
    const handles = m as unknown as {
      leaseSetRequestTimeout: NodeJS.Timeout | null;
      leaseSetExpiryWatchdog: NodeJS.Timeout | null;
      getDateRefreshTimer: NodeJS.Timeout | null;
    };
    expect(handles.leaseSetRequestTimeout).toBeNull();
    expect(handles.leaseSetExpiryWatchdog).toBeNull();
    expect(handles.getDateRefreshTimer).toBeNull();
  });

  it('Test 6 (bonus): parseErrorCount resets to 0 after a successful parse', async () => {
    const m = await I2CPSocketManager.getOrCreate(baseOpts());
    await flushUntilReady(m);
    expect(m.getLeaseSetState()).toBe('awaiting-router-request');

    // First, two malformed frames (wrong destination) → parseErrorCount = 2.
    const wrongIdentity = IdentityEx.fromPrivKey(makeTestPrivKey(123));
    const sid = (m as unknown as { i2cpSessionId: number }).i2cpSessionId;
    const now = Math.floor(Date.now() / 1000);
    const badBody = buildLeaseSet2Body(wrongIdentity, {
      publishedSeconds: now,
      expiresSeconds: 600,
      leases: [
        {
          tunnelGw: new Uint8Array(32).fill(0xee),
          tunnelId: 0xdeadbeef,
          endDateSeconds: now + 600,
        },
      ],
    });
    const badFrame = encodeMessage({
      type: I2CP_MSG.REQUEST_VARIABLE_LEASE_SET,
      sessionId: sid,
      payload: badBody,
    });
    const sock = getSocket(m);
    for (let i = 0; i < 2; i++) {
      sock.emit('data', badFrame);
      await new Promise<void>((r) => setImmediate(r));
    }
    expect(
      (m as unknown as { parseErrorCount: number }).parseErrorCount,
    ).toBe(2);

    // Now one VALID frame → state advances to 'published-assumed' and
    // parseErrorCount is reset to 0 inside the try-block (see
    // socket-manager.ts:589).
    const identity = IdentityEx.fromPrivKey(baseOpts().privKey);
    const goodBody = buildLeaseSet2Body(identity, {
      publishedSeconds: now,
      expiresSeconds: 600,
      leases: [
        {
          tunnelGw: new Uint8Array(32).fill(0xab),
          tunnelId: 0x11223344,
          endDateSeconds: now + 600,
        },
      ],
    });
    const goodFrame = encodeMessage({
      type: I2CP_MSG.REQUEST_VARIABLE_LEASE_SET,
      sessionId: sid,
      payload: goodBody,
    });
    sock.emit('data', goodFrame);
    await new Promise<void>((r) => setImmediate(r));

    expect(m.getLeaseSetState()).toBe('published-assumed');
    expect(
      (m as unknown as { parseErrorCount: number }).parseErrorCount,
    ).toBe(0);
  });
});
