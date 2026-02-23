#!/bin/bash
#
# Post-Removal Script für SecuChat DEB-Paket
#

set -e

echo "Cleaning up SecuChat..."

# Entferne Desktop-Eintrag
if command -v update-desktop-database &> /dev/null; then
    update-desktop-database /usr/share/applications 2>/dev/null || true
fi

# Hinweis für Benutzer
echo ""
echo "SecuChat has been removed."
echo ""
echo "Note: User data in ~/.secuchat/ was NOT removed."
echo "To remove user data, run: rm -rf ~/.secuchat/"
echo ""
