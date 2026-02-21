# SecureChat Desktop

Anonyme, Ende-zu-Ende verschlüsselte Messaging-App über das I2P-Netzwerk.

## Features

- 🔒 **Ende-zu-Ende Verschlüsselung** mit OpenPGP
- 🕵️ **Anonyme Kommunikation** über I2P
- 💻 **Desktop-App** (Windows, macOS, Linux)
- 🔑 **Keine Telefonnummer** nötig
- 🌐 **Dezentral** - keine zentralen Server

## Voraussetzungen

- Node.js 18+
- npm 9+
- i2pd (optional, kann eingebettet werden)

## Schnellstart

### 1. Repository klonen

```bash
git clone <repository-url>
cd securechat-desktop
```

### 2. Dependencies installieren

```bash
npm install
```

### 3. Entwicklungsmodus starten

```bash
npm run dev
```

Dies startet:
- Vite Dev Server für den Renderer
- Electron mit Hot-Reload

### 4. Produktions-Build

```bash
npm run build
npm run electron:build
```

## i2pd Einrichtung

Die App funktioniert nur mit einem laufenden i2pd-Router.

### Option A: Externes i2pd (Entwicklung)

**Windows:**
```powershell
choco install i2pd
```

**macOS:**
```bash
brew install i2pd
```

**Linux:**
```bash
# Debian/Ubuntu
sudo apt install i2pd

# Arch
sudo pacman -S i2pd
```

**SAM aktivieren** in `~/.i2pd/i2pd.conf`:
```ini
[sam]
enabled = true
address = 127.0.0.1
port = 7656
```

**i2pd starten:**
```bash
i2pd
```

### Option B: Eingebettetes i2pd (Produktion)

1. i2pd-Binary herunterladen
2. Nach `resources/i2pd/` kopieren
3. App bauen

## Projektstruktur

```
securechat-desktop/
├── src/
│   ├── main/           # Electron Main & Preload
│   │   ├── main.ts
│   │   └── preload.ts
│   ├── renderer/       # React UI
│   │   ├── components/
│   │   ├── adapters/
│   │   ├── App.tsx
│   │   └── main.tsx
│   └── shared/         # Core Services
│       ├── types/
│       ├── utils/
│       └── services/
├── resources/          # i2pd Binary (optional)
├── dist/              # Build-Ausgabe
└── package.json
```

## Wichtige Befehle

```bash
# Entwicklung starten
npm run dev

# TypeScript kompilieren
npm run build

# Electron starten
npm run electron:dev

# Produktions-Build
npm run electron:build

# Aufräumen
npm run clean
```

## Fehlerbehebung

### "i2pd nicht gefunden"

Prüfen ob i2pd läuft:
```bash
telnet 127.0.0.1 7656
```

### Build-Fehler

Dependencies neu installieren:
```bash
rm -rf node_modules package-lock.json
npm install
```

## Lizenz

MIT
