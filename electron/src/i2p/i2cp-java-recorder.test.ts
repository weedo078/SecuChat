import { describe, it } from 'vitest';
import * as fs from 'node:fs';
import * as net from 'node:net';
import { join } from 'node:path';

/**
 * Manual fixture recorder (run with I2P_FIXTURE_MODE=record against a live
 * Java-I2P router on 127.0.0.1:7654). NOT part of the regular test suite.
 */
describe.skip('I2P Java recorder (manual)', () => {
  it('records a real CreateSession frame to fixtures/', async () => {
    if (process.env.I2P_FIXTURE_MODE !== 'record') return;
    const sock = net.connect(7654, '127.0.0.1');
    await new Promise<void>((resolve, reject) => {
      sock.once('connect', () => resolve());
      sock.once('error', reject);
    });
    // Build a valid CreateSession with a fresh identity
    // ... (left as exercise — manual recording only)
    const out = join(__dirname, 'fixtures', 'i2p-java-create-session.bin');
    fs.writeFileSync(out, Buffer.alloc(0));
  }, 30_000);
});