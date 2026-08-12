/**
 * lhc9: file loads happen via setImmediate AFTER WS open.
 * This separates the WS-open handler from file loads completely.
 */
import { WebSocket } from '/home/g/dev/SecuChat/sam-proxy/node_modules/ws/wrapper.mjs';
import fs from 'fs';
import path from 'path';
import os from 'os';

const HOME = path.join(os.homedir(), '.secuchat-linux');

console.log(`[lhc9] Starting`);

const ctl = new WebSocket('ws://127.0.0.1:7657');
let ctlBuf = '';

ctl.on('open', () => {
  console.log('[lhc9] CTRL WS open');
  ctl.send('HELLO VERSION MIN=3.0 MAX=3.1\n');
  // Defer file loads to a future tick
  setImmediate(() => {
    const PRIV = fs.readFileSync(path.join(HOME, 'destination.priv'), 'utf8').trim();
    const B32 = fs.readFileSync(path.join(HOME, 'destination.b32'), 'utf8').trim();
    const PGP_PRIVATE_ARMORED = fs.readFileSync(path.join(HOME, 'pgp-private.asc'), 'utf8').trim();
    const FINGERPRINT = fs.readFileSync(path.join(HOME, 'fingerprint.txt'), 'utf8').trim();
    console.log(`[lhc9] b32: ${B32.substring(0, 30)}`);
    const contactsDir = path.join(HOME, 'phone-contacts');
    for (const file of fs.readdirSync(contactsDir)) {
      const content = fs.readFileSync(path.join(contactsDir, file), 'utf8');
      JSON.parse(content);
      console.log(`[lhc9] loaded: ${file}`);
    }
  });
});

ctl.on('message', async (data) => {
  ctlBuf += data.toString();
  let nl;
  while ((nl = ctlBuf.indexOf('\n')) !== -1) {
    const line = ctlBuf.substring(0, nl).trim();
    ctlBuf = ctlBuf.substring(nl + 1);
    if (!line) continue;
    console.log(`[lhc9 CTRL] ${line.substring(0, 250)}`);
  }
});

ctl.on('error', (e) => console.error('[lhc9] error:', e.message));
ctl.on('close', () => { console.log('[lhc9] closed'); process.exit(0); });

setTimeout(() => process.exit(0), 5000);