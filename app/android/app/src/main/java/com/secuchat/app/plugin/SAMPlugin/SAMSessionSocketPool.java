package com.secuchat.app.plugin.SAMPlugin;

import android.util.Log;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.io.PrintWriter;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Centralized SAM session-bound socket factory.
 *
 * i2pd binds STREAM CONNECT/ACCEPT authorization to the SAM socket that
 * received SESSION STATUS RESULT=OK. Fresh sockets with the same session ID
 * get RESULT=DUPLICATED_ID, and i2pd accepts STREAM commands on them too
 * (the socket rebinds), but a previously HELLO+SESSION CREATE-ed socket is
 * what we need to issue the STREAM command on without flakiness.
 *
 * Each call to {@link #obtainBoundSocket} opens a fresh TCP connection to the
 * SAM bridge, performs HELLO + SESSION CREATE on it, and returns the already
 * bound socket plus reader/writer. The caller then constructs a SAMStream on
 * top of these via the 5-arg constructor and issues STREAM CONNECT/ACCEPT
 * directly (no further SESSION CREATE needed).
 *
 * Locking is per-sessionID (an Object stored in a ConcurrentHashMap). This
 * serializes the HELLO + SESSION CREATE sequence for a given session — enough
 * since i2pd already serializes internally per session ID. Two threads on
 * different sessions do not block each other.
 *
 * Result codes:
 *   RESULT=OK            — fresh session, normal path
 *   RESULT=DUPLICATED_ID — session already registered, we rebind on this socket
 *   any other            — IOException
 */
public class SAMSessionSocketPool {

    private static final String TAG = "SecuChat:SAM";

    private static SAMSessionSocketPool instance;

    private final ConcurrentHashMap<String, Object> sessionLocks = new ConcurrentHashMap<>();

    public static synchronized SAMSessionSocketPool getInstance() {
        if (instance == null) {
            instance = new SAMSessionSocketPool();
        }
        return instance;
    }

    /**
     * Result of {@link #obtainBoundSocket}: a SAM-ready socket plus its reader
     * and writer, all sharing the same TCP connection. The caller owns the
     * socket and is responsible for closing it.
     */
    public static class BoundSocketResult {
        public final Socket socket;
        public final BufferedReader reader;
        public final PrintWriter writer;

        public BoundSocketResult(Socket socket, BufferedReader reader, PrintWriter writer) {
            this.socket = socket;
            this.reader = reader;
            this.writer = writer;
        }
    }

    /**
     * Open a TCP connection to the SAM bridge, perform HELLO + SESSION CREATE
     * (accepting both RESULT=OK and RESULT=DUPLICATED_ID as success), and
     * return the bound socket.
     *
     * @param sessionId       SAM session nickname (e.g. "sc-1785928323865")
     * @param ownDestination  908-byte base64 private destination, or null
     *                        for TRANSIENT (last-resort fallback)
     * @param samHost         SAM bridge host (e.g. "192.168.179.62")
     * @param samPort         SAM bridge port (7656 for native)
     * @param readTimeoutMs   Read timeout in ms; 0 = use 60s default
     */
    public BoundSocketResult obtainBoundSocket(
            String sessionId,
            String ownDestination,
            String samHost,
            int samPort,
            int readTimeoutMs) throws IOException {

        if (sessionId == null || sessionId.isEmpty()) {
            throw new IOException("sessionId required");
        }
        if (samHost == null || samPort <= 0) {
            throw new IOException("invalid SAM host/port");
        }

        Object lock = sessionLocks.computeIfAbsent(sessionId, k -> new Object());
        synchronized (lock) {
            int effectiveTimeout = readTimeoutMs > 0 ? readTimeoutMs : 60000;
            Socket socket = new Socket();
            socket.connect(new InetSocketAddress(samHost, samPort), 15000);
            socket.setKeepAlive(true);
            socket.setTcpNoDelay(true);
            socket.setSoTimeout(effectiveTimeout);

            try {
                BufferedReader reader = new BufferedReader(
                        new InputStreamReader(socket.getInputStream()));
                PrintWriter writer = new PrintWriter(
                        new OutputStreamWriter(socket.getOutputStream()), true);

                // HELLO
                writer.print(SAMProtocolHandler.buildHelloCommand());
                writer.flush();
                String helloResp = reader.readLine();
                Log.d(TAG, "Pool HELLO response for " + sessionId + ": " + helloResp);
                if (helloResp == null || !SAMProtocolHandler.parseHelloResponse(helloResp)) {
                    throw new IOException("SAM HELLO failed: " + helloResp);
                }

                // SESSION CREATE — accept both OK and DUPLICATED_ID
                String cmd;
                if (ownDestination != null && !ownDestination.isEmpty()) {
                    cmd = SAMProtocolHandler.buildSessionCreate(sessionId, ownDestination);
                } else {
                    Log.w(TAG, "Pool obtainBoundSocket without ownDestination — using TRANSIENT");
                    cmd = "SESSION CREATE STYLE=STREAM ID=" + sessionId + "\n";
                }
                writer.print(cmd);
                writer.flush();

                String sessionResp = reader.readLine();
                Log.d(TAG, "Pool SESSION CREATE response for " + sessionId + ": " + sessionResp);
                if (sessionResp == null) {
                    throw new IOException("No response to SESSION CREATE in pool");
                }
                if (!sessionResp.contains("RESULT=OK")
                        && !sessionResp.contains("RESULT=DUPLICATED_ID")) {
                    throw new IOException("Pool SESSION CREATE failed: " + sessionResp);
                }

                return new BoundSocketResult(socket, reader, writer);
            } catch (IOException e) {
                // On any failure during HELLO/SESSION CREATE, close the
                // partially-bound socket so we don't leak an FD.
                try { socket.close(); } catch (Exception ignored) { }
                throw e;
            }
        }
    }
}