# Getting Started

SecuChat is a privacy-focused cross-platform messaging app with end-to-end PGP encryption and I2P network routing for anonymity. No server accounts, no phone numbers — just keys. Runs on **Browser**, **Android**, and **Desktop (Electron)**.

## Prerequisites

Choose your platform:

- **Browser:** A modern browser (Chrome, Firefox, Edge, or Brave)
- **Android:** Android device with i2pd from [F-Droid](https://f-droid.org/packages/org.purplei2p.i2pd/)
- **Desktop:** Windows or Linux — download the installer or build from source

Optional but recommended for browser: [i2pd](https://i2pd.website/) for anonymous routing (see [I2P Setup](I2P-Setup))

## First Launch

Open the app. If no profile exists, the onboarding wizard starts automatically.

- **Browser:** Open the hosted URL or `http://localhost:5173` in dev mode
- **Android:** Install the APK or build with Capacitor (see [Build & Deploy](Build-and-Deploy))
- **Desktop:** Run the installed application or `cd electron && npm run dev` for development

### Step 1 — Choose your name

Enter a display name. This is how contacts will see you. Special characters are stripped; only letters, numbers, and spaces are kept.

### Step 2 — Set a passphrase

Your passphrase protects your private keys in local storage. It is **never sent anywhere**.

- Use a strong, memorable passphrase (not a password manager entry — you need to type this each time the app locks)
- Minimum length is enforced
- The passphrase is used to derive an AES-256-GCM key (via PBKDF2, 100,000 iterations) that encrypts your PGP and I2P private keys at rest

> **Warning:** If you forget your passphrase, your keys cannot be recovered. There is no reset.

### Step 3 — Key generation

The app generates two keypairs automatically:

| Key | Algorithm | Purpose |
|-----|-----------|---------|
| PGP keypair | ECC curve25519Legacy (OpenPGP.js) | Message encryption/decryption |
| I2P identity | Ed25519 (TweetNaCl) | Network routing address |

Key generation happens entirely in your browser. Nothing is uploaded.

### Step 4 — I2P setup (optional)

If you want to use I2P for anonymous routing, you can configure the connection here. This step can be skipped and done later in **Settings → I2P**.

- **Browser:** Configure SAM proxy connection (see [I2P Setup](I2P-Setup))
- **Android:** Install i2pd from F-Droid and start it — SecuChat connects automatically
- **Desktop:** I2P is bundled and configured automatically

### Step 5 — Done

Your profile is saved to local storage (IndexedDB / SQLite / Capacitor Preferences depending on platform). The app opens to the main chat view.

## Locking and Unlocking

The app auto-locks after a configurable timeout (default: 5 minutes). When locked:

- The PGP private key is cleared from memory
- No messages can be sent or decrypted
- I2P does not connect

To unlock, enter your passphrase. The app decrypts the stored keys and reconnects to I2P.

You can also lock manually via the header menu.

## Backup

After setup, export a backup via **Settings → Backup**. Backups use Age encryption (v3.0-age format) and produce two files: the encrypted backup and a separate decryption key. Store both somewhere safe — they are the only way to restore your identity.
