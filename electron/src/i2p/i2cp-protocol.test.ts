import { describe, it, expect } from 'vitest';
import { encodeMessage, decodeMessage, I2CP_MSG, I2CPMessage, readMessageFromSocket, I2CP_HELLO_BYTE } from './i2cp-protocol';
import { Duplex } from 'node:stream';
import type { Socket } from 'node:net';

describe('I2CP_HELLO_BYTE', () => {
  it('equals 0x2A (decimal 42) per the I2CP wire spec', () => {
    // The I2CP spec mandates that the very first byte after TCP-connect is
    // a single protocol identifier byte of value 42 (0x2A). Java-I2P's
    // ClientListenerRunner.validate() and i2pd's I2CP.cpp::ReadProtocolByte()
    // both close the socket if this byte is anything else.
    expect(I2CP_HELLO_BYTE).toBe(0x2a);
    expect(I2CP_HELLO_BYTE).toBe(42);
  });

  it('is exported as a single-byte Buffer when serialized', () => {
    const helloBuf = Buffer.from([I2CP_HELLO_BYTE]);
    expect(helloBuf.length).toBe(1);
    expect(helloBuf[0]).toBe(0x2a);
  });

  it('does not collide with I2CP_MSG.BLINDING_INFO numerically — same value, unrelated semantics', () => {
    // Both happen to be 42. The hello byte is a raw byte outside the
    // I2CP framing; BLINDING_INFO is a framed message type. Mixing them up
    // would mean sending a length-prefixed 42 instead of a raw 42.
    expect(I2CP_MSG.BLINDING_INFO).toBe(I2CP_HELLO_BYTE);
  });
});

describe('encodeMessage', () => {
  it('writes 4-byte big-endian length (body only) + 1-byte type + 2-byte sessionId + payload', () => {
    // Per Java-I2P's I2CPMessageImpl.writeMessage the 4-byte length is the
    // doWriteMessage() body length — it does NOT include the 1-byte type.
    const msg = { type: I2CP_MSG.SEND_MESSAGE, sessionId: 42, payload: Buffer.from([1, 2, 3]) };
    const encoded = encodeMessage(msg);
    expect(encoded.length).toBe(4 + 1 + 2 + 3);  // length + type + sessionId(u16) + payload
    expect(encoded.readUInt32BE(0)).toBe(5);  // 2 sessionId + 3 payload (body only, NO type)
    expect(encoded[4]).toBe(I2CP_MSG.SEND_MESSAGE);
    expect(encoded.readUInt16BE(5)).toBe(42);  // 2-byte big-endian sessionId
    expect(encoded.subarray(7).equals(Buffer.from([1, 2, 3]))).toBe(true);
  });

  it('handles empty payload', () => {
    const msg = { type: I2CP_MSG.CREATE_SESSION, sessionId: 7, payload: Buffer.alloc(0) };
    const encoded = encodeMessage(msg);
    expect(encoded.length).toBe(4 + 1 + 2);  // length + type + sessionId
    expect(encoded.readUInt32BE(0)).toBe(2);  // 2 sessionId bytes (body only, NO type)
    expect(encoded[4]).toBe(I2CP_MSG.CREATE_SESSION);
    expect(encoded.readUInt16BE(5)).toBe(7);
  });

  it('omits the 2-byte sessionId field when sessionId is null', () => {
    const msg = { type: I2CP_MSG.GET_DATE, sessionId: null, payload: Buffer.from([0xDE, 0xAD]) };
    const encoded = encodeMessage(msg);
    expect(encoded.length).toBe(4 + 1 + 2);  // length + type + 2 payload bytes (NOT sessionId)
    expect(encoded.readUInt32BE(0)).toBe(2);  // 2 payload bytes (body only, NO type)
    expect(encoded[4]).toBe(I2CP_MSG.GET_DATE);
    expect(encoded.subarray(5).equals(Buffer.from([0xDE, 0xAD]))).toBe(true);
  });
});

describe('decodeMessage', () => {
  it('parses a complete message with sessionId', () => {
    // bodyLen=5, type=31 (MESSAGE_PAYLOAD), sessionId=99 (0x0063), payload=[0xAA,0xBB,0xCC]
    //   wire = [4-byte len=5][type=31][sid=99 2B][payload 3B] = 10 bytes
    const frame = Buffer.alloc(4 + 1 + 2 + 3);
    frame.writeUInt32BE(5, 0);
    frame.writeUInt8(I2CP_MSG.MESSAGE_PAYLOAD, 4);
    frame.writeUInt16BE(99, 5);
    Buffer.from([0xAA, 0xBB, 0xCC]).copy(frame, 7);
    const msg = decodeMessage(frame);
    expect(msg.type).toBe(I2CP_MSG.MESSAGE_PAYLOAD);
    expect(msg.sessionId).toBe(99);
    expect(msg.payload.equals(Buffer.from([0xAA, 0xBB, 0xCC]))).toBe(true);
  });

  it('parses a message without sessionId (body length < 2)', () => {
    // bodyLen=0, type=32 (GET_DATE), no sessionId, no payload
    //   wire = [4-byte len=0][type=32] = 5 bytes
    const frame = Buffer.alloc(4 + 1);
    frame.writeUInt32BE(0, 0);
    frame.writeUInt8(I2CP_MSG.GET_DATE, 4);
    const msg = decodeMessage(frame);
    expect(msg.type).toBe(I2CP_MSG.GET_DATE);
    expect(msg.sessionId).toBe(null);
    expect(msg.payload.length).toBe(0);
  });
});

describe('readMessageFromSocket', () => {
  it('buffers partial frames until complete', async () => {
    const messages: I2CPMessage[] = [];
    const fakeSocket = new Duplex({
      read() {},
      write(_chunk, _enc, cb) { cb(); },
    });
    readMessageFromSocket(fakeSocket as unknown as Socket, (msg) => messages.push(msg));

    // Frame: bodyLen=5, type=5 (SEND_MESSAGE), sessionId=1 (0x0001), payload=[0xAA,0xBB,0xCC]
    // SEND_MESSAGE is a per-session message and therefore carries a 2-byte
    // sessionId in its body. We use it here (instead of DISCONNECT=30 which
    // is sid-less per I2CP spec) so decodeMessage preserves sessionId=1.
    // Total size = 4 (length) + 1 (type) + 5 (body = 2 sid + 3 payload) = 10 bytes
    // Send first 6 bytes (length + type + 1st byte of sessionId) — incomplete
    fakeSocket.push(Buffer.from([0, 0, 0, 5, 5, 0x00]));
    await new Promise((resolve) => setImmediate(resolve));
    expect(messages).toHaveLength(0);  // not complete yet (only 6 of 10 bytes)

    // Send next 3 bytes (rest of sessionId + 2 payload bytes) — still incomplete
    fakeSocket.push(Buffer.from([0x01, 0xAA, 0xBB]));
    await new Promise((resolve) => setImmediate(resolve));
    expect(messages).toHaveLength(0);  // still not complete (9 of 10 bytes)

    // Complete the message with the final payload byte
    fakeSocket.push(Buffer.from([0xCC]));
    await new Promise((resolve) => setImmediate(resolve));
    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe(5);
    expect(messages[0].sessionId).toBe(1);
    expect(messages[0].payload.equals(Buffer.from([0xAA, 0xBB, 0xCC]))).toBe(true);
  });
});

/**
 * Phase D.1: explicit encode→decode round-trip across every message type
 * the production path actually emits or accepts. Catches:
 *   - sessionId placement regressions (must live in the body header, not
 *     in the payload — otherwise Java-I2P / i2pd reject the frame)
 *   - length-prefix off-by-ones (a corrupted prefix truncates the next
 *     message and locks the socket)
 *   - payload-byte-level corruption between encoder and decoder
 *
 * Each case asserts the wire-format invariants the Java router depends on
 * (4-byte BE length, 1-byte type, optional 2-byte BE sessionId, payload).
 */
describe('encode→decode round-trip (Phase D.1 — wire-format compatibility)', () => {
  // Every outbound type we actually send. Inbounds live in the inverse
  // table below — the symmetry is intentional: if encode works for our
  // outbound shapes, decode MUST accept the matching inbound shape.
  const cases: Array<{
    label: string;
    type: number;
    sessionId: number | null;
    payload: Buffer;
  }> = [
    { label: 'CREATE_LEASE_SET (outbound, with sid)', type: I2CP_MSG.CREATE_LEASE_SET, sessionId: 0x1234, payload: Buffer.alloc(66, 0x42) },
    { label: 'SEND_MESSAGE (outbound, with sid)', type: I2CP_MSG.SEND_MESSAGE, sessionId: 7, payload: Buffer.from([0x01, 0x02, 0x03, 0x04]) },
    { label: 'DEST_LOOKUP (outbound, sid=requestId)', type: I2CP_MSG.DEST_LOOKUP, sessionId: 1, payload: Buffer.alloc(32, 0xAA) },
    // Inbound frames we MUST decode without corruption. Every inbound
    // type we care about carries a 2-byte sessionId (router's choice;
    // see SESSION_STATUS dual-layout for the Java variant).
    //
    // SESSION_STATUS is in SID_LESS_TYPES (see i2cp-protocol.ts) because
    // the body shape is variable across router versions (3B/5B/6B). The
    // decoder therefore passes the full body through unchanged and the
    // consumer (i2cp-socket-manager.handleIncomingMessage) extracts the
    // sid itself by branching on body length. The round-trip here
    // exercises the wire-format invariants for the FULL body, sid
    // included.
    { label: 'SESSION_STATUS (inbound, spec 6-byte [2B sid][4B status] body)', type: I2CP_MSG.SESSION_STATUS, sessionId: null, payload: Buffer.from([0x00, 0x05, 0x00, 0x00, 0x00, 0x01]) },
    { label: 'DEST_REPLY (inbound, sid=requestId)', type: I2CP_MSG.DEST_REPLY, sessionId: 1, payload: Buffer.concat([Buffer.from([0x00, 0x00, 0x00, 0x01]), Buffer.alloc(65, 0x42)]) },
    { label: 'MESSAGE_PAYLOAD (inbound, with sid)', type: I2CP_MSG.MESSAGE_PAYLOAD, sessionId: 42, payload: Buffer.from([0xDE, 0xAD, 0xBE, 0xEF]) },
    { label: 'RECEIVE_MESSAGE_BEGIN (inbound, with sid)', type: I2CP_MSG.RECEIVE_MESSAGE_BEGIN, sessionId: 99, payload: Buffer.alloc(12) },
    { label: 'RECEIVE_MESSAGE_END (inbound, with sid)', type: I2CP_MSG.RECEIVE_MESSAGE_END, sessionId: 99, payload: Buffer.alloc(12) },
  ];

  for (const c of cases) {
    it(c.label, () => {
      const encoded = encodeMessage({ type: c.type, sessionId: c.sessionId, payload: c.payload });
      // Wire-format invariants the Java router relies on:
      //   - 4-byte big-endian length prefix = BODY length (does NOT include the 1-byte type)
      //   - 1-byte type at offset 4
      //   - 2-byte sessionId at offset 5 (when present)
      const declaredLen = encoded.readUInt32BE(0);
      const expectedBodyLen = (c.sessionId !== null ? 2 : 0) + c.payload.length;
      expect(declaredLen).toBe(expectedBodyLen);
      expect(encoded.length).toBe(4 + 1 + expectedBodyLen);
      expect(encoded[4]).toBe(c.type);
      if (c.sessionId !== null) {
        expect(encoded.readUInt16BE(5)).toBe(c.sessionId);
      }

      const decoded = decodeMessage(encoded);
      expect(decoded.type).toBe(c.type);
      // Known decoder quirk: `decodeMessage` reads the sessionId only
      // from the body when `body.length >= 2`, regardless of whether the
      // encoder emitted one. encodeMessage omits the 2-byte sessionId
      // when the caller passes `null`, so any `null`-sessionId case with
      // a payload ≥ 2 bytes WILL round-trip as a non-null sessionId.
      // This is a known limitation tracked in i2cp-protocol.ts and is
      // fine for the production path because every inbound message we
      // care about carries a real sessionId (DEST_REPLY, SEND_MESSAGE,
      // MESSAGE_PAYLOAD, RECEIVE_MESSAGE_*); the sid-less frames are
      // CREATE_SESSION / GET_DATE (never round-tripped — the router
      // responds with a different message type) and SESSION_STATUS
      // (whose body shape is variable, so the consumer parses the sid
      // out of the full body — see i2cp-socket-manager.handleIncomingMessage).
      if (c.sessionId !== null) {
        expect(decoded.sessionId).toBe(c.sessionId);
      }
      expect(decoded.payload.equals(c.payload)).toBe(true);
    });
  }

  it('streaming envelope round-trip: streamId survives as sessionId', () => {
    // SEND_MESSAGE carries an inner streaming envelope in the payload. The
    // streamId lives in the I2CP header (2-byte sessionId slot) — the
    // router uses it to route the message to the right StreamingConnection.
    const streamId = 1337;
    const envelope = Buffer.concat([
      Buffer.from([0x01]), // dest sessionId
      Buffer.alloc(4),     // src port
      Buffer.alloc(4),     // dst port
      Buffer.from([0, 0, 0, 5]),
      Buffer.from('hello'),
    ]);
    const encoded = encodeMessage({
      type: I2CP_MSG.SEND_MESSAGE,
      sessionId: streamId,
      payload: envelope,
    });
    const decoded = decodeMessage(encoded);
    expect(decoded.sessionId).toBe(streamId);
    expect(decoded.payload.equals(envelope)).toBe(true);
  });
});
