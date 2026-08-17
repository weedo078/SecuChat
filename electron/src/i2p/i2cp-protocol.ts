import * as net from 'node:net';

export type I2CPMessageType = number;

export const I2CP_MSG = {
  CREATE_SESSION: 1,
  SESSION_STATUS: 20,
  SEND_MESSAGE: 30,
  MESSAGE_PAYLOAD: 31,
  MESSAGE_STATUS: 34,
  CREATE_LEASE_SET: 41,
  LEASE_SET: 42,
  REQUEST_LEASE_SET: 56,
  LEASE_SET_FOUND: 57,
  GET_DATE: 37,
} as const;

export interface I2CPMessage {
  type: I2CPMessageType;
  sessionId: number;
  payload: Buffer;
}

export function encodeMessage(msg: I2CPMessage): Buffer {
  // I2CP frame: [4-byte length BE][1-byte type][1-byte sessionId][payload]
  const innerLen = 1 + 1 + msg.payload.length;
  const buf = Buffer.alloc(4 + innerLen);
  buf.writeUInt32BE(innerLen, 0);
  buf.writeUInt8(msg.type, 4);
  buf.writeUInt8(msg.sessionId, 5);
  msg.payload.copy(buf, 6);
  return buf;
}

export function decodeMessage(buf: Buffer): I2CPMessage {
  if (buf.length < 6) throw new Error('I2CP frame too short');
  const length = buf.readUInt32BE(0);
  if (buf.length < 4 + length) throw new Error('I2CP frame incomplete');
  const type = buf.readUInt8(4);
  const sessionId = buf.readUInt8(5);
  const payload = buf.subarray(6, 4 + length);
  return { type, sessionId, payload: Buffer.from(payload) };
}

export function readMessageFromSocket(
  socket: net.Socket,
  onMessage: (msg: I2CPMessage) => void
): void {
  let buffer = Buffer.alloc(0);
  socket.on('data', (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 4) {
      const length = buffer.readUInt32BE(0);
      if (buffer.length < 4 + length) break;
      const frame = buffer.subarray(0, 4 + length);
      buffer = buffer.subarray(4 + length);
      try {
        onMessage(decodeMessage(frame));
      } catch (e) {
        socket.emit('error', e);
        return;
      }
    }
  });
}
