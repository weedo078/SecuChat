import * as net from 'node:net';

export type I2CPMessageType = number;

/**
 * I2CP message type IDs. Numbers verified against the official I2CP spec
 * (https://github.com/i2p/i2p.website/blob/main/content/es/docs/specs/i2cp.md).
 * The previous values had several collisions:
 *   - SEND_MESSAGE was 30 (= DisconnectMessage)
 *   - MESSAGE_STATUS was 34 (= DestLookupMessage)
 *   - GET_DATE was 37 (= RequestVariableLeaseSetMessage)
 *   - REQUEST_LEASE_SET was 56 (no spec ID; correct value is 21)
 *   - LEASE_SET_FOUND was 57 (does not exist in the spec)
 */
export const I2CP_MSG = {
  CREATE_SESSION: 1,
  RECONFIGURE_SESSION: 2,
  DESTROY_SESSION: 3,
  CREATE_LEASE_SET: 4, // legacy v1 leaseset creation
  SEND_MESSAGE: 5,
  RECEIVE_MESSAGE_BEGIN: 6,
  RECEIVE_MESSAGE_END: 7,
  GET_BANDWIDTH_LIMITS: 8,
  SESSION_STATUS: 20,
  REQUEST_LEASE_SET: 21,
  MESSAGE_STATUS: 22,
  BANDWIDTH_LIMITS: 23,
  REPORT_ABUSE: 29,
  DISCONNECT: 30,
  MESSAGE_PAYLOAD: 31, // incoming message body (after RECEIVE_MESSAGE_BEGIN)
  GET_DATE: 32,
  SET_DATE: 33,
  DEST_LOOKUP: 34,
  DEST_REPLY: 35,
  SEND_MESSAGE_EXPIRES: 36,
  REQUEST_VARIABLE_LEASE_SET: 37,
  HOST_LOOKUP: 38,
  HOST_REPLY: 39,
  CREATE_LEASE_SET_2: 41,
  BLINDING_INFO: 42,
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
