# SecuChat — I2CP-Client-Android (External Java-I2P Router)

**Status:** Entwurf v0.2 (Recherche-Phase)
**Datum:** 2026-08-07
**Autor:** gianjaa
**Bezieht sich auf:** [[secuchat-embedded-java-i2p-2026-08-06]] (verworfen — startet nicht), [[secuchat-i2pd-socket-binds-stream-2026-08-05]] (i2pd#1255-Blocker)

## 1. Zusammenfassung & Motivation

SecuChat (Android) braucht eine stabile I2P-Verbindung. Drei Lösungsansätze wurden evaluiert:

| # | Ansatz | Status |
|---|---|---|
| A | **I2CP-Client direkt in SecuChat** (Verbindung zu externem Java-I2P-Router auf 127.0.0.1:7654) | **← GEWÄHLT** |
| B | SAM-Bridge in der Java-I2P-App (sam.jar ist in i2p.i2p zwar Public Domain, aber wir bräuchten zusätzlich deren Implementation — wir würden den ganzen `streaming`-Stack aus i2p.i2p bundlen, was Lizenz-Konsolidierung unnötig kompliziert) | Verworfen |
| C | Java-I2P embedded im SecuChat-Prozess (Migration-Spec 2026-08-06) | Verworfen — „startet nicht", Lizenz heikel, ~30 MB APK |

**Warum Ansatz A:**
- **Umgeht den i2pd#1255-Blocker strukturell** — wir sprechen gar nicht erst mit i2pd.
- **Lizenzlich sauber**: `net.i2p:i2p` von Maven Central ist Public Domain + dokumentierte Drittlizenz-Ausnahmen. Eine `THIRD_PARTY_NOTICES.txt` reicht.
- **Klein:** ~3-5 MB zusätzlich (vs. ~30 MB bei Embedded).
- **Standard-Use-Case**: BiglyBT, I2P-Bote, Syndie, qBittorrent-XPR, Vuze mit I2P-Plugin. Bewährt.
- **Löst zwei SecuChat-Blocker strukturell (siehe Recherche):**
  - **LeaseSet-Publish**: bei I2CP automatisch. Der Router schickt `RequestLeaseSetMessage`, `RequestLeaseSetMessageHandler` in `i2p.jar` signiert und publiziert. Unser aktueller `publishLeaseSet()`-Hack + 5-min-Republish-Loop **entfällt komplett**.
  - **STREAM-Multiplex**: `I2PSocketManager` multiplexed beliebig viele Streams über **eine** Session. Genau das, was i2pd#1255 blockiert hat.
- **Schneller iterierbar**: Wenn `i2p.jar` Probleme macht, ist der Fix-Pfad kurz (eine Lib-Version hoch/runter).

**User-Setup (Setup-Story):**
1. User installiert die offizielle Android-I2P-App (PurpleI2P/GetI2P) aus F-Droid oder Play Store.
2. User öffnet die I2P-App, schaltet I2CP-Tunnel-Freigabe frei (vom User entdeckt in den App-Einstellungen als „I2CP-Benutzeroberfläche").
3. User öffnet SecuChat → verbindet sich automatisch per Localhost auf 127.0.0.1:7654.
4. Bei Fehler: klare UI-Hilfe mit Link auf Play Store und Diagnose-Tool (TCP-Test auf 7654).

## 2. Architecture

### 2.1 Prozess-Topologie

```
┌─ App-Prozess (com.secuchat.app) ─────────────────────┐
│  ┌─ Capacitor WebView + Plugin-Layer ────────────┐   │
│  │  i2p.ts (TS-Frontend)                          │   │
│  │  ▲                                             │   │
│  │  │ Capacitor.Plugins.I2PPlugin.*               │   │
│  │  ▼                                             │   │
│  │  I2PPlugin.java (Capacitor-Bridge)             │   │
│  │    ├─ I2CPSocketManager (1 pro Session)        │   │
│  │    └─ I2PSocketPool (N pro Stream)             │   │
│  └─────────────────────────────────────────────┘   │
│                                                      │
│  PGP, ChatUI, Contact Exchange, ...                  │
└─────────────────────────┬────────────────────────────┘
                          │ TCP 127.0.0.1:7654 (I2CP)
         ┌────────────────▼──────────────────────────┐
         │ Java-I2P-App (PurpleI2P/GetI2P)            │
         │ - separater Prozess com.example.i2p         │
         │ - eigener Java-I2P-Router                  │
         │ - I2CP-Server auf 127.0.0.1:7654           │
         │ - eigene NetDB, LeaseSets, Tunnel-Management│
         └────────────────┬───────────────────────────┘
                          │
                       I2P-Netz
```

**Wesentliche Designentscheidung: KEIN zweiter App-Prozess von SecuChat.** Im Gegensatz zur Embedded-Migration-Spec bleiben wir im Default-Prozess. Grund:
- Eine einzige TCP-Socket zur I2P-App (kein IPC).
- Lizenz-Risiko geringer (eine statt drei `i2p`-Module).
- Memory-Footprint klein (3-5 MB Lib statt 80-200 MB Router).

### 2.2 Modul-Übersicht

| Komponente | Datei | Prozess | Aufgabe |
|---|---|---|---|
| `I2PPlugin` | `app/android/app/src/main/java/com/secuchat/app/plugin/I2PPlugin/I2PPlugin.java` | App | Capacitor-Bridge. Methoden: `start()`, `connectTo(dest)`, `accept()`, `send(id,data)`, `close(id)`, `disconnect()`. |
| `I2CPSocketManager` | `app/android/app/src/main/java/com/secuchat/app/plugin/I2PPlugin/I2CPSocketManager.java` | App | Wrapper um `net.i2p.client.streaming.I2PSocketManager`. 1 Instanz pro Session. Singleton. |
| `I2PSocketHandle` | `app/android/app/src/main/java/com/secuchat/app/plugin/I2PPlugin/I2PSocketHandle.java` | App | Wrapper um `I2PSocket` (out) bzw. `I2PServerSocket` (in). Hält Read-Thread. |
| `I2PClientCLI` | `app/android/app/src/main/java/com/secuchat/app/plugin/I2PPlugin/I2PClientCLI.java` | App | CLI-Diagnose-Tool via `console.log` (für CDP-Debug, ersetzt `__i2pDebug`). |
| `i2pPlugin.ts` | `app/src/services/i2pPlugin.ts` | App (TS) | Capability-Discovery + Call-Forwarding an `Capacitor.Plugins.I2PPlugin`. |
| `i2p.ts` | `app/src/services/i2p.ts` | App (TS) | **Schmale API-Änderung**: nutzt `i2pPlugin.ts` statt `samNative.ts` auf Android. |

### 2.3 Build-Dependencies

**Was wir bundlen** (zum `:i2p-build` Gradle-Modul hinzufügen):

| Artefakt | Quelle | Pfad | Lizenz |
|---|---|---|---|
| `net.i2p:i2p:2.8.0` | Maven Central | `libs/i2p/i2p-2.8.0.jar` | Public Domain + Drittlizenz-Ausnahmen (siehe `THIRD_PARTY_NOTICES.txt`) |

**Was wir NICHT bundlen** (aus dem Vendor-`:i2p-build` entfernen):
- `router-2.13.0.jar` (Java-I2P full Router — 30+ MB, nicht nötig)
- `mstreaming-2.13.0.jar` (BSD, nur Subset — `i2p.jar` enthält bereits die volle Streaming-Lib)

**Lizenz-Sanity-Check im `:i2p-build`-Task**:

```groovy
// Banned packages in i2p-2.8.0.jar (wir wollen nur Client-Lib, keinen Router)
['i2ptunnel', 'sam/', 'jetty', 'routerconsole', 'router/', 'apps/'].each { banned ->
    def hit = entries.find { it.contains("${banned}/") }
    if (hit != null) {
        throw new GradleException("License-scope violation: i2p-2.8.0.jar contains ${hit}")
    }
}
```

**THIRD_PARTY_NOTICES.txt** wird automatisch aus `i2p-2.8.0.jar` extrahiert (enthält die Lizenz-Ausnahmen: EdDSA CC0, json-simple Apache 2.0, gnu.gettext LGPL, etc.).

### 2.4 Datenfluss am Beispiel `connectTo`

1. User/JS ruft `i2pService.connectTo(destB32)` aus `app/src/services/i2p.ts`.
2. JS ruft `i2pPlugin.connectTo(destB32)` (statt vormals `samNativeService.connectTo`).
3. `i2pPlugin.connectTo` ruft `Capacitor.Plugins.I2PPlugin.connectTo({destination: destB32})`.
4. `I2PPlugin.connectTo` (im ExecutorService-Thread):
   - `Destination peer = mSocketManager.getSession().lookupDest(destB32, 15_000)`
   - `I2PSocket sock = mSocketManager.connect(peer)` (blocking, max 60s)
   - Wrap in `I2PSocketHandle(sock, streamId)`, starte Read-Thread
5. Rückgabe von `{streamId}` an JS via Promise-Resolve.
6. Stream-Events (Daten, Close) gehen via `EventEmitter` → `i2pPlugin.onMessage` → `i2p.ts.emitMessage`.

### 2.5 Initialisierung (Critical Path)

```java
// Beim Plugin-Start, im ExecutorService-Thread (NIE UI-Thread)
Properties opts = new Properties();
opts.setProperty("i2cp.tcp.host", config.host);  // meist "127.0.0.1"
opts.setProperty("i2cp.tcp.port", "7654");
opts.setProperty("i2cp.destination.sigType", "EdDSA_SHA512_Ed25519");
opts.setProperty("inbound.length", "2");
opts.setProperty("outbound.length", "2");
opts.setProperty("inbound.nickname", "SecuChat");
opts.setProperty("i2cp.leaseSetEncType", "4,0");  // X25519 + ElGamal
opts.setProperty("i2cp.reduceOnIdle", "true");    // Akku

// Destination laden oder erzeugen
byte[] privKey = identityStore.loadOrNull();
if (privKey == null) {
    ByteArrayOutputStream keys = new ByteArrayOutputStream(1024);
    I2PClientFactory.createClient().createDestination(keys, SigType.EdDSA_SHA512_Ed25519);
    privKey = keys.toByteArray();
    identityStore.save(privKey);
}

// NON-BLOCKING Factory (NICHT createManager, das blockt!)
I2PSocketManager mgr = I2PSocketManagerFactory.createDisconnectedManager(
    new ByteArrayInputStream(privKey), config.host, 7654, opts);
mSocketManager = mgr;

// Explizit verbinden — NICHT createManager machen, das verbindet schon
mSession = mgr.getSession();
mSession.connect();  // baut Tunnel, macht LeaseSet-Request automatisch
String myB32 = mSession.getMyDestination().toBase32();
```

**Wichtig:** `I2PClient.DEFAULT_SIGTYPE` ist **DSA_SHA1** (Legacy). `EdDSA_SHA512_Ed25519` muss **explizit** gesetzt werden — sonst inkompatible Destination.

### 2.6 Was sich für `i2p.ts` ändert

**Schmale API-Änderung:** Auf Android wählt `i2p.ts` zwischen `samNative.ts` (SAM-Pfad, bleibt) und `i2pPlugin.ts` (I2CP-Pfad, neu). Web/Electron bleibt auf SAM.

```ts
// app/src/services/i2p.ts (Auszug)
async initialize(config?: SAMConfig): Promise<I2PStatus> {
    if (platformService.isAndroidNative()) {
        // Neuer Pfad: I2CP-Client via i2pPlugin.ts
        return i2pPlugin.initialize(config);
    }
    // Bestehender Pfad: SAM via samNative.ts
    return samNativeService.initialize(config);
}
```

Methoden-Signaturen von `i2pPlugin.ts` sind **identisch** zu `samNative.ts`:

```ts
i2pPlugin.initialize(config)
i2pPlugin.generateDestination()
i2pPlugin.createSession(nickname, privateKey)
i2pPlugin.connectTo(destination, timeout, maxRetries)
i2pPlugin.startAccepting(nickname)
i2pPlugin.send(streamId, data)
i2pPlugin.closeStream(streamId)
i2pPlugin.disconnect()
```

### 2.7 Connect/Accept-Multiplex

I2CP löst das i2pd#1255-Problem strukturell:

```java
// Outgoing: I2PSocketManager multiplexed alle Streams über 1 Session
I2PSocket sock1 = mgr.connect(peer1);  // parallel
I2PSocket sock2 = mgr.connect(peer2);  // parallel
// Kein DUPLICATED_ID, kein INVALID_ID, kein Socket-Binding

// Incoming: I2PServerSocket akzeptiert unbegrenzt
I2PServerSocket server = mgr.getServerSocket();
while (running) {
    I2PSocket in = server.accept();   // blockt bis neuer Peer
    handle(in);  // in.getPeerDestination() = b32
}
```

## 3. Komponenten-Verantwortlichkeiten

### 3.1 `I2CPSocketManager` (Java-Singleton)

```java
public class I2CPSocketManager {
    private static volatile I2CPSocketManager instance;
    private final I2PSocketManager socketManager;
    private final I2PSession session;
    private final Destination destination;
    private final Map<Integer, I2PSocketHandle> outgoingStreams;
    private final Map<Integer, I2PSocketHandle> incomingStreams;
    private final AtomicInteger streamIdCounter;
    private final ExecutorService executor;

    private I2CPSocketManager(String host, int port, byte[] privateKey) throws IOException { ... }

    public static synchronized I2CPSocketManager getOrCreate(String host, int port, byte[] privateKey) { ... }
    public int connectTo(String destinationB32) throws IOException { ... }
    public int acceptIncoming() throws IOException { ... }
    public void send(int streamId, byte[] data) throws IOException { ... }
    public void close(int streamId, String reason) { ... }
    public void disconnect() { ... }
    public String getB32Address() { ... }
}
```

**Wichtig**: `I2PSocketManager` ist **thread-safe** (lt. Java-I2P API). Wir machen unseren Wrapper **reentrant-frei** durch `synchronized`-Blöcke auf `connectTo`/`acceptIncoming` (um Storm zu verhindern — siehe Regressions-Bericht 2026-08-04).

### 3.2 `I2PSocketHandle` (pro Stream)

```java
class I2PSocketHandle {
    private final int streamId;
    private final I2PSocket socket;        // null für incoming-Acceptor
    private final I2PServerSocket serverSocket;  // nur für incoming-Acceptor
    private final String peerDestination;
    private final ExecutorService readExecutor;
    private volatile boolean closed;
}
```

### 3.3 `I2PPlugin` (Capacitor-Bridge)

Capacitor-Plugin-Annotation, EventEmitter, Methoden siehe 2.6. Events:
- `i2pMessage`: `{from, data, streamId, timestamp}`
- `i2pStreamConnected`: `{streamId, peerDestination, type: 'outgoing'|'incoming'}`
- `i2pStreamClosed`: `{streamId, reason}`
- `i2pError`: `{error, errorCode, streamId}`
- `i2pStatus`: `{connected, sessionActive, host, port, b32Address}`

## 4. Daten-Lebenszyklus

### 4.1 Persistente Identität

- I2P-Destination = **zufälliges 2048-bit ElGamal-Schlüsselpaar** (= 387-byte PrivateKey-Stream), persistiert in `app/files/i2p/router.keys` (eigene Datei, NICHT von der Java-I2P-App).
- Wrap mit PBKDF2(passphrase)-AEAD bei Persistenz (gleiche Konvention wie aktuelle `i2p.ts`).
- Beim App-Start: Destination aus Disk laden, in `I2CPSocketManager.einspeisen`.
- Beim ersten Start: neue Destination generieren, persistieren.
- Wichtig: PrivKey-Stream format = `Destination ‖ PrivateKey ‖ SigningPrivateKey` (Reihenfolge!). Factory-Default ist `EdDSA_SHA512_Ed25519`, **nicht** `DSA_SHA1`.

### 4.2 LeaseSet-Publikation

**Entfällt komplett!** Der Java-I2P-Router sendet `RequestLeaseSetMessage` automatisch, sobald die Inbound-Tunnel stehen. `RequestLeaseSetMessageHandler` in `i2p.jar` signiert und antwortet vollautomatisch. Der Router publiziert dann in die NetDB.

Kein expliziter `publishLeaseSet()`-Aufruf von SecuChat nötig. Der 5-Minuten-Republish-Loop entfällt (der Router kümmert sich um NetDB-Refresh).

### 4.3 Session-Recovery

- Bei TCP-Drop zur I2P-App: Reconnect-Loop in `I2CPSocketManager` mit Exponential-Backoff (1s, 2s, 4s, 8s, max 30s).
- Bei `RouterRestartException` (seit 0.9.34): Session komplett neu aufbauen.
- Beim Reconnect: bestehende Destination wiederverwenden (Identität bleibt).

## 5. Fehlerbehandlung

| Szenario | Diagnose | UX |
|---|---|---|
| I2P-App nicht installiert | `pm list packages net.i2p.android` → leer | **Onboarding blockiert.** Modal-Bildschirm: „SecuChat braucht die I2P-Router-App. Bitte installieren." → Play-Store-Deeplink. Kein Skip. |
| I2P-App installiert, aber nicht gestartet | TCP 127.0.0.1:7654 → ConnectionRefused | Banner: „I2P-Router-App ist nicht aktiv. Bitte öffnen Sie die I2P-App und warten Sie, bis der Router bereit ist." |
| I2CP-Tunnel nicht freigeschaltet | TCP 127.0.0.1:7654 → Connected, dann I2CP-Disconnect wegen ACL | Banner: „In der I2P-App: Einstellungen → I2CP-Benutzeroberfläche → Tunnel-Freigabe aktivieren." |
| Router noch nicht initialisiert | TCP-Connect OK, CreateSession → Disconnected | Retry-Loop 5× mit Backoff (gleich wie bisher für i2pd) |
| Peer nicht erreichbar | `I2PSocket.connect` → `NoRouteToHostException` nach 60s | Frontend-Error-Mapping: „Peer nicht erreichbar. LeaseSet-Publikation kann 1-3 Min dauern." |
| Identität korrupt | `DataFormatException` beim PrivKey-Parsing | „I2P-Identität beschädigt. Backup einspielen oder neu generieren." |
| Lauter Storm | `i2p.ts` baut zu viele Connects in <1s | `pendingConnects`-Map (gleiche Dedup-Logik wie aktueller i2pd-Adapter) |

## 6. Tests

### 6.1 Build-Tests
- `:i2p-build`-Smoke: Maven-Central-Download → SHA-256-Sums → Strict-Scope-Check (kein `i2ptunnel/`, `sam/`, `jetty/`, `routerconsole/`, `router/`, `apps/`).
- Lizenz-Scan: `THIRD_PARTY_NOTICES.txt` enthält alle Drittlizenz-Ausnahmen aus `i2p-2.8.0.jar`.

### 6.2 Funktionale Tests
- **In-Process-Loopback** (kein Netz): I2CP-Client baut ein zweites `I2PSocketManager` mit lokalem RouterContext → connectTo(self) → send → receive. CI-Smoke.
- **Integration auf A50/A54**: gegen Java-I2P-App auf Gerät. CDP-Tunnel-Pipeline wie bisher, aber `__i2pDebug.connectToPeer('<b32>')` schickt jetzt durch die I2P-App.

### 6.3 Performance-Tests
- Throughput: 1 MB Payload, lokal über I2P-Loopback, Ziel: ≥ 100 KB/s.
- Latenz: 100 Pong-Pings, p95 < 500ms.
- Memory: kein Leak über 1h Standby.

## 7. Bedrohungsmodell

- **Bedrohung 1**: MITM auf 127.0.0.1:7654 durch andere App → **akzeptiert** (Localhost ist lokal). Mitigation: nur App mit INTERNET-Permission und `android.permission.INTERNET` kann auf 127.0.0.1 zugreifen — das sind nur Apps des Users.
- **Bedrohung 2**: Andere App installiert Fake-I2CP-Server auf 7654 → **unwahrscheinlich** (Port-Belegung). Mitigation: UI zeigt Java-I2P-Banner-Identify (Version-Handshake).
- **Bedrohung 3**: I2P-Router kompromittiert (z.B. durch Bug in der I2P-App) → **Out-of-Scope** (User-Setup). Wir setzen voraus, dass die I2P-App vertrauenswürdig ist.
- **Bedrohung 4**: Deterministische I2P-Destination ableitbar aus Passphrase → **NICHT implementiert** (siehe Migration-Spec Begründung). Wir nutzen zufällige 2048-bit ElGamal.

## 8. Was sich für die User-Experience ändert

### 8.1 Negativ
- User muss die I2P-App (`net.i2p.android`) zusätzlich installieren (zusätzlicher 30-40 MB Download).
- I2P-App ist beim ersten Start langsam (5-10 Min NetDB-Build, dann OK).
- User muss in der I2P-App einmalig I2CP-Tunnel-Freigabe aktivieren („I2CP-Benutzeroberfläche").
- Onboarding blockiert ohne I2P-App — kein Skip möglich.

### 8.2 Positiv
- **Echte E2E-Kommunikation auf Android** — was seit 2026-08-05 mit dem i2pd#1255-Blocker nicht mehr ging.
- **Klare Verantwortlichkeit**: SecuChat = Messaging, I2P-App = Network-Layer. Klassisches Seperation-of-Concerns.
- **Schnellere Iterationen**: Wir können i2p-Versionen unabhängig vom i2p-Build-Stand testen.
- **Standard-Setup** unter Android-I2P-Nutzern — viele sind die Drittanbieter-Tunnel-Freigabe schon gewohnt.

## 9. Phasen / PR-Plan

| PR | Inhalt | Verifikation |
|---|---|---|
| 1 | `:i2p-build` umstellen: `net.i2p:i2p:2.8.0` von Maven Central; `router-2.13.0.jar` + `mstreaming-2.13.0.jar` raus | Build-Smoke, SHA-Sums, Strict-Scope (kein `router/`, `apps/`, `i2ptunnel/`, `sam/`, `jetty/`, `routerconsole/`) |
| 2 | `I2CPSocketManager` + `I2PSocketHandle` (Java-Klassen ohne Plugin) | Unit-Tests |
| 3 | `I2PPlugin` (Capacitor-Bridge) + EventEmitter | In-Memory-Tests (Loopback) |
| 4 | `i2pPlugin.ts` (TS-Adapter) | TS-Build |
| 5 | `i2p.ts` Wechsel: `samNativeService` → `i2pPlugin.ts` (mit Fallback auf `samNativeService` für Web/Electron) | TS-Build, ESLint |
| 6 | UI: Settings-Status + I2P-App-Install-Hint | CDP-Screenshot |
| 7 | Onboarding-Block: `pm list packages net.i2p.android`-Check + Play-Store-Deeplink-Modal | Manual-Test auf A50/A54 |
| 8 | Cleanup: `SAMPlugin/`-Code für Android raus (Web/Electron-Pfad bleibt) | Build-Smoke |
| 9 | E2E-Tests auf A50 + A54 mit dem Java-I2P-App-Setup | Manuelle CDP-Tests |

## 10. Konfiguration (vom User bestätigt)

| Frage | Entscheidung |
|---|---|
| Welche I2P-App? | **`net.i2p.android`** (PurpleI2P) — Play Store: `https://play.google.com/store/apps/details?id=net.i2p.android` |
| `SAMPlugin` für Android? | **Wegfall komplett.** SAM hat auf Android nie funktioniert (i2pd#1255). Wir behalten SAM-Pfad nur für Web/Electron. |
| Mindest-SDK? | **26** (Android 8.0+) — unverändert zur embedded-Migration-Spec. |
| I2P-App-Install-Check? | **Ja, Block + Install.** Onboarding prüft `pm list packages net.i2p.android`; falls fehlt, harten Stop mit Play-Store-Deeplink. User kann nicht ohne I2P-App in die App. |
| Onboarding-Text? | Die aktuelle i2pd-Anleitung (Schritt 4: „i2pd ist erforderlich") wird für Android komplett ersetzt: 'I2P-Router-App "I2P" installieren, in I2P-App: Einstellungen → I2CP-Benutzeroberfläche → Tunnel-Freigabe aktivieren, dann zurück zu SecuChat.' |

## 11. Warum NICHT Embedded Java-I2P (Plan B)

- Embedded-Ansatz (PR 4-6 der Migration-Spec 2026-08-06) ist nicht implementiert. User-Bericht: „startet nicht".
- Lizenz: 3 Module bundle = höherer Review-Aufwand.
- APK-Größe: +30 MB statt +3 MB.
- FGS-Process `:i2p` benötigt zusätzliche Android-15-Policy-Compatibilität.
- IPC-Overhead: 5-10 ms pro Call, der hier unnötig ist (externer Router = TCP).

---
