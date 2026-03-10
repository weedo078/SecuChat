package com.secuchat.app.plugin.SAMPlugin;

import android.util.Log;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.HashMap;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * SAM v3.1 Protocol Handler.
 *
 * Parses and builds SAM protocol commands and responses.
 * SAM protocol is line-based with key=value pairs.
 *
 * Protocol flow:
 *   1. HELLO VERSION → HELLO REPLY RESULT=OK
 *   2. DEST GENERATE → DEST REPLY PUB=... PRIV=...
 *   3. SESSION CREATE → SESSION STATUS RESULT=OK
 *   4. STREAM CONNECT / STREAM ACCEPT
 */
public class SAMProtocolHandler {

    private static final String TAG = "SAMProtocolHandler";

    // SAM protocol version
    public static final String SAM_VERSION_MIN = "3.1";
    public static final String SAM_VERSION_MAX = "3.1";

    // Response patterns
    private static final Pattern KEY_VALUE_PATTERN = Pattern.compile("(\\w+)=([^\\s]+)");

    /**
     * Parse a HELLO REPLY response.
     *
     * @param response SAM response line (e.g., "HELLO REPLY RESULT=OK VERSION=3.1")
     * @return true if RESULT=OK
     */
    public static boolean parseHelloResponse(String response) {
        if (response == null || response.isEmpty()) {
            return false;
        }

        Log.d(TAG, "Parsing HELLO response: " + response);

        Map<String, String> params = parseKeyValuePairs(response);
        String result = params.get("RESULT");

        return "OK".equals(result);
    }

    /**
     * Parse a DEST REPLY response.
     *
     * @param response SAM response (e.g., "DEST REPLY PUB=abc PRIV=xyz")
     * @return JSONObject with "pub" and "priv" keys, or null on error
     */
    public static JSONObject parseDestReply(String response) {
        if (response == null || response.isEmpty()) {
            return null;
        }

        Log.d(TAG, "Parsing DEST REPLY: " + response.substring(0, Math.min(50, response.length())) + "...");

        Map<String, String> params = parseKeyValuePairs(response);
        String pub = params.get("PUB");
        String priv = params.get("PRIV");

        if (pub == null || priv == null) {
            Log.e(TAG, "DEST REPLY missing PUB or PRIV");
            return null;
        }

        try {
            JSONObject result = new JSONObject();
            result.put("pub", pub);
            result.put("priv", priv);
            return result;
        } catch (JSONException e) {
            Log.e(TAG, "Failed to create JSON result", e);
            return null;
        }
    }

    /**
     * Parse a SESSION STATUS response.
     *
     * @param response SAM response (e.g., "SESSION STATUS RESULT=OK DESTINATION=abc")
     * @return true if RESULT=OK
     */
    public static boolean parseSessionStatus(String response) {
        if (response == null || response.isEmpty()) {
            return false;
        }

        Log.d(TAG, "Parsing SESSION STATUS: " + response);

        Map<String, String> params = parseKeyValuePairs(response);
        String result = params.get("RESULT");

        return "OK".equals(result);
    }

    /**
     * Parse a STREAM STATUS response.
     *
     * @param response SAM response (e.g., "STREAM STATUS RESULT=OK" or "STREAM STATUS RESULT=CANT_REACH_PEER")
     * @return JSONObject with "success" (boolean), "result" (string), and optional "message"
     */
    public static JSONObject parseStreamStatus(String response) {
        if (response == null || response.isEmpty()) {
            return createErrorResult("Empty response");
        }

        Log.d(TAG, "Parsing STREAM STATUS: " + response);

        Map<String, String> params = parseKeyValuePairs(response);
        String result = params.get("RESULT");

        try {
            JSONObject jsonResult = new JSONObject();

            if ("OK".equals(result)) {
                jsonResult.put("success", true);
            } else {
                jsonResult.put("success", false);
            }

            jsonResult.put("result", result != null ? result : "UNKNOWN");

            // Extract destination if present (for incoming connections)
            String destination = params.get("DESTINATION");
            if (destination != null) {
                jsonResult.put("destination", destination);
            }

            // Include full message for error cases
            if (!"OK".equals(result)) {
                jsonResult.put("message", "STREAM failed with RESULT=" + result);
            }

            return jsonResult;
        } catch (JSONException e) {
            Log.e(TAG, "Failed to create JSON result", e);
            return createErrorResult("JSON error: " + e.getMessage());
        }
    }

    /**
     * Build a HELLO command.
     *
     * @return HELLO VERSION MIN=3.1 MAX=3.1
     */
    public static String buildHelloCommand() {
        return "HELLO VERSION MIN=" + SAM_VERSION_MIN + " MAX=" + SAM_VERSION_MAX + "\n";
    }

    /**
     * Build a DEST GENERATE command.
     *
     * @return DEST GENERATE SIGNATURE_TYPE=EdDSA_SHA512_Ed25519
     */
    public static String buildDestGenerate() {
        return "DEST GENERATE SIGNATURE_TYPE=" + SAMDestination.SIGNATURE_TYPE + "\n";
    }

    /**
     * Build a SESSION CREATE command.
     *
     * @param id Session ID (nickname)
     * @param dest Private destination key (I2P Base64)
     * @return SESSION CREATE STYLE=STREAM ID=xxx DESTINATION=yyy
     */
    public static String buildSessionCreate(String id, String dest) {
        return "SESSION CREATE STYLE=STREAM ID=" + id + " DESTINATION=" + dest + "\n";
    }

    /**
     * Build a STREAM CONNECT command.
     *
     * @param sessionId Session ID
     * @param destination Target destination (b32 or full)
     * @return STREAM CONNECT ID=xxx DESTINATION=yyy SILENT=false
     */
    public static String buildStreamConnect(String sessionId, String destination) {
        return "STREAM CONNECT ID=" + sessionId + " DESTINATION=" + destination + " SILENT=false\n";
    }

    /**
     * Build a STREAM ACCEPT command.
     *
     * @param sessionId Session ID
     * @return STREAM ACCEPT ID=xxx SILENT=false
     */
    public static String buildStreamAccept(String sessionId) {
        return "STREAM ACCEPT ID=" + sessionId + " SILENT=false\n";
    }

    /**
     * Build a STREAM FORWARD command (for server mode).
     *
     * @param sessionId Session ID
     * @param port Local port to forward
     * @return STREAM FORWARD ID=xxx PORT=xxx SILENT=false
     */
    public static String buildStreamForward(String sessionId, int port) {
        return "STREAM FORWARD ID=" + sessionId + " PORT=" + port + " SILENT=false\n";
    }

    /**
     * Build a NAMING LOOKUP command.
     *
     * @param name Hostname to lookup (e.g., "example.i2p")
     * @return NAMING LOOKUP NAME=xxx
     */
    public static String buildNamingLookup(String name) {
        return "NAMING LOOKUP NAME=" + name + "\n";
    }

    /**
     * Parse NAMING REPLY response.
     *
     * @param response SAM response (e.g., "NAMING REPLY RESULT=OK NAME=xxx VALUE=yyy")
     * @return JSONObject with result, name, and value
     */
    public static JSONObject parseNamingReply(String response) {
        if (response == null || response.isEmpty()) {
            return null;
        }

        Log.d(TAG, "Parsing NAMING REPLY: " + response);

        Map<String, String> params = parseKeyValuePairs(response);

        try {
            JSONObject result = new JSONObject();
            result.put("result", params.get("RESULT"));
            result.put("name", params.get("NAME"));
            result.put("value", params.get("VALUE"));
            return result;
        } catch (JSONException e) {
            Log.e(TAG, "Failed to create JSON result", e);
            return null;
        }
    }

    /**
     * Parse generic SAM response into key-value map.
     *
     * @param response SAM response line
     * @return Map of key-value pairs
     */
    public static Map<String, String> parseKeyValuePairs(String response) {
        Map<String, String> params = new HashMap<>();

        if (response == null) {
            return params;
        }

        Matcher matcher = KEY_VALUE_PATTERN.matcher(response);
        while (matcher.find()) {
            String key = matcher.group(1);
            String value = matcher.group(2);
            params.put(key, value);
        }

        return params;
    }

    /**
     * Check if a response indicates success (RESULT=OK).
     *
     * @param response SAM response
     * @return true if RESULT=OK
     */
    public static boolean isSuccess(String response) {
        return response != null && response.contains("RESULT=OK");
    }

    /**
     * Extract error message from a failed response.
     *
     * @param response SAM response
     * @return Error message or null
     */
    public static String getErrorMessage(String response) {
        if (response == null) {
            return "No response";
        }

        Map<String, String> params = parseKeyValuePairs(response);
        String result = params.get("RESULT");

        if ("OK".equals(result)) {
            return null;
        }

        return result != null ? result : "Unknown error";
    }

    /**
     * Create an error result JSON object.
     */
    private static JSONObject createErrorResult(String message) {
        try {
            JSONObject result = new JSONObject();
            result.put("success", false);
            result.put("result", "ERROR");
            result.put("message", message);
            return result;
        } catch (JSONException e) {
            return new JSONObject();
        }
    }

    /**
     * Validate a session ID (nickname).
     * SAM requires alphanumeric IDs without spaces.
     *
     * @param id Session ID to validate
     * @return true if valid
     */
    public static boolean isValidSessionId(String id) {
        if (id == null || id.isEmpty()) {
            return false;
        }
        return id.matches("^[a-zA-Z0-9_-]+$");
    }

    /**
     * Sanitize a string for use in SAM commands.
     * Removes newlines and control characters.
     *
     * @param input Input string
     * @return Sanitized string
     */
    public static String sanitize(String input) {
        if (input == null) {
            return "";
        }
        return input.replaceAll("[\\r\\n\\x00-\\x1F\\x7F]", "");
    }
}
