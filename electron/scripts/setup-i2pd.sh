#!/bin/bash
# ============================================================================
# I2PD Setup Script fuer Linux
# ============================================================================
# Dieses Skript richtet i2pd fuer SecuChat auf Linux ein
# ============================================================================

set -e

# ============================================================================
# KONFIGURATION
# ============================================================================

I2PD_VERSION="2.50.1"
INSTALL_DIR="${HOME}/.local/share/secuchat/i2pd"
LOG_DIR="${HOME}/.local/share/secuchat/logs"
I2PD_URL="https://github.com/PurpleI2P/i2pd/releases/download/${I2PD_VERSION}/i2pd_${I2PD_VERSION}-1_amd64.deb"

# Farben fuer Output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# ============================================================================
# FUNKTIONEN
# ============================================================================

log_info() {
    echo -e "${CYAN}[I2P-Setup]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[I2P-Setup]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[I2P-Setup]${NC} $1"
}

log_error() {
    echo -e "${RED}[I2P-Setup]${NC} $1"
}

detect_distro() {
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        echo "$ID"
    else
        echo "unknown"
    fi
}

detect_arch() {
    arch=$(uname -m)
    case $arch in
        x86_64)
            echo "amd64"
            ;;
        aarch64|arm64)
            echo "arm64"
            ;;
        armv7l)
            echo "armhf"
            ;;
        *)
            echo "$arch"
            ;;
    esac
}

check_dependencies() {
    log_info "Checking dependencies..."
    
    local missing_deps=()
    
    # Pruefe erforderliche Befehle
    for cmd in curl wget tar; do
        if ! command -v "$cmd" &> /dev/null; then
            missing_deps+=("$cmd")
        fi
    done
    
    if [ ${#missing_deps[@]} -ne 0 ]; then
        log_warning "Missing dependencies: ${missing_deps[*]}"
        log_info "Attempting to install..."
        
        local distro=$(detect_distro)
        case $distro in
            ubuntu|debian)
                sudo apt-get update
                sudo apt-get install -y curl wget tar
                ;;
            fedora|rhel|centos)
                sudo dnf install -y curl wget tar
                ;;
            arch|manjaro)
                sudo pacman -S --noconfirm curl wget tar
                ;;
            *)
                log_error "Please install manually: ${missing_deps[*]}"
                exit 1
                ;;
        esac
    fi
    
    log_success "Dependencies OK"
}

download_i2pd() {
    log_info "Downloading i2pd ${I2PD_VERSION}..."
    
    local arch=$(detect_arch)
    local temp_dir=$(mktemp -d)
    
    case $arch in
        amd64)
            local url="https://github.com/PurpleI2P/i2pd/releases/download/${I2PD_VERSION}/i2pd-${I2PD_VERSION}-linux-x86_64.tar.gz"
            ;;
        arm64)
            local url="https://github.com/PurpleI2P/i2pd/releases/download/${I2PD_VERSION}/i2pd-${I2PD_VERSION}-linux-aarch64.tar.gz"
            ;;
        armhf)
            local url="https://github.com/PurpleI2P/i2pd/releases/download/${I2PD_VERSION}/i2pd-${I2PD_VERSION}-linux-armhf.tar.gz"
            ;;
        *)
            log_error "Unsupported architecture: $arch"
            exit 1
            ;;
    esac
    
    log_info "Downloading from: $url"
    
    if ! curl -L -o "$temp_dir/i2pd.tar.gz" "$url"; then
        log_error "Download failed"
        rm -rf "$temp_dir"
        exit 1
    fi
    
    log_success "Download completed"
    
    # Entpacke
    log_info "Extracting..."
    mkdir -p "$INSTALL_DIR"
    tar -xzf "$temp_dir/i2pd.tar.gz" -C "$temp_dir"
    
    # Finde und kopiere i2pd Binary
    local i2pd_binary=$(find "$temp_dir" -name "i2pd" -type f | head -1)
    if [ -n "$i2pd_binary" ]; then
        cp "$i2pd_binary" "$INSTALL_DIR/"
        chmod +x "$INSTALL_DIR/i2pd"
        log_success "i2pd binary installed"
    else
        log_error "i2pd binary not found in archive"
        rm -rf "$temp_dir"
        exit 1
    fi
    
    # Kopiere Zertifikate falls vorhanden
    local certs_dir=$(find "$temp_dir" -name "certificates" -type d | head -1)
    if [ -n "$certs_dir" ]; then
        cp -r "$certs_dir" "$INSTALL_DIR/"
        log_success "Certificates installed"
    fi
    
    # Bereinigung
    rm -rf "$temp_dir"
}

install_from_package_manager() {
    local distro=$(detect_distro)
    
    log_info "Attempting to install via package manager..."
    
    case $distro in
        ubuntu|debian)
            sudo apt-get update
            sudo apt-get install -y i2pd
            ;;
        fedora|rhel|centos)
            sudo dnf install -y i2pd
            ;;
        arch|manjaro)
            sudo pacman -S --noconfirm i2pd
            ;;
        alpine)
            sudo apk add i2pd
            ;;
        *)
            return 1
            ;;
    esac
    
    return 0
}

setup_directories() {
    log_info "Setting up directories..."
    
    mkdir -p "$INSTALL_DIR"
    mkdir -p "$LOG_DIR"
    mkdir -p "$INSTALL_DIR/certificates"
    
    log_success "Directories created"
}

verify_installation() {
    log_info "Verifying installation..."
    
    local i2pd_path="$INSTALL_DIR/i2pd"
    
    if [ ! -f "$i2pd_path" ]; then
        log_error "i2pd binary not found at: $i2pd_path"
        return 1
    fi
    
    if [ ! -x "$i2pd_path" ]; then
        log_warning "i2pd not executable, fixing permissions..."
        chmod +x "$i2pd_path"
    fi
    
    # Teste Version
    local version=$("$i2pd_path" --version 2>&1 | head -1)
    log_success "i2pd found: $version"
    
    # Pruefe Zertifikate
    local certs_dir="$INSTALL_DIR/certificates"
    if [ -d "$certs_dir" ]; then
        local cert_count=$(find "$certs_dir" -type f | wc -l)
        log_success "Found $cert_count certificate files"
    else
        log_warning "Certificates directory not found"
    fi
    
    return 0
}

check_port() {
    local port=${1:-7656}
    
    if command -v netstat &> /dev/null; then
        if netstat -tuln 2>/dev/null | grep -q ":$port "; then
            log_warning "Port $port is already in use"
            return 1
        fi
    elif command -v ss &> /dev/null; then
        if ss -tuln 2>/dev/null | grep -q ":$port "; then
            log_warning "Port $port is already in use"
            return 1
        fi
    fi
    
    log_success "Port $port is available"
    return 0
}

create_systemd_service() {
    if [ "$EUID" -eq 0 ]; then
        log_warning "Skipping systemd service creation (running as root)"
        return
    fi
    
    log_info "Creating systemd user service..."
    
    local service_dir="${HOME}/.config/systemd/user"
    mkdir -p "$service_dir"
    
    cat > "$service_dir/secuchat-i2pd.service" << EOF
[Unit]
Description=SecuChat I2P Daemon
After=network.target

[Service]
Type=simple
ExecStart=$INSTALL_DIR/i2pd --datadir=$INSTALL_DIR --sam.enabled=true --sam.port=7656 --http.enabled=true --http.port=7070
Restart=on-failure
RestartSec=10

[Install]
WantedBy=default.target
EOF
    
    log_success "Systemd service created"
    log_info "To enable: systemctl --user enable secuchat-i2pd"
    log_info "To start: systemctl --user start secuchat-i2pd"
}

print_usage() {
    echo ""
    log_info "Usage:"
    echo "  $0 [options]"
    echo ""
    echo "Options:"
    echo "  --install-dir DIR    Set installation directory (default: $INSTALL_DIR)"
    echo "  --download           Force download even if i2pd exists"
    echo "  --verify-only        Only verify existing installation"
    echo "  --create-service     Create systemd user service"
    echo "  --help               Show this help"
    echo ""
}

# ============================================================================
# HAUPTPROGRAMM
# ============================================================================

# Parse Argumente
DOWNLOAD=false
VERIFY_ONLY=false
CREATE_SERVICE=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --install-dir)
            INSTALL_DIR="$2"
            shift 2
            ;;
        --download)
            DOWNLOAD=true
            shift
            ;;
        --verify-only)
            VERIFY_ONLY=true
            shift
            ;;
        --create-service)
            CREATE_SERVICE=true
            shift
            ;;
        --help)
            print_usage
            exit 0
            ;;
        *)
            log_error "Unknown option: $1"
            print_usage
            exit 1
            ;;
    esac
done

# Header
echo ""
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  SecuChat I2P Setup for Linux${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Nur Verifizieren
if [ "$VERIFY_ONLY" = true ]; then
    verify_installation
    check_port 7656
    exit 0
fi

# Setup
setup_directories

# Pruefe ob i2pd bereits existiert
if [ -f "$INSTALL_DIR/i2pd" ] && [ "$DOWNLOAD" = false ]; then
    log_info "i2pd already installed"
else
    # Versuche Package Manager
    if ! install_from_package_manager; then
        log_info "Package manager install failed, downloading binary..."
        download_i2pd
    fi
fi

# Verifiziere
verify_installation
check_port 7656

# Erstelle Service falls gewuenscht
if [ "$CREATE_SERVICE" = true ]; then
    create_systemd_service
fi

# Fertig
echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Setup completed successfully!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
log_info "Installation directory: $INSTALL_DIR"
log_info "To start i2pd manually, run:"
echo "  $INSTALL_DIR/i2pd --sam.enabled=true --sam.port=7656"
echo ""
