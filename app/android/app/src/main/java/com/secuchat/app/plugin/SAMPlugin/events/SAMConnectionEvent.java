package com.secuchat.app.plugin.SAMPlugin.events;

import com.getcapacitor.JSObject;

/**
 * Represents a SAM connection event.
 * Emitted for stream connect/disconnect and errors.
 */
public class SAMConnectionEvent {

    public enum Type {
        STREAM_CONNECTED,
        STREAM_CLOSED,
        ERROR
    }

    private final Type type;
    private final String peerDestination;
    private final int streamId;
    private final String reason;
    private final String error;
    private final String errorCode;
    private final long timestamp;

    private SAMConnectionEvent(Type type, String peerDestination, int streamId,
                               String reason, String error, String errorCode) {
        this.type = type;
        this.peerDestination = peerDestination;
        this.streamId = streamId;
        this.reason = reason;
        this.error = error;
        this.errorCode = errorCode;
        this.timestamp = System.currentTimeMillis();
    }

    public static SAMConnectionEvent streamConnected(String peerDestination, int streamId) {
        return new SAMConnectionEvent(Type.STREAM_CONNECTED, peerDestination, streamId,
                null, null, null);
    }

    public static SAMConnectionEvent streamClosed(int streamId, String reason) {
        return new SAMConnectionEvent(Type.STREAM_CLOSED, null, streamId,
                reason, null, null);
    }

    public static SAMConnectionEvent error(String error, String errorCode, int streamId) {
        return new SAMConnectionEvent(Type.ERROR, null, streamId,
                null, error, errorCode);
    }

    public Type getType() {
        return type;
    }

    public String getPeerDestination() {
        return peerDestination;
    }

    public int getStreamId() {
        return streamId;
    }

    public String getReason() {
        return reason;
    }

    public String getError() {
        return error;
    }

    public String getErrorCode() {
        return errorCode;
    }

    public long getTimestamp() {
        return timestamp;
    }

    /**
     * Convert to JSObject for Capacitor event emission.
     */
    public JSObject toJSObject() {
        JSObject obj = new JSObject();
        obj.put("type", type.name().toLowerCase());
        obj.put("streamId", streamId);
        obj.put("timestamp", timestamp);

        if (peerDestination != null) {
            obj.put("peerDestination", peerDestination);
        }

        if (reason != null) {
            obj.put("reason", reason);
        }

        if (error != null) {
            obj.put("error", error);
        }

        if (errorCode != null) {
            obj.put("errorCode", errorCode);
        }

        return obj;
    }

    @Override
    public String toString() {
        return "SAMConnectionEvent{" +
                "type=" + type +
                ", streamId=" + streamId +
                ", peerDestination='" + peerDestination + '\'' +
                ", reason='" + reason + '\'' +
                ", error='" + error + '\'' +
                ", errorCode='" + errorCode + '\'' +
                ", timestamp=" + timestamp +
                '}';
    }
}
