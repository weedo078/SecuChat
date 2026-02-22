# I2P Troubleshooting Guide

## Problem 1: "SAM command timeout: SESSION CREATE"

### Symptome
- SecuChat zeigt: "SAM command timeout: SESSION CREATE"
- i2pd Console zeigt: Verbunden
- App zeigt: "I2P nicht verbunden"

### Ursachen

1. **i2pd noch am Bootstrap** (häufigste Ursache)
   - i2pd braucht 1-3 Minuten um erste Verbindungen aufzubauen
   - SAM funktioniert erst nach erfolgreichem Bootstrap

2. **SAM Interface nicht aktiviert**
   - i2pd muss mit `--sam.enabled=true` gestartet werden
   - Standardmäßig ist SAM oft deaktiviert

3. **Port-Konflikte**
   - Port 7656 (SAM) oder 7657 (SAM-Proxy) belegt
   - Firewall blockiert Verbindungen

### Lösungen

#### 1. Wartezeit
```
Bei erstem Start:
- i2pd baut Verbindungen zum I2P-Netzwerk auf
- Das kann 1-3 Minuten dauern
- Warte bis "Peers: X" in der i2pd Konsole steht
```

#### 2. SAM manuell aktivieren (falls deaktiviert)
**Windows:**
```cmd
# i2pd.exe mit SAM aktiv starten
i2pd.exe --sam.enabled=true --sam.address=127.0.0.1 --sam.port=7656
```

**Linux:**
```bash
# In i2pd.conf
[sam]
enabled = true
address = 127.0.0.1
port = 7656
```

#### 3. Ports prüfen
```bash
# Windows
netstat -an | findstr 7656
netstat -an | findstr 7657

# Linux
ss -tlnp | grep 7656
ss -tlnp | grep 7657
```

#### 4. Firewall-Regeln
- Erlaube i2pd.exe durch Windows Firewall
- Port 7656 und 7657 müssen lokal erreichbar sein

---

## Problem 2: "LeaseSet not found"

### Symptome
- Eine Seite ist mit I2P verbunden
- Nachricht senden führt zu: "LeaseSet not found"
- Oder: "CANT_REACH_PEER"

### Was bedeutet das?

**LeaseSet = I2P-Adressbuch-Eintrag**
- Jede I2P-Adresse hat ein LeaseSet (ähnlich DNS-Eintrag)
- Das LeaseSet enthält die aktuellen Tunnel-Endpunkte
- Ohne LeaseSet kann der Peer nicht erreicht werden

### Ursachen

1. **Empfänger hat keine gültige I2P-Adresse**
   - Der andere PC hat i2pd nicht gestartet
   - i2pd des Empfängers ist noch am Bootstrap
   - Empfänger hat falsche/veraltete I2P-Adresse

2. **I2P-Adresse nicht veröffentlicht**
   - LeaseSet wurde noch nicht ins Netzwerk geschrieben
   - Kann 30-60 Sekunden dauern nach Session-Create

3. **Falsche I2P-Adresse im Kontakt**
   - Beim Import wurde eine falsche Adresse übernommen
   - Adresse hat sich geändert (neue i2pd-Installation)

### Lösungen

#### 1. Beide Seiten prüfen
**Beide PCs müssen:**
- ✅ i2pd läuft
- ✅ SecuChat zeigt "I2P verbunden"
- ✅ Eigene I2P-Adresse wird angezeigt

#### 2. Kontakt neu importieren
```
1. Alten Kontakt löschen
2. Neue .secuchat-Datei vom Empfänger anfordern
3. Kontakt neu importieren
4. Sicherstellen dass I2P-Adresse übereinstimmt
```

#### 3. LeaseSet-Propagation warten
```
Nach Session-Create:
- LeaseSet wird ins I2P-Netzwerk geschrieben
- Das dauert 30-60 Sekunden
- Erst dann kann der Peer erreicht werden
```

#### 4. i2pd neustarten (nuklear Option)
```bash
# i2pd stoppen
# Lösche LeaseSet-DB (optional)
rm -rf ~/.i2pd/destinations/
# i2pd neu starten
```

---

## Schnell-Checkliste

### PC 1 (Sender)
```
□ i2pd läuft
□ SecuChat zeigt "I2P verbunden"
□ Eigene I2P-Adresse sichtbar
□ Kontakt hat I2P-Adresse hinterlegt
```

### PC 2 (Empfänger)
```
□ i2pd läuft
□ SecuChat zeigt "I2P verbunden"
□ Eigene I2P-Adresse sichtbar
□ Kontakt von PC 1 importiert
```

---

## Debugging

### Logs aktivieren

**SecuChat Console:**
```javascript
// In Browser Console
localStorage.setItem('debug', 'i2p:*')
```

**i2pd Logs:**
```bash
# Windows
i2pd.exe --loglevel=debug

# Linux
i2pd --loglevel=debug
```

### Wichtige Log-Meldungen

```
✅ "SAM: New session accepted" - SAM funktioniert
✅ "LeaseSet updated" - Adresse ist veröffentlicht
❌ "SAM: Session create failed" - Fehler bei Session-Erstellung
❌ "LeaseSet not found" - Adresse unbekannt
```

---

## Bekannte Einschränkungen

1. **Erster Start dauert lange**
   - i2pd muss sich erst mit dem Netzwerk verbinden
   - 1-3 Minuten ist normal

2. **LeaseSets haben TTL**
   - Nach 10 Minuten Inaktivität läuft LeaseSet ab
   - Wird automatisch erneuert bei Aktivität

3. **Firewalls blockieren I2P**
   - Manche Corporate-Firewalls blockieren I2P-Verkehr
   - UDP-Port 12345 wird für SSU verwendet
