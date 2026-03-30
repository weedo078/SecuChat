package com.secuchat.app.plugin.SAMPlugin;

import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import com.secuchat.app.plugin.SAMPlugin.events.SAMEventEmitter;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

/**
 * Capacitor Plugin for I2P SAM (Simple Anonymous Messaging) v3.1 protocol.
 * Provides native TCP socket access to the I2P SAM bridge for Android.
 *
 * This plugin replaces the WebSocket proxy approach used in the browser/PWA version,
 * allowing direct TCP connections to i2pd's SAM interface (localhost:7656).
 */
@CapacitorPlugin(name = "SAM")
public class SAMPlugin extends Plugin implements EventNotifier {

    private static final String TAG = "SecuChat:SAM";
    private static final String EVENT_MESSAGE = "message";
    private static final String EVENT_STREAM_CONNECTED = "streamConnected";
    private static final String EVENT_STREAM_CLOSED = "streamClosed";
    private static final String EVENT_ERROR = "error";
    private static final String EVENT_STATUS = "samStatus";

    private final SAMSocketManager socketManager;
    private final ExecutorService executorService;
    private final SAMEventEmitter eventEmitter;
    private volatile String currentSessionId = null; // Track the current session nickname (thread-safe)

    public SAMPlugin() {
        this.socketManager = SAMSocketManager.getInstance();
        this.executorService = Executors.newSingleThreadExecutor();
        this.eventEmitter = new SAMEventEmitter(this);
    }

    @Override
    public void notify(String eventName, JSObject data) {
        notifyListeners(eventName, data, true);
    }

    @Override
    public void load() {
        Log.d(TAG, "SAMPlugin loaded");
        // Connect event emitter to socket manager for async event forwarding
        socketManager.setEventEmitter(eventEmitter);
        Log.d(TAG, "Event emitter connected to socket manager");
    }

    /**
     * Connect to the SAM bridge.
     * Expects: { host: string, port: number }
     * Returns: { connected: boolean, error?: string }
     */
    @PluginMethod
    public void connect(PluginCall call) {
        // Null check for activity before accessing call methods
        if (getActivity() == null) {
            Log.e(TAG, "Connect failed: activity is null");
            call.reject("Activity is not available");
            return;
        }

        String host = call.getString("host", "127.0.0.1");
        int port = call.getInt("port", 7656);

        Log.d(TAG, "Connect requested to " + host + ":" + port);

        executorService.execute(() -> {
            try {
                // Step 1: TCP connect to SAM bridge
                boolean connected = socketManager.connect(host, port);
                if (!connected) {
                    JSObject result = new JSObject();
                    result.put("connected", false);
                    result.put("error", "Failed to connect to SAM at " + host + ":" + port);
                    call.resolve(result);
                    notifyStatusChange("disconnected");
                    return;
                }

                // Step 2: SAM v3.1 HELLO handshake (required before any other commands)
                String helloResponse = socketManager.sendCommandAndWait("HELLO VERSION MIN=3.1 MAX=3.1");
                if (helloResponse == null || !helloResponse.contains("RESULT=OK")) {
                    Log.e(TAG, "HELLO handshake failed: " + helloResponse);
                    socketManager.disconnect();
                    JSObject result = new JSObject();
                    result.put("connected", false);
                    result.put("error", "SAM HELLO handshake failed: " + (helloResponse != null ? helloResponse : "No response"));
                    call.resolve(result);
                    notifyStatusChange("disconnected");
                    return;
                }

                Log.d(TAG, "HELLO handshake successful: " + helloResponse);

                JSObject result = new JSObject();
                result.put("connected", true);
                call.resolve(result);

                // Notify status change
                notifyStatusChange("connected");

            } catch (Exception e) {
                Log.e(TAG, "Connect failed: " + e.getMessage(), e);
                call.reject("Connection failed: " + e.getMessage());
            }
        });
    }

    /**
     * Disconnect from the SAM bridge.
     * Returns: { disconnected: boolean }
     */
    @PluginMethod
    public void disconnect(PluginCall call) {
        // Null check for activity before proceeding
        if (getActivity() == null) {
            Log.e(TAG, "Disconnect failed: activity is null");
            call.reject("Activity is not available");
            return;
        }

        Log.d(TAG, "Disconnect requested");

        executorService.execute(() -> {
            try {
                socketManager.disconnect();

                // Clear session ID on disconnect
                currentSessionId = null;
                Log.d(TAG, "Session ID cleared");

                JSObject result = new JSObject();
                result.put("disconnected", true);
                call.resolve(result);

                notifyStatusChange("disconnected");

            } catch (Exception e) {
                Log.e(TAG, "Disconnect error: " + e.getMessage(), e);
                call.reject("Disconnect failed: " + e.getMessage());
            }
        });
    }

    /**
     * Send a raw SAM command.
     * Expects: { command: string }
     * Returns: { success: boolean }
     *
     * Note: For commands requiring response, use sendCommandAndWait.
     */
    @PluginMethod
    public void sendCommand(PluginCall call) {
        String command = call.getString("command");

        if (command == null || command.isEmpty()) {
            call.reject("Command is required");
            return;
        }

        executorService.execute(() -> {
            try {
                boolean success = socketManager.sendCommand(command);

                JSObject result = new JSObject();
                result.put("success", success);
                call.resolve(result);

            } catch (Exception e) {
                Log.e(TAG, "Send command failed: " + e.getMessage(), e);
                call.reject("Send failed: " + e.getMessage());
            }
        });
    }

    /**
     * Send a SAM command and wait for response.
     * Expects: { command: string, timeout?: number }
     * Returns: { response: string } or { error: string }
     *
     * This is the primary method for SAM v3.1 protocol commands like:
     * - HELLO VERSION MIN=3.1 MAX=3.1
     * - DEST GENERATE
     * - SESSION CREATE STYLE=STREAM ID=xxx DESTINATION=xxx
     * - STREAM CONNECT ID=xxx DESTINATION=xxx
     * - STREAM ACCEPT ID=xxx
     */
    @PluginMethod
    public void sendCommandAndWait(PluginCall call) {
        String command = call.getString("command");

        if (command == null || command.isEmpty()) {
            call.reject("Command is required");
            return;
        }

        Log.d(TAG, "sendCommandAndWait: " + command.split(" ")[0]);

        executorService.execute(() -> {
            try {
                String response = socketManager.sendCommandAndWait(command);

                JSObject result = new JSObject();

                if (response != null) {
                    result.put("response", response);
                    result.put("success", true);
                } else {
                    result.put("success", false);
                    result.put("error", "No response received (timeout or disconnected)");
                }

                call.resolve(result);

            } catch (Exception e) {
                Log.e(TAG, "Command failed: " + e.getMessage(), e);
                call.reject("Command failed: " + e.getMessage());
            }
        });
    }

    /**
     * Read a response from the SAM bridge.
     * Non-blocking poll for responses.
     * Returns: { response?: string, hasData: boolean }
     */
    @PluginMethod
    public void readResponse(PluginCall call) {
        executorService.execute(() -> {
            try {
                String response = socketManager.readResponse();

                JSObject result = new JSObject();
                result.put("hasData", response != null);

                if (response != null) {
                    result.put("response", response);
                }

                call.resolve(result);

            } catch (Exception e) {
                Log.e(TAG, "Read response failed: " + e.getMessage(), e);
                call.reject("Read failed: " + e.getMessage());
            }
        });
    }

    /**
     * Get detailed status - used by TypeScript to check connection state.
     * Returns: { connected: boolean, sessionActive: boolean, activeStreams: number }
     */
    @PluginMethod
    public void getStatus(PluginCall call) {
        Log.d(TAG, "getStatus called");
        try {
            boolean connected = socketManager.isConnected();

            JSObject result = new JSObject();
            result.put("connected", connected);
            result.put("sessionActive", connected); // Simplified - connected means session active
            result.put("activeStreams", 0); // TODO: Track active streams

            Log.d(TAG, "getStatus returning: connected=" + connected);
            call.resolve(result);

        } catch (Exception e) {
            Log.e(TAG, "getStatus failed: " + e.getMessage(), e);
            call.reject("Status check failed: " + e.getMessage());
        }
    }

    /**
     * Check if connected to SAM bridge.
     * Returns: { connected: boolean, host?: string, port?: number }
     */
    @PluginMethod
    public void isConnected(PluginCall call) {
        try {
            boolean connected = socketManager.isConnected();
            SAMConfig config = socketManager.getConfig();

            JSObject result = new JSObject();
            result.put("connected", connected);
            result.put("host", config.getHost());
            result.put("port", config.getPort());

            call.resolve(result);

        } catch (Exception e) {
            Log.e(TAG, "isConnected check failed: " + e.getMessage(), e);
            call.reject("Check failed: " + e.getMessage());
        }
    }

    /**
     * Perform SAM HELLO handshake.
     * Convenience method for initial protocol handshake.
     * Returns: { success: boolean, version?: string, error?: string }
     */
    @PluginMethod
    public void hello(PluginCall call) {
        executorService.execute(() -> {
            try {
                String response = socketManager.sendCommandAndWait("HELLO VERSION MIN=3.1 MAX=3.1");

                JSObject result = new JSObject();

                if (response != null && response.contains("RESULT=OK")) {
                    result.put("success", true);
                    // Parse version from response
                    String version = parseVersion(response);
                    result.put("version", version);
                } else {
                    result.put("success", false);
                    result.put("error", response != null ? response : "No response");
                }

                call.resolve(result);

            } catch (Exception e) {
                Log.e(TAG, "HELLO failed: " + e.getMessage(), e);
                call.reject("HELLO failed: " + e.getMessage());
            }
        });
    }

    /**
     * Generate a new I2P destination.
     * Convenience method for DEST GENERATE command.
     * Returns: { success: boolean, publicKey?: string, privateKey?: string, error?: string }
     */
    @PluginMethod
    public void generateDestination(PluginCall call) {
        String sigType = call.getString("signatureType", "EdDSA_SHA512_Ed25519");

        executorService.execute(() -> {
            try {
                // i2pd expects numeric signature type values, not string names
                String sigTypeNum = mapSignatureTypeToNumber(sigType);
                String response = socketManager.sendCommandAndWait("DEST GENERATE SIGNATURE_TYPE=" + sigTypeNum);

                JSObject result = new JSObject();

                // DEST REPLY format: "DEST REPLY PUB=<base64> PRIV=<base64>"
                // Note: i2pd DEST REPLY does NOT contain RESULT=OK
                if (response != null && response.startsWith("DEST REPLY") && response.contains("PUB=") && response.contains("PRIV=")) {
                    String pub = parseDestParam(response, "PUB");
                    String priv = parseDestParam(response, "PRIV");

                    result.put("success", true);
                    result.put("publicKey", pub);
                    result.put("privateKey", priv);
                } else {
                    result.put("success", false);
                    result.put("error", response != null ? response : "No response");
                }

                call.resolve(result);

            } catch (Exception e) {
                Log.e(TAG, "DEST GENERATE failed: " + e.getMessage(), e);
                call.reject("DEST GENERATE failed: " + e.getMessage());
            }
        });
    }

    /**
     * Create a SAM session.
     * Convenience method for SESSION CREATE command.
     * Expects: { nickname: string, privateKey?: string, style?: string }
     * Returns: { success: boolean, error?: string }
     */
    @PluginMethod
    public void createSession(PluginCall call) {
        String nickname = call.getString("nickname");
        String privateKey = call.getString("privateKey");
        String style = call.getString("style", "STREAM");

        if (nickname == null || nickname.isEmpty()) {
            call.reject("Nickname is required");
            return;
        }

        executorService.execute(() -> {
            try {
                String cmd;
                if (privateKey != null && !privateKey.isEmpty()) {
                    cmd = String.format("SESSION CREATE STYLE=%s ID=%s DESTINATION=%s",
                        style, nickname, privateKey);
                } else {
                    // TRANSIENT session - let SAM generate a destination
                    cmd = String.format("SESSION CREATE STYLE=%s ID=%s",
                        style, nickname);
                }
                String response = socketManager.sendCommandAndWait(cmd);

                JSObject result = new JSObject();

                if (response != null && response.contains("RESULT=OK")) {
                    result.put("success", true);
                    // Store the session ID for later use in STREAM CONNECT/ACCEPT
                    currentSessionId = nickname;
                    Log.d(TAG, "Session created with ID: " + nickname);
                } else {
                    result.put("success", false);
                    result.put("error", response != null ? response : "No response");
                }

                call.resolve(result);

            } catch (Exception e) {
                Log.e(TAG, "SESSION CREATE failed: " + e.getMessage(), e);
                call.reject("SESSION CREATE failed: " + e.getMessage());
            }
        });
    }

    private int nextStreamId = 1;

    private synchronized int generateStreamId() {
        return nextStreamId++;
    }

    /**
     * Connect to a remote peer via STREAM CONNECT.
     * Expects: { destination: string, timeout?: number }
     * Returns: { success: boolean, streamId?: number, error?: string }
     */
    @PluginMethod
    public void connectTo(PluginCall call) {
        String destination = call.getString("destination");
        int timeout = call.getInt("timeout", 60000);

        if (destination == null || destination.isEmpty()) {
            call.reject("Destination is required");
            return;
        }

        executorService.execute(() -> {
            try {
                // Use the stored session ID from createSession
                String sessionId = currentSessionId != null ? currentSessionId : "secuchat";
                int streamId = generateStreamId();
                String cmd = String.format("STREAM CONNECT ID=%s DESTINATION=%s SILENT=false",
                    sessionId, destination);
                Log.d(TAG, "STREAM CONNECT command: " + cmd + " (timeout: " + timeout + "ms)");
                String response = socketManager.sendCommandAndWait(cmd, timeout);

                JSObject result = new JSObject();

                if (response != null && response.contains("RESULT=OK")) {
                    result.put("success", true);
                    result.put("streamId", streamId);
                    Log.d(TAG, "STREAM CONNECT successful, streamId: " + streamId);
                } else {
                    result.put("success", false);
                    result.put("error", response != null ? response : "No response");
                    Log.e(TAG, "STREAM CONNECT failed: " + response);
                }

                call.resolve(result);

            } catch (Exception e) {
                Log.e(TAG, "STREAM CONNECT failed: " + e.getMessage(), e);
                call.reject("STREAM CONNECT failed: " + e.getMessage());
            }
        });
    }

    /**
     * Start accepting incoming connections via STREAM ACCEPT.
     * Expects: { nickname: string }
     * Returns: { success: boolean, error?: string }
     */
    @PluginMethod
    public void startAccepting(PluginCall call) {
        String nickname = call.getString("nickname");

        if (nickname == null || nickname.isEmpty()) {
            call.reject("Nickname is required");
            return;
        }

        executorService.execute(() -> {
            try {
                // STREAM ACCEPT is handled asynchronously - we just initiate it
                String cmd = String.format("STREAM ACCEPT ID=%s SILENT=false", nickname);
                socketManager.sendCommand(cmd);

                JSObject result = new JSObject();
                result.put("success", true);
                call.resolve(result);

            } catch (Exception e) {
                Log.e(TAG, "STREAM ACCEPT failed: " + e.getMessage(), e);
                call.reject("STREAM ACCEPT failed: " + e.getMessage());
            }
        });
    }

    /**
     * Send data over a stream.
     * Expects: { streamId: number, data: string }
     * Returns: { success: boolean, bytesSent?: number, error?: string }
     */
    @PluginMethod
    public void send(PluginCall call) {
        int streamId = call.getInt("streamId", -1);
        String data = call.getString("data");

        if (streamId == -1) {
            call.reject("streamId is required");
            return;
        }

        if (data == null || data.isEmpty()) {
            call.reject("data is required and cannot be empty");
            return;
        }

        final String finalData = data;

        executorService.execute(() -> {
            try {
                // SAM sends data raw over the socket after STREAM CONNECT/ACCEPT
                // For now, we'll send it as a command to be written
                boolean success = socketManager.sendData(finalData);

                JSObject result = new JSObject();
                result.put("success", success);
                if (success) {
                    result.put("bytesSent", finalData.length());
                }
                call.resolve(result);

            } catch (Exception e) {
                Log.e(TAG, "Send failed: " + e.getMessage(), e);
                call.reject("Send failed: " + e.getMessage());
            }
        });
    }

    /**
     * Close a specific stream.
     * Expects: { streamId: number }
     * Returns: { success: boolean, error?: string }
     */
    @PluginMethod
    public void closeStream(PluginCall call) {
        int streamId = call.getInt("streamId", -1);

        if (streamId == -1) {
            call.reject("streamId is required");
            return;
        }

        executorService.execute(() -> {
            try {
                // Close the underlying socket connection for this stream
                socketManager.closeStream();

                JSObject result = new JSObject();
                result.put("success", true);
                call.resolve(result);

            } catch (Exception e) {
                Log.e(TAG, "Close stream failed: " + e.getMessage(), e);
                call.reject("Close stream failed: " + e.getMessage());
            }
        });
    }

    @Override
    protected void handleOnDestroy() {
        Log.d(TAG, "Plugin destroying, shutting down SAM");
        eventEmitter.clearListeners();
        socketManager.shutdown();
        executorService.shutdown();
        try {
            if (!executorService.awaitTermination(5, TimeUnit.SECONDS)) {
                executorService.shutdownNow();
            }
        } catch (InterruptedException e) {
            executorService.shutdownNow();
        }
        super.handleOnDestroy();
    }

    private void notifyStatusChange(String status) {
        JSObject data = new JSObject();
        data.put("status", status);
        notifyListeners(EVENT_STATUS, data);
    }

    private String parseVersion(String response) {
        return parseParam(response, "VERSION");
    }

    private String parseParam(String response, String param) {
        if (response == null) return null;

        String pattern = param + "=";
        int start = response.indexOf(pattern);
        if (start == -1) return null;

        start += pattern.length();

        // Find the next parameter (PARAM=) or end of string
        // SAM responses have format: RESULT=OK PARAM=value PARAM2=value2 ...
        int end = response.length();
        int nextParamStart = response.indexOf(' ', start);
        if (nextParamStart != -1) {
            // Check if this is a new parameter (PARAM=)
            int nextEquals = response.indexOf('=', nextParamStart);
            if (nextEquals != -1) {
                // Find the space before the next parameter
                end = nextParamStart;
            }
        }

        return response.substring(start, end).trim();
    }

    /**
     * Parse PUB or PRIV parameter from DEST REPLY response.
     * DEST REPLY format: "DEST REPLY PUB=<base64> PRIV=<base64>"
     *
     * IMPORTANT: Base64-encoded I2P destinations can contain spaces.
     * This method uses the known structure (PUB followed by PRIV) to extract
     * the full value without truncating at internal spaces.
     */
    private String parseDestParam(String response, String param) {
        if (response == null) return null;

        String pattern = param + "=";
        int start = response.indexOf(pattern);
        if (start == -1) return null;

        start += pattern.length();

        int end;
        if (param.equals("PUB")) {
            // PUB value ends where PRIV= starts
            int privStart = response.indexOf("PRIV=", start);
            if (privStart != -1) {
                end = privStart - 1; // Exclude the space before PRIV
            } else {
                end = response.length();
            }
        } else if (param.equals("PRIV")) {
            // PRIV is the last parameter, goes to end of string
            end = response.length();
        } else {
            // Fallback to standard parsing for other params
            int nextSpace = response.indexOf(' ', start);
            end = (nextSpace != -1) ? nextSpace : response.length();
        }

        return response.substring(start, end).trim();
    }

    /**
     * Map signature type name to numeric value for i2pd compatibility.
     * i2pd's SAM implementation expects numeric signature type identifiers.
     */
    private String mapSignatureTypeToNumber(String sigType) {
        if (sigType == null || sigType.isEmpty()) {
            return "7"; // Default: EdDSA_SHA512_Ed25519
        }

        // If already numeric, return as-is
        if (sigType.matches("\\d+")) {
            return sigType;
        }

        // Map common signature type names to numeric values
        switch (sigType) {
            case "DSA_SHA1":
                return "0";
            case "ECDSA_SHA256_P256":
                return "1";
            case "ECDSA_SHA384_P384":
                return "2";
            case "ECDSA_SHA512_P521":
                return "3";
            case "RSA_SHA256_2048":
                return "4";
            case "RSA_SHA384_3072":
                return "5";
            case "RSA_SHA512_4096":
                return "6";
            case "EdDSA_SHA512_Ed25519":
                return "7"; // Default, most common
            case "EdDSA_SHA512_Ed25519ph":
                return "8";
            case "GOSTR3410_CRYPTO_PRO_A":
                return "9";
            case "GOSTR3410_CRYPTO_PRO_B":
                return "10";
            case "GOSTR3410_CRYPTO_PRO_C":
                return "11";
            case "ECDSA_SHA256_P256_RED":
                return "12";
            default:
                Log.w(TAG, "Unknown signature type: " + sigType + ", using default (7)");
                return "7"; // Default to EdDSA_SHA512_Ed25519
        }
    }
}
