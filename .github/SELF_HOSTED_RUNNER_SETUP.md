# Self-Hosted GitHub Actions Runner Setup

## Übersicht

Dieses Projekt verwendet **self-hosted GitHub Actions Runner** für die Electron Builds. 
Diese Anleitung erklärt die Einrichtung.

## Warum Self-Hosted?

- **Electron ARM64 Builds**: GitHub-hosted runner haben keine ARM64 Unterstützung für Linux
- **Wine für Windows Builds**: Eigene Konfiguration für Windows-Builds auf Linux
- **Performance**: Schnellere Builds durch dedizierte Hardware
- **Kosten**: Keine Limits bei GitHub Actions Minuten

## Sicherheitshinweise

⚠️ **WICHTIG**: Self-hosted Runner haben Zugriff auf:
- Repository-Code
- Secrets (wenn konfiguriert)
- Die komplette Build-Umgebung

**Empfohlene Sicherheitsmaßnahmen:**
1. Runner nur für **public Repositories** oder **vertrauenswürdige Contributor** verwenden
2. Für PRs von Forks: `runs-on: ubuntu-latest` statt `runs-on: self-hosted`
3. Secrets nur in spezifischen Jobs verfügbar machen
4. Runner regelmäßig aktualisieren

## Einrichtung

### 1. Runner aus anderem Projekt registrieren

Falls du bereits einen Runner in einem anderen Projekt hast, kannst du ihn **mehreren Repositories zuweisen**:

```bash
# Auf dem Runner-Server
sudo ./svc.sh stop

# Neuen Runner für dieses Repo hinzufügen
./config.sh --url https://github.com/DEIN_USERNAME/SecuChat --token GITHUB_TOKEN

# Service neu starten
sudo ./svc.sh start
```

### 2. Neuen Runner einrichten (ARM64 Server)

Auf deinem ARM64 Server (z.B. Oracle Cloud):

```bash
# 1. GitHub Runner herunterladen
cd ~
mkdir actions-runner && cd actions-runner

# ARM64 Version
RUNNER_VERSION="2.311.0"
curl -o actions-runner-linux-arm64.tar.gz \
  -L https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-arm64-${RUNNER_VERSION}.tar.gz

# Entpacken
tar xzf ./actions-runner-linux-arm64.tar.gz

# 2. Konfigurieren
./config.sh --url https://github.com/DEIN_USERNAME/SecuChat --token GITHUB_TOKEN

# 3. Als Systemd Service installieren
sudo ./svc.sh install
sudo ./svc.sh start

# 4. Status prüfen
sudo ./svc.sh status
```

### 3. Erforderliche Dependencies

```bash
# Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Build-Tools
sudo apt-get update
sudo apt-get install -y build-essential python3 git

# Für Electron Windows Builds (Wine)
sudo dpkg --add-architecture i386
sudo apt-get update
sudo apt-get install -y wine64 wine32

# Für Electron Linux Builds
sudo apt-get install -y libarchive-tools rpm

# Für Android (später)
# sudo apt-get install -y openjdk-17-jdk android-sdk
```

### 4. Labels konfigurieren

Um spezifische Runner zuzuweisen, kannst du Labels verwenden:

```bash
# Beim Konfigurieren Labels setzen
./config.sh --url https://github.com/DEIN_USERNAME/SecuChat \
  --token GITHUB_TOKEN \
  --labels self-hosted,linux,arm64,electron-builder
```

Dann im Workflow:
```yaml
runs-on: [self-hosted, linux, arm64]
```

## Mehrere Repositories

Ein Runner kann **mehreren Repositories** gleichzeitig dienen:

```bash
# Bestehenden Runner stoppen
sudo ./svc.sh stop

# Zusätzliches Repo hinzufügen
./config.sh --url https://github.com/DEIN_USERNAME/ANDERES_REPO --token TOKEN

# Service neu starten
sudo ./svc.sh start
```

Oder einen **neuen Runner** im selben Ordner erstellen:

```bash
mkdir ../actions-runner-secuchat && cd ../actions-runner-secuchat
curl -o actions-runner-linux-arm64.tar.gz -L https://github.com/.../actions-runner-linux-arm64-...
tar xzf ./actions-runner-linux-arm64.tar.gz
./config.sh --url https://github.com/DEIN_USERNAME/SecuChat --token TOKEN
sudo ./svc.sh install
sudo ./svc.sh start
```

## Troubleshooting

### Runner erscheint nicht in GitHub

1. Token prüfen: Muss `repo` Scope haben
2. Registrierung prüfen: `./config.sh` ohne Fehler durchlaufen?
3. Service läuft? `sudo ./svc.sh status`

### Builds dauern ewig

- ARM64 + Wine ist langsam - normal!
- Für schnellere Windows-Builds: x86_64 Runner hinzufügen
- Caching aktivieren (siehe unten)

### Out of Memory

```bash
# Swap hinzufügen
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

## Optimierungen

### Caching

Der Workflow verwendet bereits `actions/setup-node` mit Caching. Für noch schnellere Builds:

```yaml
- name: Cache Electron builds
  uses: actions/cache@v3
  with:
    path: |
      ~/actions-runner/_work/SecuChat/SecuChat/electron/node_modules
      ~/actions-runner/_work/SecuChat/SecuChat/app/node_modules
    key: ${{ runner.os }}-node-${{ hashFiles('**/package-lock.json') }}
```

### Parallelisierung

Die Workflows sind bereits parallelisiert:
- Linux ARM64 und Windows können gleichzeitig bauen
- macOS läuft auf GitHub-hosted (kein self-hosted nötig)

## Monitoring

### Runner Logs

```bash
# Service Logs
sudo journalctl -u actions.runner.* -f

# Runner Logs
cd ~/actions-runner/_diag
cat Runner_*.log | tail -100
```

### GitHub Actions Dashboard

- Gehe zu: Repository → Actions → Runners
- Hier siehst du alle self-hosted Runner und deren Status

## Alternative: Matrix Builds

Wenn du später mehrere Runner hast:

```yaml
strategy:
  matrix:
    runner: [self-hosted-arm64, self-hosted-x64]
    os: [linux, windows]

runs-on: ${{ matrix.runner }}
```

## Support

- GitHub Docs: https://docs.github.com/en/actions/hosting-your-own-runners
- Troubleshooting: https://docs.github.com/en/actions/hosting-your-own-runners/troubleshooting
