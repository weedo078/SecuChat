/**
 * Linux → Phone: Send a message via SAM STREAM CONNECT.
 * Tests the forward direction (which doesn't depend on router reachability).
 *
 *  - SESSION CREATE
 *  - On new socket: STREAM CONNECT to phone b32
 *  - Send PGP-encrypted JSON envelope
 *  - Verify echo / close
 */
import { WebSocket } from '/home/g/dev/SecuChat/sam-proxy/node_modules/ws/wrapper.mjs';
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
const contacts = {};
for (const file of fs.readdirSync(contactsDir)) {
  const content = fs.readFileSync(path.join(contactsDir, file), 'utf8');
  const parsed = JSON.parse(content);
  contacts[parsed.n] = parsed;
}

// Pick first contact
const targetName = process.argv[2] || 'android50';
const target = contacts[targetName];
if (!target) {
  console.error(`Contact ${targetName} not found`);
  process.exit(1);
}
const targetB32 = target.i;
console.log(`[sender] Targeting ${targetName} → b32 ${targetB32.substring(0, 30)}...`);
console.log(`[sender] My b32: ${B32}`);
console.log(`[sender] My fingerprint: ${FINGERPRINT}`);

// ── CTRL socket: HELLO + SESSION CREATE ─────────────────────────────
const ctl = new WebSocket('ws://127.0.0.1:7657');
let ctlBuf = '';
const sessionId = `lhc-snd-${Date.now()}`;
let openpgp = null;

async function loadOpenpgp() {
  if (openpgp) return openpgp;
  openpgp = await import('/home/g/dev/SecuChat/app/node_modules/openpgp/dist/openpgp.mjs');
  return openpgp;
}

function processLines(buf, handler) {
  let nl;
  while ((nl = buf.indexOf('\n')) !== -1) {
    const line = buf.substring(0, nl).trim();
    buf = buf.substring(nl + 1);
    if (line) handler(line);
  }
  if (buf.length > 0 && !buf.includes('\n')) {
    const line = buf.trim();
    buf = '';
    if (line) handler(line);
  }
  return buf;
}

ctl.on('open', () => {
  console.log('[sender] CTRL WS open');
  ctl.send('HELLO VERSION MIN=3.0 MAX=3.1\n');
});

ctl.on('message', async (data) => {
  ctlBuf += data.toString();
  ctlBuf = processLines(ctlBuf, async (line) => {
    console.log(`[sender CTRL] ${line.substring(0, 200)}`);
    if (line.startsWith('HELLO REPLY')) {
      await loadOpenpgp();
      console.log('[sender] Sending SESSION CREATE');
      ctl.send(`SESSION CREATE STYLE=STREAM ID=${sessionId} DESTINATION=${PRIV} SIGNATURE_TYPE=EdDSA_SHA512_Ed25519\n`);
    } else if (line.startsWith('SESSION STATUS RESULT=OK')) {
      console.log('[sender] Session OK, opening STREAM CONNECT socket');
      openStreamConnectSocket();
    }
  });
});

ctl.on('error', (e) => console.error('[sender CTRL] error:', e.message));
ctl.on('close', () => { console.log('[sender CTRL] closed'); process.exit(0); });

function openStreamConnectSocket() {
  const streamWs = new WebSocket('ws://127.0.0.1:7657');
  let streamBuf = '';

  streamWs.on('open', () => {
    console.log('[sender] STREAM WS open');
    streamWs.send('HELLO VERSION MIN=3.0 MAX=3.1\n');
  });

  streamWs.on('message', async (data) => {
    streamBuf += data.toString();
    streamBuf = processLines(streamBuf, async (line) => {
      console.log(`[sender STREAM] ${line.substring(0, 300)}`);
      if (line.startsWith('HELLO REPLY')) {
        console.log(`[sender] Sending STREAM CONNECT to ${targetB32}`);
        streamWs.send(`STREAM CONNECT ID=${sessionId} DESTINATION=${targetB32} SILENT=false\n`);
      } else if (line.startsWith('STREAM STATUS RESULT=OK')) {
        console.log('[sender] STREAM CONNECTED, sending PGP-encrypted message');
        await sendPgpMessage(streamWs);
      } else if (line.startsWith('STREAM STATUS RESULT=I2P_ERROR')) {
        console.error('[sender] STREAM CONNECT FAILED:', line);
        process.exit(1);
      }
    });
  });

  streamWs.on('error', (e) => console.error('[sender STREAM] error:', e.message));
  streamWs.on('close', () => console.log('[sender STREAM] closed'));
}

async function sendPgpMessage(ws) {
  const opgp = await loadOpenpgp();
  // Decrypt private key for signing
  const privateKey = await opgp.readPrivateKey({ armoredKey: PGP_PRIVATE });
  const decryptedPrivKey = await opgp.decryptKey({ privateKey, passphrase: PASSPHRASE });

  // Read phone's public key from contact (field "k" = public key)
  console.log('[sender] contact fields:', Object.keys(target));
  let phonePubArmored = target.k || target.pk || target.publicKey || target.pgpPublic || null;
  if (!phonePubArmored) {
    console.error('[sender] Contact does not have a public key field!');
    console.error('[sender] Full contact:', JSON.stringify(target, null, 2).substring(0, 500));
    process.exit(1);
  }

  const phonePubKey = await opgp.readKey({ armoredKey: phonePubArmored });
  const plaintext = `Hello from Linux! Time: ${new Date().toISOString()}`;
  console.log(`[sender] Plaintext: ${plaintext}`);

  const encrypted = await opgp.encrypt({
    message: await opgp.createMessage({ text: plaintext }),
    encryptionKeys: [phonePubKey, decryptedPrivKey], // recipient + sender
    signingKeys: decryptedPrivKey,
    format: 'armored',
  });

  // Build envelope
  const envelope = {
    type: 'chat-message',
    id: `linux-${Date.now()}`,
    chatId: targetName,
    senderId: B32,
    senderFingerprint: FINGERPRINT,
    encryptedContent: encrypted,
    timestamp: Date.now(),
    sequenceNumber: 1,
  };
  const envelopeJson = JSON.stringify(envelope);
  console.log(`[sender] Sending envelope (${envelopeJson.length} bytes)`);
  ws.send(envelopeJson + '\n');

  // Give it a few seconds, then close
  setTimeout(() => {
    console.log('[sender] Closing');
    process.exit(0);
  }, 5000);
}

setTimeout(() => {
  console.log('[sender] 2-min timeout');
  process.exit(0);
}, 120000);