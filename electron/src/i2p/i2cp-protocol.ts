import * as net from 'node:net';

export type I2CPMessageType = number;

/**
 * I2CP wire-protocol hello byte. MUST be sent as the very first byte after
 * TCP-connect, BEFORE any framed I2CP messages (GET_DATE, CreateSession, …).
 *
 * Both Java-I2P (`ClientListenerRunner.validate()` reads 1 byte and compares
 * to 42) and i2pd (`I2CP.cpp::ReadProtocolByte()` checks `m_Header[0] ==
 * I2CP_PROTOCOL_BYTE`) reject the connection with FIN if the first byte is
 * anything else. The framing in `encodeMessage` (4-byte BE length prefix)
 * starts AFTER this hello byte — sending a real I2CP frame as the first
 * thing after connect would be silently dropped by every router.
 *
 * Confirmed against the official spec:
 *   <https://i2p.net/en/docs/specs/i2cp-overview#protocol>
 *   "After connecting, the client MUST send a single byte of value 42 (0x2A)
 *    as a protocol identifier before sending any other I2CP messages."
 *
 * NOT to be confused with `I2CP_MSG.BLINDING_INFO` (= 42) — same numeric
 * value, completely unrelated semantics.
 */
export const I2CP_HELLO_BYTE = 0x2A;

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

/**
 * Inbound I2CP messages that DO NOT carry a 2-byte sessionId in their body.
 *
 * The generic `decodeMessage` heuristically strips 2 bytes as sessionId when
 * the body is ≥ 2 bytes. This works for per-session messages (SEND_MESSAGE,
 * SESSION_STATUS, …) but is WRONG for messages whose body is a fixed shape
 * that happens to be ≥ 2 bytes long:
 *
 *   - GET_DATE / SET_DATE: body is 8-byte Date BE (or 8+N with version).
 *     Stripping 2 bytes would mangle the timestamp.
 *   - CREATE_SESSION: the request that CREATES the session — the sessionId
 *     is assigned by the router in the SESSION_STATUS reply.
 *   - DISCONNECT: closes the entire client connection (no per-session context).
 *   - REPORT_ABUSE: per-message abuse token, not a sessionId.
 *   - HOST_LOOKUP / HOST_REPLY: name-resolution requestId is an 8-byte BE,
 *     not a 2-byte sessionId.
 *   - BANDWIDTH_LIMITS / GET_BANDWIDTH_LIMITS: global, not per-session.
 *
 * NOTE: DEST_REPLY is intentionally NOT in this set. i2pd formats the reply
 * with a 2-byte requestId prefix so our `requestId`-based matching works;
 * Java-I2P does not, and our lookupDestination implementation needs a
 * follow-up to add hash-based matching for Java. Tracked as a known gap
 * (Java DestReply has body = 0/32/387+, not 2+4+387+).
 */
const SID_LESS_TYPES: ReadonlySet<number> = new Set<number>([
  I2CP_MSG.CREATE_SESSION,
  I2CP_MSG.GET_BANDWIDTH_LIMITS,
  I2CP_MSG.BANDWIDTH_LIMITS,
  I2CP_MSG.GET_DATE,
  I2CP_MSG.SET_DATE,
  I2CP_MSG.HOST_LOOKUP,
  I2CP_MSG.HOST_REPLY,
  I2CP_MSG.REPORT_ABUSE,
  I2CP_MSG.DISCONNECT,
  // SESSION_STATUS has a variable body shape that depends on the router:
  //   6 bytes [2B sid][4B status]       — i2pd / I2CP spec literal reading
  //   5 bytes [1B sid][4B status]       — legacy Java-I2P (pre-0.9.34)
  //   3 bytes [2B msgId][1B status]     — Java-I2P 0.9.34+ (msgId doubles as sid)
  // The decoder cannot strip a fixed-width sessionId without breaking one of
  // these shapes, so we hand the full body to the parser which branches on
  // body length instead. SESSION_STATUS is therefore listed here as
  // "sid-less at the decoder layer".
  I2CP_MSG.SESSION_STATUS,
]);

export function encodeMessage(msg: I2CPMessage): Buffer {
  // I2CP wire format (Java-I2P authoratitive, I2CPMessageImpl.writeMessage):
  //   [4-byte length BE = doWriteMessage().length]   <-- BODY length, NOT including the 1-byte type
  //   [1-byte type]
  //   [body: optional 2-byte sessionId BE][payload]
  // The sessionId lives in the BODY, not the header.
  // Some messages (e.g. DestLookup, GetBandwidthLimits) have no sessionId at all.
  //
  // Confirmed via javap on /usr/share/i2p/lib/i2p.jar net/i2p/data/i2cp/I2CPMessageImpl:
  //   writeMessage:  DataHelper.writeLong(stream, doWriteMessage().length, 4)  // 4-byte length = body length
  //                  stream.write(getType())                                     // type byte
  //                  stream.write(doWriteMessage())                              // body bytes
  //   readMessage:   DataHelper.readLong(stream, 4) -> length                   // 4-byte length = body length
  //                  stream.read() -> type                                       // 1-byte type
  //                  doReadMessage(stream, length, type)                         // consumes `length` body bytes
  //
  // Earlier implementations misread this as "length includes the 1-byte type
  // field", which shifted every I2CP frame by 1 byte and surfaced as
  // "type 163 is an unknown I2CP message" once the parser fell into the
  // Ed25519 public key of an IdentityEx.
  const hasSessionId = msg.sessionId !== null && msg.sessionId !== undefined;
  const sessionIdBytes = hasSessionId ? 2 : 0;
  const bodyLen = sessionIdBytes + msg.payload.length;
  const buf = Buffer.alloc(4 + 1 + bodyLen);
  buf.writeUInt32BE(bodyLen, 0);
  buf.writeUInt8(msg.type, 4);
  if (hasSessionId) {
    buf.writeUInt16BE(msg.sessionId as number, 5);
  }
  msg.payload.copy(buf, 4 + 1 + sessionIdBytes);
  return buf;
}

export function decodeMessage(buf: Buffer): I2CPMessage {
  if (buf.length < 5) throw new Error('I2CP frame too short');
  const bodyLen = buf.readUInt32BE(0);
  if (buf.length < 4 + 1 + bodyLen) throw new Error('I2CP frame incomplete');
  const type = buf.readUInt8(4);
  const body = buf.subarray(5, 5 + bodyLen);
  let sessionId: number | null = null;
  let payloadStart = 5;
  // The 2-byte sessionId at the start of the body is present for
  // per-session types (SEND_MESSAGE, SESSION_STATUS, etc.) but NOT for
  // the sid-less types listed in SID_LESS_TYPES above (GET_DATE, DEST_*,
  // BANDWIDTH_*, HOST_*, REPORT_ABUSE, CREATE_SESSION, DISCONNECT).
  // Without this guard, the GET_DATE reply's 8-byte Date BE would be
  // misread as "2-byte sessionId + 6-byte payload".
  if (!SID_LESS_TYPES.has(type) && body.length >= 2) {
    sessionId = body.readUInt16BE(0);
    payloadStart = 7;
  }
  const payload = buf.subarray(payloadStart, 5 + bodyLen);
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
      const bodyLen = buffer.readUInt32BE(0);
      if (buffer.length < 4 + 1 + bodyLen) break;
      const frame = buffer.subarray(0, 4 + 1 + bodyLen);
      buffer = buffer.subarray(4 + 1 + bodyLen);
      try {
        onMessage(decodeMessage(frame));
      } catch (e) {
        socket.emit('error', e);
        return;
      }
    }
  });
}
