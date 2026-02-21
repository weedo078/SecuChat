# SecureChat Desktop - Projektfortsetzung mit Claude Code

## Aktueller Stand

Ich habe eine Electron-basierte Desktop-App für anonymes Messaging über I2P begonnen. Die Grundstruktur ist vorhanden, aber das Projekt ist noch nicht vollständig funktionsfähig.

### Projektstruktur
```
securechat-desktop/
├── src/
│   ├── main/                 # Electron Main & Preload
│   │   ├── main.ts          # Hauptprozess mit i2pd-Integration
│   │   └── preload.ts       # IPC Bridge
│   ├── renderer/             # React UI
│   │   ├── components/       # Header, Sidebar, ChatView, Onboarding
│   │   ├── adapters/         # Storage Adapter
│   │   ├── App.tsx
│   │   └── main.tsx
│   └── shared/               # Core Services
│       ├── types/
│       ├── utils/
│       └── services/         # i2p.ts, crypto.ts, storage.ts, qrSignaling.ts
├── package.json
├── vite.config.ts
├── tsconfig.json
└── tailwind.config.js
```

## Was funktioniert bereits

- [x] Projektstruktur
- [x] TypeScript Konfiguration
- [x] Electron + Vite Setup
- [x] Tailwind CSS
- [x] Core Services (PGP, I2P, Storage) - Grundgerüst
- [x] React Komponenten (UI) - Grundgerüst

## Was muss noch implementiert werden

### 1. Dependencies installieren & Build testen
```bash
npm install
npm run build
npm run dev
```

### 2. I2P SAM Service vervollständigen
Die Datei `src/shared/services/i2p.ts` hat einen I2PService mit TCP-Sockets, aber:
- SAM Protokoll-Implementierung prüfen/korrigieren
- Fehlerbehandlung verbessern
- Verbindungs-Status korrekt tracken
- `connectToPeer()` implementieren
- `sendMessage()` implementieren

### 3. Electron Main Process korrigieren
Die Datei `src/main/main.ts`:
- i2pd als Child Process starten (wenn gebündelt)
- Oder externes i2pd erkennen und verbinden
- IPC Handler für Storage, i2pd-Status
- Window Management

### 4. Preload Script vervollständigen
Die Datei `src/main/preload.ts`:
- Alle notwendigen APIs exposen (contextBridge)
- TypeScript Typen definieren
- Sichere IPC-Kommunikation

### 5. React UI verbinden
Die Datei `src/renderer/App.tsx`:
- I2P Service initialisieren
- Mit Electron IPC kommunizieren
- Onboarding flow fertigstellen
- Fehlerbehandlung für i2pd-Verbindung

### 6. Storage Adapter implementieren
Die Datei `src/renderer/adapters/storage.ts`:
- Electron Store verwenden
- Oder lokales Dateisystem via IPC
- Daten persistent speichern

### 7. QR-Code Kontaktaustausch
Die Datei `src/shared/services/qrSignaling.ts`:
- QR-Code generieren (I2P-Adresse + PGP-Key)
- QR-Code scannen (Kamera oder Datei)
- Kontakt importieren

### 8. Chat-Funktionalität
- Nachrichten senden/empfangen über I2P SAM
- PGP Verschlüsselung vor dem Senden
- Nachrichten-History speichern
- Echtzeit-Updates

### 9. UI Polish
- Ladezustände
- Fehlermeldungen
- Anonymitäts-Indikatoren (🟢/🔴)
- Responsive Design

### 10. i2pd-Bündelung (optional, später)
- i2pd Binary in `resources/i2pd/` kopieren
- Electron Builder konfigurieren
- Auto-Start von i2pd

## Wichtige technische Details

### I2P SAM Protokoll
SAM (Simple Anonymous Messaging) ist das Interface zu i2pd:
- Port: 7656 (Standard)
- Protokoll: Plain TCP (kein WebSocket!)
- Befehle: `HELLO`, `SESSION CREATE`, `STREAM CONNECT`, etc.

**Beispiel-Verbindungsaufbau:**
```typescript
// 1. Mit SAM verbinden (TCP)
const socket = new net.Socket();
socket.connect(7656, '127.0.0.1');

// 2. HELLO senden
socket.write('HELLO VERSION MIN=3.1 MAX=3.1\n');
// Antwort: HELLO REPLY RESULT=OK VERSION=3.1

// 3. Session erstellen
socket.write('SESSION CREATE STYLE=STREAM ID=mysession DESTINATION=TRANSIENT\n');
// Antwort: SESSION STATUS RESULT=OK DESTINATION=xxx

// 4. Zu Peer verbinden
socket.write('STREAM CONNECT ID=mysession DESTINATION=peer.b32.i2p\n');
// Antwort: STREAM STATUS RESULT=OK
// Danach: Raw Daten können gesendet werden
```

### PGP Verschlüsselung
Verwendet OpenPGP.js:
- ECC Keys (curve25519) - schneller als RSA
- Nachrichten werden vor dem Senden über I2P verschlüsselt
- Jeder Kontakt hat einen eigenen PGP Public Key

### Anonymitäts-Level
- 🟢 **Grün**: I2P verbunden - IP verborgen, anonym
- 🔴 **Rot**: Nicht verbunden - keine Kommunikation möglich

## Ziele (MVP)

1. **App startet** und erkennt i2pd (extern oder eingebettet)
2. **User kann sich registrieren** (PGP + I2P Keys generieren)
3. **Kontakte hinzufügen** via QR-Code oder manuelle Eingabe
4. **Nachrichten senden/empfangen** über I2P
5. **Alles ist E2E-verschlüsselt**

## Nicht-Ziele (für MVP)

- [ ] Datei-Übertragung
- [ ] Sprachnachrichten
- [ ] Gruppenchats
- [ ] Mobile Apps
- [ ] Mehrere Geräte synchronisieren

## Erste Schritte (Reihenfolge)

1. `npm install` ausführen und Fehler beheben
2. `npm run dev` testen - was für Fehler kommen?
3. I2P Service debuggen - verbindet er sich mit SAM?
4. Electron IPC testen - funktioniert die Kommunikation zwischen Main und Renderer?
5. Onboarding Flow fertigstellen
6. Kontakt-Manager implementieren
7. Chat-Funktionalität
8. Testing & Bugfixing

## Debug-Tipps

### i2pd testen
```bash
# Prüfen ob i2pd läuft
telnet 127.0.0.1 7656

# i2pd Logs ansehen (Linux/macOS)
tail -f ~/.i2pd/i2pd.log

# i2pd manuell starten mit SAM
i2pd --sam.enabled=true --sam.address=127.0.0.1 --sam.port=7656
```

### Electron DevTools
- Main Process: `console.log()` im Terminal
- Renderer Process: DevTools öffnen (F12 oder Cmd+Option+I)

### TypeScript Fehler
```bash
# Type-Checking
npx tsc --noEmit
```

## Dateien, die angepasst werden müssen

| Datei | Was zu tun |
|-------|------------|
| `src/shared/services/i2p.ts` | SAM Protokoll korrekt implementieren |
| `src/main/main.ts` | i2pd Integration, IPC Handler |
| `src/main/preload.ts` | APIs exposen |
| `src/renderer/App.tsx` | App-Logik, I2P Initialisierung |
| `src/renderer/adapters/storage.ts` | Electron Store verwenden |
| `src/renderer/components/Onboarding.tsx` | Flow vervollständigen |
| `src/renderer/components/ChatView.tsx` | Nachrichten senden/empfangen |

## Fragen für dich (beantworte vor dem Start)

1. **i2pd-Integration**: Soll i2pd automatisch mit der App starten (eingebettet) oder soll der User es selbst installieren?
   - Eingebettet = mehr Arbeit, aber einfacher für User
   - Extern = einfacher zu implementieren

2. **Plattform-Priorität**: Welche Plattform ist wichtigst? (Windows/macOS/Linux)

3. **Debug-Modus**: Soll es einen Debug-Modus mit mehr Logging geben?

4. **Storage**: Electron Store (einfach) oder eigenes Dateiformat?

---

## Aufgabe für Claude Code

1. Analysiere den aktuellen Code in allen Dateien
2. Identifiziere die Probleme und fehlenden Implementierungen
3. Implementiere die fehlenden Features Schritt für Schritt
4. Teste nach jedem Schritt mit `npm run dev`
5. Stelle sicher, dass die App mit i2pd kommunizieren kann

**Wichtig:** Die App muss ECHTE TCP-Verbindungen zu i2pd SAM aufbauen können (Port 7656). Das ist der kritischste Teil.
