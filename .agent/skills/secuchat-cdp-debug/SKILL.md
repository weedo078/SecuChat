---
name: secuchat-cdp-debug
description: Inspect and drive the SecuChat Android WebView via Chrome DevTools Protocol (CDP) for debugging — DOM snapshots, console.log capture, JS eval, screenshot triggers. Use whenever a UI bug needs evidence from inside the running Capacitor app and the DevBridge (see secuchat-dev-bridge skill) cannot reach the data — e.g. "what is the scanner DOM rendering?", "read the React state of X", "did scanOnce() ever run?". Triggers: "cdp", "chrome devtools", "webview inspect", "console.log capture", "evaluate in app", "Runtime.evaluate", "check rendered DOM".
---

# SecuChat CDP Debug (WebView Inspection)

## When to use

Reach for this skill when you need **live evidence from inside the running SecuChat Android WebView** — DOM, JS state, console output, network — and the DevBridge can't reach it (DevBridge only knows the `__secuchatDevBridge` API surface; CDP reaches anything in the page).

Common cases:
- "Camera opens but nothing decodes" — check DOM, `MediaStreamTrack.readyState`, `<video>` pixel data
- "Dialog should be open but I can't see it" — query DOM, check React props via fiber keys
- "App crashes silently after X" — capture `Runtime.exceptionThrown` + console history
- "What does `localStorage` say right now?" — read directly
- "Did `scanOnce()` even start?" — read `console.log` history

Don't use for:
- State mutation that already has a DevBridge route (use `secuchat-dev`)
- Pure UI screenshots (use `mobile_take_screenshot` via MCP, or `adb shell screencap`)
- Browser-side work — Capacitor WebView only

## Architecture (one-liner)

```
Host  ─adb forward tcp:9223─>  localabstract:webview_devtools_remote_<PID>
                                                                 │
                                                                 └─ Chrome DevTools Protocol (HTTP /json, WS /devtools/page/<id>)
```

The Capacitor Android WebView (Chrome ≥ 84) listens on `localabstract:webview_devtools_remote_<PID>`. Forward the **abstract socket name** to a host TCP port; CDP serves `/json/version`, `/json/list`, and `ws://…/devtools/page/<id>`.

**chrome-devtools-MCP works NOT for this** (verified 2026-08-02 in [[secuchat-android-testing]] + re-confirmed today 2026-08-12): it spawns its own Chrome instance, can't attach to the existing WebView. Use a raw WebSocket CDP client.

## Prerequisites (every device session)

```bash
# 1. Find PID — the WebView socket name depends on it, and changes after every app restart
PID=$(adb -s <SERIAL> shell pidof com.secuchat.app | tr -d '\r')
echo "PID=$PID"

# 2. Forward WebView abstract socket → host TCP
adb -s <SERIAL> forward --remove-all   # clean stale forwards first
adb -s <SERIAL> forward tcp:9223 localabstract:webview_devtools_remote_$PID

# 3. Verify
curl -s http://localhost:9223/json/version | jq -r '.["Android-Package"]'
# → "com.secuchat.app"
curl -s http://localhost:9223/json/list | jq -r '.[] | select(.type=="page") | .webSocketDebuggerUrl'
# → "ws://localhost:9223/devtools/page/B3D33E9DCD24C825E07FFBE382AFD804"
```

**Critical pitfalls:**
- `adb forward` is **lost when the bash shell exits** (each `Bash` tool call is a fresh shell). Re-run the whole sequence at the start of each session.
- `forward --remove-all` first — old forwards silently persist and confuse `curl localhost:9223`.
- The PID-based socket name means: **any** `am force-stop` + `am start`, or any `Page.reload`, can give the WebView a new PID. After a reload, re-query `/json/list` and use the new page WS URL.
- Multiple Android devices connected (`adb devices` shows 2-3 serials) → CDP forward is **device-specific**: always use `adb -s <SERIAL>`, not bare `adb`.

## The raw Python WebSocket client (no library, no Origin header)

The `chrome-devtools-MCP` issue (it spawns its own Chrome) also affects the bundled CDP libraries that require Origin headers — Chrome 150 rejects WS upgrade with 403 if `Origin` doesn't match. **Skip the WS libraries**, use this 90-line Python helper that omits `Origin` entirely:

```python
#!/usr/bin/env python3
"""Minimal CDP client. Usage: feed this script via heredoc, no save needed."""
import json, socket, base64, os, struct, time, sys

WS_URL = "ws://localhost:9223/devtools/page/<PAGE_ID>"  # from /json/list
sock = socket.create_connection(("localhost", 9223))
sock.settimeout(15)
key = base64.b64encode(os.urandom(16)).decode()
sock.send((
    f"GET {WS_URL.replace('ws://localhost:9223','')} HTTP/1.1\r\n"
    f"Host: localhost:9223\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
    f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n"
).encode())
resp = b""
while b"\r\n\r\n" not in resp:
    resp += sock.recv(4096)
assert b"101" in resp, f"No WS upgrade: {resp[:200]}"

_id = [0]
def send(method, params=None):
    _id[0] += 1
    msg = {"id": _id[0], "method": method}
    if params: msg["params"] = params
    pl = json.dumps(msg).encode()
    h = bytearray([0x81]); l = len(pl)
    if l < 126: h.append(0x80 | l)
    elif l < 65536: h.append(0x80 | 126); h += struct.pack(">H", l)
    else: h.append(0x80 | 127); h += struct.pack(">Q", l)
    mask = os.urandom(4); h += mask
    sock.send(h + bytes(b ^ mask[i % 4] for i, b in enumerate(pl)))
    return _id[0]

def recv_frame():
    head = b""
    while len(head) < 2: head += sock.recv(2 - len(head))
    ln = head[1] & 0x7F
    if ln == 126:
        e = b""
        while len(e) < 2: e += sock.recv(2 - len(e))
        ln = struct.unpack(">H", e)[0]
    elif ln == 127:
        e = b""
        while len(e) < 8: e += sock.recv(8 - len(e))
        ln = struct.unpack(">Q", e)[0]
    body = b""
    while len(body) < ln: body += sock.recv(ln - len(body))
    return body

def call(method, params=None, timeout=8):
    myid = send(method, params)
    end = time.time() + timeout
    sock.settimeout(timeout)
    while time.time() < end:
        try: body = recv_frame()
        except socket.timeout: return None
        msg = json.loads(body)
        if msg.get("id") == myid: return msg
    return None

# Examples:
r = call("Runtime.evaluate", {"expression": "document.title", "returnByValue": True})
print(r["result"]["result"]["value"])

r = call("Runtime.evaluate", {
    "expression": "document.querySelector('#qr-scanner-element')?.textContent?.trim()",
    "returnByValue": True
})
print(r["result"]["result"]["value"])
```

**Key insight:** the WS request has no `Origin:` header. Standard Python `websocket-client` would add one → Chrome 150 returns 403. The raw socket above omits it by construction.

## Common CDP patterns

### 1. DOM snapshot (what's rendered right now?)

```python
r = call("Runtime.evaluate", {
    "expression": """
    Array.from(document.querySelectorAll('button, a, [role=button]'))
        .map(b => ({
            text: (b.textContent||'').trim().slice(0,40),
            aria: b.getAttribute('aria-label')||'',
            x: Math.round(b.getBoundingClientRect().x + b.getBoundingClientRect().width/2),
            y: Math.round(b.getBoundingClientRect().y + b.getBoundingClientRect().height/2),
        }))
        .filter(b => b.text || b.aria)
    """,
    "returnByValue": True
})
print(json.dumps(r["result"]["result"]["value"], indent=2))
```

Multiplies x/y by DPR (1.17 for A50) when feeding back into `adb shell input tap`.

### 2. Console.log capture (passive monitor)

Use **before** triggering the action you want to diagnose:

```python
sock.settimeout(0.5)
send("Runtime.enable")
# (trigger the action in another way — bash adb tap, or Page.evaluate below)
deadline = time.time() + 15
while time.time() < deadline:
    try: body = recv_frame()
    except socket.timeout: continue
    msg = json.loads(body)
    if msg.get("method") == "Runtime.consoleAPICalled":
        args = msg["params"].get("args", [])
        text = " ".join(str(a.get("value", a.get("description", "?"))) for a in args)
        kind = msg["params"].get("type", "log").upper()
        print(f"[{kind}] {text[:300]}")
    elif msg.get("method") == "Runtime.exceptionThrown":
        print(f"[EXC] {json.dumps(msg['params'].get('exceptionDetails', {}))[:300]}")
```

If you see **no console events at all**: the WebView is not the page you think (re-run `/json/list`), or the page was backgrounded (Capacitor freezes background pages — bring it forward with `am start` + tap screen first).

### 3. React fiber state read (hard, but possible)

React stores internal state on DOM elements via `__reactFiber$xxx` and `__reactProps$xxx` keys. Walk the fiber tree to find the right component:

```javascript
const el = document.querySelector('#qr-scanner-element');
const fiberKey = Object.keys(el).find(k => k.startsWith('__reactFiber'));
const fiber = el[fiberKey];
// Walk up to find the right component, then read memoizedProps / memoizedState
```

This is fragile (depends on React internals). Prefer observable side-effects (`setState` → DOM update, `console.log` from inside the component) over fiber-spelunking.

### 4. Promises + async work (the gotcha)

`Runtime.evaluate` with `awaitPromise: true` blocks the WebView's JS thread until the promise resolves. If your expression creates a `getUserMedia` stream that never resolves (e.g. camera already held by another caller), `awaitPromise: true` will **hang forever** and CDP appears dead. Fixes:

- Wrap your expression in `Promise.race` with a timeout
- Use `awaitPromise: false` and instead poll a global variable you set inside
- Or just don't use `awaitPromise`: the call returns the synchronous result, and async work happens but you can't observe it

### 5. Force page reload (after localStorage change)

```python
call("Page.enable")
call("Page.reload", {"ignoreCache": True})
# wait ~3s, then re-query /json/list for new page ID
```

## Worked example: confirming the QR scanner bug

Symptom: scanner shows placeholder text but `[QR-Scan] decoded:` never appears in logcat. Three things to check via CDP:

```python
# 1. Is the scanner component mounted?
call("Runtime.evaluate", {
    "expression": "!!document.querySelector('#qr-scanner-element')",
    "returnByValue": True
})

# 2. Does ImageCapture API exist?
call("Runtime.evaluate", {
    "expression": "typeof ImageCapture",
    "returnByValue": True
})

# 3. Capture console for 10s while user scans
#    (if no console events → React didn't mount scanOnce() → look at useEffect deps)
```

## When CDP fails silently

The most common failure mode (today's session, 2026-08-12): CDP accepts the WS upgrade, Runtime.evaluate returns `None` (no response), and logcat shows nothing. Likely causes:

1. **App is on the welcome screen / not onboarded** — `setTimeout(scanOnce, …)` never fires because `<QRContactScanner />` never renders. Verify with `document.title` (should be `"SecureChat"` regardless) and a body text snippet (should mention Chats).
2. **WebView page was backgrounded** — `am start org.purplei2p.i2pd` brings i2pd to foreground and pauses Capacitor. Always follow with `am start com.secuchat.app/.MainActivity` and **re-query `/json/list`** (new page ID).
3. **The Android app was force-stopped while CDP was open** — abstract socket disappears, WS closes silently. Re-establish the forward with a fresh PID.
4. **Two devices, one forward** — if you set up the forward on A50 but your `adb shell pidof` was on A52 (or vice versa), CDP talks to a stale socket. Always specify `-s <SERIAL>`.

## Related

- `~/.claude/skills/secuchat-dev-bridge/SKILL.md` — programmatic state mutation (use when CDP can't reach it). Shares the WebView-forward prereq step 1.
- [[secuchat-android-testing]] — full Android test setup, multi-device E2E workflow
- [[secuchat-android-bugs-2026-08-11]] — CAMERA permission + share-blocked banner bugs; live evidence collected via this skill