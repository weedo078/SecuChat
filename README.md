# SecuChat 🔒

**Privater Messenger ohne Server, ohne Metadaten, ohne Kompromisse.**

SecuChat ist ein Desktop-Messaging-App mit Ende-zu-Ende-Verschlüsselung (PGP) und anonymem Routing über das I2P-Netzwerk. Deine Nachrichten sind nur für dich und deinen Gesprächspartner lesbar – niemand sonst kann mitlesen, nicht einmal wir.

> ⚠️ **WICHTIGER HINWEIS:** Diese App befindet sich noch in aktiver Entwicklung und funktioniert derzeit **nicht vollständig**. Die Grundfunktionen sind implementiert, aber es gibt noch Bugs und unvollständige Features. Verwendung auf eigene Gefahr!

---

## ✨ Features

| Feature | Beschreibung |
|---------|-------------|
| 🔐 **Echte Ende-zu-Ende-Verschlüsselung** | Alle Nachrichten werden mit PGP (ECC curve25519) verschlüsselt |
| 🕵️ **Anonymes Routing** | I2P-Netzwerk verbirgt deine IP-Adresse und Metadaten |
| 🖥️ **Keine Server** | Deine Daten bleiben auf deinem Gerät – keine Cloud, keine Accounts |
| 📁 **Kontakt-Import** | Tausche Kontakte einfach per `.secuchat`-Datei aus |
| 🖼️ **Datei-Uploads** | Sende Bilder und Dateien (bis 50MB) verschlüsselt |

---

## 📥 Download & Installation

### Windows
1. Lade die neueste Version von der [Releases-Seite](https://github.com/weedo078/SecuChat/releases) herunter
2. Führe die `.exe`-Datei aus
3. SecuChat startet automatisch (i2pd ist bereits integriert)

### Linux
```bash
# Option 1: AppImage (funktioniert auf allen Distributionen)
chmod +x SecuChat-*.AppImage
./SecuChat-*.AppImage

# Option 2: Debian/Ubuntu
sudo dpkg -i secuchat_*.deb
```

> **Hinweis:** i2pd ist in allen Installern bereits enthalten. Keine separate Installation nötig!

---

## 🚀 Erste Schritte

### 1. App starten
Beim ersten Start erstellst du dein Profil:
- Wähle einen Namen
- Lege eine Passphrase fest (schützt deine privaten Schlüssel)
- Die App generiert automatisch deine PGP- und I2P-Schlüssel

### 2. Einen Kontakt hinzufügen

**Kontaktdatei erhalten?**
1. Klicke auf "Kontakt hinzufügen" (UserPlus-Icon)
2. Lade die `.secuchat`-Datei hoch oder füge den Text ein
3. Fertig!

**Eigenen Kontakt teilen?**
1. Klicke auf "Kontakt teilen" (Share-Icon)
2. Lade deine `.secuchat`-Datei herunter
3. Sende sie an deinen Gesprächspartner (per Mail, Messenger, etc.)

### 3. Nachrichten senden
1. Wähle einen Kontakt aus der Liste
2. Tippe deine Nachricht
3. Drücke Enter oder klicke den Senden-Button

---

## 🔐 Sicherheit

SecuChat verwendet bewährte Verschlüsselungstechnologien:

- **PGP (OpenPGP.js)** – Militärgrade Verschlüsselung für alle Nachrichten
- **I2P** – Anonymes Netzwerk, das Sender und Empfänger versteckt
- **Lokale Speicherung** – Deine Daten verlassen niemals dein Gerät
- **Passwort-geschützte Schlüssel** – AES-GCM Verschlüsselung mit PBKDF2

**Was wir nicht können:**
- ❌ Deine Nachrichten lesen
- ❌ Deine IP-Adresse sehen
- ❌ Deine Kontakte kennen
- ❌ Nachrichten wiederherstellen (keine Backups auf Servern)

---

## 🐛 Troubleshooting

### "I2P nicht verbunden"
- Warte 1-2 Minuten nach dem ersten Start (i2pd baut die ersten Verbindungen auf)
- Prüfe, ob Port 7656 und 7657 frei sind
- Starte die App neu

### "Nachricht kommt nicht an"
- Stelle sicher, dass beide Seiten online sind
- Prüfe, ob die I2P-Adresse korrekt importiert wurde
- Versuche, den Kontakt neu hinzuzufügen

### "Kann Kontakt nicht importieren"
- Die `.secuchat`-Datei muss im JSON-Format sein
- Prüfe, ob alle Zeichen korrekt kopiert wurden

---

## 📄 Lizenz

GNU Affero General Public License v3.0 (AGPL-3.0)

SecuChat ist Open Source. Jeder kann den Code einsehen, überprüfen und verbessern.

---

## 🛠️ Mitwirken

Du möchtest helfen? Schau in [DEVELOPMENT.md](DEVELOPMENT.md) für Details zum Aufbau des Projekts.

**Bug gefunden?** Erstelle ein [Issue](https://github.com/weedo078/SecuChat/issues).
