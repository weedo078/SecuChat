# SecuChat Integration Plan — Core Messaging Features

> **Vision:** 100% dezentral, serverlos, I2P-basiert. Keine zentralen Infrastrukturen.

---

## Übersicht

| Feature | Priorität | Aufwand | I2P-Realisierbarkeit |
|---------|-----------|---------|---------------------|
| 1. Kontaktverifikation | P0 | 1 Tag | ✅ Lokal, kein Netzwerk |
| 2. Read Receipts & Typing | P0 | 2 Tage | ✅ P2P Status-Messages |
| 3. Datei-Transfer (P2P) | P1 | 3 Tage | ✅ Direkter Stream |
| 4. Sprachnachrichten | P1 | 3 Tage | ✅ Async P2P |
| 5. Gruppenchats | P2 | 5 Tage | ✅ Mesh (max 10 Personen) |

**Gesamtdauer:** ~14 Tage (2-3 Wochen mit 1 Entwickler)

---

## Feature 1: Kontaktverifikation (Safety Numbers)

### Ziel
Man-in-the-Middle-Angriffe verhindern durch out-of-band Verifikation der PGP-Public-Keys.

### Funktionsweise
- Jedes Gerät generiert einen Fingerprint des eigenen Public Keys
- Beim ersten Kontakt wird ein "Verification Code" angezeigt
- Nutzer können QR-Code scannen oder 6-Wort-Phrase vergleichen
- Nach Verifikation: "Grüner Haken" im Chat

### Technische Umsetzung
```typescript
// Kontaktverifikation Interface
interface ContactVerification {
  contactId: string;
  publicKeyFingerprint: string;  // SHA-256 des PGP Keys
  trustLevel: 'unverified' | 'verified' | 'blocked';
  verifiedAt?: Date;
  verificationMethod: 'qr' | 'manual' | 'none';
}

// Fingerprint-Generierung
function generateFingerprint(publicKey: string): string {
  return sha256(publicKey).slice(0, 16);  // 64-bit reichen
}

// Word-Liste für menschenlesbaren Code
const WORD_LIST = ['alpha', 'bravo', 'charlie', ...];  // 2048 Wörter
function fingerprintToWords(fingerprint: string): string {
  // BIP39-ähnlich: 6 Wörter aus Fingerprint ableiten
}
```

### UI/UX
- **Unverifizierter Kontakt:** Gelber Warnhinweis im Chat
- **Verifikations-Dialog:** QR-Code + 6-Wort-Phrase anzeigen
- **Verified:** Grünes Schloss-Symbol neben Kontaktname

### Akzeptanzkriterien
- [ ] Fingerprint wird korrekt aus Public Key generiert
- [ ] QR-Code kann gescannt werden (Kamera-Integration)
- [ ] Manuelle Vergleichs-Dialog funktioniert
- [ ] Verifikations-Status wird persistent gespeichert
- [ ] Bei Key-Änderung Warnung anzeigen

---

## Feature 2: Read Receipts & Typing Indicators

### Ziel
Grundlegende Chat-UX: Sehen ob Nachricht gelesen wurde und ob jemand tippt.

### Funktionsweise (P2P, serverlos)
- **Typing Indicator:** Wenn User tippt → Signal wird an Peer gesendet
- **Read Receipt:** Wenn Nachricht angezeigt wird → "gelesen" Signal zurück
- Keine zentrale Speicherung — alles Echtzeit-P2P

### Technische Umsetzung
```typescript
// Status-Message Types (keine Chat-Nachrichten!)
type StatusMessage =
  | { type: 'typing'; isTyping: boolean; timestamp: number }
  | { type: 'read'; messageId: string; readAt: number }
  | { type: 'delivered'; messageId: string; deliveredAt: number };

// I2P-Sende-Logik für Status
class StatusMessenger {
  async sendTypingIndicator(contactId: string, isTyping: boolean) {
    const status: StatusMessage = {
      type: 'typing',
      isTyping,
      timestamp: Date.now()
    };
    await this.i2pManager.sendTo(contactId, JSON.stringify(status));
  }
  
  async sendReadReceipt(contactId: string, messageId: string) {
    const status: StatusMessage = {
      type: 'read',
      messageId,
      readAt: Date.now()
    };
    await this.i2pManager.sendTo(contactId, JSON.stringify(status));
  }
}

// Debouncing für Typing (nicht bei jedem Tastendruck senden!)
class TypingManager {
  private typingTimeout: NodeJS.Timeout | null = null;
  
  onUserTyping() {
    if (this.typingTimeout) return;  // Schon gesendet
    
    this.statusMessenger.sendTypingIndicator(this.contactId, true);
    
    // Nach 3 Sekunden Inaktivität: "tippt nicht mehr"
    this.typingTimeout = setTimeout(() => {
      this.statusMessenger.sendTypingIndicator(this.contactId, false);
      this.typingTimeout = null;
    }, 3000);
  }
}
```

### UI/UX
- **Typing:** "Gian tippt..." unter dem Chat-Eingabefeld
- **Delivered:** Ein Haken unter Nachricht
- **Read:** Zwei Haken, blau gefärbt

### Edge Cases
- Beide offline → Keine Status-Updates möglich (akzeptabel)
- Nur einer online → Status wird verworfen (keine Queue)
- Status-Nachrichten werden **nicht** verschlüsselt (nur signiert)

### Akzeptanzkriterien
- [ ] "tippt..." wird angezeigt wenn Peer tippt
- [ ] Einzelner Haken = delivered (I2P bestätigt Empfang)
- [ ] Doppelter Haken = read (Peer hat Chat geöffnet)
- [ ] Funktioniert nur wenn beide online (dokumentieren!)

---

## Feature 3: Datei-Transfer (P2P)

### Ziel
Bilder, Dokumente, Audio direkt an Peer senden — ohne Server, ohne Cloud.

### Funktionsweise
1. Sender: Datei verschlüsseln (symmetrischer Key), I2P-Stream öffnen
2. Empfänger: Stream akzeptieren, Chunkweise empfangen
3. Beide müssen **gleichzeitig online** sein
4. Fortschrittsanzeige bei beiden

### Technische Umsetzung
```typescript
// Datei-Transfer Protokoll
interface FileTransfer {
  transferId: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  encryptionKey: string;  // Symmetrischer AES-256 Key
  chunksTotal: number;
  chunksReceived: BitSet;  // Für Resumable
}

// Chunking (1MB pro Chunk für I2P-Stabilität)
const CHUNK_SIZE = 1024 * 1024;

class FileTransferManager {
  async sendFile(contactId: string, filePath: string): Promise<void> {
    const fileStats = await fs.stat(filePath);
    const transferId = crypto.randomUUID();
    const encryptionKey = await this.generateEncryptionKey();
    
    // Transfer-Metadaten senden (klein, verschlüsselt mit PGP)
    const metadata: FileTransfer = {
      transferId,
      fileName: path.basename(filePath),
      fileSize: fileStats.size,
      mimeType: this.detectMimeType(filePath),
      encryptionKey,
      chunksTotal: Math.ceil(fileStats.size / CHUNK_SIZE),
      chunksReceived: new BitSet()
    };
    
    await this.sendMetadata(contactId, metadata);
    
    // Warte auf Accept vom Empfänger
    const accepted = await this.waitForAccept(transferId, timeout=30000);
    if (!accepted) throw new Error('Transfer rejected or timeout');
    
    // Stream öffnen und Chunks senden
    const stream = await this.i2pManager.openStream(contactId);
    const fileStream = fs.createReadStream(filePath, { highWaterMark: CHUNK_SIZE });
    
    for await (const chunk of fileStream) {
      const encryptedChunk = await this.encryptChunk(chunk, encryptionKey);
      await stream.write(encryptedChunk);
      this.updateProgress(transferId, chunk.length);
    }
    
    await stream.end();
  }
  
  async receiveFile(contactId: string, metadata: FileTransfer): Promise<string> {
    // Zeige Dialog: "Gian möchte secret.pdf (2.5MB) senden"
    const accepted = await this.showAcceptDialog(metadata);
    if (!accepted) {
      await this.sendReject(metadata.transferId);
      return;
    }
    
    // Stream akzeptieren
    const stream = await this.i2pManager.acceptStream(contactId);
    const outputPath = path.join(DOWNLOADS_DIR, metadata.fileName);
    const writeStream = fs.createWriteStream(outputPath);
    
    let receivedBytes = 0;
    stream.on('data', (encryptedChunk) => {
      const chunk = this.decryptChunk(encryptedChunk, metadata.encryptionKey);
      writeStream.write(chunk);
      receivedBytes += chunk.length;
      this.updateProgress(metadata.transferId, receivedBytes);
    });
    
    return new Promise((resolve, reject) => {
      stream.on('end', () => resolve(outputPath));
      stream.on('error', reject);
    });
  }
}
```

### I2P Stream Considerations
- I2P unterstützt Streaming (ähnlich TCP)
- Latenz ist hoch, aber Durchsatz für Dateien akzeptabel
- Timeouts großzügig (30s+ für Verbindungsaufbau)
- Resume-Funktion bei Unterbrechung

### UI/UX
- **Senden:** Datei drag-and-drop oder Datei-Dialog
- **Empfangen:** Accept/Reject Dialog mit Vorschau (Bilder)
- **Fortschritt:** Progress bar bei Sender und Empfänger
- **Fertig:** "Datei gespeichert in ~/Downloads"

### Limitierungen (dokumentieren!)
- Beide müssen gleichzeitig online sein
- Keine Dateien > 500MB (I2P-Timeout-Risiko)
- Keine "Offline-Dateiablage"

### Akzeptanzkriterien
- [ ] Dateien bis 50MB funktionieren stabil
- [ ] Verschlüsselung ist aktiv (keine Plaintext-Übertragung)
- [ ] Fortschrittsanzeige funktioniert
- [ ] Abbruch/Resume bei Verbindungsproblemen
- [ ] Bilder zeigen Vorschau vor Accept

---

## Feature 4: Sprachnachrichten

### Ziel
Async-Sprachnachrichten wie WhatsApp, aber über I2P.

### Funktionsweise
1. Aufnahme starten → Opus-Encoding (niedrige Bitrate)
2. Aufnahme stoppen → Datei verschlüsseln
3. Als "Audio-Nachricht" senden (ähnlich Datei-Transfer)
4. Empfänger: Automatisches Herunterladen + Abspielen

### Technische Umsetzung
```typescript
// Opus-Kodierung (8-12 kbps reicht für Sprache)
const OPUS_BITRATE = 12000;

class VoiceMessageManager {
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];
  
  async startRecording(): Promise<void> {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.mediaRecorder = new MediaRecorder(stream, {
      mimeType: 'audio/webm;codecs=opus'
    });
    
    this.audioChunks = [];
    this.mediaRecorder.ondataavailable = (event) => {
      this.audioChunks.push(event.data);
    };
    
    this.mediaRecorder.start(100);  // 100ms-Chunks
  }
  
  async stopRecording(): Promise<AudioMessage> {
    return new Promise((resolve) => {
      this.mediaRecorder!.onstop = async () => {
        const audioBlob = new Blob(this.audioChunks, { type: 'audio/opus' });
        const duration = await this.calculateDuration(audioBlob);
        
        // Komprimieren falls nötig (WebM → OGG Opus)
        const compressedBlob = await this.compressAudio(audioBlob);
        
        resolve({
          type: 'voice',
          duration,  // in Sekunden
          blob: compressedBlob,
          waveform: this.generateWaveform(compressedBlob)  // Für UI
        });
      };
      
      this.mediaRecorder!.stop();
    });
  }
  
  private generateWaveform(audioBlob: Blob): number[] {
    // Vereinfachte Waveform für UI (30 Balken)
    // Berechne RMS pro Segment
    return simplifiedWaveform;
  }
}

// Audio-Nachricht Interface
interface AudioMessage {
  type: 'voice';
  duration: number;  // Sekunden
  blob: Blob;
  waveform: number[];  // 30 Werte, 0-100
}

// Senden wie Datei, aber als spezieller Nachrichtentyp
// Empfänger zeigt Wellenform + Play-Button
```

### UI/UX
- **Aufnahme:** Halten-Button (wie WhatsApp) oder Toggle
- **Während Aufnahme:** Wellenform-Visualisierung + Timer
- **Gesendet:** Wellenform + Dauer (z.B. "0:42")
- **Empfangen:** Gleiche Darstellung + Play/Pause
- **Abspielen:** Fortschrittsbalken + aktuelle Zeit

### Edge Cases
- Aufnahme zu kurz (< 1s): Verwerfen
- Aufnahme zu lang (> 5min): Warnung + Teilen erlauben
- Empfänger offline: Fehlermeldung "Peer offline, Sprachnachricht kann nicht gesendet werden"

### Akzeptanzkriterien
- [ ] Aufnahme funktioniert (Mikrofon-Zugriff)
- [ ] Opus-Kompression reduziert Dateigröße deutlich
- [ ] Wellenform wird angezeigt
- [ ] Abspielen mit Position-Scrubbing
- [ ] Funktioniert nur bei Online-Status beider Peers

---

## Feature 5: Gruppenchats (Mesh, max 10 Personen)

### Ziel
Kleine Gruppen (5-10 Personen) chatten können — dezentral, ohne Server.

### Funktionsweise (Mesh-Topologie)
- Jeder Client ist gleichberechtigt (Peer-to-Peer)
- Gruppen-Schlüssel: Symmetrischer AES-Key für Nachrichten
- Key wird bei Gruppenerstellung generiert und an alle Mitglieder verteilt (PGP-verschlüsselt)
- Nachrichten werden an **jedes** Gruppenmitglied einzeln gesendet (Fan-out)

### Technische Umsetzung
```typescript
// Gruppen-Struktur
interface Group {
  groupId: string;
  name: string;
  members: GroupMember[];  // Max 10
  symmetricKey: string;    // AES-256 für Nachrichten
  createdAt: Date;
  createdBy: string;       // Kontakt-ID
}

interface GroupMember {
  contactId: string;
  publicKey: string;
  role: 'admin' | 'member';
  joinedAt: Date;
}

// Gruppennachricht
interface GroupMessage {
  type: 'group';
  groupId: string;
  messageId: string;
  senderId: string;
  encryptedContent: string;  // AES verschlüsselt
  timestamp: number;
}

class GroupChatManager {
  private groups: Map<string, Group> = new Map();
  
  // Gruppe erstellen
  async createGroup(name: string, initialMembers: Contact[]): Promise<Group> {
    const groupId = crypto.randomUUID();
    const symmetricKey = await this.generateSymmetricKey();
    
    const group: Group = {
      groupId,
      name,
      members: [
        { contactId: 'self', publicKey: this.myPublicKey, role: 'admin', joinedAt: new Date() },
        ...initialMembers.map(c => ({
          contactId: c.id,
          publicKey: c.publicKey,
          role: 'member' as const,
          joinedAt: new Date()
        }))
      ],
      symmetricKey,
      createdAt: new Date(),
      createdBy: 'self'
    };
    
    // Sende Gruppen-Key an alle Mitglieder (PGP-verschlüsselt)
    for (const member of initialMembers) {
      await this.sendGroupInvite(member, group);
    }
    
    this.groups.set(groupId, group);
    return group;
  }
  
  // Nachricht an Gruppe senden
  async sendGroupMessage(groupId: string, content: string): Promise<void> {
    const group = this.groups.get(groupId);
    if (!group) throw new Error('Group not found');
    
    const encryptedContent = await this.encryptSymmetric(content, group.symmetricKey);
    
    const message: GroupMessage = {
      type: 'group',
      groupId,
      messageId: crypto.randomUUID(),
      senderId: 'self',
      encryptedContent,
      timestamp: Date.now()
    };
    
    // Fan-out: An jedes Mitglied senden
    const sendPromises = group.members
      .filter(m => m.contactId !== 'self')
      .map(member => this.sendToMember(member.contactId, message));
    
    // Warte auf alle, aber ignoriere Einzelfehler
    await Promise.allSettled(sendPromises);
  }
  
  // Nachricht empfangen
  async receiveGroupMessage(message: GroupMessage, senderId: string): Promise<void> {
    const group = this.groups.get(message.groupId);
    if (!group) {
      // Gruppe nicht bekannt? Vielleicht Invite verpasst.
      // Option: Auto-request group info?
      return;
    }
    
    const content = await this.decryptSymmetric(
      message.encryptedContent,
      group.symmetricKey
    );
    
    // Speichern und UI benachrichtigen
    await this.storeMessage(message.groupId, {
      ...message,
      content,
      senderId
    });
  }
  
  // Mitglied hinzufügen (nur Admin)
  async addMember(groupId: string, newMember: Contact): Promise<void> {
    const group = this.groups.get(groupId);
    if (!group) throw new Error('Group not found');
    
    if (group.members.length >= 10) {
      throw new Error('Maximum group size (10) reached');
    }
    
    // Sende aktuellen Group Key an neues Mitglied
    await this.sendGroupInvite(newMember, group);
    
    // Informiere alle bestehenden Mitglieder über Neuzugang
    const announcement = `User ${newMember.name} joined the group`;
    await this.sendGroupMessage(groupId, announcement);
  }
}
```

### UI/UX
- **Gruppen-Erstellung:** Dialog mit Name + Mitglieder auswählen
- **Gruppen-Chat:** Ähnlich wie 1:1 Chat, aber mit Gruppennamen oben
- **Mitglieder-Liste:** Zeigt wer online ist (nur wenn bekannt)
- **Admin-Funktionen:** Mitglieder hinzufügen/entfernen

### Limitierungen
- **Max 10 Personen:** Mehr würde zu viel Traffic generieren
- **Keine Offline-Nachrichten:** Alle Mitglieder müssen online sein
- **Keine Nachrichten-Historie für neue Mitglieder:** Sie sehen nur ab Beitritt
- **Keine "Gruppen-Admin"-Recovery:** Wenn alle Admins weg → Gruppe tot

### Akzeptanzkriterien
- [ ] Gruppe mit 2-10 Mitgliedern erstellen
- [ ] Nachrichten werden an alle Mitglieder verteilt
- [ ] Symmetrische Verschlüsselung funktioniert
- [ ] Mitglieder hinzufügen/entfernen (Admin)
- [ ] Performance bei 10 Mitgliedern ist akzeptabel (< 5s pro Nachricht)

---

## Sprint-Planung

### Sprint 1: Foundation (Woche 1)
**Tägliche Kapazität:** 6-8 Stunden

| Tag | Task | Stunden |
|-----|------|---------|
| **Mo** | Kontaktverifikation: Fingerprint-Generierung | 4 |
| **Mo** | QR-Code Anzeige/Vergleich | 3 |
| **Di** | Verifikations-Status persistent speichern | 3 |
| **Di** | UI: Warnhinweis für unverifizierte Kontakte | 3 |
| **Mi** | Read Receipts: Status-Message-Protokoll | 4 |
| **Mi** | Typing Indicators: Debouncing + Sende-Logik | 3 |
| **Do** | UI: Haken-System + "tippt..." Anzeige | 4 |
| **Do** | Tests + Bugfixes | 3 |
| **Fr** | Review, Dokumentation, PR erstellen | 4 |

**Sprint 1 Deliverables:**
- ✅ Kontaktverifikation funktioniert
- ✅ Read Receipts + Typing Indicators aktiv
- ✅ PR gemerged

---

### Sprint 2: File Transfer (Woche 2)

| Tag | Task | Stunden |
|-----|------|---------|
| **Mo** | File Transfer: Chunking-Logik | 4 |
| **Mo** | I2P Stream-Integration | 3 |
| **Di** | Verschlüsselung (symmetrisch) | 3 |
| **Di** | Sende-Dialog + Fortschrittsbalken | 4 |
| **Mi** | Empfangs-Dialog (Accept/Reject) | 4 |
| **Mi** | Bild-Vorschau vor Accept | 2 |
| **Do** | Resume-Funktion bei Unterbrechung | 4 |
| **Do** | Tests mit großen Dateien | 3 |
| **Fr** | Review, Dokumentation, PR erstellen | 4 |

**Sprint 2 Deliverables:**
- ✅ Datei-Transfer funktioniert (bis 50MB)
- ✅ Vorschau für Bilder
- ✅ PR gemerged

---

### Sprint 3: Voice Messages (Woche 3)

| Tag | Task | Stunden |
|-----|------|---------|
| **Mo** | Mikrofon-Zugriff + MediaRecorder | 4 |
| **Mo** | Opus-Encoding Integration | 3 |
| **Di** | Wellenform-Generierung | 4 |
| **Di** | Aufnahme-UI (Halten/Toggle) | 3 |
| **Mi** | Senden als spezielle Nachricht | 3 |
| **Mi** | Empfang + Abspielen | 4 |
| **Do** | Fortschrittsbalken beim Abspielen | 3 |
| **Do** | Scrubbing (Position wechseln) | 3 |
| **Fr** | Review, Dokumentation, PR erstellen | 4 |

**Sprint 3 Deliverables:**
- ✅ Sprachnachrichten funktionieren
- ✅ Wellenform-Visualisierung
- ✅ PR gemerged

---

### Sprint 4: Group Chats (Woche 4)

| Tag | Task | Stunden |
|-----|------|---------|
| **Mo** | Gruppen-Datenstruktur + Key-Management | 4 |
| **Mo** | Gruppen-Erstellung Dialog | 3 |
| **Di** | Fan-out Logik (an alle Mitglieder senden) | 4 |
| **Di** | Gruppen-Invite Protokoll | 3 |
| **Mi** | Gruppen-Chat UI | 4 |
| **Mi** | Mitglieder-Liste + Admin-Funktionen | 3 |
| **Do** | Join/Leave Handling | 3 |
| **Do** | Performance-Optimierung (max 10) | 3 |
| **Fr** | Review, Dokumentation, PR erstellen | 4 |

**Sprint 4 Deliverables:**
- ✅ Gruppenchats funktionieren (2-10 Personen)
- ✅ Admin-Funktionen
- ✅ PR gemerged

---

## Gesamt-Meilensteine

| Woche | Feature | Status |
|-------|---------|--------|
| 1 | Kontaktverifikation + Read Receipts | 🔜 Sprint 1 |
| 2 | Datei-Transfer | 🔜 Sprint 2 |
| 3 | Sprachnachrichten | 🔜 Sprint 3 |
| 4 | Gruppenchats | 🔜 Sprint 4 |

**Gesamtdauer:** 4 Wochen (1 Entwickler, Vollzeit)
**Alternative:** 8 Wochen (1 Entwickler, halbtags)

---

## Abhängigkeiten & Risiken

### Technische Abhängigkeiten
- **I2P-Messaging muss stabil laufen** (Voraussetzung für alle Features)
- **Electron-Version** aktuell halten (Native Module)
- **PGP-Integration** funktioniert (bereits implementiert)

### Risiken
| Risiko | Wahrscheinlichkeit | Impact | Mitigation |
|--------|-------------------|--------|------------|
| I2P-Streams instabil | Mittel | Hoch | Retry-Logik, Fallback zu einfachen Nachrichten |
| Datei-Transfer zu langsam | Mittel | Mittel | Chunking, kleinere Chunks, Nutzer-Erwartung managen |
| Gruppen-Chat unskalierbar >10 | Niedrig | Mittel | Hartes Limit bei 10, Performance-Monitoring |
| UI-Komplexität wächst | Mittel | Niedrig | Iteratives Design, Nutzer-Feedback |

---

## Nächste Schritte

1. **Diesen Plan reviewen** und priorisieren
2. **Sprint 1 starten** (Kontaktverifikation)
3. **Branch erstellen:** `feature/contact-verification`
4. **Subagent spawnen** für Implementation

Soll ich mit Sprint 1 beginnen?
