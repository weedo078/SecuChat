---
title: SecuChat — Embedded Java-I2P Router Migration
date: 2026-08-06
status: APPROVED (pending user review)
session: 2026-08-06
owner: gianjaa
related: secuchat-sam-spec-compliant-architecture-2026-08-06, secuchat-i2pd-socket-binds-stream-2026-08-05, secuchat-stream-connect-invalid-id-2026-08-05, secuchat-android-bridge-e2e-2026-08-04
---

# SecuChat — Migration von SAM/i2pd zu Embedded Java-I2P

## 1. Zusammenfassung & Motivation

SecuChat ist eine Privacy-Messaging-App mit PGP-Verschlüsselung und I2P-Routing. Der aktuelle Native-SAM-Plugin (`app/android/.../plugin/SAMPlugin/`) spricht das SAM-v3.1-Protokoll gegen eine externe i2pd-Instanz (entweder das `purplei2p.i2pd`-APK auf demselben Phone, oder ein Host-i2pd auf dem Entwicklungsrechner via `adb reverse`).

Diese Architektur ist durch zwei zusammenhängende Bugs blockiert:

1. **PurpleI2P/i2pd#1255** — i2pd bindet STREAM CONNECT/ACCEPT-Berechtigung exklusiv an die Socket, auf der zuerst `SESSION STATUS RESULT=OK` kam. Folge: spec-konforme Architektur (frische HELLO-only-Sockets pro Stream) wird von i2pd mit „No response to STREAM" beantwortet. Das Issue ist seit 2020 (`r4sas`: „t/o. Need to recheck") ohne Maintainer-Aktivität, Reporter bestätigen den Bug 2021 auch für Stock-C++-Implementation.
2. **Spec-Drift-Symptome** — die in der vorigen Session gebaute Spec-konforme Architektur (`SAMSessionSocket` + `SAMStream`, kein Pool, kein `DUPLICATED_ID`-Accept) kompiliert und ist intern korrekt, kann aber gegen aktuelle i2pd-Versionen (2.56.0 Host, 2.61.0 Phone) **kein** funktionierendes STREAM-Operations-Paar herstellen.

**Strategie dieser Spec**: Wir migrieren von i2pd zu Java-I2P (`i2p.i2p`) als embedded In-Process-Router-Library im App-Build. Java-I2P (`RouterContext.internalClientManager()`) ist seit Jahren die offizielle embedded-API für diesen Use-Case, umgeht die SAM-Schicht komplett, und behebt die STREAM-Multiplex-Problematik strukturell.

### Was sich für den User ändert

Nichts funktional Sichtbares. Die App-internen APIs (`i2p.ts`-Methoden `connectTo`, `startAccepting`, `publishLeaseSet`, `disconnect`) bleiben gleich. Hintergrund: Persistente Notification „Privacy-Modus aktiv" (kein explizites „I2P"-Wort, Privacy-by-Design), Akku-Drain 5-8%/Tag bei aktiver Nutzung. APK-Größe wächst um ca. 20-30 MB. minSdkVersion steigt auf 26.

### Was sich für das Build-System ändert

`i2p.i2p` als gepinnter Vendor-Submodul mit GPG-verifiziertem Tag. Build-Integration via Gradle-Modul `:i2p-build`, das die i2p.i2p-Ant-Builds orchestriert und JARs in `app/libs/i2p/` mit SHA-256 ablegt. Lizenz-Compliance via `THIRD_PARTY_NOTICES.txt`.

### Was sich für das Threat-Model ändert

Die bisherige Architektur hatte eine **deterministische Passphrase-derived I2P-Destination** als Idee in Schubladen — diese Spec **verwirft das**. Identität bleibt ein zufälliges 2048-bit ElGamal-Schlüsselpaar, persistiert in `router.keys`, PBKDF2 wird nur als Key-File-Wrap verwendet (AEAD gegen Disk-Forensik). Forward-Secrecy und offline-Bruteforce-Schutz bleiben wie im I2P-Standard vorgesehen.

---

## 2. Architecture

### 2.1 Prozess-Topologie

Der Java-I2P-Router läuft in einem **separaten Android-Prozess** `:i2p`, nicht im App-Prozess. Die App-(Capacitor/Plugin)-Schicht bleibt im Default-Prozess `com.secuchat.app`.

```
┌─ App-Prozess (com.secuchat.app) ──────────────┐
│  ┌─ Capacitor WebView + Plugin-Layer ─────┐   │
│  │  i2p.ts (TS-Frontend)                  │   │
│  │  ▲                                      │   │
│  │  │ bindService (LocalBinder)            │   │
│  │  ▼                                      │   │
│  │  I2PPlugin.java (Capacitor-Bridge)      │   │
│  │    └─ MiniSAMBridge (API-kompatibel)    │   │
│  └─────────────────────────────────────────┘   │
│                                               │
│  PGP, ChatUI, Contact Exchange, ...           │
└───────────────────────┬───────────────────────┘
                        │ IPC (kein AIDL)
              ┌─────────▼─────────┐
              │ :i2p-Prozess      │
              │ (dedicated)       │
              │                   │
              │ RouterService ────┼─ Foreground Service,
              │ (Android-Service) │  Type: specialUse
              │    │              │
              │    ▼              │
              │ RouterProcess ────┼─ bootstrap() sync
              │ (eigene JVM)      │
              │    │              │
              │    ▼              │
              │ Router            │  (net.i2p.router.Router)
              │    │              │
              │    └─ RouterContext
              │        ├─ internalClientManager()
              │        ├─ netDB                    (im noBackup-FilesDir)
              │        └─ JobQueue + Transports    (SSU, NTCP)
              └────────┬──────────┘
                       │
                  I2P-Netz
```

**Warum zwei Prozesse?** (bestätigt durch Architektur- und Security-Review):

- **OOM-Isolation**: Java-I2P allokiert 80–200 MB Heap im Steady-State (NetDB-Page-Cache, Tunnel-Pools, Streaming-Buffers). Im App-Prozess riskiert das UI-OutOfMemory-Kills; `:i2p` bekommt eigene OOM-Klasse, kann aggressiver wachsen ohne UI zu stören.
- **Blast-Radius-Reduktion**: Bug in beliebiger App-Library (PGP, JSON-Parser, WebView-Inhalt) kann nicht direkt `router.keys` lesen oder Live-Chiffretexts mitlesen.
- **Lifecycle-Unabhängigkeit**: WebView-Crashes killen nicht den Router, App-Updates ohne Router-Restart möglich (in Stadium 6 denkbar).

**IPC-Mechanismus**: `LocalBinder`-Pattern via `bindService(BIND_AUTO_CREATE)` für synchrone Calls, `LocalBroadcastManager` für asynchrone Events vom `:i2p`-Prozess. **Kein AIDL** — AIDL wäre Cross-Process-Marshalling auf einem In-Process-API, ein Architektur-Smell.

### 2.2 Modul-Übersicht (Final)

| Komponente | Datei | Prozess | Aufgabe |
|---|---|---|---|
| `RouterProcess` | `app/android/I2PProcess/src/main/java/com/secuchat/i2p/RouterProcess.java` | `:i2p` | Statische Main-Methode. Initialisiert Security-Provider, lädt `router.config`, baut `Router`, blockiert bis Shutdown. |
| `RouterService` | `app/android/I2PProcess/src/main/java/com/secuchat/i2p/RouterService.java` | `:i2p` | Android-Service, FGS Type `specialUse`. Im `onCreate` löst er `RouterProcess.bootstrap()` aus; im `onDestroy` ruft er `RouterContext.killGlobalContext()` und wartet via `addFinalShutdownTask()` auf sauberen Teardown. |
| `I2PPlugin` | `app/android/app/src/main/java/com/secuchat/app/plugin/I2PPlugin/I2PPlugin.java` | App | Capacitor-Bridge. Bindet sich via `LocalBinder` an `RouterService`. Methoden: `start()`, `connectTo(dest)`, `accept()`, `send(id,data)`, `close(id)`. |
| `MiniSAMBridge` | `app/android/app/src/main/java/com/secuchat/app/plugin/I2PPlugin/MiniSAMBridge.java` | App (Aufrufer-Seite) | Setzt die bestehende SAM-v3.1-Methoden-API im Plugin um. Halbiert: das öffentliche `MiniSAMBridge`-Interface lebt im App-Prozess und ruft via LocalBinder-Cross-Process in `RouterBridge` rein; die Stream-Reader-Threads und `I2PSocket`-Handles leben im `:i2p`-Prozess. TS-Frontend unverändert. |
| `RouterBridge` | `app/android/I2PProcess/src/main/java/com/secuchat/i2p/RouterBridge.java` | `:i2p` | Synchroner Call-Eingang vom App-Prozess. Reicht `I2PSession.createSession()`, `I2PSocketManager.connect()`, `I2PSocketManager.createServerSocket()` an den RouterContext durch. Stream-Events: asynchron via `LocalBroadcastManager`. |
| `IdentityStore` | `app/android/I2PProcess/src/main/java/com/secuchat/i2p/IdentityStore.java` | `:i2p` | Verwaltet `router.keys` aus i2p.i2p-Defaultsystem. Wrap mit PBKDF2(passphrase)-AEAD bei Persistenz im `getNoBackupFilesDir()`. Identität ist zufälliges 2048-bit ElGamal, persistiert. |
| `ConfigProfile` | `app/android/I2PProcess/src/main/java/com/secuchat/i2p/ConfigProfile.java` | `:i2p` | Hart gesetzte Limits: `inboundPoolLength=2 outboundPoolLength=2`, `sharePercentage=50`, `totalMemoryMax=128`, `netDb.maxMemory=24`, `jobQueue.memory=8`, `router.updateDisabled=true`, `router.limits.concurrentJobs=64`. |
| `THIRD_PARTY_NOTICES.txt` | Auto-generated Asset | App-Build | Pro Modul Lizenz-Text, generiert aus `vendor/i2p.i2p/*/doc/readme.license.txt` und `LICENSE.txt`. Verlinkt in der App-„Über"-Sektion. |

### 2.3 Datenfluss am Beispiel `connectTo`

1. User/JS ruft `i2pService.connectTo(destB32)` aus `app/src/services/i2p.ts`.
2. JS ruft `Capacitor.Plugins.I2PPlugin.connectTo({destination: destB32})`.
3. `I2PPlugin.connectTo` macht `mService.connectRemote(destB32)` via `LocalBinder` an den `:i2p`-Prozess.
4. `RouterBridge.connectRemote` ruft `I2PClient.createSession(...)` (mit SecuChat-eigener 2048-bit-Destination) → holt `I2PSocketManager` via `RouterContext.internalClientManager()`.
5. `I2PSocketManager.connect(destB32)` gibt `I2PSocket` zurück.
6. `RouterBridge` packt Read-Thread + Write-Stream in ein Handle und sendet `handleId` zurück via Binder.
7. `I2PPlugin` reicht `handleId` an JS via Promise-Resolve.
8. Stream-Events (Daten angekommen, Close) gehen via `LocalBroadcastManager` zurück: `I2PPlugin` registriert `BroadcastReceiver`, leitet sie als Events an JS.
9. `i2p.ts.emitMessage({from, payload, id})` triggert ChatUI-Render.

### 2.4 Datenfluss am Beispiel `publishLeaseSet`

1. App-Start oder Re-Publish-Trigger (alle 5 Min).
2. JS ruft `i2pService.publishLeaseSet()`.
3. `I2PPlugin.publishLeaseSet` → `RouterBridge.publishLeaseSet` → triggert `LeaseSet`-Update via `Destination.publish()` (i2p.i2p-API).
4. `:i2p`-Prozess publisht automatisch im Hintergrund; `I2PClient` interface triggert den Sub-Subscribe-Message-Flow.
5. Java-I2P-Library handled das transparent, App wartet nicht.

### 2.5 Was `i2p.ts` (Frontend) sieht

**Identische Signaturen** wie vorher. Wir liefern via Capacitor-Bridge dieselbe Method-Payload wie `SAMPlugin`:

```ts
// app/src/services/i2p.ts — public API bleibt
export interface I2pService {
  start(): Promise<{nickname: string; destination: string}>;
  connectTo(destB32: string): Promise<string>; // returns streamId
  accept(): Promise<string>;                    // returns streamId
  send(streamId: string, data: Uint8Array): Promise<void>;
  close(streamId: string): Promise<void>;
  publishLeaseSet(): Promise<void>;
  disconnect(): Promise<void>;
  on(event: 'status'|'message'|'close', cb): Unsubscribe;
}
```

Die TS-Implementierung wechselt intern von TCP-Socket-Layer zu `Capacitor.Plugins.I2PPlugin.*`-Calls.

---

## 3. Komponenten-Verantwortlichkeiten

### 3.1 `RouterProcess` (Bootstrap)

```java
public class RouterProcess {
    public static void main(String[] args) throws Exception {
        // Sicherheits-Provider-Reihenfolge explizit setzen,
        // BEVOR der Router-Thread startet (Android-Konflikt mit AndroidOpenSSL).
        Security.removeProvider("BC");
        Security.insertProviderAt(new BouncyCastleProvider(), 1);

        Properties props = ConfigProfile.defaults();
        props.putAll(loadUserOverrides()); // router.config

        Router router = new Router(props);  // net.i2p.router.Router direkt,
                                            // NICHT RouterLaunch (Repo-Warnung:
                                            // "Not recommended for embedded use")
        RouterContext ctx = router.getContext();

        // Shutdown-Hook für Android-Prozess-Cleanup
        ctx.addFinalShutdownTask(() -> {
            Log.d("I2P", "RouterContext final shutdown reached");
        });

        // Blockiert — Service hält die JVM alive
        router.run();
    }
}
```

**Warum `new Router(props)` direkt, nicht `RouterLaunch.main()`?**

Aus `router/java/src/net/i2p/router/RouterLaunch.java` (i2p.i2p HEAD):
> *"Not recommended for embedded use. Instantiate Router() yourself."*

Das ist die offizielle embedded-API.

### 3.2 `I2PPlugin.connectTo` (Capacitor-Bridge)

```java
@Plugin(name = "I2PPlugin")
public class I2PPlugin extends Plugin {
    private IRouterBridge mService;
    private boolean mBound = false;

    private final ServiceConnection mConnection = new ServiceConnection() {
        @Override public void onServiceConnected(ComponentName n, IBinder s) {
            // Cross-Process-LocalBinder-Cast: kein AIDL, kein Stub.asInterface.
            // RouterBridge.Stub.asInterface() gilt nur, wenn AIDL verwendet würde —
            // wir nutzen LocalBinder, daher direkter Cast auf die im :i2p-Prozess
            // lebende RouterBridge-Referenz.
            mService = (RouterBridge) s;
            mBound = true;
        }
        // ...
    };

    @PluginMethod
    public void connectTo(PluginCall call) {
        if (!mBound) { call.reject("not_connected"); return; }
        try {
            String dest = call.getString("destination");
            String handleId = mService.connectRemote(dest);
            call.resolve(new JSObject().put("handleId", handleId));
        } catch (Exception e) {
            call.reject("connect_failed", e);
        }
    }
}
```

**Wichtig**: Service-Bindung erfolgt im `App.onCreate()` (Capacitor-Lifecycle), nicht beim Plugin-Mount — sonst Race mit `:i2p`-Prozess-Boot.

### 3.3 `MiniSAMBridge`

Kapselt die Cross-Process-Stream-Logik. Hintergrund-Thread pro Handle liest `I2PSocket.getInputStream()`, schreibt via `LocalBroadcastManager` an die App.

```java
class MiniSAMBridge {
    private final ConcurrentHashMap<String, I2PSocket> mSockets = new();

    // Vom :i2p-Prozess aufgerufen via Binder
    String connectRemote(String destB32) throws ... {
        I2PSocketManager mgr = RouterContext.getGlobalContext()
                              .internalClientManager()
                              .getClientManager();
        // ODER via internalClientManager().createClientSession(...) für eigene SecuChat-Destination
        I2PSocket sock = mgr.connect(destB32);
        String handleId = UUID.randomUUID().toString();
        mSockets.put(handleId, sock);
        startReaderThread(handleId, sock);
        return handleId;
    }

    private void startReaderThread(String id, I2PSocket sock) {
        new Thread(() -> {
            try {
                byte[] buf = new byte[32 * 1024];
                int n;
                while ((n = sock.getInputStream().read(buf)) > 0) {
                    Intent ev = new Intent(I2PPlugin.ACTION_MESSAGE);
                    ev.putExtra("handleId", id);
                    ev.putExtra("data", Arrays.copyOf(buf, n));
                    LocalBroadcastManager.getInstance(appCtx).sendBroadcast(ev);
                }
            } catch (IOException e) { /* graceful */ }
        }, "i2p-reader-" + id).start();
    }
}
```

### 3.4 `IdentityStore` und `router.keys`-Wrap

```java
class IdentityStore {
    // Plaintext-Datei: /data/data/com.secuchat.i2p/noBackup/i2p/router.keys
    //                   ^ getNoBackupFilesDir() — ausgeschlossen von Auto-Backup
    // Verschlüsselung: AES-256-GCM mit Key = PBKDF2-HMAC-SHA256(passphrase, salt, 100k iter, 32B)
    // salt: per-install-random in /data/data/com.secuchat/noBackup/salt.bin

    void createOrLoadIdentity(String passphrase) throws ... {
        File plain = new File(noBackupDir, "router.keys");
        File wrapped = new File(noBackupDir, "router.keys.enc");
        if (wrapped.exists()) {
            byte[] wrappedBytes = Files.readAllBytes(wrapped.toPath());
            byte[] plainBytes = AEADUnwrap(wrappedBytes, deriveKey(passphrase));
            // In-Memory zurück nach RouterContext, NICHT auf Disk schreiben
            // (außer wenn User explizit identitäts-backup macht).
            return;
        }
        // First boot: Router generiert zufälliges Schlüsselpaar
        // (Standard I2P-Verhalten, wir triggern es via RouterContext)
        Destination myDest = RouterContext.getGlobalContext()
                               .clientManager()
                               .createDestination();
        // ... persist in wrapped form
    }
}
```

**Identitäts-Lebenszyklus**:

- **First-Boot**: I2P erzeugt 2048-bit ElGamal zufällig, persistiert in `router.keys.enc`.
- **Folge-Boot**: Wrap wird entschlüsselt, in-memory in RouterContext geladen, Plaintext nicht auf Disk geschrieben.
- **Passphrase-Reset**: Mit unserer Wrapper-Strategie geht das — User gibt neue Passphrase ein, wir wrap'en den Plaintext-Key (noch in Memory) mit neuer Passphrase neu.
- **Passphrase-Verlust**: Plaintext-Key ist nicht mehr entschlüsselbar → Identitätsverlust. Standard-Risiko, dokumentiert in App-UX.

### 3.5 `ConfigProfile`

Die festen Limits sind nicht verhandelbar — sie sind die einzige Möglichkeit, die Akku-Realität in den Griff zu kriegen.

```java
class ConfigProfile {
    static Properties defaults() {
        Properties p = new Properties();
        p.setProperty("router.inboundPoolLength", "2");
        p.setProperty("router.outboundPoolLength", "2");
        p.setProperty("router.bandwidth.sharePercentage", "50");
        p.setProperty("router.limits.totalMemoryMax", "128");  // MB
        p.setProperty("router.netDb.maxMemory", "24");
        p.setProperty("router.jobQueue.maxMemory", "8");
        p.setProperty("router.updateDisabled", "true");
        p.setProperty("router.limits.concurrentJobs", "64");
        p.setProperty("i2p.crypto.ed25519", "true");
        p.setProperty("i2p.router.console.skip","true");
        p.setProperty("i2p.vm.list","gnu.getopt.Getopt");  // jbigi-Hook
        // Hardcoded-but-rotateable Reseed-Server (Mobilfunk-tauglich)
        p.setProperty("i2p.reseedURL",
            "https://reseed.i2p.ro/,https://i2p.ghativega.in/,https://reseed-pl.i2pd.xyz/");
        return p;
    }
}
```

### 3.6 Logging-Policy (Security-Pflicht)

```java
class LogGate {
    static {
        if (!BuildConfig.DEBUG) {
            // Produktiv-Build: Java-I2P-Log-Level auf WARN
            System.setProperty("i2p.log.level", "WARN");
            // Routerspezifische Felder in Logs unkenntlich machen
        }
    }
}
```

Crashlytics/Play-Vitals mit Filter `net.i2p.*` ausschließen, damit Router-Destination-Hashes nicht im PlayStore-Crash-Report landen.

---

## 4. Lifecycle

### 4.1 Startup-Sequenz

```
App-Coldstart
  │
  ▼
Capacitor-Lifecycle Hook (app.onCreate)
  │
  ├─→ Context.startForegroundService(routerServiceIntent)   ◄── App-Prozess
  │                                                          :i2p noch nicht da
  │
  ▼
OS startet :i2p-Prozess
  │
  ▼
RouterService.onCreate
  │   setForeground(true, "Privacy-Modus aktiv", lowImportance)
  │   startet Worker-Thread der RouterProcess.bootstrap() aufruft
  │
  ▼
RouterProcess.bootstrap
  │   Security.removeProvider("BC") + insertProviderAt(new BC(), 1)
  │   lade ConfigProfile.defaults()
  │   new Router(props), router.getContext()
  │   InternalClientManager bereit machen
  │   router.run() → blockiert
  │
  ▼ (parallel zum Block)
  I2PPlugin.onResume
  │   bindService mit BIND_AUTO_CREATE
  │   wartet auf onServiceConnected (kann 30s+ dauern wenn NetDb-Warmup)
  │
  ▼
Router ist online (RouterContext.networkStatus() == OK)
  │   LocalBroadcastManager.sendBroadcast("i2p-status:connected")
  ▼
I2PPlugin empfängt Event, ruft JS-Layer auf
  │   Capacitor notifyListeners('status', {samStatus: 'connected', leasesetPublished: true})
  ▼
i2p.ts onSamStatus → UI rendert „Verbunden …"
```

### 4.2 Teardown-Sequenz

```
App-Stop / onDestroy (sauber)
  │
  ▼
I2PPlugin.disconnect
  │   close alle sockets → RouterBridge.closeAll
  ▼
App.unbindService  → :i2p-Prozess bleibt alive (FGS, persistent)
  │
User-Force-Stop der App
  │
  ▼
OS killt :i2p-Prozess
  │   Persistente Identität (router.keys.enc) bleibt auf Disk
  ▼
Nächster Coldstart: Identität wird entschlüsselt + in RouterContext geladen
```

### 4.3 Hintergrund-Reception

- **Foreground**: WebView + `:i2p` Router-Process laufen beide.
- **App in Background**: WebView pausiert, `:i2p` läuft weiter (FGS pinnen ihn an den Service). Streams werden weiter geroutet, `LeaseSet` weiter publiziert.
- **OS aggressive Kills (low-end Devices, RAM pressure)**: `:i2p`-Prozess wird als „nicht-ui-essentiell" markiert, OS darf ihn früher killen. Mitigation: `android:largeHeap="true"` auf `:i2p`-Manifest-Tag.

### 4.4 Update-Strategie

- `i2p.i2p` als pinned GPG-signed Git-Tag (z.B. `2.10.0`).
- `scripts/verify-i2p-tag.sh` läuft im CI, verifiziert GPG-Signature gegen out-of-band (z.B. via separate Maintainer-Page auf secuchat.app/blog).
- Quartalsweise Patch-Review: GitHub-Action scannt Tags, erstellt internen PR.
- Kein Live-Submodule-Pull zur Build-Zeit — JARs werden einmalig von einem Maintainer gebaut, mit `SHA256SUMS.txt` signiert, im `vendor/i2p.i2p/build/i2p/` eingecheckt.

---

## 5. Fehlerbehandlung

### 5.1 Bekannte Fehlerbilder

| Symptom | Ursache | Mitigation |
|---|---|---|
| `SESSION_STATUS=INVALID_KEY` beim App-Coldstart | Routen-Discovery noch nicht warm, Destination-Cache leer | Retry mit Exponential-Backoff in `IdentityStore.createOrLoadIdentity`; max. 5 Versuche, dann `onError("router_not_ready")` an JS. |
| Stream-Connect hängt (kein ACK nach 30s) | Receiver-Destination noch nicht im NetDb oder symmetrisches NAT | i2p.i2p `I2PSocket.connect(timeout=…)` löst automatisch timeout; MiniSAMBridge setzt `RESULT=TIMEOUT` für die App. Dokumentieren in User-UX. |
| `OutOfMemoryError` im `:i2p`-Prozess | NetDb wächst zu groß, GC räumt nicht auf | RouterService-Tag mit `android:largeHeap="true"`. Backoff-Re-Publish-Tunnels. |
| Passphrase-Falsch-Eingabe | User tippt falsch | IdentityStore wirft `KeyUnwrapException`. UI zeigt „Falsche Passphrase, Identität nicht ladbar". App bietet „Neue Identität generieren" als Recovery. |
| ACRA/Crashlytics fängt `net.i2p.*` Stack-Traces ab | Default-Crash-Reporter zu gierig | `proguard-rules.pro`: `-keepattributes SourceFile,LineNumberTable` auf `com.secuchat.*`, Crashlytics filter `net.i2p.*` per Build-Config. |
| `:i2p`-Prozess crasht vor `addFinalShutdownTask`-Hook erreicht | OS killt hart | Nächster Boot: NetDb-Check via `RouterContext.areConfigsValid()`. Wenn invalide: lokal reseed-erzwungen. |

### 5.2 Recovery-Pfade

- **Korrupter NetDb**: User-In-App-Button „Router zurücksetzen" → löscht `netDb/`, neuerlicher Reseed.
- **Passphrase verloren**: Identität verloren, Recovery via Restore-from-Backup (SecuChat v2-Export beinhaltet zukünftig den unverschlüsselten `router.keys`-Plaintext, in User-Verschlüsselung gewrappt mit Backup-Passphrase).
- **Unklare Bugs**: Standard ist `:i2p`-Restart via `startForegroundService(intentWithAction="RESTART")`. Service stoppt sich, OS startet ihn neu.

---

## 6. Daten-Persistenz

### 6.1 Storage-Tabelle

| Datentyp | Pfad (im `:i2p`-Prozess-Storage) | Format | Protection |
|---|---|---|---|
| `router.keys` (Private-Destination) | `noBackup/i2p/router.keys.enc` | AES-256-GCM wrapped | PBKDF2(passphrase, salt, 100k) |
| `salt.bin` | `noBackup/salt.bin` | 32B random | App-Internal, per-install einmalig erzeugt |
| `netDb/` | `noBackup/i2p/netDb/` | I2P-Standard | Klartext (NetDb ist public Routable-Info) |
| `wrapper.info` | `noBackup/i2p/wrapper.info` | 1 Datei, klein | Klartext |
| Persistente Config-Overrides | `noBackup/i2p/user.config` | Java-Properties | Klartext |
| App-Private Logs | `noBackup/i2p/logs/` | I2P-Default-Logger | WARN-Level produktiv |

### 6.2 Backup-Strategie

- **`android:allowBackup="false"`** + `android:dataExtractionRules` (Android 12+).
- **SecuChat v2-Export** (separate Funktion) exportiert explizit nur den User-relevanten Teil:
  - PGP-Privat-Key (wie bisher)
  - **NEU**: `router.keys` Plaintext (in `v2`-Container, PGP-Passphrase-encrypted)
- **kein** Auto-Backup von Router-State (NetDb etc.).

### 6.3 Identitäts-Drift-Detection

- Beim Coldstart vergleicht `IdentityStore` den entschlüsselten `router.keys`-Hash mit der vorherigen Hash-Notiz in `sharedPreferences`. Wenn Drift: `onError("identity_changed_renew_contacts")` an UI.

---

## 7. Build-Integration & Lizenz-Compliance

### 7.1 Module-Auswahl (verbindlich)

**Eingebunden** (`compileOnly`/`implementation`):

| Modul | Lizenz | Begründung |
|---|---|---|
| `i2p.i2p/core/` | Public Domain | Crypto-Primitiven, immer erforderlich |
| `i2p.i2p/router/java` | Mixed (überwiegend public domain + BSD) | Router-Engine, In-Process-API |
| `i2p.i2p/apps/ministreaming/` | BSD | Streaming-Lib (das ist unsere Client-API) |

**Explizit weggelassen** (Lizenz-Risiko + nicht benötigt):

| Modul | Lizenz | Begründung |
|---|---|---|
| `i2p.i2p/apps/i2ptunnel` | GPL + Classpath-Exception | Lizenz-kritisch; nicht benötigt für In-Process-Embedded |
| `i2p.i2p/apps/sam` | Public Domain | würde SAM-Bridge exposen, die wir nicht brauchen |
| `i2p.i2p/apps/jetty` | Public Domain | WebConsole, im FGS-Kontext irrelevant |
| `i2p.i2p/apps/routerconsole` | Public Domain | dito |
| `i2p.i2p/installer` | Public Domain | Install-Tools, irrelevant |

### 7.2 Build-Pipeline

```
vendor/i2p.i2p/ (Submodul, gepinnt Tag 2.10.0)
  │
  ▼ ./gradlew :i2p-build:assemble  (vom SecuChat-Build)
  │   ruft intern ant-Targets auf
  │   Output: app/libs/i2p/{core,router,ministreaming}-*.jar
  │           app/libs/i2p/SHA256SUMS.txt
  │
  ▼ AGP erstellt :i2p-Modul mit (jbigi-AAR oder None falls Perf ok)
  │
  ▼ APK-Build
```

### 7.3 jbigi-Strategie

Erste Iteration: jbigi als optionale Optimization einbinden, mit Fallback auf Java-only-`BigInteger`. Wenn ElGamal-Tunnel-Builds > 30s statt < 5s dauern, ist jbigi Pflicht, sonst nicht.

1. **Probe**: Java-only-Build, 1.000 ElGamal-Keypairs in 10s messen.
2. **Wenn zu langsam**: eyedeekay/i2p-android's `jbigi-jni.aar` als Dependency, mit eigenem Audit-Report bevor Pin.
3. **Fallback**: pure Java, dokumentiert in Known-Issues-MD.

### 7.4 Lizenz-Dokumente

- `THIRD_PARTY_NOTICES.txt` (im App-`res/raw/`-Asset) — automatisch generiert von Gradle-Task `:app:generateNotices` aus:
  - `vendor/i2p.i2p/LICENSE.txt`
  - `vendor/i2p.i2p/*/doc/readme.license.txt` (für jedes eingebundene Modul)
- Verlinkt in der App-„Über → Open-Source-Lizenzen"-Sektion.

### 7.5 APK-Overhead-Realismus

- **Library-Code (R8-stripped)**: 18-22 MB
- **jbigi NDK-Libs (3 ABIs)**: 3-5 MB
- **GeoIP-Daten**: 1.5-4 MB (komprimiert)
- **Andere Assets**: ~1 MB

**Realistische APK-Vergrößerung: 20-30 MB.** Initiale Schätzung war 15-25, korrigiert nach Realitätscheck durch das Review.

### 7.6 Multidex + minSdkVersion

- `minSdkVersion`: **26** (Android 8.0+; native-ART mit weniger Method-Fragmentierung; Android-JCE-Restricted-Provider-Set ist ab 26 vollständiger).
- `multiDexEnabled true` (mit `minSdk >= 21` autom. unterstützt, aber wir setzen es explizit).
- `targetSdkVersion`: 34 (oder aktueller Stand zum Release).

---

## 8. Testing & Verifikation

### 8.1 Stufen-Tests

| Stufe | Test-Art | Pass-Kriterium |
|---|---|---|
| 0 | Build-Smoke | `./gradlew :I2PProcess:assembleDebug` baut, APK existiert, alle 3 ABIs present |
| 1 | Standalone-Router | `RouterProcess.main` blockiert 60s, `ls log-router-0.txt` zeigt `[RouterContext] Router started` |
| 2 | In-Memory-Connect | JUnit/Instrumentation-Test: `mgr.connect(testDest)` → `STREAM STATUS RESULT=OK` innerhalb 30s |
| 3 | Cross-Process-Roundtrip | AVD: App-Coldstart → I2P-Service bind → MiniSAM → Connect zu lokal-mock-Peer |
| 4 | E2E LAN-Chat | A50 (Phone-i2pd-SAM-off, nativen Router in App) ↔ A54 (gleiches Setup). Bidirektional. |
| 5 | E2E Passphrase-Rekey | A50 nach Reset identische Destination (PBKDF2-Wrap neu, Plaintext gleicher Key) |
| 6 | Stale-State-Resilience | Force-stop → Coldstart in 5s → Identität korrekt geladen |
| 7 | Akku-Profil | `dumpsys batterystats` nach 4h Steady-State → < 8% Akku drain |
| 8 | OEM-Auto-Start | Samsung A50 + Xiaomi Redmi → Hinweis in In-App-Setup (Vendor-Auto-Start manuell enablen) |
| 9 | Crash-Safety | `adb shell am crash com.secuchat.i2p` während connect → Recovery auf nächstem Coldstart |

### 8.2 Regressions-Tests

Alle bestehenden Tests müssen grün bleiben:
- `SAMPluginTest.java` (wird zu `I2PPluginTest.java` umbenannt, aber API-Signaturen bleiben)
- `app/src/test/services/i2p.test.ts` (Vitest) — ohne Änderungen, weil API gleich bleibt
- PGP-Engine-Tests
- ContactExchange-QR-Format-Tests

### 8.3 Verifikations-Reihenfolge (für Release-PR)

1. Build grün auf `assembleDebug`
2. Standalone-Router-Smoke auf AVD
3. Two-Device-Chat LAN A50 + A54
4. Cellular A52 (wenn App-Session-Cellular-tauglich) — bekannter Issue: OEM-Kills bei Standby
5. Force-Stop-Resilience auf A54
6. Akku-Probe 4h auf A50
7. Spec-Section 8.1 Stufen 4-9 grün

---

## 9. Risikoregister

| Risiko | Wahrscheinlichkeit | Impact | Mitigation |
|---|---|---|---|
| i2p.i2p-Modul-Konflikte mit Capacitor-Classpath | medium | build broken | Gradle-`configurations.all { exclude(...) }`, bekannte Konflikte (slf4j, junit) whitelisten |
| `:i2p`-Prozess wird vom OEM aggressive gekillt (Samsung, Xiaomi, Huawei) | high | Router startet nicht mehr | In-App-Hinweis zur manuellen Auto-Start-Aktivierung; später: Watchdog-Service der Restart triggert |
| Akku-Drain > 8%/Tag trotz Hard-Limits | medium | User-Beschwerden | Tunnel-Pool-Länge weiter runter, NetDB-Memory-Limit anpassen |
| Cryptography-Provider-Konflikt auf Android-14+ Restricted JCE | low | `NoSuchAlgorithmException` | Smoke-Test vor Boot, Fallback-Warnung in Logs |
| PBKDF2-Wrap-Passphrase vergessen → Total-Identitätsverlust | medium (real-world) | hoher UX-Schmerz | UX-Onboarding-Flow erklärt das, Restore-from-Backup-Flow prominent |
| jbigi-NDK-Build-Fehler auf CI | medium | Build broken | Java-only-Fallback als Default, jbigi ist opt-on |
| i2p.i2p-Upstream-Sicherheits-Patch verzögert | medium | Sicherheits-Drift | Patch-Watcher-CI, Quartals-Review |
| GPL-Strip-Risiko: jemand zieht versehentlich ein GPL-Modul in `implementation` rein | low | License-Verletzung | CI-Check: `:app:checkLicenses` verifiziert dass keine `apps/i2ptunnel`-Klassen im finalen APK sind |
| Play-Store lehnt `specialUse`-FGS ab wegen unzureichender Begründung | medium | Release-Delay | POLICY.md im Repo + Erläuterungs-Doc bereit für Google-Review |

---

## 10. Migrations-Phasen (PR-Plan)

Jeder PR ist ein eigener Commit-Stack, separat revertierbar. Branch: `feat/embedded-java-i2p`.

| # | PR | Inhalt | Reviewer-Schwerpunkt | Rollback |
|---|---|---|---|---|
| 1 | Stufe 0: Vendor einbinden | `vendor/i2p.i2p/` als Submodul, `scripts/verify-i2p-tag.sh`, `:i2p-build` Gradle-Modul, JARs in `app/libs/i2p/` | Build-Smoke, SHA-Sums | Submodul raus, keine App-Änderung |
| 2 | Stufe 1: Standalone-Router | Neues `:I2PProcess`-Gradle-Modul mit `RouterProcess`, `RouterService`, FGS-Mainifest-Entries | Android-Review (Manifest, FGS-Type) | Modul löschen, kein App-Impact |
| 3 | Stufe 2: In-Memory-Tests | Instrumentation-Tests, `ConfigProfile`, `IdentityStore`-Wrap-Tests, `MiniSAMBridge`-Unit-Tests | Security-Review (PBKDF2-Param) | Tests deaktivieren |
| 4 | Stufe 3: `:i2p`-Service + IPC-Bridge | `RouterBridge`, `IdentityStore` integration, `MiniSAMBridge` Core, Broadcast-Events | Architektur-Review (IPC) | Feature-Flag `use_embedded_router=false` |
| 5 | Stufe 4: `I2PPlugin` in App | `I2PPlugin.java` mit `LocalBinder`, Service-Bindung in `SecuChatApplication.onCreate` | Android-Review (Lifecycle-Race) | Flag zurücksetzen |
| 6 | Stufe 5: TS-Plugin-Wechsel | `i2p.ts` ruft `Capacitor.Plugins.I2PPlugin` statt TCP | TS-Review | Flag zurücksetzen |
| 7 | Stufe 6: Cleanup | `SAMPlugin.java` + Helper gelöscht, `sam-proxy/` deprecated, `i2p.ts` legacy code removed | Code-Review | Git revert |
| 8 | Parallel: Akku-Probe + Speicher-Probe | 24h-Test, Profil-Maps | SRE-Review | n/a |

---

## 11. Akzeptanzkriterien (Definition of Done)

- [ ] Build grün (`./gradlew :app:assembleDebug`), APK hat `20-30 MB` Größenzuwachs gemessen.
- [ ] `assembleRelease` baut eine APK mit `targetSdkVersion=34`, `minSdkVersion=26`.
- [ ] Standalone-Router-Test: `RouterProcess.bootstrap()` blockiert 60s, `RouterContext` zeigt `i2p.router.networkStatus=OK` im Log.
- [ ] E2E Test auf A50+A54: bidirektionaler App-zu-App-Chat im LAN.
- [ ] A52 (Cellular) Test: Inbound-Streams werden auch bei Cellular-NAT empfangen (Erwartung: Inbound-Tunnel-Limit 2 reduziert Erfolgsrate, dokumentieren).
- [ ] Stufe-9-Stale-State-Resilience: Force-Stop-Test grün.
- [ ] Akku-Probe nach 4h Steady-State: < 8% Drain.
- [ ] THIRD_PARTY_NOTICES.txt generiert, im App-„Über"-Screen verlinkt.
- [ ] Play-Store-FGS-POLICY.md im Repo abgelegt.
- [ ] `scripts/verify-i2p-tag.sh` läuft in CI grün.
- [ ] Bestehende TS-Tests unverändert grün.
- [ ] `SAMPlugin.java` + Helper entfernt nach Stufe 6.
- [ ] `sam-proxy/` als deprecated markiert (nicht mehr Pfad-erforderlich).

---

## 12. Out-of-Scope

Diese Spec deckt **nicht** ab:

1. **Multi-Device-Sync der Identität** — jedes Gerät hat eigene I2P-Identität (keine Sync-Schicht dafür). Falls gewünscht, separater Roadmap-Punkt.
2. **Embedded i2pd-Alternative** — das wäre eine parallele Architektur für Fälle, wo Java-I2P-Lizenz oder APK-Größe inakzeptabel ist. Aktuell nicht angedacht.
3. **Sub-Destinations pro Chat-Kontakt** — Security-Reviewer schlug Ephemeral-Identities für Forward-Secrecy vor. Wäre separates Feature nach dieser Migration. Workaround: bestehende LeaseSet-Rotation in i2p.i2p aktivieren.
4. **Tor-Bridge-Fallback** — für User mit restriktiven Firewalls. Langfristig denkbar, hier nicht.
5. **Migration von alten i2pd-`destination`-Files zu neuem Format** — wenn User eine bestehende i2pd-Identität nach SecuChat-Embedded-Java-I2P migrieren will: ist Forschungsfrage, vermutlich via `eepPriv.dat`-Format-Konversion.

---

## 13. Anhang

### 13.1 Quellen-Validierung (i2p.i2p HEAD `8e1131b`)

- `router/java/src/net/i2p/router/RouterLaunch.java` Kommentar: *"Not recommended for embedded use. Instantiate Router() yourself."* → bestätigt embedded-Pfad.
- `RouterContext` Zeile ~280: `killGlobalContext()` für sauberen Android-Restart.
- `RouterContext` Zeile ~619: `internalClientManager()` *"Use this to connect to the router in the same JVM"* → AIDL unnötig.
- `settings.gradle` listet embedding-relevante Subprojekte: `core`, `router`, `apps:ministreaming`.
- `build.gradle` root: `sourceCompatibility=17, targetCompatibility=17` → minSdk 26 mit ART 8.0+ kompatibel.
- `RouterContext.addFinalShutdownTask(Runnable)`: *"Only for external threads in the same JVM needing to know when the shutdown is complete, like Android."*

### 13.2 i2p.i2p-Modul-Lizenzen (verifiziert)

- `core/doc/readme.license.txt` → Public Domain (mit BSD/Cryptix/MIT-Komponenten)
- `apps/ministreaming/doc/readme.license.txt` → BSD
- `apps/i2ptunnel/doc/readme.license.txt` → GPL + Classpath-Exception (nicht eingebunden)
- Aktueller Master: kein separates `apps/streaming/`-Modul; in `ministreaming` konsolidiert.

### 13.3 i2pd#1255 Verlauf

- Issue-Ersteller: 2018-10-13 (`orignal` Maintainer: „I can't reproduce problem 1")
- Reporter reproduziert 2018-10-14 mit Go-Client
- `r4sas` Maintainer 2020-04-28: „t/o. Need to recheck with latest changes."
- 2021-10-01 (`Sfinx`): Bug bestätigt in Stock-C++-Implementation.
- Bis Spec-Datum 2026-08-06 kein Fix gemerged, kein PR auf den Haupt-Zweig.

### 13.4 Verwandte Spec-Dokumente im Repo

- `secuchat-sam-spec-compliant-architecture-2026-08-06.md` — vorherige Architektur (jetzt abzulösen).
- `secuchat-i2pd-socket-binds-stream-2026-08-05.md` — i2pd-Verhalten-Dokumentation.
- `secuchat-stream-connect-invalid-id-2026-08-05.md` — Symptom-Diagnose.

---

## 14. Glossar

| Begriff | Bedeutung |
|---|---|
| **i2pd** | C++-Reimplementation des I2P-Routers. SAM-Bridge hat Spec-Drift bei #1255. |
| **i2p.i2p** (Java-I2P) | Original I2P-Router, geschrieben in Java. Offizielle embedded-API für In-Process-Nutzung. |
| **SAM** | Simple Anonymous Messaging — textbasiertes Protokoll über TCP-Socket zur Steuerung des Routers. |
| **`android:process=":i2p"`** | Android-Manifest-Attribut, das angibt dass die Komponente in einem separaten OS-Prozess läuft. Eigener Heap, eigene OOM-Klasse. |
| **LocalBinder** | Android-Pattern für In-Process-Service-Bindung ohne AIDL-Marshalling. |
| **i2cp** | I2P Client Protocol — internes Protokoll zwischen Client und Router. `internalClientManager()` ist die In-Process-Variante. |
| **NetDb** | Network Database — öffentliche Routen-Info des I2P-Netzes. Nicht geheim. |
| **LeaseSet** | Publizierte Routing-Information einer Destination. Alle 5-10 Min rotiert. |
| **HSM-AEAD** | Authenticated Encryption with Associated Data. |
| **PBKDF2** | Password-Based Key Derivation Function 2 — wir verwenden 100k Iterationen mit SHA-256. |
| **FGS** | Foreground Service — Android-Service der persistent läuft und sichtbare Notification trägt. |
| **AGP** | Android Gradle Plugin. |

---

## Change-Log

- **2026-08-06 (initial)** — Spec geschrieben nach Multi-Experten-Review. Status: APPROVED (pending user review).
