package com.secuchat.app.plugin.SAMPlugin;

import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

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
    private static final String EVENT_MESSAGE = "samMessage";
    private static final String EVENT_STATUS = "samStatus";

    private final SAMSocketManager socketManager;
    private final ExecutorService executorService;

    public SAMPlugin() {
        this.socketManager = SAMSocketManager.getInstance();
        this.executorService = Executors.newSingleThreadExecutor();
    }

    @Override
    public void notify(String eventName, JSObject data) {
        notifyListeners(eventName, data, true);
    }

    @Override
    public void load() {
        Log.d(TAG, "SAMPlugin loaded");
    }

    /**
     * Connect to the SAM bridge.
     * Expects: { host: string, port: number }
     * Returns: { connected: boolean, error?: string }
     */
    @PluginMethod
    public void connect(PluginCall call) {
        String host = call.getString("host", "127.0.0.1");
        int port = call.getInt("port", 7656);

        Log.d(TAG, "Connect requested to " + host + ":" + port);

        executorService.execute(() -> {
            try {
                boolean connected = socketManager.connect(host, port);

                JSObject result = new JSObject();
                result.put("connected", connected);

                if (!connected) {
                    result.put("error", "Failed to connect to SAM at " + host + ":" + port);
                }

                call.resolve(result);

                // Notify status change
                notifyStatusChange(connected ? "connected" : "disconnected");

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
        Log.d(TAG, "Disconnect requested");

        executorService.execute(() -> {
            try {
                socketManager.disconnect();

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
     * Returns: { success: boolean, pub?: string, priv?: string, error?: string }
     */
    @PluginMethod
    public void generateDestination(PluginCall call) {
        String sigType = call.getString("signatureType", "EdDSA_SHA512_Ed25519");

        executorService.execute(() -> {
            try {
                String response = socketManager.sendCommandAndWait("DEST GENERATE SIGNATURE_TYPE=" + sigType);

                JSObject result = new JSObject();

                if (response != null && response.contains("RESULT=OK")) {
                    String pub = parseParam(response, "PUB");
                    String priv = parseParam(response, "PRIV");

                    result.put("success", true);
                    result.put("pub", pub);
                    result.put("priv", priv);
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
     * Expects: { id: string, destination: string, style?: string }
     * Returns: { success: boolean, error?: string }
     */
    @PluginMethod
    public void createSession(PluginCall call) {
        String id = call.getString("id");
        String destination = call.getString("destination");
        String style = call.getString("style", "STREAM");

        if (id == null || id.isEmpty()) {
            call.reject("Session ID is required");
            return;
        }

        if (destination == null || destination.isEmpty()) {
            call.reject("Destination is required");
            return;
        }

        executorService.execute(() -> {
            try {
                String cmd = String.format("SESSION CREATE STYLE=%s ID=%s DESTINATION=%s",
                    style, id, destination);
                String response = socketManager.sendCommandAndWait(cmd);

                JSObject result = new JSObject();

                if (response != null && response.contains("RESULT=OK")) {
                    result.put("success", true);
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

    @Override
    protected void handleOnDestroy() {
        Log.d(TAG, "Plugin destroying, shutting down SAM");
        socketManager.shutdown();
        executorService.shutdown();
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
        int end = response.indexOf(' ', start);
        if (end == -1) end = response.length();

        return response.substring(start, end).trim();
    }
}
