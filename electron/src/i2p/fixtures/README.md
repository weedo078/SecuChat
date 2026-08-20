# I2P Wire-Format Test-Fixtures

This directory contains byte-accurate recordings of real I2CP frames
captured from a live Java-I2P router. They serve as the Gold-Master
for spec-compliance tests.

## Files

- `i2p-java-create-session.bin` — A real `CreateSessionMessage` frame
  produced by Java-I2P's `I2CPClient` library against `127.0.0.1:7654`.
  Captured 2026-08-19.
- `i2p-java-create-leaseset2.bin` — A real `CreateLeaseSet2Message`
  from the same session.

## Recording (manual, one-time)

```bash
# 1. Start Java-I2P
java -jar i2p.jar

# 2. Wait for router console at 127.0.0.1:7657
sleep 30

# 3. Run recorder (writes captured bytes to fixtures/)
cd electron && I2P_FIXTURE_MODE=record npx vitest run -- i2cp-java-recorder.test.ts

# 4. Verify with hexdump
hexdump -C src/i2p/fixtures/i2p-java-create-session.bin | head
# Expect: 4-byte length + 1-byte type=CREATE_SESSION(1) + 387-byte IdentityEx
#         + 2-byte mapping-size + N bytes mapping + 8-byte Date + 64-byte signature
```

## Verification

After recording, manually verify in a Node REPL:

```bash
cd electron && node -e "
const fs = require('fs');
const buf = fs.readFileSync('src/i2p/fixtures/i2p-java-create-session.bin');
const len = buf.readUInt32BE(0);
const type = buf[4];
console.log('Frame length:', len, 'Type:', type);
console.log('IdentityEx bytes:', buf.subarray(5, 392).length);
console.log('Signature:', buf.subarray(buf.length - 64).length);
"
```

Expected: `Frame length: 467 Type: 1 IdentityEx bytes: 387 Signature: 64`.