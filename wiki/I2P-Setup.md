# I2P Setup

SecuChat routes all traffic through the [I2P](https://geti2p.net/) anonymous network. Because browsers cannot open raw TCP connections, a small WebSocket proxy bridges the gap between the app and the i2pd SAM API.

## Architecture

```
Browser (SecuChat)
    │  WebSocket ws://127.0.0.1:7657
    ▼
sam-proxy  (Node.js, sam-proxy/proxy.mjs)
    │  TCP
    ▼
i2pd  (SAM API, port 7656)
    │
    ▼
I2P network
```

You need **both** i2pd and the sam-proxy running locally.

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

Install **i2pd** from [F-Droid](https://f-droid.org/packages/org.purplei2p.i2pd/).

---

## Step 2 — Enable the SAM API

Edit your i2pd configuration file:

| OS | Config path |
|----|------------|
| Linux | `/etc/i2pd/i2pd.conf` |
| macOS (Homebrew) | `/usr/local/etc/i2pd/i2pd.conf` |
| Windows | `%APPDATA%\i2pd\i2pd.conf` |
| Android | i2pd app → Settings → SAM |

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
Open the i2pd app and tap Start
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

## Step 5 — Configure SecuChat

1. Open **Settings → I2P**
2. Enable **SAM Bridge**
3. Set host to `127.0.0.1`, port to `7657`
4. Click **Test connection**

A green indicator means the connection is working. A yellow indicator means SAM is connected but inbound tunnels are not yet established (wait 1–3 minutes).

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
