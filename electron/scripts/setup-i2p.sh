#!/bin/bash
# ============================================================================
# Java I2P Setup Script fuer Linux (Debian/Ubuntu)
# ============================================================================
# Installiert Java I2P ueber die offiziellen Paketquellen.
# Ersetzt das alte setup-i2pd.sh (i2pd-Installation).
#
# Nach erfolgreicher Installation:
#   1. Router manuell starten: i2prouter-nowrapper
#      (kann 5-10 Minuten dauern, bis der Router das Netz erreicht)
#   2. SecuChat Desktop starten (verbindet via I2CP auf 127.0.0.1:7654)
#
# Verwendung: ./setup-i2p.sh [--uninstall]
# ============================================================================

set -euo pipefail

# NOTE: Dieses Skript verwendet `</dev/tcp/...` (Bash-ismus) und ist daher
# explizit fuer /bin/bash gedacht. Shebang oben ist gesetzt.

# ============================================================================
# OPTIONEN
# ============================================================================

UNINSTALL=false
if [[ "${1:-}" == "--uninstall" ]]; then
    UNINSTALL=true
fi

# ============================================================================
# UNINSTALL
# ============================================================================

if [[ "$UNINSTALL" == "true" ]]; then
    echo "[setup-i2p] Entferne Java I2P..."
    # Best-effort: Paket entfernen falls vorhanden, Fehler ignorieren
    sudo apt-get remove -y i2p i2p-keyring 2>/dev/null || true
    sudo apt-get autoremove -y 2>/dev/null || true
    echo "[setup-i2p] Fertig (uninstall)."
    exit 0
fi

# ============================================================================
# DISTRO-ERKENNUNG
# ============================================================================

if [[ -f /etc/os-release ]]; then
    # shellcheck disable=SC1091
    . /etc/os-release
    DISTRO="$ID"
else
    echo "[setup-i2p] FEHLER: /etc/os-release nicht gefunden."
    echo "[setup-i2p] Unterstuetzt nur Debian/Ubuntu-Derivate."
    exit 1
fi

echo "[setup-i2p] Erkannte Distribution: $DISTRO"

# ============================================================================
# INSTALLATION
# ============================================================================

case "$DISTRO" in
    ubuntu|linuxmint|pop|elementary|kali|parrot)
        echo "[setup-i2p] Ubuntu-Derivat erkannt. Verwende i2p-maintainers PPA..."
        sudo apt-add-repository -y ppa:i2p-maintainers/i2p
        sudo apt-get update
        sudo apt-get install -y i2p
        ;;
    debian|knoppix)
        echo "[setup-i2p] Debian erkannt. Verwende offizielles deb.i2p.net Repo..."
        # Werkzeuge fuer Repo-Setup sicherstellen
        sudo apt-get install -y apt-transport-https lsb-release curl gnupg
        # GPG-Keyring (signed-by= in sources.list verhindert apt-key-Warnung)
        curl -fsSL https://i2p.net/i2p-archive-keyring.gpg \
            | sudo gpg --dearmor -o /usr/share/keyrings/i2p-archive-keyring.gpg
        echo "deb [signed-by=/usr/share/keyrings/i2p-archive-keyring.gpg] https://deb.i2p.net/ $(lsb_release -sc) main" \
            | sudo tee /etc/apt/sources.list.d/i2p.list
        sudo apt-get update
        # i2p-keyring wird im offiziellen Repo mitgeliefert; apt installiert es
        # bei vorhandenem Eintrag automatisch. Falls es auf Aenderungen wartet,
        # hilft ein explizites Angeben.
        sudo apt-get install -y i2p i2p-keyring
        ;;
    *)
        echo "[setup-i2p] FEHLER: Unbekannte Distribution '$DISTRO'."
        echo "[setup-i2p] Bitte Java I2P manuell installieren:"
        echo "    https://geti2p.net/de/download"
        exit 1
        ;;
esac

# ============================================================================
# SYSTEMD-SERVICE DEAKTIVIEREN
# ============================================================================
# SecuChat Desktop verwaltet die I2CP-Verbindung selbst, nicht den Router-
# Lebenszyklus. Der systemd-Service wuerde beim Boot automatisch starten und
# Ressourcen verbrauchen, ohne dass SecuChat laeuft.
#
# Bug-Watch: Auf Systemen ohne aktive systemd-User-Instanz (Container, einige
# Server) kann `systemctl --user` mit Exit-Code 1 fehlschlagen. `set -e` wuerde
# dann das Skript abbrechen. Daher: defensiv in `if` wickeln (der `if`-Test
# konsumiert den Exit-Code, ohne `set -e` auszuloesen).

if systemctl --user is-enabled i2p.service 2>/dev/null; then
    sudo systemctl disable i2p || true
fi

# ============================================================================
# I2CP-PORT-CHECK (127.0.0.1:7654)
# ============================================================================
# Der Router braucht nach dem Start 5-10 Minuten, bis er im Netz ist.
# Wir pruefen nur, ob der Listener schon laeuft. Wenn nicht: Hinweis ausgeben.

echo "[setup-i2p] Pruefe I2CP-Port 127.0.0.1:7654..."

if timeout 5 bash -c "</dev/tcp/127.0.0.1/7654" 2>/dev/null; then
    echo "[setup-i2p] OK: I2CP ist erreichbar."
else
    echo "[setup-i2p] HINWEIS: I2CP noch nicht erreichbar."
    echo "[setup-i2p] Router startet noch (kann 5-10 Min dauern)."
    echo "[setup-i2p] Manuell starten mit: i2prouter-nowrapper"
fi

# ============================================================================
# ABSCHLUSS
# ============================================================================

echo "[setup-i2p] Fertig. Starte SecuChat Desktop."
