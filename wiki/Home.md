# SecuChat Wiki

SecuChat is a privacy-focused cross-platform messaging app with end-to-end PGP encryption and I2P network routing for anonymity. It runs as a **browser PWA**, an **Android app** (via Capacitor), and a **desktop app** (via Electron).

## For Users

| Page | Description |
|------|-------------|
| [Getting Started](Getting-Started) | First-run setup: name, passphrase, key generation |
| [Adding Contacts](Adding-Contacts) | Import contact files, manual entry |
| [I2P Setup](I2P-Setup) | I2P setup per platform (browser, Android, desktop) |
| [Security Model](Security-Model) | What SecuChat protects — and what it doesn't |
| [FAQ & Troubleshooting](FAQ) | Common issues and solutions |

## For Developers

| Page | Description |
|------|-------------|
| [Architecture Overview](Architecture-Overview) | Component map, startup sequence, storage |
| [I2P / SAM Stack](I2P-SAM-Stack) | SAM v3.1 protocol, WebSocket bridge, native Android, address derivation |
| [Services Overview](Services-Overview) | All singleton services organized by category |
| [Local Development](Local-Development) | Dev setup, commands, running the full I2P stack |
| [Contact Format Specification](Contact-Format-Specification) | v1.0 and legacy v2 JSON formats |
| [State Management](State-Management) | AppContext, useApp hook, connectionState derivation |
| [Build & Deploy](Build-and-Deploy) | Build for browser, Android, and desktop |
