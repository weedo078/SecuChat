package com.secuchat.app;

import com.secuchat.app.plugin.SAMPlugin.I2PBase64;
import com.secuchat.app.plugin.SAMPlugin.SAMConfig;
import com.secuchat.app.plugin.SAMPlugin.SAMErrorCodes;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.junit.runners.JUnit4;

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
}
