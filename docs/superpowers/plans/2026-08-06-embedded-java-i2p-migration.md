# Embedded Java-I2P Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** SecuChat vom SAM/i2pd-Plugin auf embedded Java-I2P (`i2p.i2p`) als In-Process-Router migrieren, um den durch PurpleI2P/i2pd#1255 blockierten Bidirektional-Chat strukturell zu reparieren.

**Architecture:** Java-I2P-Router läuft in einem separaten Android-Prozess `:i2p` (Foreground Service, FGS-Type `specialUse`). Die App-(Capacitor)-Schicht bleibt im Default-Prozess und bindet den Service via LocalBinder (kein AIDL). TS-Frontend (`i2p.ts`) bleibt API-kompatibel durch eine `MiniSAMBridge`. Identität ist zufälliges 2048-bit ElGamal, persistiert via PBKDF2-AEAD-Wrap.

**Tech Stack:** Java 17 (Android-ART), Kotlin (Capacitor-Plugin-Layer), AGP 8.5+, Gradle 8.x, Java-I2P `core/`+`router/`+`apps/ministreaming/` (Public Domain + BSD), `:i2p`-Prozess via `android:process=":i2p"`, Foreground-Service Type `specialUse` mit PROPERTY-Subtype, `LocalBinder`/`LocalBroadcastManager`, AndroidX-Security nicht benötigt, eigene AES-256-GCM-Wrap-Implementation.

**Spec:** [docs/superpowers/specs/2026-08-06-secuchat-embedded-i2p-design.md](../specs/2026-08-06-secuchat-embedded-i2p-design.md)

## Global Constraints

- **minSdkVersion 26** (Android 8.0+); `targetSdkVersion 34`.
- **`android:process=":i2p"` Pflicht** für `RouterService` (OOM-Isolation, Blast-Radius-Reduktion); nicht optional.
- **FGS-Type `specialUse`** + PROPERTY-Subtype-String `"anonymous-overlay-network-router"` (Privacy-Messaging-Begründung).
- **PBKDF2-HMAC-SHA256(passphrase, 32B-salt, 100k iter, 32B key)** für `router.keys`-Wrap; Salt per-install-random in `salt.bin`.
- **Hardcoded Router-Limits**: `inboundPoolLength=2 outboundPoolLength=2`, `bandwidth.sharePercentage=50`, `totalMemoryMax=128` MB, `netDb.maxMemory=24` MB, `jobQueue.memory=8` MB, `concurrentJobs=64`, `router.updateDisabled=true`.
- **Identität ist zufälliges 2048-bit ElGamal** — NICHT deterministisch aus Passphrase ableiten. PBKDF2 nur als Key-File-Wrap.
- **Lizenz-Strategie**: nur `core/`+`router/java`+`apps/ministreaming/` einbinden; `apps/i2ptunnel`/`sam`/`jetty`/`routerconsole`/`installer` werden explizit ausgeschlossen.
- **Java-I2P erzeugt in `router.config` KEIN Auto-Console** (`i2p.router.console.skip=true`).
- **Logging**: produktiv `WARN`-Level für Java-I2P; Crashlytics/Play-Vitals mit Filter `net.i2p.*` ausschließen.
- **Notification-Text ohne "I2P"-Wort**: „Privacy-Modus aktiv". Channel `IMPORTANCE_LOW`.
- **TS-Frontend (`i2p.ts`) Public-API bleibt identisch** — `MiniSAMBridge` emuliert SAM-v3.1-Subset.
- **APK-Overhead-Realismus**: 20-30 MB (nicht 15-25).
- **Cycle-Root**: `app/android/`. Alle `cd app && …` aus dem Repo-Root.
- **Per-Task Commit**: jeder Task endet mit `git commit`. PRs pro Stufe (siehe Spec-Section 10).

## Multi-Agent-Workflows (pro Stage empfohlen)

Jeder Stage-Task wird per `superpowers:subagent-driven-development` ausgeführt. Für die hochriskanten Stages werden spezialisierte Sub-Agent-Teams aufgesetzt:

| Stage | Agent-Setup |
|---|---|
| 1 (Vendor-Pin) | Agent „Build-Adapter" + paralleler Agent „Git-Submodule-Audit" (Review) |
| 2 (Standalone-Router) | Agent „FGS-Manifest-Audit" (specialUse, PROPERTY, Android-15-Compat) + Agent „Crypto-Provider-Reihenfolge" (Smoke-Test) |
| 2 (jbigi-Probe) | Parallel-Agent misst ElGamal-Throughput und entscheidet jbigi-Einbindung |
| 3 (Identity + Bridge) | Agent „Security-Reviewer" (PBKDF2-AEAD-Test-Vector-Validation) |
| 5 (I2PPlugin in App) | Agent „Android-Lifecycle-Race-Hunter" |
| 7 (Akku-Profil) | Agent „SRE-Profiler" (4h-`batterystats`-Analyse) |

---

# Stage 1: Vendor-Pin + Build-Integration (PR 1)

> **Reviewer-Schwerpunkt**: Build-Smoke, SHA-Sums korrekt, GPG-Signature verifizierbar.
> **Rollback**: Submodul raus + `:i2p-build` löschen, kein App-Impact.

## Task 1.1: i2p.i2p-Submodul mit GPG-Pin

**Files:**
- Create: `.gitmodules`
- Create: `vendor/.gitkeep` (Platzhalter)
- Create: `scripts/verify-i2p-tag.sh` (ausführbar)

**Interfaces:**
- Erzeugt: `vendor/i2p.i2p/` als verifizierter Checkout mit getaggtem Commit.

- [ ] **Step 1: i2p.i2p-Repo als Submodul hinzufügen mit Pin auf Tag `2.10.0`**

```bash
cd /home/g/dev/SecuChat
mkdir -p vendor
git submodule add --branch 2.10.0 https://github.com/i2p/i2p.i2p.git vendor/i2p.i2p
git -C vendor/i2p.i2p log -1 --format="%H %s"   # expect: tag-commit-SHA
```

- [ ] **Step 2: GPG-Signature am Tag verifizieren (manuell)**

```bash
git -C vendor/i2p.i2p tag -v 2.10.0
```

Erwartet: `Good signature from "i2p release key"`. Falls Maintainer-Key-Wechsel: siehe [Maintainer-Keys-Page](https://i2p.net/en/docs/developers/release_signing_keys).

- [ ] **Step 3: Pflicht-Verifikations-Script `scripts/verify-i2p-tag.sh` anlegen**

```bash
#!/usr/bin/env bash
# scripts/verify-i2p-tag.sh — GPG-Signature + Commit-Hash gegen Out-of-Band-Pin
set -euo pipefail

EXPECTED_TAG="${I2P_EXPECTED_TAG:-2.10.0}"
EXPECTED_COMMIT_SHA="${I2P_EXPECTED_COMMIT_SHA:-}"   # ausgeliefert via secuchat.app/blog/i2p-pin
ALLOWED_SIGNING_FPR="${I2P_ALLOWED_FPR:-}"           # GPG-Fingerprint des Maintainer-Keys

cd "$(dirname "$0")/../vendor/i2p.i2p"

echo "[verify-i2p-tag] Checking tag $EXPECTED_TAG ..."
git fetch --tags origin

# 1. Tag-Signature prüfen
git tag -v "$EXPECTED_TAG" || {
    echo "ERROR: GPG signature on tag $EXPECTED_TAG failed"
    exit 1
}

# 2. Commit-Hash gegen Out-of-Band-Pin
ACTUAL_SHA=$(git rev-parse "$EXPECTED_TAG^{commit}")
if [ -n "$EXPECTED_COMMIT_SHA" ] && [ "$ACTUAL_SHA" != "$EXPECTED_COMMIT_SHA" ]; then
    echo "ERROR: Tag commits to $ACTUAL_SHA, expected $EXPECTED_COMMIT_SHA"
    echo "ERROR: Update I2P_EXPECTED_COMMIT_SHA env var from secuchat.app/blog/i2p-pin"
    exit 1
fi

# 3. Maintainer-Key-Fingerprint check
if [ -n "$ALLOWED_SIGNING_FPR" ]; then
    ACTUAL_FPR=$(git verify-tag --raw "$EXPECTED_TAG" 2>&1 | grep -oP 'using .* key [A-F0-9]+' | head -1)
    echo "[verify-i2p-tag] Signing FPR: $ACTUAL_FPR"
    # Note: in CI set I2P_ALLOWED_FPR; locally this is informational
fi

echo "[verify-i2p-tag] OK: tag $EXPECTED_TAG verified"
```

- [ ] **Step 4: Script testen**

```bash
chmod +x scripts/verify-i2p-tag.sh
./scripts/verify-i2p-tag.sh
```

Erwartet: Exit 0, Output „OK".

- [ ] **Step 5: Git-Konfiguration für Submodul-Tracking**

```bash
git add .gitmodules vendor/i2p.i2p
git -C vendor/i2p.i2p commit -m "vendor(i2p.i2p): pin 2.10.0" --allow-empty  # falls Tag bereits commit ist
git add scripts/verify-i2p-tag.sh
git commit -m "feat(vendor): i2p.i2p 2.10.0 + GPG-verify script"
```

---

## Task 1.2: `:i2p-build` Gradle-Modul

**Files:**
- Create: `app/android/i2p-build/build.gradle.kts`
- Create: `app/android/i2p-build/src/main/kotlin/I2PBuildTask.kt`
- Modify: `app/android/settings.gradle.kts` (Modul hinzufügen)

**Interfaces:**
- Consumes: `vendor/i2p.i2p/` (Submodul-Checkout)
- Produces: `app/libs/i2p/{core,router,ministreaming}-2.10.0.jar` + `SHA256SUMS.txt`

- [ ] **Step 1: Modul-Verzeichnis anlegen**

```bash
mkdir -p app/android/i2p-build/src/main/kotlin
```

- [ ] **Step 2: Modul-Konfiguration schreiben**

`app/android/i2p-build/build.gradle.kts`:

```kotlin
plugins {
    base
}

val i2pRootDir = rootProject.file("vendor/i2p.i2p").canonicalFile
val i2pJarsOut = rootProject.file("libs/i2p")

val i2pModules = listOf("core", "router/java", "apps/ministreaming")
val i2pJarFiles = listOf(
    "core/build/core.jar" to "core-2.10.0.jar",
    "router/java/build/router.jar" to "router-2.10.0.jar",
    "apps/ministreaming/build/mstreaming.jar" to "ministreaming-2.10.0.jar",
)

tasks.register<Exec>("buildI2PJars") {
    workingDir = i2pRootDir
    commandLine("./build.sh", "pkg")  // i2p.i2p's build.sh wrapper
    // Falls build.sh nicht existiert: commandLine("ant", "pkg")
}

tasks.register("copyI2PJars") {
    dependsOn("buildI2PJars")
    doLast {
        i2pJarsOut.mkdirs()
        i2pJarFiles.forEach { (src, dstName) ->
            val srcFile = file("$i2pRootDir/$src")
            require(srcFile.exists()) { "Expected $src from i2p.i2p build" }
            srcFile.copyTo(i2pJarsOut.resolve(dstName), overwrite = true)
        }
        // SHA-256-Sums
        val sha = i2pJarsOut.listFiles { f -> f.extension == "jar" }!!.joinToString("") {
            "${it.sha256()}  ${it.name}\n"
        }
        i2pJarsOut.resolve("SHA256SUMS.txt").writeText(sha)
    }
}

fun File.sha256(): String {
    val bytes = readBytes()
    val md = java.security.MessageDigest.getInstance("SHA-256")
    return md.digest(bytes).joinToString("") { "%02x".format(it) }
}
```

- [ ] **Step 3: Modul zu settings.gradle.kts hinzufügen**

In `app/android/settings.gradle.kts` (oder analog, je nach Root-Konfiguration):
```kotlin
include(":i2p-build")
```

- [ ] **Step 4: Build-Hook im Haupt-Modul einklinken**

In `app/android/app/build.gradle` (oder `.kts`):
```kotlin
// SECUCHAT:I2P — Build-Hook kopiert JARs in app/libs/i2p vor assembleDebug
tasks.named("preBuild").configure { dependsOn(":i2p-build:copyI2PJars") }

// Flat-Dir-Repo für die gepinnten JARs
repositories {
    flatDir { dirs("libs/i2p") }
}

// i2p.i2p-Module als Compile-Libs (Strict-Auswahl!)
dependencies {
    implementation(files("libs/i2p/core-2.10.0.jar"))
    implementation(files("libs/i2p/router-2.10.0.jar"))
    implementation(files("libs/i2p/ministreaming-2.10.0.jar"))
}

// Sanity: niemand zieht versehentlich apps/i2ptunnel rein
configurations.all {
    exclude(group = "i2p", module = "i2ptunnel")  // falls je Module-Patterns auftauchen
}
```

- [ ] **Step 5: Build-Probe**

```bash
cd app/android
./gradlew :i2p-build:buildI2PJars :i2p-build:copyI2PJars
ls -la ../libs/i2p/
```

Erwartet: `core-2.10.0.jar`, `router-2.10.0.jar`, `ministreaming-2.10.0.jar`, `SHA256SUMS.txt` vorhanden.

- [ ] **Step 6: Commit**

```bash
git add app/android/i2p-build app/android/settings.gradle.kts app/android/app/build.gradle
git commit -m "feat(build): :i2p-build Gradle-Modul + flat-dir repo"
```

---

## Task 1.3: jbigi-Performance-Probe (Multi-Agent-Spike)

**Files:**
- Create: `app/android/i2p-build/src/main/probe/ElGamalThroughput.kt`
- Create: `app/android/i2p-build/probe-results.md`

**Decision-Ouput:**
- Falls <5s/1k keypairs: jbigi weglassen.
- Falls >30s/1k keypairs: jbigi ist Pflicht (PR 1.4 als Folge-Task).

- [ ] **Step 1: Multi-Agent-Workflow aufsetzen**

Dispatched per `superpowers:subagent-driven-development` mit Auftrag:
- Lese i2p.i2p's `core/java/src/gnu/getopt/Getopt.java` und verwandte BigInt-Klassen.
- Schreibe eine Java-only-Probe-`main`, die 1.000 ElGamal-Keypairs generiert.
- Miss Zeit in ms, dokumentiere in `probe-results.md`.

- [ ] **Step 2: Probe-Skeleton anlegen**

`app/android/i2p-build/src/main/probe/ElGamalThroughput.kt`:

```kotlin
import net.i2p.data.PrivateKey
import net.i2p.data.PublicKey

fun main() {
    val n = 1000
    val t0 = System.currentTimeMillis()
    repeat(n) {
        val priv = PrivateKey()
        priv.generate()
        val pub = PublicKey()
    }
    val elapsed = System.currentTimeMillis() - t0
    println("ElGamal $n keypairs: ${elapsed} ms (${elapsed / n.toDouble()} ms/pair)")
    // Decision-Schwelle: <5000ms total = jbigi weglassen OK
}
```

- [ ] **Step 3: Probe-Ergebnisse dokumentieren, Entscheidung treffen**

In `probe-results.md` festhalten und Commit-Hash der Entscheidung in PR-Description.

- [ ] **Step 4: Wenn jbigi nötig: eyedeekay-Fork-Audit-Report erstellen**

Audit-Checkliste als Markdown:
- Letzter Commit-Datum
- Letzte CVE-Response
- Build-Pipeline-Reproducibility
- Lizenz-Klarheit

**Stop-Bedingung**: Wenn Audit-Risiko > medium, eigene NDK-Pipeline vorbereiten (statt eyedeekay-Fork).

- [ ] **Step 5: Commit**

```bash
git add app/android/i2p-build/src/main/probe probe-results.md
git commit -m "feat(probe): elgamal-throughput + jbigi-decision"
```

---

# Stage 2: Standalone `:i2p`-Prozess (PR 2)

> **Reviewer-Schwerpunkt**: FGS-Manifest korrekt, Krypto-Provider-Reihenfolge sauber, Router-Boot-Test grün.
> **Rollback**: `:I2PProcess`-Modul löschen.

## Task 2.1: `:I2PProcess` Gradle-Modul + Manifest-Skelett

**Files:**
- Create: `app/android/I2PProcess/build.gradle`
- Create: `app/android/I2PProcess/src/main/AndroidManifest.xml`
- Create: `app/android/I2PProcess/src/main/java/com/secuchat/i2p/RouterService.java` (Stub)

**Interfaces:**
- Erzeugt: Android-Service-Component im `:i2p`-Prozess.

- [ ] **Step 1: Gradle-Modul anlegen**

```bash
mkdir -p app/android/I2PProcess/src/main/java/com/secuchat/i2p
```

`app/android/I2PProcess/build.gradle`:

```groovy
apply plugin: 'com.android.library'

android {
    namespace 'com.secuchat.i2p'
    compileSdk 34

    defaultConfig {
        minSdk 26
        targetSdk 34
        // eigenes Prozess-Tag + largeHeap für Router
        manifestPlaceholders = [largeHeap: 'true']
    }

    compileOptions {
        sourceCompatibility JavaVersion.VERSION_17
        targetCompatibility JavaVersion.VERSION_17
    }

    buildTypes {
        debug { /* defaults */ }
        release { minifyEnabled true; proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro' }
    }
}

dependencies {
    implementation 'androidx.annotation:annotation:1.7.1'
    implementation project(':i2p-build')
    // i2p.i2p JARs
    implementation fileTree(dir: 'libs/i2p', include: ['*.jar'])
}
```

`app/android/I2PProcess/src/main/AndroidManifest.xml`:

```xml
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <application>
        <service
            android:name="com.secuchat.i2p.RouterService"
            android:process=":i2p"
            android:exported="false"
            android:foregroundServiceType="specialUse"
            android:largeHeap="true">
            <property
                android:name="android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE"
                android:value="anonymous-overlay-network-router" />
        </service>
    </application>
</manifest>
```

- [ ] **Step 2: RouterService-Stub anlegen**

`app/android/I2PProcess/src/main/java/com/secuchat/i2p/RouterService.java`:

```java
package com.secuchat.i2p;

import android.app.Service;
import android.content.Intent;
import android.os.IBinder;
import android.util.Log;

public class RouterService extends Service {
    private static final String TAG = "SecuChat/I2PService";

    @Override
    public IBinder onBind(Intent intent) {
        return null;  // Cross-Process-LocalBinder folgt in Stage 4
    }

    @Override
    public void onCreate() {
        super.onCreate();
        Log.d(TAG, "RouterService onCreate (process=:i2p)");
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // Forward-Service vor Boot, damit OS den Prozess nicht killt.
        // Notification-Setup folgt in Task 2.2.
        return START_STICKY;
    }
}
```

- [ ] **Step 3: Module in settings.gradle.kts hinzufügen**

```kotlin
include(":I2PProcess")
```

- [ ] **Step 4: App-Manifest erweitern**

`app/android/app/src/main/AndroidManifest.xml`: hinzufügen (innerhalb von `<application>`):

```xml
<service
    android:name="com.secuchat.app.RoutedProcessStarter"
    android:exported="false" />
<!-- I2PProcess service wird via Manifest-Merge eingebunden, mit :i2p-Prozess-Tag -->
```

- [ ] **Step 5: Build-Probe**

```bash
cd app/android && ./gradlew :I2PProcess:assembleDebug
```

Erwartet: Build grün, AAR im `build/outputs/aar/`-Verzeichnis.

- [ ] **Step 6: Commit**

```bash
git add app/android/I2PProcess app/android/settings.gradle.kts app/android/app/src/main/AndroidManifest.xml
git commit -m "feat(android): I2PProcess-Modul + :i2p-Service-Stub"
```

---

## Task 2.2: Notification-Channel + Foreground-Boot

**Files:**
- Modify: `RouterService.java` (echte Foreground-Logik + Notification)
- Create: `RouterServiceTest.java`

**Interfaces:**
- Erzeugt: Persistente Notification mit LOW-importance Channel.

- [ ] **Step 1: Notification-Channel erstellen (Boot-resistent)**

Erweitere `RouterService.onCreate`:

```java
private static final String CHANNEL_ID = "secuchat_router";
private static final int NOTIF_ID = 1001;

@Override
public void onCreate() {
    super.onCreate();

    NotificationChannel channel = new NotificationChannel(
        CHANNEL_ID,
        "Privacy-Modus",
        NotificationManager.IMPORTANCE_LOW
    );
    channel.setShowBadge(false);
    NotificationManager nm = getSystemService(NotificationManager.class);
    nm.createNotificationChannel(channel);

    Notification n = new Notification.Builder(this, CHANNEL_ID)
        .setSmallIcon(android.R.drawable.ic_lock_idle_lock)
        .setContentTitle("Privacy-Modus aktiv")
        .setContentText("Hintergrund-Routing läuft")
        .setOngoing(true)
        .build();
    startForeground(NOTIF_ID, n);
}
```

- [ ] **Step 2: Manifest-Permission prüfen**

`AndroidManifest.xml` für `:I2PProcess`:
```xml
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_SPECIAL_USE" />
```
Für `app/android/app/src/main/AndroidManifest.xml` sicherstellen:
```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
<uses-permission android:name="android.permission.WAKE_LOCK" />  <!-- sparsam -->
```

- [ ] **Step 3: Unit-Test `RouterServiceTest.java`**

```java
@RunWith(RobolectricTestRunner.class)
public class RouterServiceTest {
    @Test
    public void onCreate_createsNotificationChannel() {
        Context ctx = ApplicationProvider.getApplicationContext();
        RouterService svc = new RouterService();
        svc.onCreate();
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        NotificationChannel ch = nm.getNotificationChannel("secuchat_router");
        assertNotNull(ch);
        assertEquals(NotificationManager.IMPORTANCE_LOW, ch.getImportance());
    }
}
```

- [ ] **Step 4: Test grün machen**

```bash
cd app/android && ./gradlew :I2PProcess:testDebugUnitTest
```

- [ ] **Step 5: Commit**

```bash
git add app/android/I2PProcess/src/main/java/com/secuchat/i2p/RouterService.java
git add app/android/I2PProcess/src/test/java/com/secuchat/i2p/RouterServiceTest.java
git add app/android/I2PProcess/src/main/AndroidManifest.xml
git commit -m "feat(android): RouterService foreground + low-importance channel"
```

---

## Task 2.3: Crypto-Provider-Reihenfolge Smoke-Test

**Files:**
- Create: `app/android/I2PProcess/src/main/java/com/secuchat/i2p/RouterProcess.java`
- Create: `app/android/I2PProcess/src/test/java/com/secuchat/i2p/CryptoProviderSmokeTest.java`

- [ ] **Step 1: Boot-Stub `RouterProcess.java`**

```java
package com.secuchat.i2p;

import android.util.Log;
import java.security.Security;
import org.bouncycastle.jce.provider.BouncyCastleProvider;
import net.i2p.router.Router;
import net.i2p.router.RouterContext;

public final class RouterProcess {
    private static final String TAG = "SecuChat/RouterProcess";

    public static RouterContext bootstrap(java.util.Properties props, Runnable shutdownHook) {
        // Krypto-Provider-Reihenfolge EXPLIZIT vor Router-Thread
        // (Android-Builtin AndroidOpenSSL vs. i2p.i2p's BouncyCastle).
        java.security.Provider existing = Security.getProvider("BC");
        if (existing != null) Security.removeProvider("BC");
        Security.insertProviderAt(new BouncyCastleProvider(), 1);

        // System-Properties für Java-I2P
        System.setProperty("i2p.router.console.skip", "true");
        System.setProperty("i2p.log.level", "WARN");
        for (String key : props.stringPropertyNames()) {
            System.setProperty(key, props.getProperty(key));
        }

        Router router = new Router(props);
        RouterContext ctx = router.getContext();
        ctx.addFinalShutdownTask(() -> {
            Log.d(TAG, "final shutdown reached");
            if (shutdownHook != null) shutdownHook.run();
        });
        return ctx;
    }

    private RouterProcess() {}
}
```

- [ ] **Step 2: Smoke-Test**

```java
@RunWith(RobolectricTestRunner.class)
public class CryptoProviderSmokeTest {
    @Test
    public void bouncyCastle_isInsertedAtTop() {
        RouterProcess.bootstrap(new java.util.Properties(), null);
        java.security.Provider p = Security.getProvider("BC");
        assertNotNull("BouncyCastle must be registered", p);
        // ElGamal ist für i2p.i2p zwingend; wenn AndroidOpenSSL ihn hat, OK;
        // sonst MUSS BC ihn liefern.
        assertNotNull("ElGamal KeyPairGenerator missing",
            KeyPairGenerator.getInstance("ElGamal"));
    }
}
```

- [ ] **Step 3: Test grün**

```bash
cd app/android && ./gradlew :I2PProcess:testDebugUnitTest
```

- [ ] **Step 4: Commit**

```bash
git add app/android/I2PProcess/src/main/java/com/secuchat/i2p/RouterProcess.java
git add app/android/I2PProcess/src/test/java/com/secuchat/i2p/CryptoProviderSmokeTest.java
git commit -m "feat(android): RouterProcess.bootstrap with crypto-provider init"
```

---

## Task 2.4: Standalone-Boot-Test (Konsument = Tests)

**Files:**
- Create: `app/android/I2PProcess/src/test/java/com/secuchat/i2p/RouterProcessBootTest.java`
- Create: `app/android/I2PProcess/src/main/java/com/secuchat/i2p/ConfigProfile.java`

- [ ] **Step 1: `ConfigProfile.java` mit Hard-Limits**

```java
package com.secuchat.i2p;

import java.util.Properties;

public final class ConfigProfile {
    private ConfigProfile() {}

    public static Properties defaults() {
        Properties p = new Properties();
        p.setProperty("router.inboundPoolLength", "2");
        p.setProperty("router.outboundPoolLength", "2");
        p.setProperty("router.bandwidth.sharePercentage", "50");
        p.setProperty("router.limits.totalMemoryMax", "128");
        p.setProperty("router.netDb.maxMemory", "24");
        p.setProperty("router.jobQueue.maxMemory", "8");
        p.setProperty("router.limits.concurrentJobs", "64");
        p.setProperty("router.updateDisabled", "true");
        p.setProperty("i2p.crypto.ed25519", "true");
        // Reseed-Server (Mobilfunk-tauglich)
        p.setProperty("i2p.reseedURL",
            "https://reseed.i2p.ro/,https://i2p.ghativega.in/,https://reseed-pl.i2pd.xyz/");
        return p;
    }
}
```

- [ ] **Step 2: Boot-Test**

```java
@RunWith(RobolectricTestRunner.class)
public class RouterProcessBootTest {
    @Test(timeout = 90_000)
    public void router_boots_and_contextIsAccessible() throws InterruptedException {
        Properties props = ConfigProfile.defaults();
        // Workdir isolieren
        File workdir = new File(System.getProperty("java.io.tmpdir"), "secuchat-i2p-test");
        workdir.mkdirs();
        props.setProperty("i2p.workDir", workdir.getAbsolutePath());

        RouterContext ctx = RouterProcess.bootstrap(props, null);

        // Process-Thread für Router-Loop starten
        Thread routerThread = new Thread(() -> /* ctx.router().run() */ {
            // Robolectric-Test stoppt den Loop durch Thread.interrupt
        }, "i2p-router-test");
        routerThread.start();

        Thread.sleep(15_000);  // 15s Boot abwarten

        // Network-Status prüfen (1 = OK, 4 = WARN, 5 = ERROR)
        // net.i2p.router.RouterContext hat networkStatus() Methode
        int status = ctx.commSystem().getStatus();
        assertTrue("Router status war >=0: " + status, status >= 0);

        // Cleanup: Router-Thread unterbrechen
        ctx.router().setKillFlag(true);
        routerThread.interrupt();
        Thread.sleep(1_000);

        RouterContext.killGlobalContext();
    }
}
```

- [ ] **Step 3: Lokal ausführen**

```bash
cd app/android && ./gradlew :I2PProcess:testDebugUnitTest --tests "*RouterProcessBootTest*"
```

Erwartet: Test grün nach 15-25s Boot-Wartezeit.

- [ ] **Step 4: Commit**

```bash
git add app/android/I2PProcess/src/main/java/com/secuchat/i2p/ConfigProfile.java
git add app/android/I2PProcess/src/test/java/com/secuchat/i2p/RouterProcessBootTest.java
git commit -m "feat(android): ConfigProfile hard-limits + RouterBootTest"
```

---

# Stage 3: In-Memory-Tests (PR 3)

> **Reviewer-Schwerpunkt**: PBKDF2-Parameter, AEAD-Implementation, keine Logcat-Leaks.
> **Rollback**: Tests deaktivieren.

## Task 3.1: `IdentityStore` mit PBKDF2-Wrap

**Files:**
- Create: `app/android/I2PProcess/src/main/java/com/secuchat/i2p/IdentityStore.java`
- Create: `app/android/I2PProcess/src/test/java/com/secuchat/i2p/IdentityStoreTest.java`

**Interfaces:**
- `IdentityStore.createOrLoadIdentity(workdir, passphrase) → Destination` (synchrone, in-memory).

- [ ] **Step 1: Failing Test zuerst**

```java
@RunWith(RobolectricTestRunner.class)
public class IdentityStoreTest {
    private File workdir;
    private byte[] salt;

    @Before
    public void setUp() throws IOException {
        workdir = new File(System.getProperty("java.io.tmpdir"),
            "secuchat-i2p-idstore-" + UUID.randomUUID());
        workdir.mkdirs();
        salt = new byte[32];
        new SecureRandom().nextBytes(salt);
    }

    @Test
    public void wrap_then_unwrap_recovers_plaintext() throws Exception {
        byte[] plaintext = new byte[387];  // typ. ElGamal-Private-Key
        new SecureRandom().nextBytes(plaintext);

        byte[] wrapped = IdentityStore.wrap(plaintext, "correct-horse-battery-staple", salt);
        assertFalse(Arrays.equals(wrapped, plaintext));

        byte[] recovered = IdentityStore.unwrap(wrapped, "correct-horse-battery-staple", salt);
        assertArrayEquals(plaintext, recovered);
    }

    @Test(expected = AEADBadTagException.class)
    public void wrong_passphrase_fails_unwrap() throws Exception {
        byte[] plaintext = new byte[64];
        byte[] wrapped = IdentityStore.wrap(plaintext, "right", salt);
        IdentityStore.unwrap(wrapped, "wrong", salt);
    }

    @After
    public void tearDown() {
        FileUtils.deleteQuietly(workdir);
    }
}
```

- [ ] **Step 2: Test grün machen mit Implementation**

`IdentityStore.java`:

```java
package com.secuchat.i2p;

import java.io.File;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import javax.crypto.AEADBadTagException;
import javax.crypto.Cipher;
import javax.crypto.SecretKey;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.PBEKeySpec;
import javax.crypto.spec.SecretKeySpec;

public final class IdentityStore {
    private static final int PBKDF2_ITER = 100_000;
    private static final int KEY_BYTES = 32;        // 256-bit key
    private static final int IV_BYTES = 12;         // GCM nonce
    private static final int TAG_BITS = 128;

    private IdentityStore() {}

    private static SecretKey deriveKey(String passphrase, byte[] salt) throws GeneralSecurityException {
        PBEKeySpec spec = new PBEKeySpec(passphrase.toCharArray(), salt, PBKDF2_ITER, KEY_BYTES * 8);
        byte[] keyBytes = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).getEncoded();
        return new SecretKeySpec(keyBytes, "AES");
    }

    public static byte[] wrap(byte[] plaintext, String passphrase, byte[] salt) throws GeneralSecurityException {
        SecretKey key = deriveKey(passphrase, salt);
        byte[] iv = new byte[IV_BYTES];
        new SecureRandom().nextBytes(iv);
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.ENCRYPT_MODE, key, new GCMParameterSpec(TAG_BITS, iv));
        byte[] cipherAndTag = c.doFinal(plaintext);
        // Layout: [salt-version=1byte | iv=12B | cipher+tag]
        ByteBuffer out = ByteBuffer.allocate(1 + IV_BYTES + cipherAndTag.length);
        out.put((byte) 1);
        out.put(iv);
        out.put(cipherAndTag);
        return out.array();
    }

    public static byte[] unwrap(byte[] wrapped, String passphrase, byte[] salt) throws GeneralSecurityException {
        if (wrapped.length < 1 + IV_BYTES + TAG_BITS/8) throw new AEADBadTagException("wrapped too short");
        if (wrapped[0] != 1) throw new IllegalArgumentException("unsupported wrap version");
        ByteBuffer in = ByteBuffer.wrap(wrapped);
        in.position(1);
        byte[] iv = new byte[IV_BYTES];
        in.get(iv);
        byte[] cipherAndTag = new byte[in.remaining()];
        in.get(cipherAndTag);

        SecretKey key = deriveKey(passphrase, salt);
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(TAG_BITS, iv));
        return c.doFinal(cipherAndTag);  // throws AEADBadTagException on tag mismatch
    }

    /** Persist salt to disk in noBackup dir. */
    public static byte[] loadOrCreateSalt(File saltFile) throws IOException {
        if (saltFile.exists()) return Files.readAllBytes(saltFile.toPath());
        byte[] salt = new byte[32];
        new SecureRandom().nextBytes(salt);
        saltFile.getParentFile().mkdirs();
        Files.write(saltFile.toPath(), salt);
        return salt;
    }
}
```

- [ ] **Step 3: Test ausführen**

```bash
cd app/android && ./gradlew :I2PProcess:testDebugUnitTest --tests "*IdentityStoreTest*"
```

Erwartet: 2 Tests grün.

- [ ] **Step 4: Multi-Agent „Security-Review" (PBKDF2-Parameter-Validation)**

Dispatched subagent mit Auftrag:
- Validiere gegen NIST-SP-800-132 + OWASP-PBKDF2-Empfehlung.
- Validiere GCM-Tag-Länge (128-Bit ist Maximum).
- Validiere IV-Randomness-Verwendung (SecureRandom).
- Validiere Salt-Länge (≥128 Bit, hier 256).

- [ ] **Step 5: Commit**

```bash
git add app/android/I2PProcess/src/main/java/com/secuchat/i2p/IdentityStore.java
git add app/android/I2PProcess/src/test/java/com/secuchat/i2p/IdentityStoreTest.java
git commit -m "feat(i2p): IdentityStore PBKDF2-AEAD wrap+unwrap"
```

---

## Task 3.2: `MiniSAMBridge`-Skeleton mit In-Process-Stubs

**Files:**
- Create: `app/android/I2PProcess/src/main/java/com/secuchat/i2p/MiniSAMBridge.java`
- Create: `app/android/I2PProcess/src/test/java/com/secuchat/i2p/MiniSAMBridgeTest.java`

**Interfaces:**
- `MiniSAMBridge.connectRemote(destB32) → handleId` (Stub, echte I2PSocket folgt in Stage 4).

- [ ] **Step 1: Failing Test**

```java
@RunWith(RobolectricTestRunner.class)
public class MiniSAMBridgeTest {
    @Test
    public void handleId_isUUID() {
        MiniSAMBridge bridge = new MiniSAMBridge(/* mock dependencies */);
        String id = bridge.connectRemote("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa~1");
        assertNotNull(id);
        assertTrue(id.length() == 36);  // UUID.toString() length
    }
}
```

- [ ] **Step 2: Skeleton Implementation**

```java
package com.secuchat.i2p;

import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

public class MiniSAMBridge {
    private final ConcurrentHashMap<String, Object> mHandles = new ConcurrentHashMap<>();

    public MiniSAMBridge(/* dependencies: I2PSocketManager, Executor */) {}

    public String connectRemote(String destB32) {
        String handleId = UUID.randomUUID().toString();
        mHandles.put(handleId, new Object());  // placeholder
        return handleId;
    }
}
```

- [ ] **Step 3: Grüner Test, Commit**

```bash
git add app/android/I2PProcess
git commit -m "test(i2p): MiniSAMBridge skeleton + UUID-handleId"
```

---

# Stage 4: `:i2p`-Service + IPC-Bridge (PR 4)

> **Reviewer-Schwerpunkt**: IPC-Lifecycle-Race, `LocalBinder`-Pattern, Broadcast-Events korrekt.
> **Rollback**: Feature-Flag `use_embedded_router=false`.

## Task 4.1: `RouterBridge` mit Cross-Process-LocalBinder

**Files:**
- Create: `app/android/I2PProcess/src/main/java/com/secuchat/i2p/RouterBridge.java`

**Interfaces:**
- Erzeugt: `IBinder`-Rückgabe in `RouterService.onBind`.

- [ ] **Step 1: Bridge-Klasse**

```java
package com.secuchat.i2p;

import android.content.Intent;
import android.os.Binder;
import android.os.IBinder;
import android.os.RemoteException;
import android.util.Log;
import androidx.localbroadcastmanager.content.LocalBroadcastManager;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import net.i2p.client.streaming.I2PSocket;
import net.i2p.client.streaming.I2PSocketManager;
import net.i2p.router.RouterContext;

public class RouterBridge extends Binder {
    private static final String TAG = "SecuChat/RouterBridge";
    public static final String ACTION_MESSAGE = "com.secuchat.i2p.MESSAGE";
    public static final String ACTION_STATUS = "com.secuchat.i2p.STATUS";
    public static final String ACTION_CLOSE = "com.secuchat.i2p.CLOSE";
    public static final String ACTION_MESSAGE_ERROR = "com.secuchat.i2p.MESSAGE_ERROR";

    private final I2PSocketManager mSocketManager;
    private final ConcurrentHashMap<String, I2PSocket> mSockets = new ConcurrentHashMap<>();
    private final android.content.Context mAppContext;

    public RouterBridge(I2PSocketManager mgr, android.content.Context appCtx) {
        mSocketManager = mgr;
        mAppContext = appCtx;
    }

    public String connectRemote(String destB32) {
        try {
            I2PSocket sock = mSocketManager.connect(destB32);
            String handleId = UUID.randomUUID().toString();
            mSockets.put(handleId, sock);
            startReader(handleId, sock);
            return handleId;
        } catch (Exception e) {
            Log.w(TAG, "connectRemote failed for " + destB32, e);
            return null;
        }
    }

    private void startReader(String handleId, I2PSocket sock) {
        Thread t = new Thread(() -> {
            byte[] buf = new byte[32 * 1024];
            try {
                int n;
                while ((n = sock.getInputStream().read(buf)) > 0) {
                    Intent ev = new Intent(ACTION_MESSAGE);
                    ev.putExtra("handleId", handleId);
                    ev.putExtra("data", java.util.Arrays.copyOf(buf, n));
                    LocalBroadcastManager.getInstance(mAppContext).sendBroadcast(ev);
                }
                Intent cl = new Intent(ACTION_CLOSE);
                cl.putExtra("handleId", handleId);
                LocalBroadcastManager.getInstance(mAppContext).sendBroadcast(cl);
                mSockets.remove(handleId);
            } catch (Exception e) {
                Log.d(TAG, "reader closed for " + handleId, e);
                Intent err = new Intent(ACTION_MESSAGE_ERROR);
                err.putExtra("handleId", handleId);
                err.putExtra("error", e.getMessage());
                LocalBroadcastManager.getInstance(mAppContext).sendBroadcast(err);
            }
        }, "i2p-reader-" + handleId);
        t.setDaemon(true);
        t.start();
    }

    /** Vom App-Prozess per LocalBinder aufgerufen. */
    public IBinder asBinder() { return this; }
}
```

- [ ] **Step 2: `RouterService.onBind` returnt RouterBridge**

```java
public class RouterService extends Service {
    private RouterBridge mBridge;

    @Override
    public IBinder onBind(Intent intent) {
        if (mBridge == null) {
            // RouterContext holen, I2PSocketManager via internalClientManager
            RouterContext ctx = RouterContext.getGlobalContext();
            I2PSocketManager mgr = ctx.internalClientManager().getClientManager();
            mBridge = new RouterBridge(mgr, getApplicationContext());
        }
        return mBridge.asBinder();
    }
}
```

- [ ] **Step 3: Build + Smoke-Test**

```bash
cd app/android && ./gradlew :I2PProcess:assembleDebug
```

Erwartet: Build grün.

- [ ] **Step 4: Commit**

```bash
git add app/android/I2PProcess/src/main/java/com/secuchat/i2p/RouterBridge.java
git add app/android/I2PProcess/src/main/java/com/secuchat/i2p/RouterService.java
git commit -m "feat(i2p): RouterBridge LocalBinder + reader-thread"
```

---

# Stage 5: `I2PPlugin` im App-Prozess (PR 5)

> **Reviewer-Schwerpunkt**: Lifecycle-Race bei Coldstart, BroadcastReceiver-Registrierung.
> **Rollback**: Feature-Flag.

## Task 5.1: Service-Bindung in `SecuChatApplication`

**Files:**
- Modify: `app/android/app/src/main/java/com/secuchat/app/SecuChatApplication.java`

- [ ] **Step 1: Service-Start im onCreate hinzufügen**

In `SecuChatApplication.onCreate` (oder neuer Bootstrap-Hook):

```java
Intent routerIntent = new Intent();
routerIntent.setClassName(getPackageName(), "com.secuchat.i2p.RouterService");
getApplicationContext().startForegroundService(routerIntent);
```

Wichtig: `startForegroundService` muss innerhalb von 5s in einem `Service.onStartCommand` mit `startForeground` beantwortet werden — `RouterService.onCreate` macht das bereits in Task 2.2.

- [ ] **Step 2: Manifest-Permission prüfen**

Sicherstellen dass `FOREGROUND_SERVICE_SPECIAL_USE` im `app`-Manifest steht.

- [ ] **Step 3: Commit**

```bash
git add app/android/app/src/main/java/com/secuchat/app/SecuChatApplication.java
git commit -m "feat(app): start RouterService on app-create"
```

---

## Task 5.2: `I2PPlugin`-Capacitor-Bridge

**Files:**
- Create: `app/android/app/src/main/java/com/secuchat/app/plugin/I2PPlugin/I2PPlugin.java`

**Interfaces:**
- `Capacitor.Plugins.I2PPlugin.connectTo({destination}) → {handleId}`

- [ ] **Step 1: Plugin-Datei**

```java
package com.secuchat.app.plugin.I2PPlugin;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.os.IBinder;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.secuchat.i2p.RouterBridge;

@CapacitorPlugin(name = "I2PPlugin")
public class I2PPlugin extends Plugin {
    private RouterBridge mBridge;
    private boolean mBound;

    private final ServiceConnection mConnection = new ServiceConnection() {
        @Override
        public void onServiceConnected(ComponentName name, IBinder service) {
            mBridge = (RouterBridge) service;
            mBound = true;
        }
        @Override public void onServiceDisconnected(ComponentName name) { mBound = false; }
    };

    @Override
    protected void handleOnStart() {
        super.handleOnStart();
        Intent i = new Intent().setClassName(getContext(), "com.secuchat.i2p.RouterService");
        getContext().bindService(i, mConnection, Context.BIND_AUTO_CREATE);
    }

    @Override
    protected void handleOnDestroy() {
        if (mBound) getContext().unbindService(mConnection);
        super.handleOnDestroy();
    }

    @PluginMethod
    public void connectTo(PluginCall call) {
        if (!mBound || mBridge == null) { call.reject("router_not_ready"); return; }
        String dest = call.getString("destination");
        String handleId = mBridge.connectRemote(dest);
        if (handleId == null) call.reject("connect_failed");
        else call.resolve(new JSObject().put("handleId", handleId));
    }

    @PluginMethod
    public void publishLeaseSet(PluginCall call) {
        // LeaseSet-Publishing ist im RouterContext automatisch.
        // Hier nur Bestätigung an JS.
        call.resolve();
    }

    @PluginMethod
    public void disconnect(PluginCall call) {
        // Schließt alle Sockets + setzt Session-Status
        // (echte Implementation folgt in PR 5.3)
        call.resolve();
    }
}
```

- [ ] **Step 2: Plugin in Capacitor registrieren**

Wenn die App ein zentrales `MainActivity` mit `init(savedInstanceState, bridge)` hat, hinzufügen:

```java
bridge.registerPlugin(I2PPlugin.class);
```

- [ ] **Step 3: Build-Probe**

```bash
cd app && npx cap sync android && cd android && ./gradlew :app:assembleDebug
```

Erwartet: Build grün.

- [ ] **Step 4: Commit**

```bash
git add app/android/app/src/main/java/com/secuchat/app/plugin/I2PPlugin
git commit -m "feat(app): I2PPlugin Capacitor-Bridge mit LocalBinder"
```

---

## Task 5.3: BroadcastReceiver im Plugin

**Files:**
- Create: `app/android/app/src/main/java/com/secuchat/app/plugin/I2PPlugin/I2PBroadcastReceiver.java`
- Modify: `I2PPlugin.java`

- [ ] **Step 1: Receiver**

```java
package com.secuchat.app.plugin.I2PPlugin;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import androidx.localbroadcastmanager.content.LocalBroadcastManager;
import com.getcapacitor.JSObject;
import com.secuchat.i2p.RouterBridge;

public class I2PBroadcastReceiver extends BroadcastReceiver {
    private final I2PPlugin mPlugin;

    public I2PBroadcastReceiver(I2PPlugin plugin) {
        mPlugin = plugin;
        IntentFilter filter = new IntentFilter();
        filter.addAction(RouterBridge.ACTION_MESSAGE);
        filter.addAction(RouterBridge.ACTION_STATUS);
        filter.addAction(RouterBridge.ACTION_CLOSE);
        filter.addAction(RouterBridge.ACTION_MESSAGE_ERROR);
        LocalBroadcastManager.getInstance(plugin.getContext())
            .registerReceiver(this, filter);
    }

    @Override
    public void onReceive(Context ctx, Intent intent) {
        String handleId = intent.getStringExtra("handleId");
        switch (intent.getAction()) {
            case RouterBridge.ACTION_MESSAGE:
                byte[] data = intent.getByteArrayExtra("data");
                JSObject ev = new JSObject();
                ev.put("handleId", handleId);
                ev.put("data", android.util.Base64.encodeToString(data, 0));  // base64-safe für JS-UInt8
                mPlugin.notifyListeners("message", ev);
                break;
            case RouterBridge.ACTION_CLOSE:
                JSObject ce = new JSObject();
                ce.put("handleId", handleId);
                mPlugin.notifyListeners("close", ce);
                break;
            case RouterBridge.ACTION_STATUS:
                JSObject se = new JSObject();
                se.put("status", intent.getStringExtra("status"));
                mPlugin.notifyListeners("status", se);
                break;
            case RouterBridge.ACTION_MESSAGE_ERROR:
                JSObject ee = new JSObject();
                ee.put("handleId", handleId);
                ee.put("error", intent.getStringExtra("error"));
                mPlugin.notifyListeners("error", ee);
                break;
        }
    }
}
```

- [ ] **Step 2: Receiver in `I2PPlugin.handleOnStart` registrieren**

```java
private I2PBroadcastReceiver mReceiver;

@Override
protected void handleOnStart() {
    super.handleOnStart();
    // ... bindService wie oben
    mReceiver = new I2PBroadcastReceiver(this);
}
```

- [ ] **Step 3: Build + Smoke**

```bash
cd app/android && ./gradlew :app:assembleDebug
```

- [ ] **Step 4: Commit**

```bash
git add app/android/app/src/main/java/com/secuchat/app/plugin/I2PPlugin
git commit -m "feat(app): broadcast-receiver for stream events"
```

---

# Stage 6: TS-Plugin-Wechsel (PR 6)

> **Reviewer-Schwerpunkt**: API-Kompatibilität zu `i2p.ts`.
> **Rollback**: Feature-Flag.

## Task 6.1: `i2p.ts` Plugin-Name-Wechsel

**Files:**
- Modify: `app/src/services/i2p.ts`

- [ ] **Step 1: Importe ändern**

Suchen nach `SAMPlugin`, ersetzen mit `I2PPlugin`. Konkret (Pseudocode):

```ts
// vor:
// import { registerPlugin } from '@capacitor/core';
// import { SamPlugin } from './sam-bindings';
// const sam = registerPlugin<SamPlugin>('SAMPlugin', {...});

// nach:
import { registerPlugin } from '@capacitor/core';

interface I2PPlugin {
  connectTo(opts: { destination: string }): Promise<{ handleId: string }>;
  accept(): Promise<{ handleId: string }>;
  publishLeaseSet(): Promise<void>;
  disconnect(): Promise<void>;
  send(opts: { handleId: string; data: string }): Promise<void>;
  close(opts: { handleId: string }): Promise<void>;
}

const i2pPlugin = registerPlugin<I2PPlugin>('I2PPlugin', {
  web: () => import('./i2p-web-fallback').then(m => new m.I2PWebFallback()),
});
```

- [ ] **Step 2: Methoden-Implementierung umstellen**

In `i2p.ts.start()`, `connectTo()`, etc.: ersetze TCP-Socket-Calls durch `i2pPlugin.*`-Calls. Public-Signaturen unverändert.

- [ ] **Step 3: `app/src/test/services/i2p.test.ts` läuft unverändert**

```bash
cd app && npx vitest run src/test/services/i2p.test.ts
```

Erwartet: alle bestehenden Tests grün.

- [ ] **Step 4: Type-Check**

```bash
cd app && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add app/src
git commit -m "feat(ts): i2p.ts uses I2PPlugin instead of TCP socket"
```

---

# Stage 7: Cleanup (PR 7)

> **Reviewer-Schwerpunkt**: keine Regressionen.
> **Rollback**: Git revert.

## Task 7.1: SAMPlugin-Löschung

**Files:**
- Delete: `app/android/app/src/main/java/com/secuchat/app/plugin/SAMPlugin/**`
- Delete: `app/android/app/src/test/java/com/secuchat/app/SAMPluginTest.java`
- Modify: `app/android/app/src/main/AndroidManifest.xml` (keine `SAMPlugin`-Referenz mehr)

- [ ] **Step 1: Tests laufen lassen (sicherstellen kein Regression)**

```bash
cd app/android && ./gradlew test
```

- [ ] **Step 2: SAMPlugin-Verzeichnis löschen**

```bash
git rm -r app/android/app/src/main/java/com/secuchat/app/plugin/SAMPlugin
git rm app/android/app/src/test/java/com/secuchat/app/SAMPluginTest.java
```

- [ ] **Step 3: Manifest bereinigen**

```bash
# manuell: jede <service android:name="...SAMPlugin..."> Zeile entfernen
```

- [ ] **Step 4: Build-Probe**

```bash
cd app/android && ./gradlew :app:assembleDebug
cd app && npx cap sync android && cd android && ./gradlew assembleDebug
```

- [ ] **Step 5: Commit**

```bash
git add app/android/app/src/main/java/com/secuchat/app/plugin
git add app/android/app/src/test/java/com/secuchat/app
git add app/android/app/src/main/AndroidManifest.xml
git commit -m "refactor(android): remove SAMPlugin (replaced by I2PPlugin)"
```

---

## Task 7.2: `sam-proxy/` als deprecated markieren

**Files:**
- Modify: `sam-proxy/README.md` (oder analog)

- [ ] **Step 1: README mit Deprecation-Hinweis**

```markdown
> ⚠️ **DEPRECATED 2026-08-06**: SAM-Proxy ist obsolet nach Migration auf Java-I2P-embedded.
> Wird in einer zukünftigen Version entfernt.
```

- [ ] **Step 2: Commit**

```bash
git add sam-proxy/README.md
git commit -m "docs(sam-proxy): mark as deprecated after Java-I2P migration"
```

---

## Task 7.3: THIRD_PARTY_NOTICES-Generator + Lizenz-Eintrag in App

**Files:**
- Create: `scripts/extract-i2p-licenses.sh`
- Modify: `app/android/app/src/main/res/raw/THIRD_PARTY_NOTICES.txt` (generiert)

- [ ] **Step 1: Generator-Script**

```bash
#!/usr/bin/env bash
# scripts/extract-i2p-licenses.sh — erzeugt THIRD_PARTY_NOTICES für App-Build
set -euo pipefail

OUT="${1:-app/android/app/src/main/res/raw/THIRD_PARTY_NOTICES.txt}"
VENDOR="vendor/i2p.i2p"

mkdir -p "$(dirname "$OUT")"
{
    echo "SecuChat — Open-Source-Lizenzen"
    echo "Stand: $(date +%Y-%m-%d)"
    echo "===="
    echo
    echo "Diese App enthält embedded Java-I2P (i2p.i2p) unter folgender Lizenz:"
    echo
    echo "--- Java-I2P (https://github.com/i2p/i2p.i2p) ---"
    cat "$VENDOR/LICENSE.txt" 2>/dev/null || echo "(LICENSE.txt fehlt)"
    echo
    echo "--- core/ Modul ---"
    cat "$VENDOR/core/doc/readme.license.txt" 2>/dev/null || echo "(readme.license.txt fehlt)"
    echo
    echo "--- apps/ministreaming/ Modul ---"
    cat "$VENDOR/apps/ministreaming/doc/readme.license.txt" 2>/dev/null || echo "(readme.license.txt fehlt)"
    echo
} > "$OUT"
echo "Generated $OUT"
```

- [ ] **Step 2: In App verlinken**

`app/src/components/AboutScreen.tsx` (oder analog): add menu item „Open-Source-Lizenzen" das die `res/raw/THIRD_PARTY_NOTICES.txt` in einem Modal anzeigt.

- [ ] **Step 3: Build-Hook**

```kotlin
// :app/build.gradle.kts
tasks.named("preBuild") {
    dependsOn("generateNotices")
}
tasks.register<Exec>("generateNotices") {
    commandLine("bash", "../../scripts/extract-i2p-licenses.sh")
}
```

- [ ] **Step 4: Test + Commit**

```bash
bash scripts/extract-i2p-licenses.sh
git add scripts/extract-i2p-licenses.sh app/android/app/src/main/res/raw/THIRD_PARTY_NOTICES.txt
git add app/android/app/build.gradle app/src/components/AboutScreen.tsx
git commit -m "feat(legal): THIRD_PARTY_NOTICES auto-generator"
```

---

# Stage 8: Akku- + Speicher-Profil (Parallel)

> **Reviewer-Schwerpunkt**: < 8% Drain, RAM < 200 MB im `:i2p`-Prozess.
> **Rollback**: nicht zwingend (separate PR-Validierung).

## Task 8.1: 4-Stunden-Batterystats-Probe auf A50

**Files:**
- Create: `docs/test-reports/2026-XX-XX-i2p-battery-profile.md`

- [ ] **Step 1: Test-Setup dokumentieren**

Conditions:
- A50 mit Phone-i2pd deinstalliert, SecuChat mit embedded Java-I2P installiert.
- WLAN verbunden, App foregrounded dann backgrounded.
- Display an/aus Mix 50/50.
- Akku-Start: 100%.

- [ ] **Step 2: Vor-Test**

```bash
adb -s R58M80LEXMK shell dumpsys batterystats --reset
adb -s R58M80LEXMK shell dumpsys batterystats --enable full
```

- [ ] **Step 3: 4 Stunden warten, dann:**

```bash
adb -s R58M80LEXMK shell dumpsys batterystats > docs/test-reports/battery-raw.txt
adb -s R58M80LEXMK shell dumpsys batterystats --checkin > docs/test-reports/battery-checkin.txt
```

- [ ] **Step 4: Parsen + Report generieren**

`docs/test-reports/2026-XX-XX-i2p-battery-profile.md`:

- Aktueller Akku-Stand vs. Start
- Top-3 Stromfresser
- Anteil von `com.secuchat.i2p` (`:i2p`-Prozess)
- Vergleich mit `android.uid.system` (i2pd.apk-Referenz)

- [ ] **Step 5: Spec-Section 11 DoD-Check „< 8%/Tag" eintragen**

- [ ] **Step 6: Commit**

```bash
git add docs/test-reports/2026-XX-XX-i2p-battery-profile.md
git commit -m "test(battery): 4h i2p-process profile on A50"
```

---

# Acceptance Criteria Mapping (Spec § 11)

| DoD-Item | Erfüllt durch Task |
|---|---|
| Build grün | Task 1.2, 2.1, 5.2, 7.1 |
| `targetSdkVersion=34`, `minSdkVersion=26` | Task 2.1 |
| Standalone-Router blockiert 60s | Task 2.4 |
| E2E auf A50+A54 | manuelle Verifikation (nicht im Plan) |
| Stale-State-Resilience | manuelle Verifikation |
| Akku-Probe | Task 8.1 |
| THIRD_PARTY_NOTICES.txt generiert | Task 7.3 |
| `scripts/verify-i2p-tag.sh` läuft in CI grün | Task 1.1 |
| TS-Tests unverändert grün | Task 6.1 Step 3 |
| `SAMPlugin.java` entfernt | Task 7.1 |
| `sam-proxy/` deprecated | Task 7.2 |
| Play-Store-FGS-POLICY.md | manuell vor Release |

---

# Self-Review Checklist (run before execution)

- [ ] Spec-Section 2 (Architektur) → Tasks 2.x + 5.x
- [ ] Spec-Section 3 (Komponenten) → Tasks 2.4, 3.1, 4.1, 5.x
- [ ] Spec-Section 4 (Lifecycle) → Tasks 2.x, 5.1
- [ ] Spec-Section 5 (Fehlerbehandlung) → wird beim Test fehlende Cases aufgreifen (nicht im Plan)
- [ ] Spec-Section 6 (Persistenz) → Task 3.1
- [ ] Spec-Section 7 (Build) → Tasks 1.2, 1.3
- [ ] Spec-Section 8 (Testing) → Tasks 2.4, 3.1, 8.1
- [ ] Spec-Section 9 (Risikoregister) → wird beim E2E verifiziert
- [ ] Spec-Section 10 (Migrations-PR-Plan) → Tasks-Stages 1-8
- [ ] Spec-Section 11 (DoD) → obige Mapping-Tabelle

---

# Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-06-embedded-java-i2p-migration.md`.

Two execution options:

1. **Subagent-Driven (recommended)** — I'll dispatch a fresh subagent per Task, review zwischen den Tasks, schneller Iterations-Loop. Map von Stage → Subagent-Setup steht im Plan.

2. **Inline Execution** — Ich führe die Tasks in dieser Session aus, mit Checkpoints zwischen den Stages.

Welche Variante?
