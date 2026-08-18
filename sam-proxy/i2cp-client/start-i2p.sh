#!/bin/bash
# Start Java-I2P Router wrapper-less
set -e
CP=""
for jar in /usr/share/i2p/lib/*.jar; do
  CP="$CP:$jar"
done
CP="${CP#:}"
exec /usr/bin/java \
  -Djava.net.preferIPv4Stack=false \
  -Djava.library.path=/usr/share/i2p:/usr/share/i2p/lib \
  -Di2p.dir.base=/usr/share/i2p \
  -Xmx512m \
  -cp "$CP" \
  net.i2p.router.RouterLaunch
