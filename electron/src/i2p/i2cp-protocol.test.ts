import { describe, it, expect } from 'vitest';
import { encodeMessage, decodeMessage, I2CP_MSG, I2CPMessage, readMessageFromSocket } from './i2cp-protocol';
import { Duplex } from 'node:stream';
import type { Socket } from 'node:net';

describe('encodeMessage', () => {
  it('writes 4-byte big-endian length + 1-byte type + payload', () => {
    const msg = { type: I2CP_MSG.SEND_MESSAGE, sessionId: 42, payload: Buffer.from([1, 2, 3]) };
    const encoded = encodeMessage(msg);
    expect(encoded.length).toBe(4 + 1 + 1 + 3);  // length + type + sessionId-byte + payload
    expect(encoded.readUInt32BE(0)).toBe(5);  // 1 type + 1 sessionId + 3 payload
    expect(encoded[4]).toBe(I2CP_MSG.SEND_MESSAGE);
    expect(encoded[5]).toBe(42);
    expect(encoded.subarray(6).equals(Buffer.from([1, 2, 3]))).toBe(true);
  });

  it('handles empty payload', () => {
    const msg = { type: I2CP_MSG.GET_DATE, sessionId: 0, payload: Buffer.alloc(0) };
    const encoded = encodeMessage(msg);
    expect(encoded.length).toBe(4 + 1 + 1);
    expect(encoded.readUInt32BE(0)).toBe(2);
  });
});

describe('decodeMessage', () => {
  it('parses a complete message', () => {
    const frame = Buffer.alloc(4 + 1 + 1 + 3);
    frame.writeUInt32BE(5, 0);
    frame.writeUInt8(I2CP_MSG.MESSAGE_PAYLOAD, 4);
    frame.writeUInt8(99, 5);
    Buffer.from([0xAA, 0xBB, 0xCC]).copy(frame, 6);
    const msg = decodeMessage(frame);
    expect(msg.type).toBe(I2CP_MSG.MESSAGE_PAYLOAD);
    expect(msg.sessionId).toBe(99);
    expect(msg.payload.equals(Buffer.from([0xAA, 0xBB, 0xCC]))).toBe(true);
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

    // Frame: length=5, type=30 (SEND_MESSAGE), sessionId=1, payload=[0xAA, 0xBB, 0xCC]
    // Total size = 4 (length) + 1 (type) + 1 (sessionId) + 3 (payload) = 9 bytes
    // Send first 5 bytes (length + type + 1st byte of sessionId) — incomplete
    fakeSocket.push(Buffer.from([0, 0, 0, 5, 30]));
    await new Promise((resolve) => setImmediate(resolve));
    expect(messages).toHaveLength(0);  // not complete yet (only 5 of 9 bytes)

    // Send next 3 bytes (rest of sessionId + 2 payload bytes) — still incomplete
    fakeSocket.push(Buffer.from([1, 0xAA, 0xBB]));
    await new Promise((resolve) => setImmediate(resolve));
    expect(messages).toHaveLength(0);  // still not complete (8 of 9 bytes)

    // Complete the message with the final payload byte
    fakeSocket.push(Buffer.from([0xCC]));
    await new Promise((resolve) => setImmediate(resolve));
    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe(30);
    expect(messages[0].sessionId).toBe(1);
    expect(messages[0].payload.equals(Buffer.from([0xAA, 0xBB, 0xCC]))).toBe(true);
  });
});
