/**
 * Copy of linux-headless.mjs EXACT, but:
 *  - removed the openStreamSocket function definition entirely
 *  - removed the setTimeout at the end
 *  - removed the SESSION_ID global
 *
 * If this works → bug is in openStreamSocket or setTimeout
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

console.log(`[lhc6] Starting`);
console.log(`[lhc6] b32: ${B32}`);
console.log(`[lhc6] fingerprint: ${FINGERPRINT}`);

// Load phone contacts
const contactsDir = path.join(HOME, 'phone-contacts');
const phoneContacts = {};
if (fs.existsSync(contactsDir)) {
  for (const file of fs.readdirSync(contactsDir)) {
    const content = fs.readFileSync(path.join(contactsDir, file), 'utf8');
    const parsed = JSON.parse(content);
    phoneContacts[parsed.n] = parsed;
    console.log(`[lhc6] Loaded contact: ${parsed.n} → ${parsed.i.substring(0, 50)}...`);
  }
}

let openpgp = null;
async function loadOpenpgp() {
  if (openpgp) return openpgp;
  openpgp = await import('/home/g/dev/SecuChat/app/node_modules/openpgp/dist/openpgp.mjs');
  return openpgp;
}

const ctl = new WebSocket('ws://127.0.0.1:7657');
let ctlBuf = '';

ctl.on('open', () => {
  console.log('[lhc6] CTRL WS open');
  ctl.send('HELLO VERSION MIN=3.0 MAX=3.1\n');
});

ctl.on('message', async (data) => {
  ctlBuf += data.toString();
  let nl;
  while ((nl = ctlBuf.indexOf('\n')) !== -1) {
    const line = ctlBuf.substring(0, nl).trim();
    ctlBuf = ctlBuf.substring(nl + 1);
    if (!line) continue;
    console.log(`[lhc6 CTRL] ${line.substring(0, 250)}`);
  }
});

ctl.on('error', (e) => console.error('[lhc6 CTRL] error:', e.message));
ctl.on('close', () => { console.log('[lhc6 CTRL] closed'); process.exit(0); });

setTimeout(() => process.exit(0), 5000);