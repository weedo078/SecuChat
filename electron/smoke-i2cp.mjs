// Live Java-I2P smoketest for spec-compliant CreateSession.
//
// Connects to 127.0.0.1:7654, sends GET_DATE then CreateSession, and verifies
// that the live router accepts the frame (SessionStatus.reply with status=1
// "Created"). This is a regression check for the I2CP spec-compliance work in
// Tasks 1–8 — pure-mock unit tests can hide wire-format bugs that only the
// real Java-I2P router surfaces.
//
// Usage:
//   cd electron && npm run build && node smoke-i2cp.mjs
//
// Exit codes:
//   0  -> sessionReady=true  (Java-I2P accepted CreateSession, status=Created)
//   1  -> sessionReady=false (router rejected or did not respond in time)
//
// Security: this script logs `b32Address` (public) only. The 128-byte
// `privKey` blob is generated fresh per run and is NEVER logged.

import { generateEd25519Destination } from './dist/i2p/destination-gen.js';
import { IdentityEx } from './dist/i2p/i2cp-identity.js';
import { encodeCreateSession } from './dist/i2p/i2cp-session-creator.js';
import { I2CP_MSG, encodeMessage, I2CP_HELLO_BYTE } from './dist/i2p/i2cp-protocol.js';
import * as net from 'node:net';

const ROUTER_HOST = '127.0.0.1';
const ROUTER_PORT = 7654;
const WAIT_GET_DATE_MS = 500;
const WAIT_CREATESESSION_MS = 15_000;

const SESSION_STATUS_CREATED = 1;
const SESSION_STATUS_UPDATED = 2;
const SESSION_STATUS_DESTROYED = 3;
const SESSION_STATUS_INVALID = 4;
function sessionStatusName(s) {
  switch (s) {
    case SESSION_STATUS_CREATED: return 'Created';
    case SESSION_STATUS_UPDATED: return 'Updated';
    case SESSION_STATUS_DESTROYED: return 'Destroyed';
    case SESSION_STATUS_INVALID: return 'Invalid';
    default: return `Unknown(${s})`;
  }
}

const received = [];

async function main() {
  const dest = await generateEd25519Destination();
  const identity = IdentityEx.fromPrivKey(dest.privKey);
  // Public b32 only — never print the 128-byte privKey.
  console.log(`generated destination: b32=${dest.b32Address}`);

  const sock = net.connect(ROUTER_PORT, ROUTER_HOST);
  await new Promise((resolve, reject) => {
    sock.once('connect', resolve);
    sock.once('error', reject);
  });

  // I2CP wire-protocol hello byte (0x2A = 42). MUST be the very first byte
  // after TCP-connect, BEFORE any framed I2CP messages. Java-I2P's
  // ClientListenerRunner.validate() and i2pd's I2CP.cpp::ReadProtocolByte()
  // both close the socket if this byte is anything else — without it, the
  // router FIN-closes silently and we receive zero frames.
  // See https://i2p.net/en/docs/specs/i2cp-overview
  sock.write(Buffer.from([I2CP_HELLO_BYTE]));

  let buf = Buffer.alloc(0);
  let sessionReady = false;
  let sessionId = null;

  sock.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    // Frame any complete I2CP messages from the byte stream.
    // Per Java-I2P's I2CPMessageImpl.writeMessage, the 4-byte length is the
    // doWriteMessage() body length — it does NOT include the 1-byte type.
    while (buf.length >= 5) {
      const bodyLen = buf.readUInt32BE(0);
      if (buf.length < 4 + 1 + bodyLen) break;
      const frame = buf.subarray(0, 4 + 1 + bodyLen);
      buf = buf.subarray(4 + 1 + bodyLen);

      const type = frame.readUInt8(4);
      const body = frame.subarray(5); // bodyLen bytes after the 1-byte type
      const entry = { type, length: bodyLen, body, raw: frame };
      received.push(entry);

      if (type === I2CP_MSG.GET_DATE) {
        // GET_DATE reply (Java-I2P echoes a SET_DATE shape with optional
        // version): body = [8-byte Date BE] + optional version string.
        const ts = body.length >= 8
          ? body.readBigUInt64BE(0).toString()
          : `<bodyLen=${body.length}>`;
        console.log(`<- type=${type} (GET_DATE) bodyLen=${bodyLen} date=${ts}`);
      } else if (type === 30 /* DISCONNECT */) {
        // DisconnectMessage body = 1-byte reason + reason string. The reason
        // is the router's complaint about a rejected handshake — log the
        // full body so we can diagnose spec mismatches that surface as
        // an abrupt close.
        console.log(
          `<- type=${type} (DISCONNECT) bodyLen=${bodyLen} ` +
          `bodyHex=${body.toString('hex')} bodyUtf8=${body.toString('utf8').replace(/[^\x20-\x7e]/g, '?')}`,
        );
      } else if (type === I2CP_MSG.SESSION_STATUS) {
        // SessionStatus body — Java-I2P 0.9.34+ uses a compact 3-byte form:
        //   [2-byte msgId BE][1-byte status]
        // (msgId == effectively the sessionId, since the router ties them
        // together 1:1 on CreateSession). Older routers used 4-6 byte forms.
        const bodyHex = body.toString('hex');
        if (body.length >= 6) {
          // [2-byte msgId BE][1-byte sid][1-byte status][padding?] — incl. possible
          // [1-byte sid][4-byte status] variant — read 2-byte msgId + 1-byte status
          // for the most reliable decoding.
          const msgId = body.readUInt16BE(0);
          const status = body.readUInt8(body.length - 1);
          sessionId = msgId;
          console.log(
            `<- type=${type} (SESSION_STATUS, ≥6B) bodyLen=${bodyLen} bodyHex=${bodyHex} ` +
            `msgId=${msgId} status=${status} (${sessionStatusName(status)})`,
          );
          if (status === SESSION_STATUS_CREATED) sessionReady = true;
        } else if (body.length === 3) {
          // [2-byte msgId BE][1-byte status] — Java-I2P 0.9.34+ default.
          const msgId = body.readUInt16BE(0);
          const status = body.readUInt8(2);
          sessionId = msgId;
          console.log(
            `<- type=${type} (SESSION_STATUS, 3B) bodyLen=${bodyLen} bodyHex=${bodyHex} ` +
            `msgId=${msgId} status=${status} (${sessionStatusName(status)})`,
          );
          if (status === SESSION_STATUS_CREATED) sessionReady = true;
        } else if (body.length === 5) {
          // [1-byte sid][4-byte status] (older routers).
          const sid = body.readUInt8(0);
          const status = body.readUInt32BE(1);
          sessionId = sid;
          console.log(
            `<- type=${type} (SESSION_STATUS, 1B/4B) bodyLen=${bodyLen} bodyHex=${bodyHex} ` +
            `sessionId=${sid} status=${status} (${sessionStatusName(status)})`,
          );
          if (status === SESSION_STATUS_CREATED) sessionReady = true;
        } else {
          console.log(
            `<- type=${type} (SESSION_STATUS) bodyLen=${bodyLen} bodyHex=${bodyHex} (unrecognized body shape, len=${body.length})`,
          );
        }
      } else {
        console.log(`<- type=${type} bodyLen=${bodyLen}`);
      }
    }
  });

  sock.on('error', (err) => {
    console.error(`socket error: ${err.message}`);
  });

  // 1) GET_DATE (clock-sync, optional but useful for debugging).
  sock.write(
    encodeMessage({ type: I2CP_MSG.GET_DATE, sessionId: null, payload: Buffer.alloc(0) }),
  );
  await new Promise((r) => setTimeout(r, WAIT_GET_DATE_MS));

  // 2) CreateSession — the headline message. spec-compliant layout:
  //   [IdentityEx 387B][mapping-size 2B][mapping N][date 8B][sig 64B Ed25519]
  const dateMs = Date.now();
  const createSessionBuf = encodeCreateSession({
    identity,
    properties: new Map([['nickname', 'SecuChat-Smoketest']]),
    dateMs,
  });
  console.log(`-> type=1 (CREATE_SESSION) len=${createSessionBuf.length - 4} (full ${createSessionBuf.length}B incl. 4B length prefix)`);
  sock.write(createSessionBuf);

  // 3) Wait for SessionStatus reply.
  await new Promise((r) => setTimeout(r, WAIT_CREATESESSION_MS));

  console.log(`sessionReady=${sessionReady}`);
  console.log(`received frames: ${received.length}`);
  for (const f of received) {
    console.log(`  - type=${f.type} len=${f.length}`);
  }

  sock.destroy();

  if (sessionReady) {
    if (sessionId !== null) {
      console.log(`assigned sessionId=${sessionId}`);
    }
    process.exit(0);
  } else {
    console.error('FAIL — Java-I2P did not return SESSION_STATUS Created for our CreateSession');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`smoke run threw: ${err && err.stack ? err.stack : err}`);
  process.exit(2);
});
