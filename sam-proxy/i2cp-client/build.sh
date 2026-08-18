#!/bin/bash
# Build-Script für den Java-i2cp-Client.
# Compiliert SecuchatLinuxI2cp.java gegen die Java-I2P-Bibliotheken.
set -e
cd "$(dirname "$0")"
javac -cp "/usr/share/i2p/lib/*" SecuchatLinuxI2cp.java
echo "Build OK: $(ls -la SecuchatLinuxI2cp.class)"
