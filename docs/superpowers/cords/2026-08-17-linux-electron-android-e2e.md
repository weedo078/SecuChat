# Cord: Linux Electron ↔ Android A50 Cross-Platform Chat (manual)

**Date:** 2026-08-17
**Scope:** Validate that Linux SecuChat (Electron + Java I2P) and Android SecuChat
(Capacitor + native SAM plugin + i2pd) can exchange a real message bidirectionally.
**Status today:** **SKIP UNTIL PHASE-2 LANDS** — see top section.

---

## ⚠ Skip until Phase-2 lands

The Linux Electron client uses an I2CP (`port 7654`) transport to its local
Java I2P router. Today `I2CPSocketManager.initialize()` is a TCP-only stub:
the full I2CP `CreateSessionMessage` + `SessionStatusMessage` handshake is a
Phase-2 follow-up (tracked separately, not in scope of Task 18).

Because the handshake is stubbed, `i2pInvoke('start', …)` returns the literal
sentinel:

```
'placeholder-b32-will-be-set-by-i2p-router'
```

instead of a real `<52 chars>.b32.i2p` address. The Android side's
`parseConnectToOpts()` rejects the placeholder, so neither Linux→Android
nor Android→Linux can complete end-to-end today.

**Code reference:** `electron/src/i2p/i2cp-socket-manager.ts:94-96`
(the `this.b32Address = 'placeholder-…'` assignment).

**Once Phase-2 lands**, run the cord below verbatim. You do NOT need any
DevBridge expertise — every command is spelled out.

---

## Prerequisites

### Linux host (test box)

- Java I2P running locally, I2CP port reachable on `127.0.0.1:7654`.
  Verify: `nc -z 127.0.0.1 7654 && echo OK`
  Install: `sudo /home/g/dev/SecuChat/.github/scripts/setup-linux-i2p.sh`
- SecuChat Linux build at `/opt/SecuChat/securechat` (Electron binary +
  `app.asar`). DISPLAY set to `:10.0` (matches `secuchat-linux-e2e-contact-swap-2026-08-12`).
- `adb` on PATH (`apt install adb` or equivalent).
- Android device (A50) attached via USB and authorized for ADB
  (`adb devices` shows it in `device` state, not `unauthorized`).

### Android device (A50)

- SecuChat APK installed with Test-Mode enabled:
  - `localStorage['secuchat_test_mode'] = '1'`
  - `localStorage['secuchat_auto_onboard'] = '1'`
- i2pd daemon running on the device, LeaseSet published.
  Quick check: open SecuChat on the device → Chat view loads → no red
  "i2p disabled" banner.

If Test-Mode is NOT yet enabled, the one-time setup is in
`~/.claude/skills/secuchat-dev-bridge/SKILL.md` ("Test-Mode-Reihenfolge"
section). The cord assumes Test-Mode is already on — re-running the
setup breaks the device's auto-onboard.

---

## Step 0 — One-time forward setup

The Android DevBridgePlugin listens on `127.0.0.1:8888` on the device.
Bridge it to the host:

```bash
# Pick a host port that doesn't collide. A50 → 8887 is the convention
# used by secuchat-dev bridge skill (A52 → 8889, A54 → 8891).
SERIAL=$(adb devices | awk '/\tdevice$/{print $1; exit}')
HOST_PORT=8887
adb -s "$SERIAL" forward tcp:"$HOST_PORT" tcp:8888

# Verify the bridge is up.
curl -fsS "http://127.0.0.1:${HOST_PORT}/health"
# Expected: {"ok":true,"running":true}
```

If you see `connection refused`, the bridge isn't installed or the APK
isn't Test-Mode-enabled. Re-check Prerequisites → Android device.

---

## Step 1 — Bring up Linux Electron

```bash
export DISPLAY=:10.0
/opt/SecuChat/securechat --no-sandbox &
LINUX_PID=$!

# Wait for the renderer to be ready. The Linux app shows a Contact List.
# Visual check: the Contact List view should appear within ~5 s.
sleep 5
```

If the Electron window doesn't appear, check:

```bash
# Renderer log on stderr (uncomment in main.ts if needed).
# Common culprit: app/dist/index.html missing — rebuild with
#   cd /home/g/dev/SecuChat/app && npm run build
```

---

## Step 2 — Linux → Android: contact swap

The Linux app starts as a brand-new identity (no contacts). Bring the
Linux identity over to the device and the Android identity over to Linux
via DevBridge:

```bash
SERIAL=$(adb devices | awk '/\tdevice$/{print $1; exit}')
HOST_PORT=8887

# 2a. Export the Linux identity via Linux's own DevBridge (if enabled) OR
#     transfer via the Android bridge by swapping in the OPPOSITE direction:
#     we use the Android-side DevBridge to call /eval on a Linux-side
#     helper. The simpler path is to use the Linux Electron's own
#     "Export Contact" UI button. Corded alternative below:

# EASIEST: use the Android-side DevBridge to call /identity on the
# Linux app via its own DevBridge if exposed. If not, fall back to
# the UI: Linux → Settings → Export Identity → save .secuchat → push
# to device via `adb push`.

# 2b. Pull Android's identity via DevBridge:
LINUX_B64=$(curl -fsS "http://127.0.0.1:${HOST_PORT}/export-contact" \
  -X POST --data '{}' \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["result"]["content"])')

# Sanity: it's a v2 .secuchat string.
echo "$LINUX_B64" | head -c 80
# Expected: v2:eJ...

# 2c. Push the Android contact into Linux via the Linux app's
#     IPC. Today Linux doesn't expose a contact-import bridge, so we
#     use the Linux app's own UI: Settings → Import Contact → paste.
echo "$LINUX_B64" | xclip -selection clipboard
# Then click into the Linux app and Ctrl+V into the import dialog.

# 2d. Reverse direction: export Linux identity, import into Android.
# Repeat the same dance in reverse:
#   - In Linux app: Settings → Export Identity → copy to clipboard
#   - On Android: paste into Add Contact dialog
# (Or use the Linux-side DevBridge if you've enabled it; the cord
# assumes the UI flow for both sides for simplicity.)
```

If both contacts appear in each side's Contact List (Linux shows "A50",
Android shows "Linux"), Step 2 is done.

---

## Step 3 — Linux → Android: send a message

```bash
# In the Linux Electron app:
#   - Click the Android contact
#   - Type a message in the input field
#   - Press Enter / click Send
#
# Expected: the chat view shows the message with a check mark / "delivered"
# status. (Electron renderer writes to local IndexedDB via the storage IPC
# bridge.)
```

Verify on the Android side:

```bash
# Open the Android SecuChat app on A50.
# The contact list should show an unread badge on the Linux contact.
# Tap into the chat: the message sent from Linux should appear.

# Programmatic verification via DevBridge:
curl -fsS "http://127.0.0.1:${HOST_PORT}/state" | python3 -m json.tool
# Expected: the Linux contact has a chat with the message we just sent.
```

---

## Step 4 — Android → Linux: send a message back

In the Android app, open the chat with Linux and send a reply.

Verify on the Linux side:

```bash
# In the Linux Electron app: the Linux contact should now have a chat
# with the reply visible. The renderer decrypts via openpgp (no IPC
# to Java I2P needed for the read path).
```

---

## Step 5 — Pass criteria

All of the following must be true:

- [ ] Linux Electron launches with renderer loads (Step 1).
- [ ] Linux Contact List shows A50 after import (Step 2).
- [ ] Android Contact List shows Linux after import (Step 2).
- [ ] Linux → Android message appears in Android chat (Step 3).
- [ ] Android → Linux message appears in Linux chat (Step 4).
- [ ] `/state` on Android DevBridge reports the bidirectional chats.

If all six are green, write a memory note at:

```
/home/g/.claude/projects/-home-g-dev-SecuChat/memory/secuchat-i2p-desktop-e2e-2026-08-17.md
```

Title: **"Cross-platform chat Linux Electron ↔ Android A50 verified"**
Body:

```markdown
---
name: secuchat-i2p-desktop-e2e-2026-08-17
description: "<one-line summary>"
metadata:
  modified: <ISO date>
---

# Cross-Platform Chat Linux Electron ↔ Android A50 (manual cord passed)

**Date:** <date>
**Branch:** feat/android-port
**Setup:** DISPLAY=:10.0, /opt/SecuChat/securechat, A50 Test-Mode.

## Result

PASS — bidirectional chat verified end-to-end between Linux Electron
(SecuChat 1.0.x, Electron 42.x, Java I2P I2CP) and Android Capacitor
(SecuChat 1.0.x, net.i2p.android i2pd, native SAM plugin).

## Setup notes

- DevBridge host port: 8887 (A50 convention).
- Linux → Android: <describe any quirks>.
- Android → Linux: <describe any quirks>.

## Files

- Cord: docs/superpowers/cords/2026-08-17-linux-electron-android-e2e.md
- Test: electron/tests/e2e/cross-platform-chat.test.ts (was test.skip,
        un-skipped as part of this run).
```

---

## Step 6 — If something fails

Common failure modes (see memory `secuchat-android-bridge-e2e-2026-08-04`
and `secuchat-linux-caps-lud-diagnose-2026-08-14` for full history):

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `curl /health` connection refused | DevBridgePlugin disabled or APK old | Reinstall the latest Test-Mode APK; re-enable via CDP |
| `LeaseSet not found` on Linux → Android | Linux Java I2P behind firewall (Caps=LUD) | See `secuchat-linux-caps-lud-diagnose-2026-08-14`. No code fix today — symptom is environmental. |
| `LeaseSet not found` on Android → Linux | Android i2pd in STREAM-only mode (default client tunnels deleted) | User-side: re-create default client tunnels in net.i2p.android settings |
| Message stuck "pending" | STREAM CONNECT timing — see `secuchat-i2pd-stream-architecture-2026-08-05` | Wait 30 s; if still stuck, restart the sender |
| Linux app blank screen after launch | APP_DIST path resolution — see Task 17 Bug 1 | Rebuild: `cd app && npm run build` |

---

## Step 7 — When Phase-2 lands

1. Remove the `⚠ Skip until Phase-2 lands` block at the top of this file
   (replace with `## Status: ACTIVE`).
2. Open `electron/tests/e2e/cross-platform-chat.test.ts` and replace
   `test.skip(...)` with the roundtrip body documented in the test
   docstring.
3. Run the cord end-to-end and capture the memory note at the path above.