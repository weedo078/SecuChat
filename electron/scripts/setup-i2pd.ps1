# ============================================================================
# I2PD Setup Script fuer Windows
# ============================================================================
# Dieses Skript richtet i2pd fuer SecuChat auf Windows ein
# ============================================================================

param(
    [string]$InstallDir = "$env:LOCALAPPDATA\SecuChat\i2pd",
    [switch]$Download,
    [switch]$Verify
)

$ErrorActionPreference = "Stop"

# ============================================================================
# KONFIGURATION
# ============================================================================

$I2PD_VERSION = "2.50.1"
$I2PD_URL = "https://github.com/PurpleI2P/i2pd/releases/download/$I2PD_VERSION/i2pd_$I2PD_VERSION-win64-mingw.zip"
$I2PD_URL_32 = "https://github.com/PurpleI2P/i2pd/releases/download/$I2PD_VERSION/i2pd_$I2PD_VERSION-win32-mingw.zip"

# ============================================================================
# FUNKTIONEN
# ============================================================================

function Write-Info($Message) {
    Write-Host "[I2P-Setup] $Message" -ForegroundColor Cyan
}

function Write-Success($Message) {
    Write-Host "[I2P-Setup] $Message" -ForegroundColor Green
}

function Write-Warning($Message) {
    Write-Host "[I2P-Setup] $Message" -ForegroundColor Yellow
}

function Write-Error($Message) {
    Write-Host "[I2P-Setup] $Message" -ForegroundColor Red
}

function Test-AdminRights {
    $currentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    return $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-Architecture {
    if ([Environment]::Is64BitOperatingSystem) {
        return "x64"
    } else {
        return "x86"
    }
}

function Install-I2PD {
    param(
        [string]$Destination
    )
    
    Write-Info "Installing i2pd to: $Destination"
    
    # Erstelle Verzeichnis
    if (!(Test-Path $Destination)) {
        New-Item -ItemType Directory -Path $Destination -Force | Out-Null
        Write-Info "Created directory: $Destination"
    }
    
    $arch = Get-Architecture
    $downloadUrl = if ($arch -eq "x64") { $I2PD_URL } else { $I2PD_URL_32 }
    
    Write-Info "Downloading i2pd $I2PD_VERSION for $arch..."
    
    $tempFile = "$env:TEMP\i2pd_$I2PD_VERSION.zip"
    
    try {
        # Download
        Invoke-WebRequest -Uri $downloadUrl -OutFile $tempFile -UseBasicParsing
        Write-Success "Download completed"
        
        # Entpacke
        Write-Info "Extracting..."
        Expand-Archive -Path $tempFile -DestinationPath "$env:TEMP\i2pd_extract" -Force
        
        # Kopiere Dateien
        $extractedDir = Get-ChildItem "$env:TEMP\i2pd_extract" -Directory | Select-Object -First 1
        if ($extractedDir) {
            Copy-Item "$($extractedDir.FullName)\*" $Destination -Recurse -Force
            Write-Success "Files extracted to: $Destination"
        }
        
        # Bereinigung
        Remove-Item $tempFile -Force -ErrorAction SilentlyContinue
        Remove-Item "$env:TEMP\i2pd_extract" -Recurse -Force -ErrorAction SilentlyContinue
        
    } catch {
        Write-Error "Failed to download or extract i2pd: $_"
        return $false
    }
    
    return $true
}

function Test-I2PDBinary {
    param(
        [string]$Path
    )
    
    $binaryPath = Join-Path $Path "i2pd.exe"
    
    if (!(Test-Path $binaryPath)) {
        Write-Error "i2pd.exe not found at: $binaryPath"
        return $false
    }
    
    Write-Success "i2pd.exe found at: $binaryPath"
    
    # Pruefe Version
    try {
        $versionInfo = (Get-Item $binaryPath).VersionInfo
        Write-Info "Version: $($versionInfo.FileVersion)"
        Write-Info "Product: $($versionInfo.ProductName)"
    } catch {
        Write-Warning "Could not read version info"
    }
    
    return $true
}

function Add-FirewallRule {
    param(
        [string]$BinaryPath
    )
    
    if (!(Test-AdminRights)) {
        Write-Warning "Admin rights required for firewall rule. Skipping..."
        return
    }
    
    Write-Info "Adding firewall rule for i2pd..."
    
    try {
        # Entferne alte Regel falls vorhanden
        netsh advfirewall firewall delete rule name="SecuChat i2pd" 2>$null | Out-Null
        
        # Fuege neue Regel hinzu
        netsh advfirewall firewall add rule `
            name="SecuChat i2pd" `
            dir=in `
            action=allow `
            program="$BinaryPath\i2pd.exe" `
            enable=yes | Out-Null
        
        Write-Success "Firewall rule added"
    } catch {
        Write-Warning "Could not add firewall rule: $_"
    }
}

function Test-PortAvailable {
    param(
        [int]$Port = 7656
    )
    
    try {
        $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
        $listener.Start()
        $listener.Stop()
        Write-Success "Port $Port is available"
        return $true
    } catch {
        Write-Warning "Port $Port is already in use"
        return $false
    }
}

# ============================================================================
# HAUPTPROGRAMM
# ============================================================================

Write-Host "========================================" -ForegroundColor Blue
Write-Host "  SecuChat I2P Setup for Windows" -ForegroundColor Blue
Write-Host "========================================" -ForegroundColor Blue
Write-Host ""

# Pruefe ob Download erforderlich
if ($Download -or !(Test-Path (Join-Path $InstallDir "i2pd.exe"))) {
    Write-Info "i2pd not found or download requested"
    
    if (!(Install-I2PD -Destination $InstallDir)) {
        Write-Error "Installation failed"
        exit 1
    }
} else {
    Write-Info "i2pd already installed"
}

# Verifiziere Installation
if ($Verify) {
    Write-Host ""
    Write-Info "Verifying installation..."
    
    if (!(Test-I2PDBinary -Path $InstallDir)) {
        Write-Error "Verification failed"
        exit 1
    }
    
    # Pruefe Zertifikate
    $certsDir = Join-Path $InstallDir "certificates"
    if (Test-Path $certsDir) {
        $certCount = (Get-ChildItem $certsDir -Recurse -File).Count
        Write-Success "Found $certCount certificate files"
    } else {
        Write-Warning "Certificates directory not found"
    }
    
    # Pruefe Port
    Test-PortAvailable -Port 7656
}

# Fuege Firewall-Regel hinzu
Add-FirewallRule -BinaryPath $InstallDir

Write-Host ""
Write-Success "Setup completed successfully!"
Write-Host ""
Write-Info "Installation directory: $InstallDir"
Write-Info "To start i2pd manually, run:"
Write-Host "  $InstallDir\i2pd.exe --sam.enabled=true --sam.port=7656"
