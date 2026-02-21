# SecureChat - Projekt Dokumentation

## Übersicht

SecureChat ist eine sichere Messaging-Webapp mit Ende-zu-Ende-Verschlüsselung, die ohne zentrale Server auskommt. Die App wurde basierend auf der technischen Spezifikation aus der Android-App in eine moderne Webanwendung überführt.

**Live-Demo:** https://psdt3z7ayegn6.ok.kimi.link

---

## Tech Stack

| Komponente | Technologie |
|------------|-------------|
| Frontend Framework | React 19 + TypeScript |
| Build Tool | Vite 7 |
| Styling | Tailwind CSS 3.4 |
| UI Components | shadcn/ui (40+ Komponenten) |
| Kryptografie | OpenPGP.js |
| P2P-Kommunikation | WebRTC |
| Lokale Speicherung | IndexedDB |
| QR-Codes | qrcode + jsQR |

---

## Projektstruktur

```
/mnt/okcomputer/output/app/
├── src/
│   ├── components/
│   │   ├── ui/                    # shadcn/ui Komponenten
│   │   └── custom/                # Eigene Komponenten
│   │       ├── Header.tsx         # App-Header mit Status
│   │       ├── Sidebar.tsx        # Chat-Liste & Navigation
│   │       ├── ChatView.tsx       # Chat-Interface
│   │       ├── ContactManager.tsx # Kontaktverwaltung
│   │       ├── QRCodeShare.tsx    # QR-Code teilen/scannen
│   │       ├── Settings.tsx       # Einstellungen
│   │       └── Onboarding.tsx     # Erst Einrichtung
│   ├── contexts/
│   │   └── AppContext.tsx         # Global State Management
│   ├── services/
│   │   ├── crypto.ts              # PGP-Kryptografie (OpenPGP.js)
│   │   ├── storage.ts             # IndexedDB Wrapper
│   │   └── webrtc.ts              # WebRTC P2P-Kommunikation
│   ├── types/
│   │   └── index.ts               # TypeScript Type-Definitionen
│   ├── App.tsx                    # Haupt-App-Komponente
│   ├── main.tsx                   # Entry Point
│   └── index.css                  # Globale Styles
├── public/                        # Statische Assets
├── dist/                          # Build-Output
├── index.html
├── package.json
├── tailwind.config.js
├── tsconfig.json
└── vite.config.ts
```

---

## Kernfunktionen

### 1. PGP-Verschlüsselung (OpenPGP.js)

**Datei:** `src/services/crypto.ts`

- RSA-4096 Schlüsselgenerierung
- Ende-zu-Ende-Verschlüsselung aller Nachrichten
- Digitale Signaturen
- Schlüsselvalidierung
- Import/Export von Verbindungsdateien

```typescript
// Schlüsselgenerierung
const keys = await cryptoService.generateKeyPair(username, passphrase);

// Nachricht verschlüsseln
const encrypted = await cryptoService.encryptMessage(message, recipientPublicKey);

// Nachricht entschlüsseln
const decrypted = await cryptoService.decryptMessage(encryptedMessage, passphrase);
```

### 2. WebRTC P2P-Kommunikation

**Datei:** `src/services/webrtc.ts`

- Direkte Peer-to-Peer-Verbindungen
- DataChannels für Nachrichtenübertragung
- ICE-Kandidaten für NAT-Traversal
- Verbindungsstatus-Monitoring
- Signaling über WebSocket (erweiterbar für I2P)

### 3. Lokale Datenspeicherung (IndexedDB)

**Datei:** `src/services/storage.ts`

- Verschlüsselte Speicherung aller Daten
- Stores: user, contacts, chats, messages, settings
- Backup & Restore Funktionalität
- Vollständige Datenlöschung möglich

### 4. UI/UX Komponenten

| Komponente | Funktion |
|------------|----------|
| Header | Verbindungsstatus, Verschlüsselungsstatus, Benutzermenü |
| Sidebar | Chat-Liste, Kontaktsuche, Schnellaktionen |
| ChatView | Nachrichtenanzeige, Eingabe, Status-Indikatoren |
| ContactManager | Kontakte hinzufügen/entfernen/verwalten |
| QRCodeShare | Kontaktaustausch via QR-Code |
| Settings | App-Einstellungen, Sicherheit, Backup |
| Onboarding | Erst-Einrichtung mit Schlüsselgenerierung |

---

## Datenstrukturen

### User
```typescript
interface User {
  id: string;
  username: string;
  deviceId: string;
  pgpPublicKey: string;
  pgpPrivateKey?: string;
  fingerprint: string;
  createdAt: string;
}
```

### Contact
```typescript
interface Contact {
  id: string;
  name: string;
  pgpPublicKey: string;
  fingerprint: string;
  p2pIdentifier: string;
  lastSeen?: string;
  status: 'online' | 'offline' | 'unknown';
}
```

### Message
```typescript
interface Message {
  id: string;
  chatId: string;
  senderId: string;
  recipientId: string;
  encryptedContent: string;
  decryptedContent?: string;
  timestamp: string;
  sequenceNumber: number;
  status: 'sending' | 'sent' | 'delivered' | 'read' | 'failed';
  type: 'text' | 'file' | 'system';
}
```

### Connection File (Kontaktaustausch)
```json
{
  "version": "1.0",
  "metadata": {
    "timestamp": "ISO-8601-timestamp",
    "username": "username",
    "deviceId": "unique-device-identifier"
  },
  "keys": {
    "pgpPublicKey": "ASCII-armored-pgp-public-key",
    "fingerprint": "pgp-key-fingerprint"
  },
  "network": {
    "p2pIdentifier": "permanent-p2p-network-id",
    "protocol": "webrtc"
  }
}
```

---

## Sicherheitsfunktionen

### Implementiert

| Funktion | Status | Beschreibung |
|----------|--------|--------------|
| PGP-Verschlüsselung | ✅ | RSA-4096, Ende-zu-Ende |
| Lokale Schlüsselspeicherung | ✅ | Passphrase-geschützt |
| App-Sperre | ✅ | Passphrase-Entsperrung |
| Screenshot-Schutz | ✅ | UI-Indikator (Browser-Limitation) |
| Automatische Sperre | ✅ | Konfigurierbares Timeout |
| Duress PIN | ✅ | Notfall-Löschung |
| Backup-Verschlüsselung | ✅ | PGP-verschlüsselte Backups |
| Schlüssel-Export/Import | ✅ | JSON-Format |
| Vollständige Datenlöschung | ✅ | Mit Bestätigung |

### Geplant (Zukunft)

| Funktion | Status | Beschreibung |
|----------|--------|--------------|
| Biometrische Authentifizierung | 🔄 | WebAuthn API |
| I2P-Integration | 🔄 | Anonymes Routing |
| Forward Secrecy | 🔄 | Ephemere Schlüssel |
| Message Self-Destruct | 🔄 | Zeitbasierte Löschung |

---

## Entwicklungsphasen

### Phase 1: Basis (Implementiert)
- ✅ PGP-Verschlüsselung mit OpenPGP.js
- ✅ Grundlegende UI mit shadcn/ui
- ✅ Lokale Datenspeicherung (IndexedDB)
- ✅ Kontaktverwaltung
- ✅ Chat-Interface

### Phase 2: Erweiterte Funktionen (Implementiert)
- ✅ WebRTC-Integration
- ✅ QR-Code Kontaktaustausch
- ✅ Backup-System
- ✅ Sicherheitseinstellungen
- ✅ Fehlerbehandlung

### Phase 3: Optimierung (Geplant)
- 🔄 I2P-Integration für anonymes Routing
- 🔄 Performance-Optimierung
- 🔄 Mobile Responsiveness
- 🔄 Push-Benachrichtigungen
- 🔄 Dateiübertragung

---

## Installation & Entwicklung

### Voraussetzungen
- Node.js 20+
- npm oder yarn

### Installation
```bash
cd /mnt/okcomputer/output/app
npm install
```

### Entwicklungsserver
```bash
npm run dev
```

### Build
```bash
npm run build
```

### Build-Output
```
dist/
├── index.html
├── assets/
│   ├── index-[hash].js
│   └── index-[hash].css
```

---

## Deployment

Die App wurde auf einem statischen Webserver deployed:

```bash
# Build erstellen
npm run build

# Deploy (via Tool)
# Output: /mnt/okcomputer/output/app/dist
```

**Live-URL:** https://psdt3z7ayegn6.ok.kimi.link

---

## Browser-Kompatibilität

| Browser | Unterstützung | Hinweise |
|---------|---------------|----------|
| Chrome/Edge | ✅ Voll | Alle Features |
| Firefox | ✅ Voll | Alle Features |
| Safari | ⚠️ Teilweise | WebRTC Einschränkungen |
| Mobile Chrome | ✅ Voll | Touch-optimiert |
| Mobile Safari | ⚠️ Teilweise | Kamera-Zugriff eingeschränkt |

---

## Bekannte Einschränkungen

1. **WebRTC Signaling**: Derzeit über WebSocket, I2P-Integration geplant
2. **Push-Benachrichtigungen**: Nicht implementiert (erfordert Service Worker)
3. **Dateiübertragung**: Nicht implementiert
4. **Sprach/Videoanrufe**: UI vorhanden, Funktionalität geplant
5. **Screenshot-Schutz**: Nur visueller Indikator, technischer Schutz nicht möglich

---

## Architektur-Entscheidungen

### Warum React + TypeScript?
- Typensicherheit für kryptografische Operationen
- Große Ökosystem für UI-Komponenten
- Gute Performance mit Vite

### Warum OpenPGP.js?
- Industriestandard für PGP-Verschlüsselung
- Gut gewartet und dokumentiert
| Unterstützt RSA-4096

### Warum IndexedDB?
- Native Browser-Unterstützung
- Asynchrone API
- Große Speicherkapazität
- Transaktionssicher

### Warum WebRTC?
- Direkte P2P-Verbindungen
- Eingebauter DTLS-Verschlüsselung
- Geringe Latenz

---

## Lizenz

Dieses Projekt wurde als Demo-Implementierung erstellt.

---

## Autor

Entwickelt basierend auf der technischen Spezifikation für eine sichere Chat-Anwendung.
