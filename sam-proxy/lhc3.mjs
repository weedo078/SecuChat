import { WebSocket } from '/home/g/dev/SecuChat/sam-proxy/node_modules/ws/wrapper.mjs';
import fs from 'fs';
import path from 'path';
import os from 'os';

const HOME = path.join(os.homedir(), '.secuchat-linux');
const PRIV = fs.readFileSync(path.join(HOME, 'destination.priv'), 'utf8').trim();
const B32 = fs.readFileSync(path.join(HOME, 'destination.b32'), 'utf8').trim();
const PASSPHRASE = 'testpass123';

console.log('priv len:', PRIV.length);
console.log('b32:', B32);

const ws = new WebSocket('ws://127.0.0.1:7657');
ws.on('open', () => {
  console.log('OPEN');
  ws.send('HELLO VERSION MIN=3.0 MAX=3.1\n');
});
ws.on('message', async (data) => {
  const s = data.toString().trim();
  console.log('MSG:', s.substring(0, 200));
  if (s.startsWith('HELLO REPLY')) {
    console.log('Loading openpgp (deferred)...');
    const openpgp = await import('/home/g/dev/SecuChat/app/node_modules/openpgp/dist/openpgp.mjs');
    console.log('openpgp loaded');
    ws.send(`SESSION CREATE STYLE=STREAM ID=lhc3 DESTINATION=${PRIV} SIGNATURE_TYPE=EdDSA_SHA512_Ed25519\n`);
  } else if (s.startsWith('SESSION STATUS RESULT=OK')) {
    console.log('Session OK');
    process.exit(0);
  }
});
ws.on('error', e => console.log('ERR', e.message));
setTimeout(() => process.exit(0), 30000);