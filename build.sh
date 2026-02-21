#!/usr/bin/env bash
# SecuChat Build Script
# Downloads all required binaries and builds the Electron desktop app.
#
# Usage:
#   ./build.sh           # Build for current platform
#   ./build.sh --win     # Build Windows installer (requires wine on Linux)
#   ./build.sh --linux   # Build Linux AppImage
#   ./build.sh --all     # Build both

set -e

I2PD_VERSION="2.59.0"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ELECTRON_DIR="$SCRIPT_DIR/electron"
APP_DIR="$SCRIPT_DIR/app"
RESOURCES_DIR="$ELECTRON_DIR/resources/i2pd"

# ─── Colors ───────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()    { echo -e "${GREEN}[build]${NC} $*"; }
warn()    { echo -e "${YELLOW}[build]${NC} $*"; }
error()   { echo -e "${RED}[build]${NC} $*"; exit 1; }

# ─── Args ─────────────────────────────────────────────────────────────────────
BUILD_WIN=false
BUILD_LINUX=false

if [[ $# -eq 0 ]]; then
  # Default: build for current platform
  if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "win32" ]]; then
    BUILD_WIN=true
  else
    BUILD_LINUX=true
  fi
else
  for arg in "$@"; do
    case $arg in
      --win)   BUILD_WIN=true ;;
      --linux) BUILD_LINUX=true ;;
      --all)   BUILD_WIN=true; BUILD_LINUX=true ;;
      *) error "Unknown argument: $arg" ;;
    esac
  done
fi

# ─── Detect architecture ──────────────────────────────────────────────────────
ARCH=$(uname -m)
case "$ARCH" in
  x86_64)  LINUX_ARCH="amd64"; LINUX_EB_ARCH="x64" ;;
  aarch64) LINUX_ARCH="arm64"; LINUX_EB_ARCH="arm64" ;;
  *) error "Unsupported architecture: $ARCH" ;;
esac

# ─── Dependencies check ───────────────────────────────────────────────────────
info "Checking dependencies..."
command -v node >/dev/null || error "node not found. Install Node.js 20+"
command -v npm  >/dev/null || error "npm not found."

if [[ "$BUILD_WIN" == true ]] && ! command -v wine >/dev/null 2>&1; then
  warn "wine not found — needed for Windows NSIS installer."
  warn "Install with: sudo apt-get install wine"
  error "Aborting. Install wine and retry."
fi

# ─── Download i2pd Linux binary ───────────────────────────────────────────────
download_i2pd_linux() {
  local dest="$RESOURCES_DIR/linux/i2pd"
  if [[ -f "$dest" ]]; then
    info "i2pd Linux binary already present, skipping download."
    return
  fi

  info "Downloading i2pd $I2PD_VERSION Linux ($LINUX_ARCH)..."
  local url="https://github.com/PurpleI2P/i2pd/releases/download/${I2PD_VERSION}/i2pd_${I2PD_VERSION}-1bookworm1_${LINUX_ARCH}.deb"
  local tmp_deb="/tmp/i2pd_linux.deb"
  local tmp_dir="/tmp/i2pd_linux_extracted"

  curl -fL --progress-bar -o "$tmp_deb" "$url"
  rm -rf "$tmp_dir" && mkdir "$tmp_dir"
  dpkg-deb -x "$tmp_deb" "$tmp_dir"

  mkdir -p "$RESOURCES_DIR/linux"
  cp "$tmp_dir/usr/bin/i2pd" "$dest"
  chmod +x "$dest"
  info "i2pd Linux binary installed."
}

# ─── Download i2pd Windows binary ─────────────────────────────────────────────
download_i2pd_win() {
  local dest="$RESOURCES_DIR/win/i2pd.exe"
  if [[ -f "$dest" ]]; then
    info "i2pd Windows binary already present, skipping download."
    return
  fi

  info "Downloading i2pd $I2PD_VERSION Windows x64..."
  local url="https://github.com/PurpleI2P/i2pd/releases/download/${I2PD_VERSION}/i2pd_${I2PD_VERSION}_win64_mingw.zip"
  local tmp_zip="/tmp/i2pd_win64.zip"
  local tmp_dir="/tmp/i2pd_win64_extracted"

  curl -fL --progress-bar -o "$tmp_zip" "$url"
  rm -rf "$tmp_dir" && mkdir "$tmp_dir"
  unzip -q "$tmp_zip" -d "$tmp_dir"

  mkdir -p "$RESOURCES_DIR/win"
  cp "$tmp_dir/i2pd.exe" "$dest"
  info "i2pd Windows binary installed."
}

# ─── Copy certificates ────────────────────────────────────────────────────────
download_certificates() {
  local dest="$RESOURCES_DIR/certificates"
  if [[ -d "$dest" && "$(ls -A "$dest")" ]]; then
    info "i2pd certificates already present, skipping."
    return
  fi

  info "Downloading i2pd certificates..."
  local url="https://github.com/PurpleI2P/i2pd/releases/download/${I2PD_VERSION}/i2pd_${I2PD_VERSION}-1bookworm1_amd64.deb"
  local tmp_deb="/tmp/i2pd_certs.deb"
  local tmp_dir="/tmp/i2pd_certs_extracted"

  curl -fL --progress-bar -o "$tmp_deb" "$url"
  rm -rf "$tmp_dir" && mkdir "$tmp_dir"
  dpkg-deb -x "$tmp_deb" "$tmp_dir"

  mkdir -p "$dest"
  cp -r "$tmp_dir/usr/share/i2pd/certificates/." "$dest/"
  info "Certificates installed ($(find "$dest" -name "*.crt" | wc -l) files)."
}

# ─── Build web app ────────────────────────────────────────────────────────────
build_app() {
  info "Installing app dependencies..."
  npm --prefix "$APP_DIR" install --silent

  info "Building web app..."
  npm --prefix "$APP_DIR" run build
  info "Web app built → app/dist/"
}

# ─── Build Electron ───────────────────────────────────────────────────────────
build_electron() {
  info "Installing Electron dependencies..."
  npm --prefix "$ELECTRON_DIR" install --silent

  info "Compiling TypeScript..."
  npm --prefix "$ELECTRON_DIR" run build
}

# ─── Package ──────────────────────────────────────────────────────────────────
package_linux() {
  info "Packaging Linux AppImage (arch: $LINUX_EB_ARCH)..."
  # Temporarily set arch in builder config
  cd "$ELECTRON_DIR"
  node_modules/.bin/electron-builder --linux AppImage --$LINUX_EB_ARCH
  info "Done: electron/release/SecuChat-*.AppImage"
}

package_win() {
  info "Packaging Windows installer..."
  cd "$ELECTRON_DIR"
  node_modules/.bin/electron-builder --win nsis --x64
  info "Done: electron/release/SecuChat-*-Setup.exe"
}

# ─── Main ─────────────────────────────────────────────────────────────────────
echo ""
echo "  ╔═══════════════════════════════╗"
echo "  ║   SecuChat Build Script       ║"
echo "  ║   i2pd $I2PD_VERSION                 ║"
echo "  ╚═══════════════════════════════╝"
echo ""

# Download binaries as needed
[[ "$BUILD_LINUX" == true ]] && download_i2pd_linux
[[ "$BUILD_WIN"   == true ]] && download_i2pd_win
download_certificates

# Build
build_app
build_electron

# Package
[[ "$BUILD_LINUX" == true ]] && package_linux
[[ "$BUILD_WIN"   == true ]] && package_win

echo ""
info "Build complete! Output in electron/release/"
ls -lh "$ELECTRON_DIR/release/"*.{exe,AppImage} 2>/dev/null || true
