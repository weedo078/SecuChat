package com.secuchat.app.plugin.SAMPlugin;

import android.util.Log;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.io.PrintWriter;
import java.net.Socket;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * SAM Stream wrapper for managing a single I2P stream connection.
 *
 * Each SAM stream operates on a separate socket connection to the SAM bridge.
 * This class handles:
 * - Socket connection to SAM
 * - HELLO handshake
 * - STREAM CONNECT / ACCEPT operations
 * - Data read/write
 * - Connection state management
 */
public class SAMStream {

    private static final String TAG = "SecuChat:SAM";
    private static final AtomicInteger streamIdCounter = new AtomicInteger(0);

    // Stream states
    public enum State {
        DISCONNECTED,
        CONNECTING,
        HELLO_SENT,
        SESSION_ATTACHED,
        CONNECTING_TO_PEER,
        ACCEPTING,
        CONNECTED,
        CLOSED,
        ERROR
    }

    private final int streamId;
    private final String sessionId;
    private volatile State state;
    private Socket socket;
    private BufferedReader reader;
    private PrintWriter writer;
    private String peerDestination;

    // Caller-supplied connect timeout (ms); 0 = use socket default (60s).
    // Set via setConnectTimeout() before streamConnect() to honor a plugin-level
    // timeout on the STREAM CONNECT readLine().
    private volatile int currentConnectTimeoutMs = 0;

    // Local private destination (908-byte base64) — required so we can issue
    // an inline SESSION CREATE on a freshly-opened socket before STREAM
    // CONNECT/ACCEPT. Without it, i2pd closes the original session socket
    // within milliseconds after SESSION STATUS, and any subsequent STREAM
    // CONNECT/ACCEPT on a new socket is rejected with RESULT=INVALID_ID.
    // Set via the 4-arg constructor or setOwnDestination() before streamConnect().
    // null means TRANSIENT session (i2pd will generate a fresh destination, which
    // does NOT preserve the original session identity — see sessionCreate()).
    private volatile String ownDestination = null;

    // Async message handling
    private final BlockingQueue<String> messageQueue;
    private MessageListener messageListener;
    private Thread readThread;
    private final AtomicBoolean isRunning;

    // SAM host and port
    private final String samHost;
    private final int samPort;

    /**
     * Interface for receiving messages from the stream.
     */
    public interface MessageListener {
        void onMessage(String data);
        void onConnected();
        void onDisconnected();
        void onError(String error);
    }

    /**
     * Create a new SAM stream.
     *
     * @param sessionId SAM session ID to attach to
     * @param samHost SAM bridge host
     * @param samPort SAM bridge port
     */
    public SAMStream(String sessionId, String samHost, int samPort) {
        this(sessionId, null, samHost, samPort);
    }

    /**
     * Create a new SAM stream with a known local private destination.
     *
     * The ownDestination is used by streamConnect()/streamAccept() to issue an
     * inline SESSION CREATE on a freshly-opened socket — required because i2pd
     * closes the original session socket within milliseconds after SESSION
     * STATUS, so without this the next STREAM CONNECT/ACCEPT (on a new socket)
     * would be rejected with RESULT=INVALID_ID.
     *
     * @param sessionId SAM session ID to attach to
     * @param ownDestination Local private destination (908-byte base64), or
     *                       null to use TRANSIENT (NOT recommended for restore)
     * @param samHost SAM bridge host
     * @param samPort SAM bridge port
     */
    public SAMStream(String sessionId, String ownDestination, String samHost, int samPort) {
        this.streamId = streamIdCounter.incrementAndGet();
        this.sessionId = sessionId;
        this.ownDestination = ownDestination;
        this.samHost = samHost;
        this.samPort = samPort;
        this.state = State.DISCONNECTED;
        this.messageQueue = new LinkedBlockingQueue<>();
        this.isRunning = new AtomicBoolean(false);
    }

    /**
     * Set/override the local private destination. Call this before
     * streamConnect()/streamAccept() if you used the 3-arg constructor and
     * the destination is now known.
     */
    public void setOwnDestination(String destination) {
        this.ownDestination = destination;
    }

    /**
     * Get the stream ID.
     */
    public int getStreamId() {
        return streamId;
    }

    /**
     * Get current connection state.
     */
    public State getState() {
        return state;
    }

    /**
     * Get peer destination (available after connection).
     */
    public String getPeerDestination() {
        return peerDestination;
    }

    /**
     * Set message listener for async data reception.
     */
    public void setMessageListener(MessageListener listener) {
        this.messageListener = listener;
    }

    /**
     * Set the per-stream connect timeout (ms).
     * Applied to the underlying socket before streamConnect()'s readLine() so a
     * hung i2pd response cannot block the executor indefinitely.
     * @param timeoutMs Timeout in ms; 0 = use socket default (60s).
     */
    public void setConnectTimeout(int timeoutMs) {
        this.currentConnectTimeoutMs = timeoutMs > 0 ? timeoutMs : 0;
    }

    /**
     * Publish the LeaseSet for the session attached to this stream.
     * Must be called AFTER connect() (which performs HELLO). The publish
     * is sent on this fresh socket bound to the session ID.
     *
     * i2pd accepts DESTINATION PUBLISH on any socket that includes the
     * session ID — it does not require SESSION CREATE on the same socket.
     *
     * @return raw SAM response line, or null on socket error / timeout
     * @throws IOException if the stream is not in SESSION_ATTACHED state
     */
    public String publishLeaseSet() throws IOException {
        if (state != State.SESSION_ATTACHED) {
            throw new IllegalStateException("Stream not ready for DESTINATION PUBLISH: " + state);
        }
        // Tight read timeout: i2pd answers DESTINATION PUBLISH quickly.
        if (socket != null) {
            try { socket.setSoTimeout(30000); } catch (Exception ignored) { }
        }
        String cmd = "DESTINATION PUBLISH ID=" + sessionId + "\n";
        Log.d(TAG, "Sending DESTINATION PUBLISH for session: " + sessionId);
        writer.print(cmd);
        writer.flush();
        String response = reader.readLine();
        Log.d(TAG, "DESTINATION PUBLISH response: " + response);
        return response;
    }

    /**
     * Connect to SAM bridge and perform HELLO handshake.
     *
     * @return true if connected and hello completed
     * @throws IOException on connection failure
     */
    public boolean connect() throws IOException {
        if (state != State.DISCONNECTED) {
            throw new IllegalStateException("Stream not in DISCONNECTED state: " + state);
        }

        Log.d(TAG, "Connecting to SAM at " + samHost + ":" + samPort);
        state = State.CONNECTING;

        try {
            socket = new Socket(samHost, samPort);
            socket.setKeepAlive(true);
            socket.setTcpNoDelay(true);

            reader = new BufferedReader(new InputStreamReader(socket.getInputStream()));
            writer = new PrintWriter(new OutputStreamWriter(socket.getOutputStream()), true);

            // Perform HELLO handshake
            return performHello();

        } catch (IOException e) {
            state = State.ERROR;
            Log.e(TAG, "Connection failed", e);
            cleanup();
            throw e;
        }
    }

    /**
     * Perform HELLO VERSION handshake.
     */
    private boolean performHello() throws IOException {
        state = State.HELLO_SENT;

        String helloCmd = SAMProtocolHandler.buildHelloCommand();
        Log.d(TAG, "Sending HELLO...");

        writer.print(helloCmd);
        writer.flush();

        String response = reader.readLine();
        Log.d(TAG, "HELLO response: " + response);

        if (response == null) {
            state = State.ERROR;
            throw new IOException("No response to HELLO");
        }

        if (SAMProtocolHandler.parseHelloResponse(response)) {
            state = State.SESSION_ATTACHED;
            return true;
        } else {
            state = State.ERROR;
            throw new IOException("HELLO failed: " + response);
        }
    }

    /**
     * Re-attach this freshly-opened socket to the session by sending an
     * inline SESSION CREATE on it, BEFORE the STREAM CONNECT/ACCEPT.
     *
     * Why this is required (i2pd-specific behaviour, 2026-08-05):
     * i2pd closes the original session socket within milliseconds after
     * SESSION STATUS is sent. Any subsequent STREAM CONNECT/ACCEPT on a
     * newly-opened socket is rejected with RESULT=INVALID_ID unless we first
     * send SESSION CREATE on the new socket — i2pd rebinds the new socket
     * to the existing session by ID. This is the same pattern that
     * DESTINATION PUBLISH uses (see SAMPlugin.createSession() inline publish).
     *
     * i2pd accepts DUPLICATED_ID on subsequent SESSION CREATE attempts for
     * an already-registered session ID — we treat this as success because
     * the session is already known to i2pd and the new socket is now
     * eligible for STREAM CONNECT/ACCEPT. This is what makes
     * startAccepting's accept loop work after the first session-bound socket
     * has been taken over by publishLeaseSet.
     *
     * Caller MUST invoke this after connect() (state == SESSION_ATTACHED)
     * and before streamConnect()/streamAccept().
     *
     * @return true on SESSION STATUS RESULT=OK or RESULT=DUPLICATED_ID
     * @throws IOException on I/O failure or any other SESSION STATUS error
     */
    public boolean sessionCreate() throws IOException {
        if (state != State.SESSION_ATTACHED) {
            throw new IllegalStateException("Stream not ready for SESSION CREATE: " + state);
        }
        if (ownDestination == null || ownDestination.isEmpty()) {
            // TRANSIENT fallback: i2pd generates a fresh destination. This
            // does NOT preserve the original session identity, but it keeps
            // i2pd from rejecting STREAM CONNECT/ACCEPT outright.
            Log.w(TAG, "sessionCreate without ownDestination — using TRANSIENT (identity will differ)");
        }

        // Reasonable read timeout — SESSION STATUS arrives promptly once
        // DESTINATION is provided, but allow some slack.
        if (socket != null) {
            try { socket.setSoTimeout(30000); } catch (Exception ignored) { }
        }

        String cmd = (ownDestination != null && !ownDestination.isEmpty())
            ? SAMProtocolHandler.buildSessionCreate(sessionId, ownDestination)
            : "SESSION CREATE STYLE=STREAM ID=" + sessionId + "\n";
        Log.d(TAG, "Sending inline SESSION CREATE for session " + sessionId + " (on fresh socket)");
        writer.print(cmd);
        writer.flush();

        String response = reader.readLine();
        Log.d(TAG, "SESSION CREATE response: " + response);

        if (response == null) {
            state = State.ERROR;
            throw new IOException("No response to SESSION CREATE");
        }

        // Both OK and DUPLICATED_ID are acceptable — the session is known
        // to i2pd in both cases and the fresh socket can now issue
        // STREAM CONNECT/ACCEPT. Any other RESULT is a real failure.
        if (response.contains("RESULT=OK") || response.contains("RESULT=DUPLICATED_ID")) {
            return true;
        }
        state = State.ERROR;
        throw new IOException("SESSION CREATE on stream socket failed: " + response);
    }

    /**
     * Connect to a remote I2P destination via STREAM CONNECT.
     *
     * @param destination Target destination (b32.i2p or full base64)
     * @return true if connected
     * @throws IOException on connection failure
     */
    public boolean streamConnect(String destination) throws IOException {
        if (state != State.SESSION_ATTACHED) {
            throw new IllegalStateException("Stream not ready for CONNECT: " + state);
        }

        // i2pd closes the original session socket after SESSION STATUS; the
        // session must be re-bound on this fresh socket before STREAM CONNECT.
        sessionCreate();

        state = State.CONNECTING_TO_PEER;
        this.peerDestination = destination;

        // Defense-in-depth: if a caller passes a socket timeout via the plugin,
        // honor it before the (potentially blocking) readLine().
        // Default socket timeout from SAMSocketManager.connect() is 60s.
        if (socket != null && currentConnectTimeoutMs > 0) {
            try {
                socket.setSoTimeout(currentConnectTimeoutMs);
            } catch (Exception e) {
                Log.w(TAG, "Could not set STREAM CONNECT socket timeout: " + e.getMessage());
            }
        }

        String connectCmd = SAMProtocolHandler.buildStreamConnect(sessionId, destination);
        Log.d(TAG, "Sending STREAM CONNECT to " + destination.substring(0, Math.min(20, destination.length())) + "...");

        writer.print(connectCmd);
        writer.flush();

        String response = reader.readLine();
        Log.d(TAG, "STREAM CONNECT response: " + response);

        if (response == null) {
            state = State.ERROR;
            throw new IOException("No response to STREAM CONNECT");
        }

        JSONObject result = SAMProtocolHandler.parseStreamStatus(response);
        boolean success = result != null && result.optBoolean("success", false);

        if (success) {
            state = State.CONNECTED;
            startReadThread();
            if (messageListener != null) {
                messageListener.onConnected();
            }
            return true;
        } else {
            state = State.ERROR;
            String errorMsg = result != null ? result.optString("message", "Unknown error") : "Parse error";
            throw new IOException("STREAM CONNECT failed: " + errorMsg);
        }
    }

    /**
     * Accept incoming connections via STREAM ACCEPT.
     *
     * @return Peer destination of the connected client
     * @throws IOException on accept failure
     */
    public String streamAccept() throws IOException {
        if (state != State.SESSION_ATTACHED) {
            throw new IllegalStateException("Stream not ready for ACCEPT: " + state);
        }

        // i2pd closes the original session socket after SESSION STATUS; the
        // session must be re-bound on this fresh socket before STREAM ACCEPT.
        sessionCreate();

        state = State.ACCEPTING;

        String acceptCmd = SAMProtocolHandler.buildStreamAccept(sessionId);
        Log.d(TAG, "Sending STREAM ACCEPT...");

        writer.print(acceptCmd);
        writer.flush();

        // First response: STREAM STATUS
        String statusResponse = reader.readLine();
        Log.d(TAG, "STREAM ACCEPT status: " + statusResponse);

        if (statusResponse == null) {
            state = State.ERROR;
            throw new IOException("No response to STREAM ACCEPT");
        }

        JSONObject result = SAMProtocolHandler.parseStreamStatus(statusResponse);
        boolean success = result != null && result.optBoolean("success", false);

        if (!success) {
            state = State.ERROR;
            String errorMsg = result != null ? result.optString("message", "Unknown error") : "Parse error";
            throw new IOException("STREAM ACCEPT failed: " + errorMsg);
        }

        // Second response: peer destination (base64)
        String peerDest = reader.readLine();
        if (peerDest == null || peerDest.isEmpty()) {
            state = State.ERROR;
            throw new IOException("No peer destination received");
        }

        peerDestination = peerDest.trim();
        Log.d(TAG, "Accepted connection from: " + peerDestination.substring(0, Math.min(20, peerDestination.length())) + "...");

        state = State.CONNECTED;
        startReadThread();

        if (messageListener != null) {
            messageListener.onConnected();
        }

        return peerDestination;
    }

    /**
     * Send data over the stream.
     *
     * @param data Data to send
     * @return true if sent
     */
    public boolean send(String data) {
        if (!isConnected()) {
            Log.w(TAG, "Cannot send: stream not connected");
            return false;
        }

        if (data == null || data.isEmpty()) {
            return true;
        }

        // SAM STREAM framing: the receiver's readLine() blocks until a newline
        // (or EOF) arrives. Without this, the message stays buffered in the
        // receiver's reader until the socket closes.
        // Append \n if not already present so messages are actually delivered.
        String framed = data.endsWith("\n") ? data : data + "\n";

        // SAM protocol: data is sent as-is after connection establishment
        writer.print(framed);
        writer.flush();

        return !writer.checkError();
    }

    /**
     * Send data with newline.
     *
     * @param data Data to send
     * @return true if sent
     */
    public boolean sendLine(String data) {
        return send(data + "\n");
    }

    /**
     * Read a line from the stream (blocking).
     *
     * @return Line read, or null if EOF/error
     * @throws IOException on read error
     */
    public String readLine() throws IOException {
        if (reader == null) {
            return null;
        }
        return reader.readLine();
    }

    /**
     * Start background read thread for async message handling.
     */
    private void startReadThread() {
        isRunning.set(true);

        readThread = new Thread(() -> {
            Log.d(TAG, "Read thread started for stream " + streamId);

            while (isRunning.get() && !Thread.currentThread().isInterrupted()) {
                try {
                    String line = reader.readLine();

                    if (line == null) {
                        // EOF - connection closed
                        Log.d(TAG, "Read thread: EOF reached");
                        break;
                    }

                    // Skip SAM protocol responses
                    if (line.startsWith("HELLO ") ||
                        line.startsWith("SESSION ") ||
                        line.startsWith("STREAM ")) {
                        Log.d(TAG, "Read thread: SAM response: " + line);
                        continue;
                    }

                    // Queue the message
                    messageQueue.offer(line);

                    // Notify listener
                    if (messageListener != null) {
                        messageListener.onMessage(line);
                    }

                } catch (IOException e) {
                    if (isRunning.get()) {
                        Log.e(TAG, "Read error", e);
                        if (messageListener != null) {
                            messageListener.onError(e.getMessage());
                        }
                    }
                    break;
                }
            }

            Log.d(TAG, "Read thread ended for stream " + streamId);

            if (state == State.CONNECTED) {
                state = State.CLOSED;
            }

            if (messageListener != null) {
                messageListener.onDisconnected();
            }
        }, "SAMStream-" + streamId);

        readThread.setDaemon(true);
        readThread.start();
    }

    /**
     * Check if stream is connected.
     */
    public boolean isConnected() {
        return state == State.CONNECTED &&
               socket != null &&
               socket.isConnected() &&
               !socket.isClosed() &&
               !socket.isInputShutdown() &&
               !socket.isOutputShutdown() &&
               writer != null &&
               !writer.checkError();
    }

    /**
     * Poll for received messages (non-blocking).
     *
     * @return Message or null if none available
     */
    public String pollMessage() {
        return messageQueue.poll();
    }

    /**
     * Get the underlying socket (for advanced use).
     */
    public Socket getSocket() {
        return socket;
    }

    /**
     * Close the stream and cleanup resources.
     */
    public void close() {
        Log.d(TAG, "Closing stream " + streamId);

        isRunning.set(false);
        state = State.CLOSED;

        if (readThread != null) {
            readThread.interrupt();
            readThread = null;
        }

        cleanup();
    }

    /**
     * Cleanup resources without changing state.
     */
    private void cleanup() {
        if (writer != null) {
            writer.close();
            writer = null;
        }

        if (reader != null) {
            try {
                reader.close();
            } catch (IOException e) {
                // Ignore
            }
            reader = null;
        }

        if (socket != null) {
            try {
                socket.close();
            } catch (IOException e) {
                // Ignore
            }
            socket = null;
        }
    }

    /**
     * Get stream info as JSON.
     */
    public JSONObject toJSON() {
        JSONObject json = new JSONObject();
        try {
            json.put("streamId", streamId);
            json.put("sessionId", sessionId);
            json.put("state", state.toString());
            json.put("connected", isConnected());
            if (peerDestination != null) {
                json.put("peerDestination", peerDestination.substring(0, Math.min(20, peerDestination.length())) + "...");
            }
        } catch (JSONException e) {
            Log.e(TAG, "JSON error", e);
        }
        return json;
    }

    @Override
    public String toString() {
        return "SAMStream{" +
                "streamId=" + streamId +
                ", state=" + state +
                ", peerDestination='" + (peerDestination != null ? peerDestination.substring(0, Math.min(10, peerDestination.length())) + "..." : "null") + '\'' +
                '}';
    }
}
