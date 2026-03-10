package com.secuchat.app.plugin.SAMPlugin;

import android.util.Base64;
import android.util.Log;

/**
 * I2P Base64 encoding/decoding utilities.
 * I2P uses a modified Base64 alphabet where:
 * - '-' is used instead of '+'
 * - '~' is used instead of '/'
 * - No padding characters (=)
 *
 * This is based on RFC 4648 with I2P-specific modifications.
 */
public class I2PBase64 {

    private static final String TAG = "SecuChat:SAM";

    private static final String I2P_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-~";
    private static final String STD_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    /**
     * Encode bytes to I2P Base64 format.
     *
     * @param data Raw bytes to encode
     * @return I2P Base64 encoded string
     */
    public static String encode(byte[] data) {
        if (data == null || data.length == 0) {
            return "";
        }

        // First encode using standard Base64
        String standard = Base64.encodeToString(data, Base64.NO_PADDING | Base64.NO_WRAP);

        // Convert to I2P alphabet
        return standard.replace('+', '-').replace('/', '~');
    }

    /**
     * Decode I2P Base64 string to bytes.
     *
     * @param i2pBase64 I2P Base64 encoded string
     * @return Decoded bytes
     * @throws IllegalArgumentException if input is invalid
     */
    public static byte[] decode(String i2pBase64) {
        if (i2pBase64 == null || i2pBase64.isEmpty()) {
            return new byte[0];
        }

        // Convert from I2P alphabet to standard
        String standard = i2pBase64.replace('-', '+').replace('~', '/');

        // Add padding if needed
        int padding = (4 - (standard.length() % 4)) % 4;
        if (padding > 0) {
            standard += "=".repeat(padding);
        }

        try {
            byte[] result = Base64.decode(standard, Base64.DEFAULT);
            Log.d(TAG, "Decoded I2P Base64: " + i2pBase64.length() + " chars -> " + result.length + " bytes");
            return result;
        } catch (IllegalArgumentException e) {
            Log.e(TAG, "Failed to decode I2P Base64: " + e.getMessage());
            throw e;
        }
    }

    /**
     * Check if a string is valid I2P Base64.
     *
     * @param input String to validate
     * @return true if valid I2P Base64
     */
    public static boolean isValid(String input) {
        if (input == null || input.isEmpty()) {
            return false;
        }

        // I2P Base64 only contains these characters
        return input.matches("^[A-Za-z0-9-~]+$");
    }

    /**
     * Convert standard Base64 to I2P Base64.
     *
     * @param standardBase64 Standard Base64 string
     * @return I2P Base64 string
     */
    public static String fromStandardBase64(String standardBase64) {
        if (standardBase64 == null) {
            return null;
        }
        return standardBase64.replace('+', '-').replace('/', '~').replace("=", "");
    }

    /**
     * Convert I2P Base64 to standard Base64.
     *
     * @param i2pBase64 I2P Base64 string
     * @return Standard Base64 string with padding
     */
    public static String toStandardBase64(String i2pBase64) {
        if (i2pBase64 == null) {
            return null;
        }

        String standard = i2pBase64.replace('-', '+').replace('~', '/');

        // Add padding
        int padding = (4 - (standard.length() % 4)) % 4;
        if (padding > 0) {
            standard += "=".repeat(padding);
        }

        return standard;
    }
}
