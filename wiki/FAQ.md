# FAQ & Troubleshooting

## General

**Does SecuChat need an account or phone number?**
No. Identity is based entirely on local cryptographic keys. No registration, no server account.

**Where is my data stored?**
Locally on your device — IndexedDB (browser), SQLite (Electron desktop), or Capacitor Preferences + IndexedDB (Android). Nothing leaves your device except the encrypted messages sent over I2P.

**Can I use SecuChat without I2P?**
Yes. Without I2P, messages are still PGP-encrypted end-to-end, but your IP address will be visible to your contact and network observers. Enable I2P for full anonymity.

**What platforms does SecuChat support?**
Three platforms:
- **Browser PWA** — any modern browser (Chrome, Firefox, Edge, Brave)
- **Android** — via Capacitor (install APK or build from source)
- **Desktop** — Electron app for Windows (NSIS installer) and Linux (AppImage/deb)

**Does SecuChat work on iOS?**
Not natively. iOS doesn't support the raw TCP connections needed for I2P. Use Android or desktop (Electron) for full I2P functionality. The browser PWA will load on iOS but I2P anonymity won't be available.

**Does SecuChat support group chats?**
Yes. Groups of up to 10 members with a shared AES-256 group key exchanged via X25519 ECDH. Admin-managed membership, fan-out delivery over I2P.

---

## Connection Issues

**The header dot is red — I2P not connected**

Browser:
1. Check that i2pd is running: `sudo systemctl status i2pd`
2. Check that the SAM proxy is running: `cd sam-proxy && npm start`
3. In SecuChat Settings → I2P, verify the host is `127.0.0.1` and port is `7657`
4. Click **Test connection**

Android:
1. Make sure the i2pd app is running
2. Check that SAM is enabled in the i2pd app settings (address `127.0.0.1`, port `7656`)

Desktop:
1. Restart the Electron app — it starts i2pd and the SAM proxy automatically
2. If still red, check Settings → I2P for error messages

**The header dot is yellow after connecting**

Yellow means SAM is connected but inbound tunnels are not yet established. This is normal for the first 1–5 minutes after i2pd starts. Wait and the dot will turn green automatically.

**"SAM-Proxy nicht erreichbar"** (browser only)

The sam-proxy Node.js process is not running or port 7657 is blocked. Start it with:

```bash
cd sam-proxy && npm start
```

This error does not apply to Android (native SAM) or Desktop (bundled proxy).

**"Peer nicht erreichbar / CANT_REACH_PEER"**

The contact's i2pd has not yet published its LeaseSet (network routing information). Causes:
- The contact is offline
- i2pd is still building tunnels (wait 1–3 minutes)
- The contact's stored I2P address is outdated — ask them to re-export their contact file after connecting to I2P

**Connection works but messages show "failed"**

The I2P stream may have dropped. SecuChat automatically attempts to reconnect before sending. If it keeps failing:
1. Check that both users are connected (green dot)
2. Try reopening the chat

---

## Keys & Passphrase

**I forgot my passphrase**

There is no recovery option. Your private key is encrypted with the passphrase and cannot be decrypted without it. If you have a backup, it is also encrypted with the same passphrase.

**"Decryption failed" on messages**

This happens when the PGP key pair is not loaded (e.g., after a lock). Unlock the app and messages will be decrypted automatically when you open the chat.

**My fingerprint changed after re-installing / clearing browser data**

Clearing browser storage deletes your keys. A new keypair is generated on next launch with a different fingerprint and a new I2P address. You will need to re-share your contact file with your contacts.

---

## Contacts

**"Export not possible — I2P never connected"**

Your I2P address is assigned by the SAM session on first connection. Connect to I2P once (Settings → I2P → Test connection), then export the contact file.

**Contact added but shows as offline**

I2P connections can take 30–60 seconds to establish on first attempt. The status updates automatically. If the contact remains offline, they may genuinely be offline or their I2P address may have changed.

**"Invalid PGP public key" when importing**

The contact file may be truncated or corrupted. Ask the contact to re-export and re-send the `.secuchat` file.

---

## Performance

**Key generation is slow**

PGP key generation in the browser takes a few seconds — this is normal for ECC curve25519. It only happens once during onboarding.

**First I2P connection takes a long time**

On a fresh i2pd installation, building the initial tunnel pool takes 5–10 minutes. Subsequent starts are much faster as i2pd caches network data.

**Messages are slow over I2P**

I2P tunnels introduce latency by design (typically 1–5 seconds per message). This is the trade-off for anonymity.

---

## Development

**How do I run the app locally?**

See [Local Development](Local-Development).

**Where do I report bugs?**

Open an issue in the GitHub repository.

---

## Android

**How do I install SecuChat on Android?**
Install the APK or build from source with Capacitor. See [Build & Deploy](Build-and-Deploy) for build instructions.

**Does the app need to stay in the foreground for I2P?**
No. A foreground service keeps the I2P connection alive when the app is backgrounded. Android may still kill it under extreme memory pressure.

**Why doesn't the app need the SAM proxy on Android?**
Android uses a native SAM plugin (`samNative.ts`) that connects directly to i2pd via TCP — no WebSocket proxy needed.

**How do notifications work on Android?**
All notifications are generated locally via @capacitor/local-notifications. No cloud messaging service (FCM/GCM) is used. This is privacy-focused by design.

---

## Desktop (Electron)

**Do I need to install i2pd separately?**
No. The Electron app bundles i2pd and starts it automatically. You can also configure an external i2pd in Settings if preferred.

**How do auto-updates work?**
Electron uses `electron-updater` to check for new versions. Updates are downloaded and installed on restart.

**Where does the desktop app store data?**
In a SQLite database via better-sqlite3, managed through an IPC bridge to the main process.

---

## File Transfer & Voice Messages

**What is the maximum file size for transfers?**
500 MB. Files are sent in 1 MB chunks over I2P with AES-256 encryption. Progress tracking and resume are supported.

**Can I reject an incoming file transfer?**
Yes. You'll see the transfer request with file metadata and can accept or reject it.

**How do voice messages work?**
Recorded via the MediaRecorder API (Opus encoding) with waveform visualization. Playback supports scrubbing. Voice messages are sent as encrypted files over I2P.
