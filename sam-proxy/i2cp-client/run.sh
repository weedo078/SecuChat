#!/bin/bash
# Run-Script für den Java-i2cp-Client.
# Startet SecuChatLinuxI2cp. Optional mit Ziel-b32 als erstem Argument für Outbound.
#
# Voraussetzung: Java-I2P-Router läuft (ps aux | grep RouterLaunch)
# Bei firewalled Router (Caps=LUD) wird Inbound nicht funktionieren.
set -e
cd "$(dirname "$0")"
CP=".:/usr/share/i2p/lib/*"
exec java -cp "$CP" SecuchatLinuxI2cp "$@"
