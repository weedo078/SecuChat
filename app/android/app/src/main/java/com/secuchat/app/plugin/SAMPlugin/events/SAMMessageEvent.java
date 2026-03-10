package com.secuchat.app.plugin.SAMPlugin.events;

import com.getcapacitor.JSObject;

/**
 * Represents a SAM message event.
 * Emitted when data is received from a peer.
 */
public class SAMMessageEvent {

    private final String from;
    private final String data;
    private final int streamId;
    private final long timestamp;

    public SAMMessageEvent(String from, String data, int streamId) {
        this.from = from;
        this.data = data;
        this.streamId = streamId;
        this.timestamp = System.currentTimeMillis();
    }

    public String getFrom() {
        return from;
    }

    public String getData() {
        return data;
    }

    public int getStreamId() {
        return streamId;
    }

    public long getTimestamp() {
        return timestamp;
    }

    /**
     * Convert to JSObject for Capacitor event emission.
     */
    public JSObject toJSObject() {
        JSObject obj = new JSObject();
        obj.put("from", from);
        obj.put("data", data);
        obj.put("streamId", streamId);
        obj.put("timestamp", timestamp);
        return obj;
    }

    @Override
    public String toString() {
        return "SAMMessageEvent{" +
                "from='" + from + '\'' +
                ", streamId=" + streamId +
                ", timestamp=" + timestamp +
                ", dataLength=" + (data != null ? data.length() : 0) +
                '}';
    }
}
