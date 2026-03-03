# I2P / SAM Stack

This page documents the I2P integration in detail: the SAM v3.1 protocol, the WebSocket proxy, and how the two service layers (`samService` and `i2pService`) work together.

## Why a Proxy?

Browsers cannot open raw TCP connections. The I2P SAM API speaks a line-based text protocol over TCP (port 7656). The sam-proxy (`sam-proxy/proxy.mjs`) bridges this gap by accepting WebSocket connections from the browser and forwarding bytes to i2pd's SAM port.

```
Browser WebSocket  ←→  sam-proxy  ←→  i2pd SAM (TCP 7656)
        port 7657                              port 7656
```

The proxy is stateless — it does no protocol parsing, just byte forwarding.

## SAM v3.1 Protocol Flow

`samService` (`services/i2pSam.ts`) implements the full SAM v3.1 handshake.

### Session establishment (main socket)

```
Client → i2pd:   HELLO VERSION MIN=3.1 MAX=3.1
i2pd   → Client: HELLO REPLY RESULT=OK VERSION=3.1

Client → i2pd:   DEST GENERATE SIGNATURE_TYPE=EdDSA_SHA512_Ed25519
i2pd   → Client: DEST REPLY PUB=<base64> PRIV=<base64>

Client → i2pd:   SESSION CREATE STYLE=STREAM ID=sc-<timestamp> DESTINATION=<PRIV>
i2pd   → Client: SESSION STATUS RESULT=OK DESTINATION=<PUB>
```

The session nickname includes a timestamp (`sc-<Date.now()>`) to avoid `DUPLICATED_ID` errors when i2pd keeps an old session alive ~5 minutes after a TCP drop.

### Outbound stream (separate socket per connection)

SAM v3.1 requires **a new WebSocket connection** for each STREAM CONNECT. Reusing the session socket for STREAM CONNECT corrupts the session state in i2pd.

```
[new WebSocket]
Client → i2pd:   HELLO VERSION MIN=3.1 MAX=3.1
i2pd   → Client: HELLO REPLY RESULT=OK VERSION=3.1

Client → i2pd:   STREAM CONNECT ID=sc-<timestamp> DESTINATION=<peer-b32> SILENT=false
i2pd   → Client: STREAM STATUS RESULT=OK
[stream is open — subsequent data is application data]
```

Timeout for STREAM CONNECT is 60 seconds (I2P tunnel builds can take 30–60 s on first attempt).

### Retry logic

`connectTo()` retries up to 3 times on `LeaseSet not found` / `CANT_REACH_PEER` errors, with 10 s / 20 s / 30 s waits between attempts. This handles the case where a peer's i2pd is still building tunnels.

### Reconnect

If the WebSocket drops, `samService` attempts automatic reconnect with exponential backoff (1 s × 2^attempt + jitter, max 30 s, up to 5 attempts). On successful reconnect, the session is restored with the same destination private key but a fresh timestamp-based nickname.

## Address Derivation

An I2P `.b32.i2p` address is derived from the SAM destination public key:

```
b32address = base32(SHA-256(destination_bytes)) + ".b32.i2p"
```

I2P uses a modified Base64 alphabet (`-` instead of `+`, `~` instead of `/`). `computeB32Address()` in `samService` normalises this before hashing.

## i2pService — High-Level API

`i2pService` (`services/i2p.ts`) sits on top of `samService` and provides the application-facing API.

### Identity

Two keys form a user's I2P identity:

| Key | Algorithm | Stored as |
|-----|-----------|-----------|
| Ed25519 keypair | TweetNaCl `nacl.sign.keyPair()` | Base64 in IndexedDB (`i2pPublicKey`, `i2pPrivateKey`) |
| SAM destination | EdDSA_SHA512_Ed25519 from i2pd | Base64 in IndexedDB (`i2pSamDestination`) |

The Ed25519 key is used for the local `.b32.i2p` address during onboarding (before SAM connects). Once SAM connects and a real destination is generated, `i2pAddress` is updated to the SAM-derived b32. This corrects any mismatch that occurs when onboarding happens offline.

### Peer connections

```ts
i2pService.connectToPeer(b32Address)   // opens STREAM CONNECT
i2pService.sendMessage(to, message)    // auto-connects if needed, sends JSON
i2pService.sendFile(to, file)          // chunked transfer (8 KB chunks, max 50 MB)
```

Files are sent as a sequence of JSON messages:
1. `file-offer` — metadata (name, MIME type, size, total chunks)
2. `file-chunk` × N — base64-encoded chunk data
3. `file-complete` — signals end of transfer

### Tunnel readiness check

After `SESSION CREATE`, `i2pService` polls the i2pd web console at `http://127.0.0.1:7070/?page=i2p_tunnels_json` every 5 seconds (up to 2 minutes) to detect when inbound tunnels are established. When `leasesetPublished` becomes `true`, the header dot turns green.

If the web console is unreachable (e.g., it's disabled), the check falls back to SAM connected status.

## Key Files

| File | Description |
|------|-------------|
| `sam-proxy/proxy.mjs` | Node.js WebSocket-to-TCP bridge |
| `app/src/services/i2pSam.ts` | SAM v3.1 protocol client |
| `app/src/services/i2p.ts` | High-level I2P API (identity, peers, send/receive) |
| `app/src/utils/base32.ts` | RFC 4648 Base32 + base64 helpers |
