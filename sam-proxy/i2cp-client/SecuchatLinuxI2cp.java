/**
 * SecuChat Linux Node via Java-I2P I2CP (port 7654).
 *
 * Transparenter I2CP-Layer für manuelle Tests — KEIN PGP-Decrypt eingebaut:
 *  - SESSION CREATE via I2CP → LeaseSet automatisch published
 *  - outbound (optional, mit b32-Argument): connect → stdin → wire
 *  - inbound: serverSocket.accept() in eigenem Thread → print
 *
 * Für PGP-verschlüsselte Chat-Nachrichten das Skript
 *   sam-proxy/linux-headless.mjs (Node, SAM-Weg)
 * verwenden — das hier ist nur eine Dünn-Schicht zur Verifikation, dass
 * die I2CP-Session steht und der Tunnel-Roundtrip funktioniert.
 *
 * Build + Run:
 *   ./build.sh
 *   ./run.sh                    # nur inbound-Listener
 *   ./run.sh <target-b32>       # zusätzlich outbound-Thread
 *
 * Voraussetzungen:
 *   - Java-I2P-Router läuft (ps aux | grep RouterLaunch)
 *   - ~/.secuchat-linux/destination.priv vorhanden (kommt aus der App per /export-contact)
 */
import net.i2p.client.I2PSession;
import net.i2p.client.streaming.I2PServerSocket;
import net.i2p.client.streaming.I2PSocket;
import net.i2p.client.streaming.I2PSocketManager;
import net.i2p.client.streaming.I2PSocketManagerFactory;
import net.i2p.data.Destination;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.Properties;
import java.util.concurrent.*;

public class SecuchatLinuxI2cp {
    private static final String I2CP_HOST = "127.0.0.1";
    private static final int    I2CP_PORT = 7654;
    private static final String HOME      = System.getProperty("user.home") + "/.secuchat-linux";

    public static void main(String[] args) throws Exception {
        byte[] privKey = Files.readAllBytes(Paths.get(HOME, "destination.priv"));
        Properties opts = new Properties();
        opts.setProperty("i2cp.tcp.host", I2CP_HOST);
        opts.setProperty("i2cp.tcp.port", String.valueOf(I2CP_PORT));
        opts.setProperty("i2cp.destination.sigType", "EdDSA_SHA512_Ed25519");
        opts.setProperty("inbound.length", "2");
        opts.setProperty("outbound.length", "2");
        opts.setProperty("inbound.nickname", "secuchat-linux");
        opts.setProperty("i2cp.leaseSetEncType", "4,0");
        opts.setProperty("i2cp.reduceOnIdle", "true");

        System.out.println("[lhc-i2cp] Connecting to I2CP " + I2CP_HOST + ":" + I2CP_PORT);
        final I2PSocketManager mgr = I2PSocketManagerFactory.createDisconnectedManager(
            new ByteArrayInputStream(privKey), I2CP_HOST, I2CP_PORT, opts);
        final I2PSession session = mgr.getSession();
        session.connect();
        final Destination me = session.getMyDestination();
        final String myB32 = me.toBase32();
        System.out.println("[lhc-i2cp] Connected. b32=" + myB32);

        // OUTBOUND: connect to b32 from args
        if (args.length >= 1) {
            final String targetB32 = args[0];
            new Thread(() -> {
                try {
                    System.out.println("[lhc-i2cp] Looking up " + targetB32.substring(0, 16) + "...");
                    Destination peer = session.lookupDest(targetB32, 30_000);
                    if (peer == null) {
                        System.out.println("[lhc-i2cp] LeaseSet not found, aborting outbound");
                        return;
                    }
                    I2PSocket sock = mgr.connect(peer);
                    System.out.println("[lhc-i2cp] OUTBOUND CONNECTED to " + targetB32.substring(0, 16));
                    OutputStream out = sock.getOutputStream();
                    BufferedReader br = new BufferedReader(new InputStreamReader(System.in));
                    String line;
                    while ((line = br.readLine()) != null) {
                        out.write((line + "\n").getBytes(StandardCharsets.UTF_8));
                        out.flush();
                        System.out.println("[lhc-i2cp] sent (" + line.length() + ")");
                    }
                    sock.close();
                } catch (Exception e) {
                    System.out.println("[lhc-i2cp] outbound error: " + e.getMessage());
                }
            }, "outbound").start();
        }

        // INBOUND: accept in dedicated thread
        final I2PServerSocket server = mgr.getServerSocket();
        new Thread(() -> {
            while (true) {
                try {
                    final I2PSocket sock = server.accept();
                    System.out.println("[lhc-i2cp] INCOMING from " + sock.getPeerDestination().toBase32().substring(0, 16));
                    new Thread(() -> {
                        try {
                            BufferedReader rdr = new BufferedReader(new InputStreamReader(sock.getInputStream(), StandardCharsets.UTF_8));
                            String line;
                            while ((line = rdr.readLine()) != null) {
                                System.out.println("[lhc-i2cp] RX (" + line.length() + "): " + line.substring(0, Math.min(120, line.length())));
                            }
                        } catch (IOException e) {
                            System.out.println("[lhc-i2cp] inbound read end: " + e.getMessage());
                        }
                    }, "inbound-conn").start();
                } catch (Exception e) {
                    System.out.println("[lhc-i2cp] accept error: " + e.getMessage());
                    try { Thread.sleep(1000); } catch (InterruptedException ie) { return; }
                }
            }
        }, "accept").start();

        // Keep alive
        Thread.sleep(Long.MAX_VALUE);
    }
}
