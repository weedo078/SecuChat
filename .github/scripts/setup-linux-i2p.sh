#!/bin/bash
# ============================================================================
# CI Pre-Condition: Install Java I2P for Playwright E2E (Task 17)
# ============================================================================
#
# SecuChat's Electron Desktop E2E test (electron/tests/e2e/i2p-electron.test.ts)
# requires a reachable I2CP endpoint on 127.0.0.1:7654. On Linux CI runners,
# that means installing Java I2P via the OS package manager.
#
# This script is intentionally SEPARATE from the test itself for two reasons:
#
#   1. Tests should not install OS packages — they assume their environment.
#   2. Cross-platform hazard: Debian vs Ubuntu install paths differ (Debian
#      uses deb.i2p.net + signed-by= keyring; Ubuntu uses the
#      i2p-maintainers PPA). Keeping install in one shell script keeps the
#      matrix readable.
#
# Run before `npx playwright test`:
#
#   sudo ./.github/scripts/setup-linux-i2p.sh
#
# After install, the user (or runner) must start the router manually:
#
#   i2prouter-nowrapper            # Ubuntu/i2p-maintainers PPA
#   # Debian: wrapper invokes i2prouter-nowrapper; the binary on PATH is
#   # also named i2prouter — both Debian and Ubuntu end up at the same
#   # underlying Java process. Manual start: `~/.i2p/run.sh` or
#   # `i2prouter` (Debian) / `i2prouter-nowrapper` (Ubuntu).
#
# It can take 5-10 minutes for the router to fully join the network.
# The E2E test probes 127.0.0.1:7654 itself and `test.skip()`s with a
# documented error if the port is not reachable, so no timing trick is
# needed here — just verify `nc -z 127.0.0.1 7654` returns 0 before
# launching the test.
# ============================================================================

set -euo pipefail

if [[ $EUID -ne 0 ]]; then
    echo "[setup-linux-i2p] FEHLER: Bitte mit sudo aufrufen." >&2
    exit 1
fi

if [[ ! -f /etc/os-release ]]; then
    echo "[setup-linux-i2p] FEHLER: /etc/os-release nicht gefunden." >&2
    exit 1
fi
# shellcheck disable=SC1091
. /etc/os-release
DISTRO="$ID"

echo "[setup-linux-i2p] Distribution: $DISTRO"

case "$DISTRO" in
    ubuntu|linuxmint|pop|elementary|kali|parrot)
        echo "[setup-linux-i2p] Ubuntu-Derivat — i2p-maintainers PPA..."
        apt-add-repository -y ppa:i2p-maintainers/i2p
        apt-get update
        apt-get install -y i2p
        ;;
    debian|knoppix)
        echo "[setup-linux-i2p] Debian — deb.i2p.net Repo..."
        apt-get install -y apt-transport-https lsb-release curl gnupg
        curl -fsSL https://i2p.net/i2p-archive-keyring.gpg \
            | gpg --dearmor -o /usr/share/keyrings/i2p-archive-keyring.gpg
        echo "deb [signed-by=/usr/share/keyrings/i2p-archive-keyring.gpg] https://deb.i2p.net/ $(lsb_release -sc) main" \
            > /etc/apt/sources.list.d/i2p.list
        apt-get update
        apt-get install -y i2p i2p-keyring
        ;;
    *)
        echo "[setup-linux-i2p] FEHLER: Unbekannte Distribution '$DISTRO'." >&2
        echo "[setup-linux-i2p] Bitte Java I2P manuell installieren: https://geti2p.net/de/download" >&2
        exit 1
        ;;
esac

# Disable systemd autostart (SecuChat manages I2CP, not the router lifecycle).
if systemctl --user is-enabled i2p.service 2>/dev/null; then
    systemctl disable i2p || true
fi

echo "[setup-linux-i2p] Installation abgeschlossen."
echo "[setup-linux-i2p] Router manuell starten (kann 5-10 Min dauern):"
echo "[setup-linux-i2p]   i2prouter-nowrapper        # Ubuntu"
echo "[setup-linux-i2p]   ~/.i2p/run.sh              # Debian"
echo "[setup-linux-i2p] Verifikation: nc -z 127.0.0.1 7654"