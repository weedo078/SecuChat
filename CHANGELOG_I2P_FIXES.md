# I2P Connectivity Fixes - Changelog

**Date:** 2026-02-23  
**Author:** Kimi Agent Swarm  
**Scope:** I2P Manager Integration for SecuChat

---

## Overview

These changes fix critical I2P connectivity issues in SecuChat through a robust, modular I2P management system.

---

## New Files

### 1. `electron/src/i2p-manager.ts` (NEW)
**Description:** Complete I2P management class  
**Functions:**
- Robust path resolution for various environments (Dev/Production)
- Automatic certificate copying on first start
- Linux: Automatic `chmod +x` for i2pd binary
- Increased timeout (45s instead of 20s) for slower systems
- File-based logging (`~/.config/SecuChat/logs/i2pd.log`)
- Graceful shutdown with SIGTERM → SIGKILL fallback
- Port checking with configurable intervals

**Exports:**
- `I2PManager` - Class for advanced usage
- `startI2pd()` - Starts i2pd and waits for SAM port
- `stopI2pd()` - Stops i2pd process
- `isI2pReady()` - Checks SAM port availability
- `getI2PManager()` - Singleton accessor

### 2. `electron/scripts/setup-i2pd.sh` (NEW)
**Description:** Linux setup script for i2pd  
**Functions:**
- Downloads i2pd binary if not present
- Checks system architecture
- Sets correct permissions
- Optional systemd service creation

**Usage:**
```bash
chmod +x scripts/setup-i2pd.sh
./scripts/setup-i2pd.sh --download --create-service
```

### 3. `electron/scripts/setup-i2pd.ps1` (NEW)
**Description:** Windows PowerShell setup script  
**Functions:**
- Automatic download of i2pd binary
- Architecture detection (x64/x86)
- Firewall rule creation
- Visual C++ Redistributables check

**Usage:**
```powershell
Set-ExecutionPolicy -ExecutionPolicy Bypass -Scope Process
.\scripts\setup-i2pd.ps1 -Download -Verify
```

### 4. `electron/scripts/after-install.sh` (NEW)
**Description:** Post-install script for Linux DEB packages  
**Function:** Sets permissions after installation

### 5. `electron/scripts/after-remove.sh` (NEW)
**Description:** Post-remove script for Linux DEB packages  
**Function:** Cleanup on uninstall

---

## Modified Files

### 1. `electron/src/main.ts` (OVERWRITTEN)
**Changes:**
- Removed: Inline I2PD start logic
- Removed: Inline SAM proxy (WebSocketServer)
- Removed: `APP_ROOT` constant with Non-Null Assertion
- Removed: `waitForPort`, `setupI2pdDataDir`, `isI2pdRunning` functions
- Removed: `startI2pd`, `stopI2pd` functions (now from i2p-manager)
- Removed: `startSamProxy`, `stopSamProxy` functions

**New:**
- Imports I2P functions from `./i2p-manager`
- `initializeI2P()` - Wrapper with status management
- Dialog warning if I2P doesn't start (Continue/Exit)
- `i2p:restart` IPC handler
- `i2p:status` IPC handler returns SAM info
- Error handling for uncaughtException/unhandledRejection

**I2P IPC Channels:**
- `i2p:status` - Returns current I2P status
- `i2p:restart` - Restarts i2pd

### 2. `electron/electron-builder.json` (UPDATED)
**Changes:**
```json
{
  "asar": false,  // NEW: Important for binary access
  ...
  "nsis": {
    ...
    "include": "installer.nsh"  // FIXED: Missing comma corrected
  }
}
```

**Reason for `asar: false`:**
The i2pd binary must be directly executable from the filesystem. ASAR archiving blocks access to native binaries.

---

## Fixed Issues

| Priority | Issue | Status |
|-----------|---------|--------|
| 🔴 Critical | `APP_ROOT` undefined | ✅ Solved via `getAppRoot()` function |
| 🔴 Critical | Certificates not copied | ✅ Solved via `copyCertificates()` |
| 🔴 Critical | Linux executable permissions | ✅ Solved via `ensureExecutable()` |
| 🟠 High | Timeout too short (20s) | ✅ Increased to 45s |
| 🟠 High | Missing error handling | ✅ Complete try-catch blocks |
| 🟡 Medium | No logging | ✅ Log files in `~/.config/SecuChat/logs/` |
| 🟡 Medium | No port conflict check | ✅ Port check before start |
| 🟡 Medium | Syntax error in electron-builder.json | ✅ Corrected |

---

## I2P Log Files

After starting, logs can be found at:

| File | Description |
|-------|-------------|
| `~/.config/SecuChat/logs/i2pd.log` | Console output from i2pd |
| `~/.config/SecuChat/logs/i2pd-internal.log` | Internal i2pd logs |

---

## SAM Configuration

The app connects directly to i2pd via SAM:

```
Host: 127.0.0.1
Port: 7656 (SAM)
HTTP Console: http://127.0.0.1:7070
```

---

## Build Instructions

### Linux
```bash
cd electron
npm run build
npm run dist:linux
```

### Windows
```bash
cd electron
npm run build
npm run dist:win
```

---

## Testing

1. **Development:**
   ```bash
   cd electron
   npm run dev
   ```

2. **Test packaged app:**
   ```bash
   # Linux
   ./release/SecuChat-0.0.38.AppImage
   
   # Or install DEB
   sudo dpkg -i release/secuchat_0.0.38_amd64.deb
   ```

3. **Log monitoring:**
   ```bash
   tail -f ~/.config/SecuChat/logs/i2pd.log
   ```

---

## Known Limitations

- macOS support may require adjustments
- ARM architecture needs separate i2pd binaries
- Windows: VC++ Redistributables must be installed

---

## Support

For issues:
1. Check logs: `~/.config/SecuChat/logs/`
2. Consult `TROUBLESHOOTING.md`
3. Create an issue with logs and system info
