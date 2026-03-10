package com.secuchat.app.plugin.SAMPlugin;

/**
 * Error codes for SAM (Simple Anonymous Messaging) plugin.
 * Used for consistent error handling across the plugin.
 */
public final class SAMErrorCodes {

    private SAMErrorCodes() {
        // Utility class, prevent instantiation
    }

    /**
     * Connection to SAM bridge failed.
     * Could be due to i2pd not running, wrong host/port, or network issues.
     */
    public static final String CONNECTION_FAILED = "CONNECTION_FAILED";

    /**
     * Operation timed out.
     * SAM command did not receive a response within the expected timeframe.
     */
    public static final String TIMEOUT = "TIMEOUT";

    /**
     * Invalid response from SAM bridge.
     * Response could not be parsed or contained unexpected data.
     */
    public static final String INVALID_RESPONSE = "INVALID_RESPONSE";

    /**
     * Stream was closed unexpectedly.
     * The connection to the peer was lost.
     */
    public static final String STREAM_CLOSED = "STREAM_CLOSED";

    /**
     * SAM session error.
     * Session creation failed or session was invalidated.
     */
    public static final String SESSION_ERROR = "SESSION_ERROR";

    /**
     * Destination generation failed.
     * Could not generate a new I2P destination keypair.
     */
    public static final String DESTINATION_ERROR = "DESTINATION_ERROR";

    /**
     * Peer not reachable.
     * Could not connect to the specified I2P destination.
     */
    public static final String PEER_UNREACHABLE = "PEER_UNREACHABLE";

    /**
     * Invalid configuration.
     * SAM configuration is missing or invalid.
     */
    public static final String INVALID_CONFIG = "INVALID_CONFIG";

    /**
     * HELLO handshake failed.
     * Could not negotiate SAM protocol version with the bridge.
     */
    public static final String HELLO_FAILED = "HELLO_FAILED";

    /**
     * Maximum reconnection attempts exceeded.
     * Could not reestablish connection after multiple retries.
     */
    public static final String MAX_RECONNECT_EXCEEDED = "MAX_RECONNECT_EXCEEDED";

    /**
     * Unknown error.
     * An unexpected error occurred.
     */
    public static final String UNKNOWN = "UNKNOWN";

    /**
     * Get a human-readable description for an error code.
     *
     * @param errorCode The error code
     * @return Human-readable description
     */
    public static String getDescription(String errorCode) {
        if (errorCode == null) {
            return "Unknown error";
        }

        switch (errorCode) {
            case CONNECTION_FAILED:
                return "Failed to connect to SAM bridge. Check that i2pd is running with SAM enabled.";
            case TIMEOUT:
                return "Operation timed out. The SAM bridge did not respond in time.";
            case INVALID_RESPONSE:
                return "Received invalid response from SAM bridge.";
            case STREAM_CLOSED:
                return "Connection to peer was closed unexpectedly.";
            case SESSION_ERROR:
                return "SAM session error. The session may have expired or been invalidated.";
            case DESTINATION_ERROR:
                return "Failed to generate I2P destination.";
            case PEER_UNREACHABLE:
                return "Peer is not reachable. They may be offline or their LeaseSet has not propagated yet.";
            case INVALID_CONFIG:
                return "Invalid SAM configuration. Check host, port, and enabled settings.";
            case HELLO_FAILED:
                return "SAM HELLO handshake failed. Check SAM protocol version compatibility.";
            case MAX_RECONNECT_EXCEEDED:
                return "Maximum reconnection attempts exceeded. Please check your I2P connection.";
            case UNKNOWN:
            default:
                return "An unexpected error occurred: " + errorCode;
        }
    }
}
