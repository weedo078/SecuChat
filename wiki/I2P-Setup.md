# I2P Setup

SecuChat routes all traffic through the [I2P](https://geti2p.net/) anonymous network. Setup differs by platform:

## Architecture

```
Browser (PWA)           Android               Desktop (Electron)
    │ WS :7657            │ TCP :7656           │ WS :7657 (bundled)
    ▼                     ▼                     ▼
sam-proxy              samNative            bundled sam-proxy
    │ TCP :7656           │ I2CP :7654          │ TCP :7656
    ▼                     ▼                     ▼
i2pd                  Java I2P              bundled i2pd
    │                     │                     │
    ▼                     ▼                     ▼
                 I2P network
```

### Browser PWA — You need both i2pd and sam-proxy running manually
### Android — Install Java I2P from the Play Store, app connects natively via I2CP (no proxy needed)
### Desktop — i2pd and SAM proxy are bundled, started automatically

---

## Step 1 — Install i2pd

### Linux (Debian / Ubuntu)

```bash
sudo apt install i2pd
```

### Linux (Arch)

```bash
sudo pacman -S i2pd
```

### Linux (Fedora)

```bash
sudo dnf install i2pd
```

### macOS

```bash
brew install i2pd
```

### Windows

Download the installer from the [i2pd releases page](https://github.com/PurpleI2P/i2pd/releases).

### Android

Install **Java I2P** (`net.i2p.android`) from the [Google Play Store](https://play.google.com/store/apps/details?id=net.i2p.android).

After installation:

1. Open Java I2P — on first launch, set the language (e.g. English).
2. Go to **Settings → Advanced** and enable the **I2CP** toggle.
3. Go to **Settings → Bandwidth and Network**:
   - Enable "Activate on boot".
   - Set upload and download bandwidth to **Maximum**.
   - Enable **UPnP**.
4. Start Java I2P (long-press to start) and return to SecuChat.

SecuChat will automatically connect via I2CP on port 7654; the SAM plugin then talks to port 7656.

---

## Step 2 — Enable the SAM API

Edit your i2pd configuration file:

| OS | Config path |
|----|------------|
| Linux | `/etc/i2pd/i2pd.conf` |
| macOS (Homebrew) | `/usr/local/etc/i2pd/i2pd.conf` |
| Windows | `%APPDATA%\i2pd\i2pd.conf` |
| Android | Java I2P app → Settings → Advanced → I2CP |

Add or uncomment:

```ini
[sam]
enabled = true
address = 127.0.0.1
port = 7656
```

---

## Step 3 — Start i2pd

```bash
# Linux systemd
sudo systemctl enable --now i2pd

# macOS / manual
i2pd --sam.enabled=true --sam.address=127.0.0.1 --sam.port=7656

# Android
Open the Java I2P app and long-press to start
```

**First start:** i2pd needs 5–10 minutes to integrate into the I2P network and build inbound tunnels. Subsequent starts are much faster.

---

## Step 4 — Start the SAM proxy

The proxy ships with SecuChat in `sam-proxy/`.

```bash
cd sam-proxy
npm install   # first time only
npm start
```

The proxy listens on **port 7657** by default and forwards to i2pd on port 7656.

---

## Step 5 — Configure SecuChat (Browser)

1. Open **Settings → I2P**
2. Enable **SAM Bridge**
3. Set host to `127.0.0.1`, port to `7657`
4. Click **Test connection**

A green indicator means the connection is working. A yellow indicator means SAM is connected but inbound tunnels are not yet established (wait 1–3 minutes).

---

## Android Setup

Android connects to Java I2P natively via the SAM plugin — no WebSocket proxy needed.

### Step 1 — Install Java I2P

Install **Java I2P** (`net.i2p.android`) from the [Google Play Store](https://play.google.com/store/apps/details?id=net.i2p.android).

### Step 2 — Set language (first launch)

On first launch, Java I2P asks you to pick a language (e.g. English). Make your selection; this is a one-time step.

### Step 3 — Enable I2CP

In Java I2P, go to **Settings → Advanced** and enable the **I2CP** toggle. SecuChat uses I2CP on port `7654` to talk to the Java I2P router.

### Step 4 — Configure bandwidth and network

In **Settings → Bandwidth and Network**:

- Enable **"Activate on boot"** so Java I2P starts automatically with the device.
- Set **upload and download bandwidth** to **Maximum** (or the highest profile your plan supports).
- Enable **UPnP** so inbound tunnels can be established without manual port forwarding.

### Step 5 — Start Java I2P

Start Java I2P by **long-pressing** the router entry in the app. Wait 5–10 minutes for the first integration into the I2P network.

### Step 6 — Use SecuChat

Open SecuChat. The app connects to Java I2P directly via the native SAM plugin (talking to I2CP on port 7654, then SAM on port 7656). No additional configuration needed.

The background service (`backgroundService`) keeps the I2P connection alive when the app is backgrounded.

---

## Desktop (Electron) Setup

The Electron app bundles both i2pd and the SAM proxy — setup is largely automatic.

### Step 1 — Install SecuChat Desktop

Download the installer for your platform (see [Build & Deploy](Build-and-Deploy)) and install it.

### Step 2 — First launch

On first launch, the Electron main process automatically:
1. Starts i2pd from the bundled binary
2. Starts the internal SAM proxy on port 7657
3. Connects the app

Just wait for the green status indicator. The initial I2P integration takes 5–10 minutes on first run.

> If you prefer to use your own i2pd installation instead of the bundled one, you can configure it in **Settings → I2P**.

---

## Status Indicators

The header shows a colored dot:

| Color | Meaning |
|-------|---------|
| Green | SAM connected, inbound tunnels ready |
| Yellow | SAM connected, tunnels building |
| Red | Not connected |

---

## Troubleshooting

**"SAM proxy not reachable"**
Make sure `npm start` is running in `sam-proxy/` and that port 7657 is not blocked by a firewall.

**"SAM connection failed"**
i2pd may not be running, or SAM is not enabled in its config. Check `sudo systemctl status i2pd`.

**Peer unreachable / CANT_REACH_PEER**
The other user's I2P node has not published its LeaseSet yet. Wait 1–3 minutes and retry. This is normal on first connection.

**Cannot reach the app at all after restart**
i2pd assigns a stable address only when you reuse the same SAM destination (private key). SecuChat stores this automatically. If you deleted local storage, a new address is generated.
