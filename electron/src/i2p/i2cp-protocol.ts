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
  sessionId: number | null;
  payload: Buffer;
}

export function encodeMessage(msg: I2CPMessage): Buffer {
  // I2CP wire format (spec-correct):
  //   [4-byte length BE][1-byte type][optional 2-byte sessionId BE][payload]
  // The sessionId lives in the BODY, not the header.
  // Some messages (e.g. DestLookup, GetBandwidthLimits) have no sessionId at all.
  const hasSessionId = msg.sessionId !== null && msg.sessionId !== undefined;
  const sessionIdBytes = hasSessionId ? 2 : 0;
  const innerLen = 1 + sessionIdBytes + msg.payload.length;
  const buf = Buffer.alloc(4 + innerLen);
  buf.writeUInt32BE(innerLen, 0);
  buf.writeUInt8(msg.type, 4);
  if (hasSessionId) {
    buf.writeUInt16BE(msg.sessionId as number, 5);
  }
  msg.payload.copy(buf, 4 + 1 + sessionIdBytes);
  return buf;
}

export function decodeMessage(buf: Buffer): I2CPMessage {
  if (buf.length < 5) throw new Error('I2CP frame too short');
  const length = buf.readUInt32BE(0);
  if (buf.length < 4 + length) throw new Error('I2CP frame incomplete');
  const type = buf.readUInt8(4);
  const body = buf.subarray(5, 4 + length);
  let sessionId: number | null = null;
  let payloadStart = 5;
  if (body.length >= 2) {
    sessionId = body.readUInt16BE(0);
    payloadStart = 7;
  }
  const payload = buf.subarray(payloadStart, 4 + length);
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
