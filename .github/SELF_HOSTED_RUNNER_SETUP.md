# Self-Hosted GitHub Actions Runner Setup

## Overview

This project uses **self-hosted GitHub Actions runners** for Electron builds. 
This guide explains the setup.

## Why Self-Hosted?

- **Electron ARM64 builds**: GitHub-hosted runners have no ARM64 support for Linux
- **Wine for Windows builds**: Custom configuration for Windows builds on Linux
- **Performance**: Faster builds through dedicated hardware
- **Cost**: No limits on GitHub Actions minutes

## Security Notes

⚠️ **IMPORTANT**: Self-hosted runners have access to:
- Repository code
- Secrets (if configured)
- The complete build environment

**Recommended security measures:**
1. Only use runners for **public repositories** or **trusted contributors**
2. For PRs from forks: `runs-on: ubuntu-latest` instead of `runs-on: self-hosted`
3. Only make secrets available in specific jobs
4. Regularly update runners

## Setup

### 1. Register runner from another project

If you already have a runner in another project, you can **assign it to multiple repositories**:

```bash
# On the runner server
sudo ./svc.sh stop

# Add new runner for this repo
./config.sh --url https://github.com/YOUR_USERNAME/SecuChat --token GITHUB_TOKEN

# Restart service
sudo ./svc.sh start
```

### 2. Set up new runner (ARM64 server)

On your ARM64 server (e.g., Oracle Cloud):

```bash
# 1. Download GitHub runner
cd ~
mkdir actions-runner && cd actions-runner

# ARM64 version
RUNNER_VERSION="2.311.0"
curl -o actions-runner-linux-arm64.tar.gz \
  -L https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-arm64-${RUNNER_VERSION}.tar.gz

# Extract
tar xzf ./actions-runner-linux-arm64.tar.gz

# 2. Configure
./config.sh --url https://github.com/YOUR_USERNAME/SecuChat --token GITHUB_TOKEN

# 3. Install as systemd service
sudo ./svc.sh install
sudo ./svc.sh start

# 4. Check status
sudo ./svc.sh status
```

### 3. Required dependencies

```bash
# Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Build tools
sudo apt-get update
sudo apt-get install -y build-essential python3 git

# For Electron Windows builds (Wine)
sudo dpkg --add-architecture i386
sudo apt-get update
sudo apt-get install -y wine64 wine32

# For Electron Linux builds
sudo apt-get install -y libarchive-tools rpm

# For Android (later)
# sudo apt-get install -y openjdk-17-jdk android-sdk
```

### 4. Configure labels

To assign specific runners, you can use labels:

```bash
# Set labels during configuration
./config.sh --url https://github.com/YOUR_USERNAME/SecuChat \
  --token GITHUB_TOKEN \
  --labels self-hosted,linux,arm64,electron-builder
```

Then in the workflow:
```yaml
runs-on: [self-hosted, linux, arm64]
```

## Multiple Repositories

A runner can serve **multiple repositories** simultaneously:

```bash
# Stop existing runner
sudo ./svc.sh stop

# Add additional repo
./config.sh --url https://github.com/YOUR_USERNAME/OTHER_REPO --token TOKEN

# Restart service
sudo ./svc.sh start
```

Or create a **new runner** in the same folder:

```bash
mkdir ../actions-runner-secuchat && cd ../actions-runner-secuchat
curl -o actions-runner-linux-arm64.tar.gz -L https://github.com/.../actions-runner-linux-arm64-...
tar xzf ./actions-runner-linux-arm64.tar.gz
./config.sh --url https://github.com/YOUR_USERNAME/SecuChat --token TOKEN
sudo ./svc.sh install
sudo ./svc.sh start
```

## Troubleshooting

### Runner doesn't appear in GitHub

1. Check token: Must have `repo` scope
2. Check registration: Did `./config.sh` complete without errors?
3. Is service running? `sudo ./svc.sh status`

### Builds take forever

- ARM64 + Wine is slow - normal!
- For faster Windows builds: add x86_64 runner
- Enable caching (see below)

### Out of Memory

```bash
# Add swap
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

## Optimizations

### Caching

The workflow already uses `actions/setup-node` with caching. For even faster builds:

```yaml
- name: Cache Electron builds
  uses: actions/cache@v3
  with:
    path: |
      ~/actions-runner/_work/SecuChat/SecuChat/electron/node_modules
      ~/actions-runner/_work/SecuChat/SecuChat/app/node_modules
    key: ${{ runner.os }}-node-${{ hashFiles('**/package-lock.json') }}
```

### Parallelization

Workflows are already parallelized:
- Linux ARM64 and Windows can build simultaneously
- macOS runs on GitHub-hosted (no self-hosted needed)

## Monitoring

### Runner logs

```bash
# Service logs
sudo journalctl -u actions.runner.* -f

# Runner logs
cd ~/actions-runner/_diag
cat Runner_*.log | tail -100
```

### GitHub Actions Dashboard

- Go to: Repository → Actions → Runners
- Here you can see all self-hosted runners and their status

## Alternative: Matrix builds

If you have multiple runners later:

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
