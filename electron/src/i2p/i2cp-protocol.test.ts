import { describe, it, expect } from 'vitest';
import { encodeMessage, decodeMessage, I2CP_MSG, I2CPMessage, readMessageFromSocket } from './i2cp-protocol';
import { Duplex } from 'node:stream';
import type { Socket } from 'node:net';

describe('encodeMessage', () => {
  it('writes 4-byte big-endian length + 1-byte type + 2-byte sessionId + payload', () => {
    const msg = { type: I2CP_MSG.SEND_MESSAGE, sessionId: 42, payload: Buffer.from([1, 2, 3]) };
    const encoded = encodeMessage(msg);
    expect(encoded.length).toBe(4 + 1 + 2 + 3);  // length + type + sessionId(u16) + payload
    expect(encoded.readUInt32BE(0)).toBe(6);  // 1 type + 2 sessionId + 3 payload
    expect(encoded[4]).toBe(I2CP_MSG.SEND_MESSAGE);
    expect(encoded.readUInt16BE(5)).toBe(42);  // 2-byte big-endian sessionId
    expect(encoded.subarray(7).equals(Buffer.from([1, 2, 3]))).toBe(true);
  });

  it('handles empty payload', () => {
    const msg = { type: I2CP_MSG.CREATE_SESSION, sessionId: 7, payload: Buffer.alloc(0) };
    const encoded = encodeMessage(msg);
    expect(encoded.length).toBe(4 + 1 + 2);  // length + type + sessionId
    expect(encoded.readUInt32BE(0)).toBe(3);  // 1 type + 2 sessionId
    expect(encoded[4]).toBe(I2CP_MSG.CREATE_SESSION);
    expect(encoded.readUInt16BE(5)).toBe(7);
  });

  it('omits the 2-byte sessionId field when sessionId is null', () => {
    const msg = { type: I2CP_MSG.GET_DATE, sessionId: null, payload: Buffer.from([0xDE, 0xAD]) };
    const encoded = encodeMessage(msg);
    expect(encoded.length).toBe(4 + 1 + 2);  // length + type + 2 payload bytes (NOT sessionId)
    expect(encoded.readUInt32BE(0)).toBe(3);  // 1 type + 2 payload
    expect(encoded[4]).toBe(I2CP_MSG.GET_DATE);
    expect(encoded.subarray(5).equals(Buffer.from([0xDE, 0xAD]))).toBe(true);
  });
});

describe('decodeMessage', () => {
  it('parses a complete message with sessionId', () => {
    // length=6, type=31 (MESSAGE_PAYLOAD), sessionId=99 (0x0063), payload=[0xAA,0xBB,0xCC]
    const frame = Buffer.alloc(4 + 1 + 2 + 3);
    frame.writeUInt32BE(6, 0);
    frame.writeUInt8(I2CP_MSG.MESSAGE_PAYLOAD, 4);
    frame.writeUInt16BE(99, 5);
    Buffer.from([0xAA, 0xBB, 0xCC]).copy(frame, 7);
    const msg = decodeMessage(frame);
    expect(msg.type).toBe(I2CP_MSG.MESSAGE_PAYLOAD);
    expect(msg.sessionId).toBe(99);
    expect(msg.payload.equals(Buffer.from([0xAA, 0xBB, 0xCC]))).toBe(true);
  });

  it('parses a message without sessionId (body length < 2)', () => {
    // length=1, type=37 (GET_DATE), no sessionId, payload=[]
    const frame = Buffer.alloc(4 + 1);
    frame.writeUInt32BE(1, 0);
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

    // Frame: length=6, type=30 (SEND_MESSAGE), sessionId=1 (0x0001), payload=[0xAA,0xBB,0xCC]
    // Total size = 4 (length) + 1 (type) + 2 (sessionId) + 3 (payload) = 10 bytes
    // Send first 6 bytes (length + type + 1st byte of sessionId) — incomplete
    fakeSocket.push(Buffer.from([0, 0, 0, 6, 30, 0x00]));
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
    expect(messages[0].type).toBe(30);
    expect(messages[0].sessionId).toBe(1);
    expect(messages[0].payload.equals(Buffer.from([0xAA, 0xBB, 0xCC]))).toBe(true);
  });
});
