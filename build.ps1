# SecuChat Windows Build Script
# Automatically installs all missing dependencies and builds the app.
# Usage: .\build.ps1   (run as Administrator for automatic Defender handling)

param([switch]$All)

$ErrorActionPreference = "Stop"
$I2PD_VERSION = "2.59.0"
$SCRIPT_DIR   = $PSScriptRoot
$ELECTRON_DIR = "$SCRIPT_DIR\electron"
$APP_DIR      = "$SCRIPT_DIR\app"
$I2PD_EXE     = "$ELECTRON_DIR\resources\i2pd\win\i2pd.exe"

function Info  { param($msg) Write-Host "[build] $msg" -ForegroundColor Green }
function Warn  { param($msg) Write-Host "[build] WARN: $msg" -ForegroundColor Yellow }
function Abort { param($msg) Write-Host "[build] ERROR: $msg" -ForegroundColor Red; exit 1 }

function Refresh-Path {
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" +
                [System.Environment]::GetEnvironmentVariable("Path","User")
}

# --- Defender exclusion for the entire repo (persistent) ---
# i2pd.exe is a legitimate open-source privacy tool that Windows Defender
# incorrectly flags as malware. We add the repo folder as a permanent
# exclusion so Defender never deletes it during or after the build.
Info "Adding Windows Defender exclusion for repo folder..."
try {
    Add-MpPreference -ExclusionPath $SCRIPT_DIR -ErrorAction Stop
    Info "Defender exclusion added: $SCRIPT_DIR"
    Info "Note: This exclusion is permanent so i2pd.exe won't be deleted."
} catch {
    Warn "Could not add Defender exclusion automatically."
    Warn "Please run this script as Administrator, OR add the exclusion manually:"
    Warn "  Windows Security -> Virus & threat protection -> Manage settings"
    Warn "  -> Add or remove exclusions -> Add folder: $SCRIPT_DIR"
    Write-Host ""
    $continue = Read-Host "[build] Continue anyway? (y/n)"
    if ($continue -ne "y") { exit 1 }
}

# --- Install Node.js if missing ---
Info "Checking Node.js..."
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Info "Node.js not found. Installing via winget..."
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        Abort "winget not found. Please install Node.js manually from https://nodejs.org (LTS) and re-run this script."
    }
    winget install --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements -e
    Refresh-Path
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        Abort "Node.js installation failed. Please install manually from https://nodejs.org and re-run."
    }
    Info "Node.js installed successfully."
}
Info "Node.js $(node --version) ready."

# --- Download i2pd.exe if missing ---
Info "Checking i2pd..."
if (Test-Path $I2PD_EXE) {
    Info "i2pd.exe already present."
} else {
    Info "Downloading i2pd $I2PD_VERSION Windows x64..."
    $url    = "https://github.com/PurpleI2P/i2pd/releases/download/$I2PD_VERSION/i2pd_${I2PD_VERSION}_win64_mingw.zip"
    $tmpZip = "$env:TEMP\i2pd_win64.zip"
    $tmpDir = "$env:TEMP\i2pd_win64_extracted"

    # Also exclude TEMP during extraction
    try {
        Add-MpPreference -ExclusionPath $env:TEMP -ErrorAction Stop
    } catch { }

    try {
        Invoke-WebRequest -Uri $url -OutFile $tmpZip -UseBasicParsing
        if (Test-Path $tmpDir) { Remove-Item $tmpDir -Recurse -Force }
        Expand-Archive -Path $tmpZip -DestinationPath $tmpDir

        $destDir = Split-Path $I2PD_EXE
        if (-not (Test-Path $destDir)) { New-Item -ItemType Directory -Path $destDir | Out-Null }
        Copy-Item "$tmpDir\i2pd.exe" $I2PD_EXE
        Info "i2pd.exe installed."
    } finally {
        try { Remove-MpPreference -ExclusionPath $env:TEMP -ErrorAction SilentlyContinue } catch { }
    }
}

# --- Check certificates ---
Info "Checking i2pd certificates..."
$certsDir = "$ELECTRON_DIR\resources\i2pd\certificates"
if (Test-Path $certsDir) {
    $certCount = (Get-ChildItem $certsDir -Recurse -Filter "*.crt").Count
    Info "Certificates present ($certCount files)."
} else {
    Abort "Certificates missing at $certsDir - make sure you cloned the full repo."
}

# --- Build web app ---
Info "Installing app dependencies..."
Set-Location $APP_DIR
npm install --silent
if ($LASTEXITCODE -ne 0) { Abort "npm install failed in app/" }

Info "Building web app..."
npm run build
if ($LASTEXITCODE -ne 0) { Abort "npm run build failed in app/" }
Info "Web app built -> app\dist\"

# --- Build Electron ---
Info "Installing Electron dependencies..."
Set-Location $ELECTRON_DIR
npm install --silent
if ($LASTEXITCODE -ne 0) { Abort "npm install failed in electron/" }

Info "Compiling TypeScript..."
npm run build
if ($LASTEXITCODE -ne 0) { Abort "TypeScript compilation failed" }

# --- Package ---
Info "Packaging Windows installer (NSIS)..."
& ".\node_modules\.bin\electron-builder.cmd" --win nsis --x64
if ($LASTEXITCODE -ne 0) { Abort "electron-builder failed" }

# --- Done ---
Write-Host ""
Info "Build complete! Output:"
Get-ChildItem "$ELECTRON_DIR\release\" -Filter "*.exe" | ForEach-Object {
    Write-Host "  -> $($_.FullName) ($([math]::Round($_.Length/1MB, 1)) MB)" -ForegroundColor Cyan
}
Write-Host ""
Info "Reminder: Defender exclusion for $SCRIPT_DIR is active."
Info "i2pd.exe is a legitimate privacy tool (https://i2pd.website)."
Write-Host ""
