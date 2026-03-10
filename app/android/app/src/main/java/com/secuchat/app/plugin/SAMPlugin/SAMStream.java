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
    private State state;
    private Socket socket;
    private BufferedReader reader;
    private PrintWriter writer;
    private String peerDestination;

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
        this.streamId = streamIdCounter.incrementAndGet();
        this.sessionId = sessionId;
        this.samHost = samHost;
        this.samPort = samPort;
        this.state = State.DISCONNECTED;
        this.messageQueue = new LinkedBlockingQueue<>();
        this.isRunning = new AtomicBoolean(false);
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

        state = State.CONNECTING_TO_PEER;
        this.peerDestination = destination;

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
        if (state != State.CONNECTED || writer == null) {
            Log.w(TAG, "Cannot send: stream not connected");
            return false;
        }

        if (data == null || data.isEmpty()) {
            return true;
        }

        // SAM protocol: data is sent as-is after connection establishment
        writer.print(data);
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
               !socket.isClosed();
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
