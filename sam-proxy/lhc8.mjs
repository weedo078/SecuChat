/**
 * lhc8: lhc6 logic, BUT file reads happen asynchronously (via fs.promises)
 * after WS open. If this works → file reads are the culprit.
 */
import { WebSocket } from '/home/g/dev/SecuChat/sam-proxy/node_modules/ws/wrapper.mjs';
import { readFile } from 'fs/promises';
import { readdir } from 'fs/promises';
import path from 'path';
import os from 'os';

const HOME = path.join(os.homedir(), '.secuchat-linux');

console.log(`[lhc8] Starting`);

const ctl = new WebSocket('ws://127.0.0.1:7657');
let ctlBuf = '';

ctl.on('open', () => {
  console.log('[lhc8] CTRL WS open');
  ctl.send('HELLO VERSION MIN=3.0 MAX=3.1\n');
  // File reads happen NOW, AFTER WS is already open
  (async () => {
    const PRIV = (await readFile(path.join(HOME, 'destination.priv'), 'utf8')).trim();
    const B32 = (await readFile(path.join(HOME, 'destination.b32'), 'utf8')).trim();
    const PGP_PRIVATE_ARMORED = (await readFile(path.join(HOME, 'pgp-private.asc'), 'utf8')).trim();
    const FINGERPRINT = (await readFile(path.join(HOME, 'fingerprint.txt'), 'utf8')).trim();
    console.log(`[lhc8] b32: ${B32}`);
    const contactsDir = path.join(HOME, 'phone-contacts');
    for (const file of await readdir(contactsDir)) {
      const content = await readFile(path.join(contactsDir, file), 'utf8');
      JSON.parse(content);
      console.log(`[lhc8] loaded: ${file}`);
    }
  })();
});

ctl.on('message', async (data) => {
  ctlBuf += data.toString();
  let nl;
  while ((nl = ctlBuf.indexOf('\n')) !== -1) {
    const line = ctlBuf.substring(0, nl).trim();
    ctlBuf = ctlBuf.substring(nl + 1);
    if (!line) continue;
    console.log(`[lhc8 CTRL] ${line.substring(0, 250)}`);
  }
});

ctl.on('error', (e) => console.error('[lhc8] error:', e.message));
ctl.on('close', () => { console.log('[lhc8] closed'); process.exit(0); });

setTimeout(() => process.exit(0), 5000);