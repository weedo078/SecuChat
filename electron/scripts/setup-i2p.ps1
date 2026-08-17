# ============================================================================
# Java I2P Setup Script fuer Windows
# ============================================================================
# Installiert Java I2P via offiziellen NSIS-Installer von geti2p.net.
# Ersetzt das alte setup-i2pd.ps1 (i2pd-Installation).
#
# Nach erfolgreicher Installation:
#   1. Router Console oeffnen: Browser -> 127.0.0.1:7657
#   2. Router startet automatisch nach Windows-Login (Wrapper-Service)
#   3. SecuChat Desktop starten (verbindet via I2CP auf 127.0.0.1:7654)
#
# Verwendung:
#   pwsh -File setup-i2p.ps1
#   pwsh -File setup-i2p.ps1 -Uninstall
#
# Hinweise:
#   - NSIS-Installer unterstuetzt keinen Silent-Uninstall. -Uninstall
#     gibt nur einen Hinweis aus, wie der Nutzer manuell deinstalliert.
#   - Das Skript benoetigt KEINE Admin-Rechte, wenn der Installer per
#     /S ohne Admin laeuft (Standard-User-Install unter %LOCALAPPDATA%).
#   - PowerShell 5.1+ (Windows PowerShell) und PowerShell 7+ unterstuetzt.
# ============================================================================

param(
    [switch]$Uninstall
)

# Bei Fehlern sofort abbrechen (Standard fuer robuste Setup-Scripts).
$ErrorActionPreference = "Stop"

# ============================================================================
# KONFIGURATION
# ============================================================================

$I2P_VERSION = "2.13.0"
$INSTALLER_URL = "https://files.i2p.net/$I2P_VERSION/i2pinstall_$($I2P_VERSION)_windows.exe"
$INSTALLER_PATH = "$env:TEMP\i2pinstall_$($I2P_VERSION)_windows.exe"
$I2CP_HOST = "127.0.0.1"
$I2CP_PORT = 7654
$I2CP_PROBE_TIMEOUT_MS = 3000

# ============================================================================
# HILFSFUNKTIONEN
# ============================================================================

function Write-Info($Message) {
    Write-Host "[setup-i2p] $Message"
}

function Write-Warn($Message) {
    Write-Host "[setup-i2p] WARNUNG: $Message" -ForegroundColor Yellow
}

# ============================================================================
# UNINSTALL
# ============================================================================
# Der Java-I2P-Windows-Installer (NSIS) unterstuetzt kein Silent-Uninstall
# (kein /S fuer Uninstall-Pfad). Der Nutzer muss die Standard-Windows-
# Deinstallation ueber Systemsteuerung > Programme ausfuehren.

if ($Uninstall) {
    Write-Info "Entferne Java I2P..."
    $i2pDir = "C:\Program Files\i2p"
    if (Test-Path $i2pDir) {
        Write-Info "Manuelle Deinstallation erforderlich."
        Write-Info "Installationspfad: $i2pDir"
        Write-Info "Oeffne: Systemsteuerung -> Programme -> i2p deinstallieren."
    } else {
        Write-Info "Java I2P scheint nicht installiert zu sein ($i2pDir fehlt)."
        Write-Info "Manuelle Pruefung empfohlen: Systemsteuerung -> Programme."
    }
    exit 0
}

# ============================================================================
# INSTALLER-DOWNLOAD
# ============================================================================
# Wenn der Installer bereits im TEMP-Cache liegt (vorheriger Lauf),
# wird er wiederverwendet. Sonst frisch herunterladen.

if (Test-Path $INSTALLER_PATH) {
    Write-Info "Installer bereits im Cache: $INSTALLER_PATH"
} else {
    Write-Info "Lade Installer herunter: $INSTALLER_URL"
    try {
        Invoke-WebRequest -Uri $INSTALLER_URL -OutFile $INSTALLER_PATH -UseBasicParsing
    } catch {
        Write-Warn "Download fehlgeschlagen: $_"
        Write-Warn "Manuelle Installation: $INSTALLER_URL"
        exit 1
    }
    Write-Info "Download abgeschlossen: $INSTALLER_PATH"
}

# ============================================================================
# INSTALLER-AUSFUEHRUNG (silent)
# ============================================================================
# Java I2P nutzt NSIS als Installer-Framework. NSIS unterstuetzt /S fuer
# die unbeaufsichtigte Installation. -PassThru -Wait liefert ein Process-
# Objekt mit ExitCode.

Write-Info "Starte Installer (silent /S)..."
$proc = Start-Process -FilePath $INSTALLER_PATH -ArgumentList "/S" -PassThru -Wait
if ($proc.ExitCode -ne 0) {
    Write-Warn "Installer fehlgeschlagen (Exit-Code $($proc.ExitCode))."
    Write-Warn "Manuelle Installation: $INSTALLER_URL"
    exit 1
}
Write-Info "Installer abgeschlossen."

# ============================================================================
# I2CP-PORT-PRUEFUNG (127.0.0.1:7654)
# ============================================================================
# Der Router braucht nach Installation/Start 5-10 Minuten, bis er im Netz
# ist. Wir pruefen nur, ob der I2CP-Listener schon laeuft. Wenn nicht:
# Hinweis ausgeben (Router Console im Browser oeffnen).

Write-Info "Pruefe I2CP-Port $I2CP_HOST:$I2CP_PORT..."
$tcpClient = New-Object System.Net.Sockets.TcpClient
try {
    # ConnectAsync mit Wait spart Blockaden bei laengeren Timeouts.
    $connectTask = $tcpClient.ConnectAsync($I2CP_HOST, $I2CP_PORT)
    if ($connectTask.Wait($I2CP_PROBE_TIMEOUT_MS) -and $tcpClient.Connected) {
        Write-Info "OK: I2CP auf $I2CP_HOST:$I2CP_PORT erreichbar."
        $tcpClient.Close()
    } else {
        Write-Warn "I2CP noch nicht erreichbar (Router startet noch)."
        Write-Warn "Oeffne I2P Router Console manuell: Browser -> 127.0.0.1:7657"
    }
} catch {
    Write-Warn "I2CP nicht erreichbar (Router startet noch)."
    Write-Warn "Oeffne I2P Router Console manuell: Browser -> 127.0.0.1:7657"
} finally {
    if ($tcpClient.Connected) {
        $tcpClient.Close()
    }
    $tcpClient.Dispose()
}

# ============================================================================
# ABSCHLUSS
# ============================================================================

Write-Info "Fertig. Starte SecuChat Desktop."
