#!/bin/bash
#
# Post-Installation Script für SecuChat DEB-Paket
#

set -e

echo "Setting up SecuChat..."

# Erstelle Benutzerverzeichnis für Konfiguration
if [ -d /home ]; then
    for userdir in /home/*; do
        if [ -d "$userdir" ]; then
            username=$(basename "$userdir")
            config_dir="$userdir/.secuchat"
            
            # Erstelle Config-Verzeichnis
            mkdir -p "$config_dir/i2pd"
            chown -R "$username:$username" "$config_dir" 2>/dev/null || true
        fi
    done
fi

# Setze Berechtigungen für i2pd Binary
I2PD_BINARY="/opt/SecuChat/resources/i2pd/linux/i2pd"
if [ -f "$I2PD_BINARY" ]; then
    chmod 755 "$I2PD_BINARY"
    echo "Set executable permissions for i2pd"
fi

# Aktualisiere Desktop-Datenbank
if command -v update-desktop-database &> /dev/null; then
    update-desktop-database /usr/share/applications
fi

# Aktualisiere MIME-Typen
if command -v update-mime-database &> /dev/null; then
    update-mime-database /usr/share/mime
fi

echo "SecuChat installation complete!"
echo "Run 'secuchat' or find it in your applications menu."
