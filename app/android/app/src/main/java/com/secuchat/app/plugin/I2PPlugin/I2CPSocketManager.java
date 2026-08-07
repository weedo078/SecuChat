package com.secuchat.app.plugin.I2PPlugin;

import net.i2p.client.I2PSession;
import net.i2p.client.streaming.I2PServerSocket;
import net.i2p.client.streaming.I2PSocket;
import net.i2p.client.streaming.I2PSocketManager;
import net.i2p.client.streaming.I2PSocketManagerFactory;
import net.i2p.crypto.SigType;
import net.i2p.data.Destination;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.util.Map;
import java.util.Properties;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

import android.util.Log;

public class I2CPSocketManager {
    private static final String TAG = "SecuChat:I2CP";
    private static volatile I2CPSocketManager instance;

    private final I2PSocketManager socketManager;
    private final I2PSession session;
    private final Destination destination;
    private final I2PServerSocket serverSocket;
    private final Map<Integer, I2PSocketHandle> outgoingStreams = new ConcurrentHashMap<>();
    private final Map<Integer, I2PSocketHandle> incomingStreams = new ConcurrentHashMap<>();
    private final AtomicInteger streamIdCounter = new AtomicInteger(1);
    private final ExecutorService executor = Executors.newCachedThreadPool();
    private volatile int acceptStreamId = -1;
    private volatile boolean disconnected = false;

    private I2CPSocketManager(String host, int port, byte[] privateKey, String nickname) throws IOException {
        // 1. Properties für I2CP-Verbindung
        Properties opts = new Properties();
        opts.setProperty("i2cp.tcp.host", host);
        opts.setProperty("i2cp.tcp.port", String.valueOf(port));
        opts.setProperty("i2cp.destination.sigType", "EdDSA_SHA512_Ed25519");
        opts.setProperty("inbound.length", "2");
        opts.setProperty("outbound.length", "2");
        opts.setProperty("inbound.nickname", nickname);
        opts.setProperty("i2cp.leaseSetEncType", "4,0");
        opts.setProperty("i2cp.reduceOnIdle", "true");

        // 2. NON-BLOCKING Factory (nicht createManager!)
        try {
            socketManager = I2PSocketManagerFactory.createDisconnectedManager(
                new ByteArrayInputStream(privateKey), host, port, opts);
        } catch (net.i2p.client.I2PSessionException e) {
            throw new IOException("createDisconnectedManager failed: " + e.getMessage(), e);
        }

        // 3. Session explizit verbinden
        session = socketManager.getSession();
        try {
            session.connect();  // blockt bis Tunnel bereit + LeaseSet automatisch published
        } catch (net.i2p.client.I2PSessionException e) {
            throw new IOException("I2CP session.connect failed: " + e.getMessage(), e);
        }

        destination = session.getMyDestination();
        serverSocket = socketManager.getServerSocket();
        Log.i(TAG, "I2CP session connected. b32=" + destination.toBase32().substring(0, 20) + "...");
    }

    public static synchronized I2CPSocketManager getOrCreate(String host, int port, byte[] privateKey, String nickname) throws IOException {
        if (instance == null) {
            instance = new I2CPSocketManager(host, port, privateKey, nickname);
        }
        return instance;
    }

    /**
     * Package-private input validator extracted from connectTo() so it can be
     * exercised by unit tests without a live I2P router. Throws IOException for
     * null or empty input — connectTo() would otherwise need a constructed
     * manager (and thus a router) just to assert this contract.
     */
    static void requireDestination(String destinationB32) throws IOException {
        if (destinationB32 == null || destinationB32.isEmpty()) {
            throw new IOException("destination B32 required");
        }
    }

    public static synchronized I2CPSocketManager getInstance() {
        return instance;
    }

    public synchronized int connectTo(String destinationB32) throws IOException {
        requireDestination(destinationB32);
        Destination peer;
        try {
            peer = session.lookupDest(destinationB32, 15_000);
        } catch (net.i2p.client.I2PSessionException e) {
            throw new IOException("lookupDest failed for " + destinationB32.substring(0, Math.min(20, destinationB32.length())) + "...: " + e.getMessage(), e);
        }
        if (peer == null) {
            throw new IOException("LeaseSet not found for " + destinationB32.substring(0, Math.min(20, destinationB32.length())) + "...");
        }
        I2PSocket sock;
        try {
            sock = socketManager.connect(peer);  // blockt bis Tunnel bereit
        } catch (net.i2p.I2PException e) {
            throw new IOException("connect failed: " + e.getMessage(), e);
        }
        int streamId = streamIdCounter.getAndIncrement();
        I2PSocketHandle handle = new I2PSocketHandle(streamId, sock, null, peer.toBase32(), executor);
        outgoingStreams.put(streamId, handle);
        return streamId;
    }

    public int acceptIncoming() throws IOException {
        if (acceptStreamId == -1) {
            // Accept-Loop noch nicht gestartet
            acceptStreamId = streamIdCounter.getAndIncrement();
            // ServerSocket.accept() wird in einem dedizierten Thread aufgerufen
            // (Stream-Ergebnis wird in incomingStreams gemappt)
        }
        // Blockt bis ein neuer Peer verbindet. Achtung: ServerSocket.accept() ist synchron!
        // Vereinfachung: in PR 3 (I2PPlugin) wird dieser Pfad in eigenem Thread laufen.
        I2PSocket sock;
        try {
            sock = serverSocket.accept();
        } catch (net.i2p.I2PException e) {
            throw new IOException("accept failed: " + e.getMessage(), e);
        }
        int streamId = streamIdCounter.getAndIncrement();
        String peerB32 = sock.getPeerDestination().toBase32();
        I2PSocketHandle handle = new I2PSocketHandle(streamId, sock, null, peerB32, executor);
        incomingStreams.put(streamId, handle);
        return streamId;
    }

    public synchronized void send(int streamId, byte[] data) throws IOException {
        I2PSocketHandle handle = outgoingStreams.get(streamId);
        if (handle == null) handle = incomingStreams.get(streamId);
        if (handle == null) throw new IOException("stream " + streamId + " not found");
        OutputStream out = handle.getSocket().getOutputStream();
        out.write(data);
        out.flush();
    }

    public synchronized void close(int streamId, String reason) throws IOException {
        I2PSocketHandle handle = outgoingStreams.remove(streamId);
        if (handle == null) handle = incomingStreams.remove(streamId);
        if (handle == null) {
            Log.w(TAG, "close(" + streamId + "): stream not found");
            return;
        }
        handle.close(reason);
    }

    public synchronized void disconnect() {
        // Mark disconnected first so acceptIncoming()'s post-accept path (and any
        // caller polling isConnected()) sees the closed state immediately.
        disconnected = true;
        outgoingStreams.forEach((id, h) -> h.close("disconnect"));
        outgoingStreams.clear();
        incomingStreams.forEach((id, h) -> h.close("disconnect"));
        incomingStreams.clear();
        if (acceptStreamId != -1) {
            try { serverSocket.close(); } catch (Exception ignored) {}
            acceptStreamId = -1;
        }
        try { socketManager.destroySocketManager(); } catch (Exception ignored) {}
        // Stop the cached thread pool. Daemon read-threads finish naturally when
        // their sockets close, but the ExecutorService itself must be shut down
        // to allow JVM graceful exit. shutdownNow() interrupts threads blocked in
        // socket I/O (the executor owns read threads since I3).
        executor.shutdownNow();
        instance = null;
    }

    public String getB32Address() {
        return destination != null ? destination.toBase32() : null;
    }

    public boolean isConnected() {
        return !disconnected && socketManager != null && session != null;
    }

    public I2PSocketHandle getStream(int streamId) {
        I2PSocketHandle h = outgoingStreams.get(streamId);
        if (h == null) h = incomingStreams.get(streamId);
        return h;
    }

    public ExecutorService getExecutor() {
        return executor;
    }
}
