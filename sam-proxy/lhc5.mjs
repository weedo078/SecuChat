/**
 * Reduced test: copy linux-headless.mjs logic but minimal — same imports,
 * same file reads, same contact loading, same deferred openpgp — and
 * identical handler shape. The ONLY difference: no second socket, no
 * SESSION CREATE, no STREAM ACCEPT.
 *
 * If this hangs too, the bug is in the imports/file-reads/handler shape.
 * If this works, the bug is in the second-socket creation logic.
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

console.log(`[lhc5] Starting`);
console.log(`[lhc5] b32: ${B32.substring(0, 50)}`);

// Load phone contacts
const contactsDir = path.join(HOME, 'phone-contacts');
const phoneContacts = {};
if (fs.existsSync(contactsDir)) {
  for (const file of fs.readdirSync(contactsDir)) {
    const content = fs.readFileSync(path.join(contactsDir, file), 'utf8');
    const parsed = JSON.parse(content);
    phoneContacts[parsed.n] = parsed;
    console.log(`[lhc5] Loaded contact: ${parsed.n} → ${parsed.i.substring(0, 50)}...`);
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
  console.log('[lhc5] CTRL WS open');
  ctl.send('HELLO VERSION MIN=3.0 MAX=3.1\n');
});

ctl.on('message', async (data) => {
  console.log('[lhc5] MSG RX:', data.toString().substring(0, 80));
  ctlBuf += data.toString();
  let nl;
  while ((nl = ctlBuf.indexOf('\n')) !== -1) {
    const line = ctlBuf.substring(0, nl).trim();
    ctlBuf = ctlBuf.substring(nl + 1);
    if (!line) continue;
    console.log(`[lhc5] LINE: ${line.substring(0, 200)}`);
  }
});

ctl.on('error', (e) => console.error('[lhc5] error:', e.message));
ctl.on('close', () => console.log('[lhc5] closed'));

setTimeout(() => {
  console.log('[lhc5] timeout');
  process.exit(0);
}, 5000);