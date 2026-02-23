# I2P-Konnektivitäts-Fixes - Änderungsdokumentation

**Datum:** 2026-02-23  
**Autor:** Kimi Agent Swarm  
**Scope:** I2P-Manager Integration für SecuChat

---

## Übersicht

Diese Änderungen beheben kritische I2P-Konnektivitätsprobleme in SecuChat durch eine robuste, modulare I2P-Verwaltung.

---

## Neue Dateien

### 1. `electron/src/i2p-manager.ts` (NEU)
**Beschreibung:** Vollständige I2P-Verwaltungsklasse  
**Funktionen:**
- Robuste Pfad-Auflösung für verschiedene Umgebungen (Dev/Production)
- Automatische Zertifikatskopierung beim ersten Start
- Linux: Automatische `chmod +x` für i2pd-Binary
- Erhöhtes Timeout (45s statt 20s) für langsamer Systeme
- Datei-basiertes Logging (`~/.config/SecuChat/logs/i2pd.log`)
- Graceful shutdown mit SIGTERM → SIGKILL Fallback
- Port-Prüfung mit konfigurierbaren Intervallen

**Exporte:**
- `I2PManager` - Klasse für erweiterte Nutzung
- `startI2pd()` - Startet i2pd und wartet auf SAM-Port
- `stopI2pd()` - Stoppt i2pd-Prozess
- `isI2pReady()` - Prüft SAM-Port-Verfügbarkeit
- `getI2PManager()` - Singleton-Accessor

### 2. `electron/scripts/setup-i2pd.sh` (NEU)
**Beschreibung:** Linux Setup-Skript für i2pd  
**Funktionen:**
- Download der i2pd-Binary falls nicht vorhanden
- Überprüfung der Systemarchitektur
- Setzen der korrekten Berechtigungen
- Optionale systemd-Service-Erstellung

**Verwendung:**
```bash
chmod +x scripts/setup-i2pd.sh
./scripts/setup-i2pd.sh --download --create-service
```

### 3. `electron/scripts/setup-i2pd.ps1` (NEU)
**Beschreibung:** Windows PowerShell Setup-Skript  
**Funktionen:**
- Automatischer Download der i2pd-Binary
- Architektur-Erkennung (x64/x86)
- Firewall-Regel-Erstellung
- Visual C++ Redistributables-Prüfung

**Verwendung:**
```powershell
Set-ExecutionPolicy -ExecutionPolicy Bypass -Scope Process
.\scripts\setup-i2pd.ps1 -Download -Verify
```

### 4. `electron/scripts/after-install.sh` (NEU)
**Beschreibung:** Post-Install Script für Linux DEB-Pakete  
**Funktion:** Setzt Berechtigungen nach Installation

### 5. `electron/scripts/after-remove.sh` (NEU)
**Beschreibung:** Post-Remove Script für Linux DEB-Pakete  
**Funktion:** Bereinigt beim Deinstallieren

---

## Geänderte Dateien

### 1. `electron/src/main.ts` (ÜBERSCHRIEBEN)
**Änderungen:**
- Entfernt: Inline I2PD-Start-Logik
- Entfernt: Inline SAM-Proxy (WebSocketServer)
- Entfernt: `APP_ROOT` Konstante mit Non-Null Assertion
- Entfernt: `waitForPort`, `setupI2pdDataDir`, `isI2pdRunning` Funktionen
- Entfernt: `startI2pd`, `stopI2pd` Funktionen (jetzt aus i2p-manager)
- Entfernt: `startSamProxy`, `stopSamProxy` Funktionen

**Neu:**
- Importiert I2P-Funktionen aus `./i2p-manager`
- `initializeI2P()` - Wrapper mit Status-Verwaltung
- Dialog-Warnung wenn I2P nicht startet (Continue/Exit)
- `i2p:restart` IPC-Handler
- `i2p:status` IPC-Handler gibt SAM-Info zurück
- Error Handling für uncaughtException/unhandledRejection

**I2P IPC Channels:**
- `i2p:status` - Gibt aktuellen I2P-Status zurück
- `i2p:restart` - Startet i2pd neu

### 2. `electron/electron-builder.json` (AKTUALISIERT)
**Änderungen:**
```json
{
  "asar": false,  // NEU: Wichtig für Binary-Zugriff
  ...
  "nsis": {
    ...
    "include": "installer.nsh"  // KORRIGIERT: Fehlendes Komma behoben
  }
}
```

**Begründung für `asar: false`:**
Die i2pd-Binary muss direkt aus dem Dateisystem ausführbar sein. ASAR-Archivierung blockiert den Zugriff auf native Binaries.

---

## Behobene Probleme

| Priorität | Problem | Status |
|-----------|---------|--------|
| 🔴 Kritisch | `APP_ROOT` nicht definiert | ✅ Gelöst durch `getAppRoot()` Funktion |
| 🔴 Kritisch | Zertifikate werden nicht kopiert | ✅ Gelöst durch `copyCertificates()` |
| 🔴 Kritisch | Linux Executable-Berechtigungen | ✅ Gelöst durch `ensureExecutable()` |
| 🟠 Hoch | Timeout zu kurz (20s) | ✅ Erhöht auf 45s |
| 🟠 Hoch | Fehlende Fehlerbehandlung | ✅ Vollständige try-catch Blocks |
| 🟡 Mittel | Keine Protokollierung | ✅ Log-Dateien in `~/.config/SecuChat/logs/` |
| 🟡 Mittel | Keine Port-Konflikt-Prüfung | ✅ Port-Prüfung vor Start |
| 🟡 Mittel | Syntaxfehler in electron-builder.json | ✅ Korrigiert |

---

## I2P-Log-Dateien

Nach dem Start finden sich Logs unter:

| Datei | Beschreibung |
|-------|--------------|
| `~/.config/SecuChat/logs/i2pd.log` | Konsolenausgabe von i2pd |
| `~/.config/SecuChat/logs/i2pd-internal.log` | Interne i2pd-Logs |

---

## SAM-Konfiguration

Die App verbindet sich direkt über SAM mit i2pd:

```
Host: 127.0.0.1
Port: 7656 (SAM)
HTTP-Konsole: http://127.0.0.1:7070
```

---

## Build-Anweisungen

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

1. **Entwicklung:**
   ```bash
   cd electron
   npm run dev
   ```

2. **Geprägte App testen:**
   ```bash
   # Linux
   ./release/SecuChat-0.0.38.AppImage
   
   # Oder DEB installieren
   sudo dpkg -i release/secuchat_0.0.38_amd64.deb
   ```

3. **Log-Überwachung:**
   ```bash
   tail -f ~/.config/SecuChat/logs/i2pd.log
   ```

---

## Bekannte Einschränkungen

- macOS-Unterstützung erfordert möglicherweise Anpassungen
- ARM-Architektur benötigt separate i2pd-Binaries
- Windows: VC++ Redistributables müssen installiert sein

---

## Support

Bei Problemen:
1. Logs prüfen: `~/.config/SecuChat/logs/`
2. `TROUBLESHOOTING.md` konsultieren
3. Issue mit Logs und System-Info erstellen
