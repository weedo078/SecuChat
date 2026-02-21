# SecuChat Windows Build Script
# Requires: Node.js 20+, Git
# Usage:
#   .\build.ps1     # Build Windows installer

param([switch]$All)

$ErrorActionPreference = "Stop"
$I2PD_VERSION = "2.59.0"
$SCRIPT_DIR   = $PSScriptRoot
$ELECTRON_DIR = "$SCRIPT_DIR\electron"
$APP_DIR      = "$SCRIPT_DIR\app"
$I2PD_EXE     = "$ELECTRON_DIR\resources\i2pd\win\i2pd.exe"

function Info  { param($msg) Write-Host "[build] $msg" -ForegroundColor Green }
function Abort { param($msg) Write-Host "[build] ERROR: $msg" -ForegroundColor Red; exit 1 }

# --- Check Node.js ---
Info "Checking dependencies..."
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Abort "Node.js not found. Install from https://nodejs.org"
}
Info "Node.js $(node --version) found."

# --- Download i2pd.exe ---
if (Test-Path $I2PD_EXE) {
    Info "i2pd.exe already present, skipping download."
} else {
    Info "Downloading i2pd $I2PD_VERSION Windows x64..."
    $url    = "https://github.com/PurpleI2P/i2pd/releases/download/$I2PD_VERSION/i2pd_${I2PD_VERSION}_win64_mingw.zip"
    $tmpZip = "$env:TEMP\i2pd_win64.zip"
    $tmpDir = "$env:TEMP\i2pd_win64_extracted"

    Invoke-WebRequest -Uri $url -OutFile $tmpZip -UseBasicParsing
    if (Test-Path $tmpDir) { Remove-Item $tmpDir -Recurse -Force }
    Expand-Archive -Path $tmpZip -DestinationPath $tmpDir

    $destDir = Split-Path $I2PD_EXE
    if (-not (Test-Path $destDir)) { New-Item -ItemType Directory -Path $destDir | Out-Null }
    Copy-Item "$tmpDir\i2pd.exe" $I2PD_EXE
    Info "i2pd.exe installed."
}

# --- Check certificates ---
$certsDir = "$ELECTRON_DIR\resources\i2pd\certificates"
if (Test-Path $certsDir) {
    $certCount = (Get-ChildItem $certsDir -Recurse -Filter "*.crt").Count
    Info "i2pd certificates present ($certCount files)."
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
