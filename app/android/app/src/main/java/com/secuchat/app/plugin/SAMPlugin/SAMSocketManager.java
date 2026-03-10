package com.secuchat.app.plugin.SAMPlugin;

import android.util.Log;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.PrintWriter;
import java.net.Socket;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

import com.secuchat.app.plugin.SAMPlugin.events.SAMEventEmitter;

/**
 * Singleton manager for SAM TCP socket connections.
 * Handles non-blocking I/O using ExecutorService for all SAM v3.1 protocol operations.
 */
public class SAMSocketManager {
    private static final String TAG = "SecuChat:SAM";
    private static final int CONNECT_TIMEOUT_MS = 15000;
    private static final int READ_TIMEOUT_MS = 60000;
    private static final int COMMAND_TIMEOUT_MS = 30000;

    private static SAMSocketManager instance;

    private final ExecutorService executorService;
    private final AtomicBoolean isConnected;
    private final AtomicReference<Socket> socketRef;
    private final AtomicReference<PrintWriter> writerRef;
    private final AtomicReference<BufferedReader> readerRef;
    private final BlockingQueue<String> responseQueue;

    private SAMConfig config;
    private volatile SAMEventEmitter eventEmitter;
    private final BlockingQueue<String> pendingEvents;
    private Thread readThread;

    private SAMSocketManager() {
        this.executorService = Executors.newCachedThreadPool();
        this.isConnected = new AtomicBoolean(false);
        this.socketRef = new AtomicReference<>();
        this.writerRef = new AtomicReference<>();
        this.readerRef = new AtomicReference<>();
        this.responseQueue = new LinkedBlockingQueue<>();
        this.pendingEvents = new LinkedBlockingQueue<>();
        this.config = new SAMConfig();
    }

    /**
     * Get the singleton instance of SAMSocketManager.
     */
    public static synchronized SAMSocketManager getInstance() {
        if (instance == null) {
            instance = new SAMSocketManager();
        }
        return instance;
    }

    /**
     * Set the event emitter for forwarding async events to TypeScript.
     * Processes any pending events that arrived before emitter was set.
     */
    public void setEventEmitter(SAMEventEmitter emitter) {
        this.eventEmitter = emitter;
        Log.d(TAG, "Event emitter set, processing " + pendingEvents.size() + " pending events");

        // Process any pending events that arrived before emitter was set
        String pendingEvent;
        while ((pendingEvent = pendingEvents.poll()) != null) {
            handleAsyncEvent(pendingEvent);
        }
    }

    /**
     * Connect to the SAM bridge at the specified host and port.
     * Performs the connection on a background thread.
     *
     * @param host SAM bridge host (typically localhost)
     * @param port SAM bridge port (typically 7656 for i2pd SAM)
     * @return true if connection successful, false otherwise
     */
    public boolean connect(String host, int port) {
        if (isConnected.get()) {
            Log.w(TAG, "Already connected, disconnecting first");
            disconnect();
        }

        try {
            Log.d(TAG, "Connecting to SAM at " + host + ":" + port);

            Socket socket = new Socket();
            socket.connect(new java.net.InetSocketAddress(host, port), CONNECT_TIMEOUT_MS);
            socket.setSoTimeout(READ_TIMEOUT_MS);
            socket.setKeepAlive(true);

            socketRef.set(socket);

            PrintWriter writer = new PrintWriter(socket.getOutputStream(), true);
            BufferedReader reader = new BufferedReader(new InputStreamReader(socket.getInputStream()));

            writerRef.set(writer);
            readerRef.set(reader);

            // Set connected BEFORE starting read thread to avoid race condition
            isConnected.set(true);

            // Start the background read thread
            startReadThread();
            config.setHost(host);
            config.setPort(port);
            config.setEnabled(true);

            Log.i(TAG, "Successfully connected to SAM at " + host + ":" + port);
            return true;

        } catch (IOException e) {
            Log.e(TAG, "Failed to connect to SAM: " + e.getMessage(), e);
            cleanup();
            return false;
        }
    }

    /**
     * Disconnect from the SAM bridge and clean up resources.
     */
    public void disconnect() {
        Log.d(TAG, "Disconnecting from SAM");
        isConnected.set(false);
        config.setEnabled(false);
        responseQueue.clear();
        pendingEvents.clear();
        cleanup();
    }

    /**
     * Send a raw SAM command to the bridge.
     * Commands are automatically terminated with newline if not present.
     *
     * @param command The SAM command to send
     * @return true if command was sent successfully
     */
    public boolean sendCommand(String command) {
        if (!isConnected.get()) {
            Log.e(TAG, "Cannot send command: not connected");
            return false;
        }

        PrintWriter writer = writerRef.get();
        if (writer == null) {
            Log.e(TAG, "Cannot send command: writer is null");
            return false;
        }

        try {
            String cmd = command.endsWith("\n") ? command : command + "\n";
            Log.d(TAG, "Sending: " + cmd.trim());
            writer.print(cmd);
            writer.flush();

            if (writer.checkError()) {
                Log.e(TAG, "PrintWriter encountered an error");
                return false;
            }

            return true;
        } catch (Exception e) {
            Log.e(TAG, "Failed to send command: " + e.getMessage(), e);
            return false;
        }
    }

    /**
     * Read a response from the SAM bridge.
     * Blocks until a response is available or timeout occurs.
     *
     * @return The response string, or null if error/timeout
     */
    public String readResponse() {
        return readResponseWithTimeout(COMMAND_TIMEOUT_MS);
    }

    /**
     * Read a response from the SAM bridge with a custom timeout.
     * Blocks until a response is available or timeout occurs.
     *
     * @param timeoutMs Timeout in milliseconds
     * @return The response string, or null if error/timeout
     */
    public String readResponseWithTimeout(int timeoutMs) {
        if (!isConnected.get()) {
            Log.e(TAG, "Cannot read response: not connected");
            return null;
        }

        try {
            String response = responseQueue.poll(timeoutMs, TimeUnit.MILLISECONDS);
            if (response != null) {
                Log.d(TAG, "Received: " + response.trim());
            } else {
                Log.w(TAG, "Read response timeout after " + timeoutMs + "ms");
            }
            return response;
        } catch (InterruptedException e) {
            Log.w(TAG, "Read interrupted", e);
            Thread.currentThread().interrupt();
            return null;
        }
    }

    /**
     * Send a command and wait for the response.
     * Convenience method for synchronous command/response operations.
     *
     * @param command The SAM command to send
     * @return The response string, or null if error/timeout
     */
    public String sendCommandAndWait(String command) {
        return sendCommandAndWait(command, COMMAND_TIMEOUT_MS);
    }

    /**
     * Send a command and wait for the response with a custom timeout.
     * Convenience method for synchronous command/response operations.
     *
     * @param command The SAM command to send
     * @param timeoutMs Timeout in milliseconds
     * @return The response string, or null if error/timeout
     */
    public String sendCommandAndWait(String command, int timeoutMs) {
        // Clear any stale responses
        responseQueue.clear();

        if (!sendCommand(command)) {
            return null;
        }

        return readResponseWithTimeout(timeoutMs);
    }

    /**
     * Check if currently connected to the SAM bridge.
     */
    public boolean isConnected() {
        if (!isConnected.get()) {
            return false;
        }

        Socket socket = socketRef.get();
        return socket != null && socket.isConnected() && !socket.isClosed();
    }

    /**
     * Get the current configuration.
     */
    public SAMConfig getConfig() {
        return new SAMConfig(config.getHost(), config.getPort(), config.isEnabled());
    }

    /**
     * Execute a task on the background executor.
     * Used for non-blocking operations.
     */
    public void executeAsync(Runnable task) {
        executorService.execute(task);
    }

    private void startReadThread() {
        readThread = new Thread(() -> {
            Log.d(TAG, "Read thread started");
            BufferedReader reader = readerRef.get();

            while (isConnected.get() && reader != null) {
                try {
                    String line = reader.readLine();
                    if (line != null) {
                        Log.d(TAG, "Read thread received: " + line.trim());

                        // Check if this is an async event (STREAM CONNECTED/CLOSED)
                        if (isAsyncEvent(line)) {
                            handleAsyncEvent(line);
                        } else {
                            // It's a response to a command
                            responseQueue.offer(line);
                        }
                    } else {
                        // End of stream - connection closed
                        Log.w(TAG, "Read thread: end of stream");
                        break;
                    }
                } catch (IOException e) {
                    if (isConnected.get()) {
                        Log.e(TAG, "Read error: " + e.getMessage(), e);
                        // Emit error event to TypeScript
                        SAMEventEmitter emitter = eventEmitter;
                        if (emitter != null) {
                            emitter.emitError("Read error: " + e.getMessage(), 0);
                        }
                    }
                    break;
                }
            }

            Log.d(TAG, "Read thread exiting");
            if (isConnected.get()) {
                // Connection was lost unexpectedly
                isConnected.set(false);
            }
            // Clear thread reference when thread dies
            readThread = null;
        }, "SAM-ReadThread");

        readThread.setDaemon(true);
        readThread.start();
    }

    /**
     * Check if a line is an async event (not a command response).
     */
    private boolean isAsyncEvent(String line) {
        if (line == null) return false;
        // STREAM CONNECTED and STREAM CLOSED are async events from i2pd
        return line.startsWith("STREAM CONNECTED") ||
               line.startsWith("STREAM CLOSED");
    }

    /**
     * Handle async events by forwarding to the event emitter.
     * Buffers events if emitter is not yet set.
     */
    private void handleAsyncEvent(String line) {
        if (eventEmitter == null) {
            // Buffer event for later delivery instead of dropping
            Log.d(TAG, "Buffering event (no emitter yet): " + line.substring(0, Math.min(50, line.length())));
            pendingEvents.offer(line);
            return;
        }

        if (line.startsWith("STREAM CONNECTED")) {
            // Parse: STREAM CONNECTED ID=xxx DESTINATION=xxx
            String destination = parseParam(line, "DESTINATION");
            int streamId = parseStreamId(parseParam(line, "ID"));
            Log.d(TAG, "Emitting streamConnected: id=" + streamId + ", dest=" + (destination != null ? destination.substring(0, Math.min(20, destination.length())) + "..." : "null"));
            eventEmitter.emitStreamConnected(destination != null ? destination : "", streamId);

        } else if (line.startsWith("STREAM CLOSED")) {
            // Parse: STREAM CLOSED ID=xxx [REASON=xxx]
            int streamId = parseStreamId(parseParam(line, "ID"));
            String reason = parseParam(line, "REASON");
            Log.d(TAG, "Emitting streamClosed: id=" + streamId + ", reason=" + (reason != null ? reason : "closed"));
            eventEmitter.emitStreamClosed(streamId, reason != null ? reason : "closed");
        }
    }

    /**
     * Parse a parameter value from a SAM response line.
     */
    private String parseParam(String response, String param) {
        if (response == null) return null;
        String pattern = param + "=";
        int start = response.indexOf(pattern);
        if (start == -1) return null;
        start += pattern.length();
        int end = response.indexOf(' ', start);
        if (end == -1) end = response.length();
        return response.substring(start, end).trim();
    }

    /**
     * Parse stream ID from string, extracting numeric portion.
     * Returns -1 on parse failure to distinguish from valid ID 0.
     */
    private int parseStreamId(String idStr) {
        if (idStr == null) return -1;
        try {
            return Integer.parseInt(idStr.replaceAll("[^0-9]", ""));
        } catch (NumberFormatException e) {
            return -1;
        }
    }

    private void cleanup() {
        // Close socket FIRST to unblock BufferedReader.readLine()
        // readLine() doesn't respond to interrupt(), but will throw IOException when socket closes
        Socket socket = socketRef.getAndSet(null);
        if (socket != null) {
            try {
                socket.close();
            } catch (IOException e) {
                Log.w(TAG, "Error closing socket: " + e.getMessage());
            }
        }

        // Close reader
        BufferedReader reader = readerRef.getAndSet(null);
        if (reader != null) {
            try {
                reader.close();
            } catch (IOException e) {
                Log.w(TAG, "Error closing reader: " + e.getMessage());
            }
        }

        // Close writer
        PrintWriter writer = writerRef.getAndSet(null);
        if (writer != null) {
            writer.close();
        }

        // Now interrupt the read thread after socket close unblocked it
        if (readThread != null && readThread.isAlive()) {
            readThread.interrupt();
            readThread = null;
        }

        // Clear response queue
        responseQueue.clear();

        Log.d(TAG, "Cleanup completed");
    }

    /**
     * Shutdown the manager and release all resources.
     * Call this when the app is being destroyed.
     */
    public void shutdown() {
        Log.d(TAG, "Shutting down SAMSocketManager");
        disconnect();
        executorService.shutdown();
        try {
            if (!executorService.awaitTermination(5, TimeUnit.SECONDS)) {
                executorService.shutdownNow();
            }
        } catch (InterruptedException e) {
            executorService.shutdownNow();
            Thread.currentThread().interrupt();
        }
    }

    /**
     * Send raw data over the socket connection.
     * Used after STREAM CONNECT/ACCEPT to send actual message data.
     *
     * @param data The data to send
     * @return true if data was sent successfully
     */
    public boolean sendData(String data) {
        if (!isConnected.get()) {
            Log.e(TAG, "Cannot send data: not connected");
            return false;
        }

        PrintWriter writer = writerRef.get();
        if (writer == null) {
            Log.e(TAG, "Cannot send data: writer is null");
            return false;
        }

        try {
            Log.d(TAG, "Sending data (" + data.length() + " bytes)");
            writer.print(data);
            writer.flush();

            if (writer.checkError()) {
                Log.e(TAG, "PrintWriter encountered an error sending data");
                return false;
            }

            return true;
        } catch (Exception e) {
            Log.e(TAG, "Failed to send data: " + e.getMessage(), e);
            return false;
        }
    }

    /**
     * Close the current stream/socket connection.
     * This disconnects from SAM entirely.
     */
    public void closeStream() {
        Log.d(TAG, "Closing stream");
        disconnect();
    }
}
