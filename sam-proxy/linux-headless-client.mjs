#!/usr/bin/env node
/**
 * Headless SecuChat Linux client.
 *
 *  - SESSION CREATE mit unserer eigenen Destination via Java-I2P SAM-Bridge
 *    (Port 7656, erreichbar über sam-proxy WS 7657)
 *  - STREAM ACCEPT auf separatem Socket
 *  - Empfängt PGP-verschlüsselte "chat-message" Envelopes, entschlüsselt
 *    sie mit Linux's PGP private key, zeigt Klartext
 *  - Replies mit PGP-encrypt(plaintext) → PGP-armored → JSON envelope
 */
import { WebSocket } from '/home/g/dev/SecuChat/sam-proxy/node_modules/ws/wrapper.mjs';
import * as openpgp from '/home/g/dev/SecuChat/app/node_modules/openpgp/dist/openpgp.mjs';
import fs from 'fs';
import path from 'path';
import os from 'os';

const HOME = path.join(os.homedir(), '.secuchat-linux');
const PRIV = fs.readFileSync(path.join(HOME, 'destination.priv'), 'utf8').trim();
const B32 = fs.readFileSync(path.join(HOME, 'destination.b32'), 'utf8').trim();
const PUB = fs.readFileSync(path.join(HOME, 'pgp-public.asc'), 'utf8').trim();
const PGP_PRIVATE = fs.readFileSync(path.join(HOME, 'pgp-private.asc'), 'utf8').trim();
const FINGERPRINT = fs.readFileSync(path.join(HOME, 'fingerprint.txt'), 'utf8').trim();
const PASSPHRASE = 'testpass123';

// Load phone contacts
const contactsDir = path.join(HOME, 'phone-contacts');
const phoneContacts = {};
for (const file of fs.readdirSync(contactsDir)) {
  const content = fs.readFileSync(path.join(contactsDir, file), 'utf8');
  const parsed = JSON.parse(content);
  phoneContacts[parsed.n] = parsed;
  console.log(`[linux-client] Loaded contact: ${parsed.n} → ${parsed.i.substring(0, 52)}...`);
}

const sessionId = `linux-ctl-${Date.now()}`;

// ── Control socket: HELLO + SESSION CREATE ───────────────────────────
const ctl = new WebSocket('ws://127.0.0.1:7657');
let ctlBuf = '';

function sendCtl(line) {
  console.log(`[CTRL → SAM] ${line.substring(0, 100)}`);
  ctl.send(line + '\n');
}

ctl.on('open', () => {
  console.log('[linux-client] CTRL WS connected');
  sendCtl('HELLO VERSION MIN=3.0 MAX=3.1');
});

let streamSocket = null;
let streamBuf = '';

ctl.on('message', async (data) => {
  ctlBuf += data.toString();
  let nl;
  while ((nl = ctlBuf.indexOf('\n')) !== -1) {
    const line = ctlBuf.substring(0, nl).trim();
    ctlBuf = ctlBuf.substring(nl + 1);
    if (!line) continue;
    console.log(`[SAM → CTRL] ${line.substring(0, 150)}`);

    if (line.startsWith('HELLO REPLY')) {
      console.log('--- SESSION CREATE ---');
      sendCtl(`SESSION CREATE STYLE=STREAM ID=${sessionId} DESTINATION=${PRIV} SIGNATURE_TYPE=EdDSA_SHA512_Ed25519`);
    } else if (line.startsWith('SESSION STATUS RESULT=OK')) {
      console.log('--- Session OK, opening STREAM ACCEPT on fresh socket ---');
      openStreamSocket();
    } else if (line.startsWith('NAMING REPLY')) {
      if (line.includes('RESULT=OK')) {
        console.log('✓ OUR LEASESET IN NETDB');
      } else {
        console.log(`✗ Not in NetDB yet: ${line.match(/MESSAGE="([^"]+)"/)?.[1]}`);
      }
    }
  }
});

ctl.on('error', (e) => { console.error('[CTRL] WS error:', e.message); process.exit(1); });
ctl.on('close', () => { console.log('[CTRL] WS closed'); process.exit(0); });

// ── Stream socket: STREAM ACCEPT ─────────────────────────────────────
function openStreamSocket() {
  streamSocket = new WebSocket('ws://127.0.0.1:7657');
  streamSocket.on('open', () => {
    console.log('[linux-client] STREAM WS connected');
    streamSocket.send('HELLO VERSION MIN=3.0 MAX=3.1\n');
  });

  streamSocket.on('message', async (data) => {
    streamBuf += data.toString();
    let nl;
    while ((nl = streamBuf.indexOf('\n')) !== -1) {
      const line = streamBuf.substring(0, nl).trim();
      streamBuf = streamBuf.substring(nl + 1);
      if (!line) continue;
      console.log(`[SAM → STREAM] ${line.substring(0, 200)}`);

      if (line.startsWith('HELLO REPLY')) {
        console.log(`--- STREAM ACCEPT for session ${sessionId} ---`);
        streamSocket.send(`STREAM ACCEPT ID=${sessionId}\n`);
      } else if (line.startsWith('STREAM STATUS RESULT=OK')) {
        console.log('✓ STREAM ACCEPT established, listening for incoming messages');
      } else if (line.startsWith('STREAM STATUS RESULT=I2P_ERROR')) {
        console.log('✗ STREAM ERROR — exiting');
        process.exit(1);
      }
    }
  });

  streamSocket.on('error', (e) => { console.error('[STREAM] WS error:', e.message); });
  streamSocket.on('close', () => console.log('[STREAM] WS closed'));
}

// ── Periodic NAMING LOOKUP ────────────────────────────────────────────
setInterval(() => {
  if (ctl.readyState === WebSocket.OPEN) {
    sendCtl(`NAMING LOOKUP NAME=${B32}`);
  }
}, 60000);

// ── Keep alive ────────────────────────────────────────────────────────
setInterval(() => {
  if (ctl.readyState === WebSocket.OPEN) ctl.ping();
  if (streamSocket?.readyState === WebSocket.OPEN) streamSocket.ping();
}, 30000);

setTimeout(() => {
  console.log('[linux-client] Timeout (30 min) — exiting');
  process.exit(0);
}, 1800000);