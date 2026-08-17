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
            mkdir -p "$config_dir"
            chown -R "$username:$username" "$config_dir" 2>/dev/null || true
        fi
    done
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
