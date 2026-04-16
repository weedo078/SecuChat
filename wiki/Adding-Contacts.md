# Adding Contacts

SecuChat has no central directory. To chat with someone, you exchange a **contact file** out-of-band (via Signal, email, USB, etc.) and import it into the app.

## Contact File Format

A contact file (`.secuchat`) contains everything needed to reach and encrypt messages for someone:

- Display name
- I2P address (`.b32.i2p`)
- PGP public key
- PGP fingerprint

The file is plain JSON. There is no server involved in this exchange.

## Method 1 — File Import (recommended)

This is the standard method. It includes the full PGP public key and enables end-to-end encryption immediately.

### Sharing your own contact file

1. Open **Add Contact** → **My File** tab
2. Click **Save `<username>.secuchat`**
3. Send the downloaded file to your contact through any side channel

> **Note:** Your I2P address is only available after you have connected to I2P at least once. If the export button is disabled, connect first via **Settings → I2P**.

### Importing a contact's file

1. Receive the `.secuchat` file from your contact
2. Open **Add Contact** → **Import** tab
3. Click the upload area and select the file
4. Review the displayed name, I2P address and fingerprint
5. Click **Add**

The app validates the PGP key before saving. If I2P is connected, it attempts to establish a stream to the contact immediately.

## Method 2 — Manual Entry

Use this if you already know someone's I2P address and PGP public key (e.g. they published them somewhere).

1. Open **Add Contact** → **Manual** tab
2. Fill in:
   - **Name** — any label you choose
   - **I2P address** — the full `.b32.i2p` address
   - **PGP Public Key** — the full ASCII-armored PGP block starting with `-----BEGIN PGP PUBLIC KEY BLOCK-----`
3. Click **Add Contact**

The PGP key is validated before saving. An invalid key is rejected.

## Contact Status

After adding a contact, their status is shown as:

| Status | Meaning |
|--------|---------|
| `unknown` | Not yet attempted to connect |
| `connecting` | I2P stream in progress |
| `online` | I2P stream established |
| `offline` / `disconnected` | Stream failed or timed out |

Status is not persisted — it resets to `unknown` on each app restart.

## Contact Verification (Safety Numbers)

After adding a contact, you can verify their identity using **safety numbers**:

1. Open the contact's chat → tap the verification icon
2. A **safety number** is generated from both your PGP fingerprints
3. Compare the safety number with your contact through a trusted out-of-band channel

Two verification methods are available:

| Method | Description |
|--------|-------------|
| **QR code** | Scan each other's QR codes in person |
| **6-word phrase** | Human-readable phrase derived from the safety number — read it aloud or compare manually |

Verified contacts show a verification badge in the chat. If either party's keys change, the safety number changes and the badge is removed — alerting you to potential man-in-the-middle interference.

---

## Troubleshooting

**"Export not possible — I2P never connected"**
Connect to I2P first (Settings → I2P → Enable SAM → Test connection), then export.

**"Invalid PGP public key"**
The file may be corrupted or in an unsupported format. Ask your contact to re-export their contact file.

**Contact shows as offline even though they are online**
I2P LeaseSet propagation can take 1–3 minutes after the peer connects. Wait and the status will update automatically when the next connection attempt succeeds.
