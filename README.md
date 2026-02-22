# SecuChat

Eine datenschutzfokussierte Messaging-App mit Ende-zu-Ende PGP-Verschlüsselung und anonymem I2P-Routing. Keine zentralen Server, keine Metadaten, keine Kompromisse.

> **Status:** In aktiver Entwicklung. Bugs werden aktuell behoben (siehe [Bugplan](plan/BUGPLAN.md)).

---

## Funktionsweise

```
Sender                          Empfänger
  │                                 │
  ├─ Nachricht mit PGP verschlüsseln│
  │                                 │
  ├──── I2P (Garlic Routing) ───────►│
  │     (Anonymes Netzwerk)         │
  │                                 │
  │                    PGP entschlüsseln
```

- **PGP (OpenPGP.js)** — Ende-zu-Ende-Verschlüsselung aller Nachrichten (ECC curve25519)
- **I2P** — Anonymes Routing über das I2P-Netzwerk, kein Absender nachvollziehbar
- **Lokal** — Alle Daten in IndexedDB im Browser, kein Backend, kein Account

---

## Tech Stack

| Bereich | Technologie |
|---------|-------------|
| Frontend | React 19 + TypeScript |
| Build | Vite 7 |
| Styling | Tailwind CSS + shadcn/ui |
| Kryptografie | OpenPGP.js (ECC curve25519) |
| Anonymisierung | I2P via SAM v3.1 Protokoll |
| Speicherung | IndexedDB (lokal im Browser) |
| Kontaktaustausch | QR-Code + Datei-Import |

---

## Projektstruktur

```
SecuChat/
├── app/                    # Haupt-App (Vite/React PWA)
│   ├── src/
│   │   ├── components/custom/  # App-Komponenten
│   │   ├── services/           # crypto, i2p, storage, sam
│   │   └── contexts/           # AppContext (globaler State)
│   └── public/
├── sam-proxy/              # WebSocket→TCP Bridge für I2P SAM
├── plan/                   # Projektpläne & Dokumentation
│   ├── BUGPLAN.md          # Fehleranalyse & Behebungsplan (58 Issues)
│   ├── DISTRIBUTION_PLAN.md    # Desktop & Android Distributions-Architektur
│   └── PROJEKT_DOKUMENTATION.md  # Technische Dokumentation
└── securechat-desktop/     # Veraltet, wird nicht verwendet
```

---

## Lokale Entwicklung

### Voraussetzungen

- Node.js 20+
- i2pd (für I2P-Funktionalität)

### Start

```bash
# 1. I2P-Router starten
i2pd --sam.enabled=true --sam.address=127.0.0.1 --sam.port=7656

# 2. SAM-Proxy starten (WebSocket-Bridge für den Browser)
cd sam-proxy && npm start

# 3. App starten
cd app && npm install && npm run dev
```

Die App ist dann unter `http://localhost:5173` erreichbar.

### Weitere Befehle

```bash
cd app
npm run build     # Produktions-Build (→ app/dist/)
npm run lint      # ESLint
npx tsc --noEmit  # TypeScript-Check
```

---

## Distribution

### Desktop (Linux & Windows)

Geplant als Electron-App mit gebündeltem i2pd — ein einzelner Installer, kein separates Setup nötig.

### Android

Geplant als Capacitor-App (WebView der bestehenden App) + nodejs-mobile für sam-proxy + [i2pd aus F-Droid](https://f-droid.org/packages/org.purplei2p.i2pd/).

Releases werden über **GitHub Releases** bereitgestellt.

Details: [plan/DISTRIBUTION_PLAN.md](plan/DISTRIBUTION_PLAN.md)

---

## Sicherheit

- Nachrichten verlassen das Gerät ausschließlich PGP-verschlüsselt
- I2P-Garlic-Routing verschleiert Absender und Empfänger
- Kein zentraler Server, keine Nutzerkonten, keine Logs
- Passphrase-geschützter privater Schlüssel

Bekannte Sicherheitsprobleme und deren Behebung: [plan/BUGPLAN.md](plan/BUGPLAN.md)

---

## Lizenz

GNU Affero General Public License v3.0 (AGPL-3.0)

Jede Nutzung, Modifikation oder Verbreitung dieses Codes — auch über ein Netzwerk — verpflichtet dazu, den Quellcode unter der gleichen Lizenz offenzulegen. Kommerzielle Closed-Source-Nutzung ist nicht gestattet.

Siehe [LICENSE](LICENSE) für den vollständigen Lizenztext.
