/**
 * Headless SecuChat Linux client.
 *
 * Phase 7: Bidirektionaler E2E-Test Linux ↔ Android
 *  - SESSION CREATE mit Linux-Destination via Java-I2P SAM (port 7656 via WS 7657)
 *  - STREAM ACCEPT auf separatem Socket (Java-I2P v3: control + stream sockets)
 *  - PGP-Verschlüsselung eingehender Nachrichten entschlüsseln (openpgp)
 *  - Klartext anzeigen
 *
 * WICHTIG: Java-I2P sendet SAM-Antworten oft OHNE trailing \n.
 * Daher müssen wir Buffer-Reste nach while-loop separat verarbeiten.
 *
 *  Usage:
 *    cd /home/g/dev/SecuChat/sam-proxy
 *    node ./linux-headless.mjs
 */

import { WebSocket } from '/home/g/dev/SecuChat/sam-proxy/node_modules/ws/wrapper.mjs';
import fs from 'fs';
import path from 'path';
import os from 'os';

const HOME = path.join(os.homedir(), '.secuchat-linux');
const PRIV = fs.readFileSync(path.join(HOME, 'destination.priv'), 'utf8').trim();
const B32 = fs.readFileSync(path.join(HOME, 'destination.b32'), 'utf8').trim();
const PGP_PRIVATE_ARMORED = fs.readFileSync(path.join(HOME, 'pgp-private.asc'), 'utf8').trim();
const FINGERPRINT = fs.readFileSync(path.join(HOME, 'fingerprint.txt'), 'utf8').trim();
const PASSPHRASE = 'testpass123';
const SESSION_ID = `lhc-${Date.now()}`;
let currentSessionId = SESSION_ID;

console.log(`[lhc] Starting`);
console.log(`[lhc] b32: ${B32}`);
console.log(`[lhc] fingerprint: ${FINGERPRINT}`);

// Load phone contacts
const contactsDir = path.join(HOME, 'phone-contacts');
const phoneContacts = {};
if (fs.existsSync(contactsDir)) {
  for (const file of fs.readdirSync(contactsDir)) {
    const content = fs.readFileSync(path.join(contactsDir, file), 'utf8');
    const parsed = JSON.parse(content);
    phoneContacts[parsed.n] = parsed;
    console.log(`[lhc] Loaded contact: ${parsed.n} → ${parsed.i.substring(0, 50)}...`);
  }
}

// ── Load openpgp (deferred) ──────────────────────────────────────────
let openpgp = null;
async function loadOpenpgp() {
  if (openpgp) return openpgp;
  openpgp = await import('/home/g/dev/SecuChat/app/node_modules/openpgp/dist/openpgp.mjs');
  return openpgp;
}

// ── Helper: process SAM lines (handles partial-line buffer) ─────────
function processLines(buf, handler) {
  let nl;
  while ((nl = buf.indexOf('\n')) !== -1) {
    const line = buf.substring(0, nl).trim();
    buf = buf.substring(nl + 1);
    if (line) handler(line);
  }
  // Java-I2P often omits trailing \n — handle remaining buffer
  if (buf.length > 0 && !buf.includes('\n')) {
    const line = buf.trim();
    buf = '';
    if (line) handler(line);
  }
  return buf;
}

// ── CTRL socket: HELLO + SESSION CREATE ─────────────────────────────
const ctl = new WebSocket('ws://127.0.0.1:7657');
let ctlBuf = '';

ctl.on('open', () => {
  console.log('[lhc] CTRL WS open');
  ctl.send('HELLO VERSION MIN=3.0 MAX=3.1\n');
});

ctl.on('message', async (data) => {
  ctlBuf += data.toString();
  ctlBuf = processLines(ctlBuf, async (line) => {
    console.log(`[CTRL] ${line.substring(0, 200)}`);
    if (line.startsWith('HELLO REPLY')) {
      await loadOpenpgp();
      console.log(`[lhc] Sending SESSION CREATE with ID=${currentSessionId}`);
      ctl.send(`SESSION CREATE STYLE=STREAM ID=${currentSessionId} DESTINATION=${PRIV} SIGNATURE_TYPE=EdDSA_SHA512_Ed25519\n`);
    } else if (line.startsWith('SESSION STATUS RESULT=OK')) {
      console.log('[lhc] Session OK, opening STREAM ACCEPT socket');
      openStreamSocket(currentSessionId);
    } else if (line.includes('DUPLICATED_DEST')) {
      console.log('[lhc] DUPLICATED_DEST — previous session still alive, retrying with new ID in 5s');
      setTimeout(() => {
        const newId = `lhc-${Date.now()}`;
        currentSessionId = newId;
        console.log(`[lhc] Retry SESSION CREATE with ID=${newId}`);
        ctl.send(`SESSION CREATE STYLE=STREAM ID=${newId} DESTINATION=${PRIV} SIGNATURE_TYPE=EdDSA_SHA512_Ed25519\n`);
      }, 5000);
    } else if (line.startsWith('NAMING REPLY')) {
      const ok = line.includes('RESULT=OK');
      const msg = line.match(/MESSAGE="([^"]+)"/)?.[1] || 'unknown';
      console.log(`[lhc] NAMING LOOKUP: ${ok ? '✓ IN NETDB' : '✗ ' + msg}`);
    }
  });
});

ctl.on('error', (e) => console.error('[CTRL] error:', e.message));
ctl.on('close', () => { console.log('[CTRL] closed'); process.exit(0); });

// ── Periodic NAMING LOOKUP for self (NetDB propagation check) ──────
setInterval(() => {
  if (ctl.readyState === WebSocket.OPEN) {
    console.log(`[lhc] Periodic NAMING LOOKUP for ${B32}`);
    ctl.send(`NAMING LOOKUP NAME=${B32}\n`);
  }
}, 30000);

// ── STREAM socket: STREAM ACCEPT + incoming data ────────────────────
function openStreamSocket(sessionId) {
  const streamWs = new WebSocket('ws://127.0.0.1:7657');
  let streamBuf = '';
  let incomingStreamId = null;

  streamWs.on('open', () => {
    console.log('[lhc] STREAM WS open');
    streamWs.send('HELLO VERSION MIN=3.0 MAX=3.1\n');
  });

  streamWs.on('message', async (data) => {
    streamBuf += data.toString();
    streamBuf = processLines(streamBuf, async (line) => {
      console.log(`[STREAM] ${line.substring(0, 300)}`);
      if (line.startsWith('HELLO REPLY')) {
        console.log(`[lhc] Sending STREAM ACCEPT for session ${sessionId}`);
        streamWs.send(`STREAM ACCEPT ID=${sessionId}\n`);
      } else if (line.startsWith('STREAM STATUS RESULT=OK')) {
        const m = line.match(/ID=(\d+)/);
        if (m) incomingStreamId = m[1];
        console.log(`[lhc] STREAM ACCEPT OK, id=${incomingStreamId}, listening for messages`);
      } else if (line.startsWith('STREAM CONNECTED')) {
        console.log(`[lhc] Incoming stream connected: ${line}`);
      } else if (incomingStreamId !== null && line.length > 0 && !line.startsWith('STREAM')) {
        // This is data on the incoming stream (after STREAM CONNECTED)
        await handleIncomingMessage(streamWs, incomingStreamId, line);
      }
    });
  });

  streamWs.on('error', (e) => console.error('[STREAM] error:', e.message));
  streamWs.on('close', () => console.log('[STREAM] closed'));
}

// ── Handle incoming PGP-encrypted message ─────────────────────────────
async function handleIncomingMessage(streamWs, streamId, rawData) {
  console.log(`[lhc] Raw incoming (${rawData.length} bytes): ${rawData.substring(0, 200)}`);
  try {
    // Parse envelope
    const envelope = JSON.parse(rawData);
    console.log(`[lhc] Envelope type: ${envelope.type}, senderId: ${envelope.senderId}`);
    if (envelope.type !== 'chat-message') {
      console.log(`[lhc] (ignoring non-chat envelope)`);
      return;
    }
    // Decrypt PGP
    const opgp = await loadOpenpgp();
    const privateKey = await opgp.readPrivateKey({ armoredKey: PGP_PRIVATE_ARMORED });
    const decryptedKey = await opgp.decryptKey({ privateKey, passphrase: PASSPHRASE });
    const message = await opgp.readMessage({ armoredMessage: envelope.encryptedContent });
    const { data: plaintext } = await opgp.decrypt({
      message,
      decryptionKeys: decryptedKey,
    });
    console.log(`[lhc] ═══════════════════════════════════════`);
    console.log(`[lhc] PLAINTEXT: ${plaintext}`);
    console.log(`[lhc] (from ${envelope.senderFingerprint})`);
    console.log(`[lhc] ═══════════════════════════════════════`);
  } catch (err) {
    console.error(`[lhc] Failed to decrypt: ${err.message}`);
  }
}

setTimeout(() => {
  console.log('[lhc] 30-min timeout');
  process.exit(0);
}, 1800000);