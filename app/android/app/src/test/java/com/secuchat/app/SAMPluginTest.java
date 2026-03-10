package com.secuchat.app;

import com.secuchat.app.plugin.SAMPlugin.I2PBase64;
import com.secuchat.app.plugin.SAMPlugin.SAMConfig;
import com.secuchat.app.plugin.SAMPlugin.SAMErrorCodes;
import com.secuchat.app.plugin.SAMPlugin.SAMProtocolHandler;

import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.junit.runners.JUnit4;

import java.util.Map;

import static org.junit.Assert.*;

/**
 * Unit tests for SAM Plugin components.
 * Tests I2PBase64 encoding/decoding, SAMConfig, and error codes.
 */
@RunWith(JUnit4.class)
public class SAMPluginTest {

    // =========================================================================
    // I2PBase64 Tests
    // =========================================================================

    @Test
    public void testI2PBase64EncodeEmpty() {
        assertEquals("", I2PBase64.encode(new byte[0]));
        assertEquals("", I2PBase64.encode(null));
    }

    @Test
    public void testI2PBase64EncodeBasic() {
        // "hello" in standard Base64: "aGVsbG8="
        // In I2P Base64: "aGVsbG8" (no padding)
        byte[] input = "hello".getBytes();
        String encoded = I2PBase64.encode(input);
        assertEquals("aGVsbG8", encoded);
    }

    @Test
    public void testI2PBase64EncodeWithSpecialChars() {
        // Bytes that produce + and / in standard Base64
        // 0xFB 0xFF 0xFF -> +/// in standard, -~~~ in I2P
        byte[] input = new byte[]{(byte) 0xFB, (byte) 0xFF, (byte) 0xFF};
        String encoded = I2PBase64.encode(input);
        assertTrue("Should contain ~ instead of /", encoded.contains("~"));
        assertFalse("Should not contain /", encoded.contains("/"));
        assertFalse("Should not contain +", encoded.contains("+"));
    }

    @Test
    public void testI2PBase64DecodeEmpty() {
        assertArrayEquals(new byte[0], I2PBase64.decode(""));
        assertArrayEquals(new byte[0], I2PBase64.decode(null));
    }

    @Test
    public void testI2PBase64RoundTrip() {
        byte[] original = "Hello, I2P World!".getBytes();
        String encoded = I2PBase64.encode(original);
        byte[] decoded = I2PBase64.decode(encoded);
        assertArrayEquals(original, decoded);
    }

    @Test
    public void testI2PBase64DecodeWithSpecialChars() {
        // -~~~ should decode to same bytes as +///
        String i2pBase64 = "-~~~";
        byte[] decoded = I2PBase64.decode(i2pBase64);

        // Verify by encoding back
        String reEncoded = I2PBase64.encode(decoded);
        assertEquals(i2pBase64, reEncoded);
    }

    @Test
    public void testI2PBase64IsValid() {
        assertTrue(I2PBase64.isValid("abcABC123"));
        assertTrue(I2PBase64.isValid("with-special-chars-~"));
        assertFalse(I2PBase64.isValid("with+plus"));
        assertFalse(I2PBase64.isValid("with/slash"));
        assertFalse(I2PBase64.isValid("with=padding"));
        assertFalse(I2PBase64.isValid(""));
        assertFalse(I2PBase64.isValid(null));
    }

    @Test
    public void testI2PBase64FromStandardBase64() {
        String standard = "aGVsbG8+/=";
        String i2p = I2PBase64.fromStandardBase64(standard);
        assertEquals("aGVsbG8-~", i2p);
    }

    @Test
    public void testI2PBase64ToStandardBase64() {
        String i2p = "aGVsbG8-~";
        String standard = I2PBase64.toStandardBase64(i2p);
        assertEquals("aGVsbG8+~/", standard);
    }

    // =========================================================================
    // SAMConfig Tests
    // =========================================================================

    @Test
    public void testSAMConfigDefaultConstructor() {
        SAMConfig config = new SAMConfig();
        assertEquals("127.0.0.1", config.getHost());
        assertEquals(7656, config.getPort());
        assertFalse(config.isEnabled());
    }

    @Test
    public void testSAMConfigParameterizedConstructor() {
        SAMConfig config = new SAMConfig("192.168.1.1", 7657, true);
        assertEquals("192.168.1.1", config.getHost());
        assertEquals(7657, config.getPort());
        assertTrue(config.isEnabled());
    }

    @Test
    public void testSAMConfigSetters() {
        SAMConfig config = new SAMConfig();
        config.setHost("10.0.0.1");
        config.setPort(8080);
        config.setEnabled(true);

        assertEquals("10.0.0.1", config.getHost());
        assertEquals(8080, config.getPort());
        assertTrue(config.isEnabled());
    }

    @Test
    public void testSAMConfigToString() {
        SAMConfig config = new SAMConfig("127.0.0.1", 7656, true);
        String str = config.toString();
        assertTrue(str.contains("127.0.0.1"));
        assertTrue(str.contains("7656"));
        assertTrue(str.contains("true"));
    }

    // =========================================================================
    // SAMErrorCodes Tests
    // =========================================================================

    @Test
    public void testErrorCodesExist() {
        // Verify all expected error codes exist
        assertEquals("CONNECTION_FAILED", SAMErrorCodes.CONNECTION_FAILED);
        assertEquals("TIMEOUT", SAMErrorCodes.TIMEOUT);
        assertEquals("INVALID_RESPONSE", SAMErrorCodes.INVALID_RESPONSE);
        assertEquals("STREAM_CLOSED", SAMErrorCodes.STREAM_CLOSED);
        assertEquals("SESSION_ERROR", SAMErrorCodes.SESSION_ERROR);
        assertEquals("DESTINATION_ERROR", SAMErrorCodes.DESTINATION_ERROR);
        assertEquals("PEER_UNREACHABLE", SAMErrorCodes.PEER_UNREACHABLE);
        assertEquals("INVALID_CONFIG", SAMErrorCodes.INVALID_CONFIG);
        assertEquals("HELLO_FAILED", SAMErrorCodes.HELLO_FAILED);
        assertEquals("MAX_RECONNECT_EXCEEDED", SAMErrorCodes.MAX_RECONNECT_EXCEEDED);
        assertEquals("UNKNOWN", SAMErrorCodes.UNKNOWN);
    }

    @Test
    public void testErrorCodeDescriptions() {
        assertNotNull(SAMErrorCodes.getDescription(SAMErrorCodes.CONNECTION_FAILED));
        assertNotNull(SAMErrorCodes.getDescription(SAMErrorCodes.TIMEOUT));
        assertNotNull(SAMErrorCodes.getDescription(SAMErrorCodes.INVALID_RESPONSE));
        assertNotNull(SAMErrorCodes.getDescription(SAMErrorCodes.STREAM_CLOSED));

        // Verify descriptions are meaningful
        assertTrue(SAMErrorCodes.getDescription(SAMErrorCodes.CONNECTION_FAILED).contains("connect"));
        assertTrue(SAMErrorCodes.getDescription(SAMErrorCodes.TIMEOUT).contains("time"));
    }

    @Test
    public void testErrorCodeDescriptionNull() {
        String desc = SAMErrorCodes.getDescription(null);
        assertNotNull(desc);
        assertTrue(desc.contains("Unknown"));
    }

    @Test
    public void testErrorCodeDescriptionUnknown() {
        String desc = SAMErrorCodes.getDescription("CUSTOM_ERROR");
        assertNotNull(desc);
        assertTrue(desc.contains("CUSTOM_ERROR"));
    }

    // =========================================================================
    // SAMProtocolHandler Tests
    // =========================================================================

    @Test
    public void testParseHelloResponseSuccess() {
        String response = "HELLO REPLY RESULT=OK VERSION=3.1";
        assertTrue(SAMProtocolHandler.parseHelloResponse(response));
    }

    @Test
    public void testParseHelloResponseFailure() {
        String response = "HELLO REPLY RESULT=NOVERSION";
        assertFalse(SAMProtocolHandler.parseHelloResponse(response));
    }

    @Test
    public void testParseHelloResponseNull() {
        assertFalse(SAMProtocolHandler.parseHelloResponse(null));
        assertFalse(SAMProtocolHandler.parseHelloResponse(""));
    }

    @Test
    public void testParseDestReplySuccess() {
        String response = "DEST REPLY PUB=abc123 PRIV=xyz789";
        JSONObject result = SAMProtocolHandler.parseDestReply(response);

        assertNotNull(result);
        assertEquals("abc123", result.optString("pub"));
        assertEquals("xyz789", result.optString("priv"));
    }

    @Test
    public void testParseDestReplyMissingPriv() {
        String response = "DEST REPLY PUB=abc123";
        JSONObject result = SAMProtocolHandler.parseDestReply(response);

        assertNull(result);
    }

    @Test
    public void testParseDestReplyNull() {
        assertNull(SAMProtocolHandler.parseDestReply(null));
        assertNull(SAMProtocolHandler.parseDestReply(""));
    }

    @Test
    public void testParseSessionStatusSuccess() {
        String response = "SESSION STATUS RESULT=OK DESTINATION=dest123";
        assertTrue(SAMProtocolHandler.parseSessionStatus(response));
    }

    @Test
    public void testParseSessionStatusFailure() {
        String response = "SESSION STATUS RESULT=DUPLICATED_ID";
        assertFalse(SAMProtocolHandler.parseSessionStatus(response));
    }

    @Test
    public void testParseStreamStatusSuccess() {
        String response = "STREAM STATUS RESULT=OK";
        JSONObject result = SAMProtocolHandler.parseStreamStatus(response);

        assertNotNull(result);
        assertTrue(result.optBoolean("success"));
        assertEquals("OK", result.optString("result"));
    }

    @Test
    public void testParseStreamStatusWithDestination() {
        String response = "STREAM STATUS RESULT=OK DESTINATION=peerDest123";
        JSONObject result = SAMProtocolHandler.parseStreamStatus(response);

        assertNotNull(result);
        assertTrue(result.optBoolean("success"));
        assertEquals("peerDest123", result.optString("destination"));
    }

    @Test
    public void testParseStreamStatusFailure() {
        String response = "STREAM STATUS RESULT=CANT_REACH_PEER";
        JSONObject result = SAMProtocolHandler.parseStreamStatus(response);

        assertNotNull(result);
        assertFalse(result.optBoolean("success"));
        assertEquals("CANT_REACH_PEER", result.optString("result"));
        assertNotNull(result.optString("message"));
    }

    @Test
    public void testBuildHelloCommand() {
        String cmd = SAMProtocolHandler.buildHelloCommand();
        assertEquals("HELLO VERSION MIN=3.1 MAX=3.1\n", cmd);
    }

    @Test
    public void testBuildDestGenerate() {
        String cmd = SAMProtocolHandler.buildDestGenerate();
        assertEquals("DEST GENERATE SIGNATURE_TYPE=EdDSA_SHA512_Ed25519\n", cmd);
    }

    @Test
    public void testBuildSessionCreate() {
        String cmd = SAMProtocolHandler.buildSessionCreate("test-session", "priv-key-b64");
        assertEquals("SESSION CREATE STYLE=STREAM ID=test-session DESTINATION=priv-key-b64\n", cmd);
    }

    @Test
    public void testBuildStreamConnect() {
        String cmd = SAMProtocolHandler.buildStreamConnect("my-session", "peer-dest-b64");
        assertEquals("STREAM CONNECT ID=my-session DESTINATION=peer-dest-b64 SILENT=false\n", cmd);
    }

    @Test
    public void testBuildStreamAccept() {
        String cmd = SAMProtocolHandler.buildStreamAccept("my-session");
        assertEquals("STREAM ACCEPT ID=my-session SILENT=false\n", cmd);
    }

    @Test
    public void testBuildStreamForward() {
        String cmd = SAMProtocolHandler.buildStreamForward("my-session", 8080);
        assertEquals("STREAM FORWARD ID=my-session PORT=8080 SILENT=false\n", cmd);
    }

    @Test
    public void testBuildNamingLookup() {
        String cmd = SAMProtocolHandler.buildNamingLookup("example.i2p");
        assertEquals("NAMING LOOKUP NAME=example.i2p\n", cmd);
    }

    @Test
    public void testParseNamingReply() {
        String response = "NAMING REPLY RESULT=OK NAME=example.i2p VALUE=dest123";
        JSONObject result = SAMProtocolHandler.parseNamingReply(response);

        assertNotNull(result);
        assertEquals("OK", result.optString("result"));
        assertEquals("example.i2p", result.optString("name"));
        assertEquals("dest123", result.optString("value"));
    }

    @Test
    public void testParseKeyValuePairs() {
        String response = "KEY1=value1 KEY2=value2 KEY3=value3";
        Map<String, String> pairs = SAMProtocolHandler.parseKeyValuePairs(response);

        assertEquals(3, pairs.size());
        assertEquals("value1", pairs.get("KEY1"));
        assertEquals("value2", pairs.get("KEY2"));
        assertEquals("value3", pairs.get("KEY3"));
    }

    @Test
    public void testParseKeyValuePairsNull() {
        Map<String, String> pairs = SAMProtocolHandler.parseKeyValuePairs(null);
        assertNotNull(pairs);
        assertTrue(pairs.isEmpty());
    }

    @Test
    public void testIsSuccess() {
        assertTrue(SAMProtocolHandler.isSuccess("RESULT=OK"));
        assertTrue(SAMProtocolHandler.isSuccess("HELLO REPLY RESULT=OK VERSION=3.1"));
        assertFalse(SAMProtocolHandler.isSuccess("RESULT=ERROR"));
        assertFalse(SAMProtocolHandler.isSuccess(null));
    }

    @Test
    public void testGetErrorMessage() {
        assertNull(SAMProtocolHandler.getErrorMessage("RESULT=OK"));
        assertEquals("ERROR", SAMProtocolHandler.getErrorMessage("RESULT=ERROR"));
        assertEquals("CANT_REACH_PEER", SAMProtocolHandler.getErrorMessage("STREAM STATUS RESULT=CANT_REACH_PEER"));
        assertEquals("No response", SAMProtocolHandler.getErrorMessage(null));
    }

    @Test
    public void testIsValidSessionId() {
        assertTrue(SAMProtocolHandler.isValidSessionId("valid-session"));
        assertTrue(SAMProtocolHandler.isValidSessionId("session123"));
        assertTrue(SAMProtocolHandler.isValidSessionId("my_session"));
        assertTrue(SAMProtocolHandler.isValidSessionId("My-Session-123"));
        assertFalse(SAMProtocolHandler.isValidSessionId(null));
        assertFalse(SAMProtocolHandler.isValidSessionId(""));
        assertFalse(SAMProtocolHandler.isValidSessionId("invalid session"));
        assertFalse(SAMProtocolHandler.isValidSessionId("invalid@session"));
    }

    @Test
    public void testSanitize() {
        assertEquals("clean", SAMProtocolHandler.sanitize("clean"));
        assertEquals("clean", SAMProtocolHandler.sanitize("cle\n"));
        assertEquals("clean", SAMProtocolHandler.sanitize("cle\rclean"));
        assertEquals("clean", SAMProtocolHandler.sanitize("clean\x00"));
        assertEquals("", SAMProtocolHandler.sanitize(null));
    }
}
