package com.secuchat.app.plugin.SAMPlugin;

import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Log;

import java.math.BigInteger;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.PrivateKey;
import java.security.PublicKey;
import java.security.spec.ECGenParameterSpec;
import java.util.Arrays;

/**
 * I2P Destination with Ed25519 key pair and b32 address calculation.
 *
 * An I2P destination consists of:
 * - Public key (for encryption)
 * - Signing key (for signatures, Ed25519)
 * - Certificate (optional, for type/length)
 *
 * The b32 address is computed as SHA-256 of the destination bytes, then Base32 encoded.
 */
public class SAMDestination {

    private static final String TAG = "SAMDestination";

    // Ed25519 signature type as defined by SAM v3.1
    public static final String SIGNATURE_TYPE = "EdDSA_SHA512_Ed25519";

    private final KeyPair keyPair;
    private final String publicKeyBase64;
    private final String privateKeyBase64;
    private String b32Address;

    /**
     * Create a destination from an existing key pair.
     *
     * @param keyPair Ed25519 key pair
     * @param publicKeyBase64 I2P Base64 encoded public destination
     * @param privateKeyBase64 I2P Base64 encoded private destination
     */
    public SAMDestination(KeyPair keyPair, String publicKeyBase64, String privateKeyBase64) {
        this.keyPair = keyPair;
        this.publicKeyBase64 = publicKeyBase64;
        this.privateKeyBase64 = privateKeyBase64;
    }

    /**
     * Generate a new Ed25519 destination.
     *
     * @return New SAMDestination instance
     * @throws Exception if key generation fails
     */
    public static SAMDestination generate() throws Exception {
        Log.d(TAG, "Generating new Ed25519 destination...");

        // Generate Ed25519 key pair using Android 11+ API
        KeyPairGenerator keyGen = KeyPairGenerator.getInstance("Ed25519");
        KeyPair keyPair = keyGen.generateKeyPair();

        // Build I2P destination format
        // Destination format: PublicKey (256 bytes for ElGamal) + SigningPublicKey (32 bytes for Ed25519) + Certificate
        // For Ed25519, we use a simplified format compatible with SAM

        byte[] publicKeyBytes = buildDestinationBytes(keyPair.getPublic());
        byte[] privateKeyBytes = buildPrivateKeyBytes(keyPair.getPrivate(), publicKeyBytes);

        String pubBase64 = I2PBase64.encode(publicKeyBytes);
        String privBase64 = I2PBase64.encode(privateKeyBytes);

        Log.d(TAG, "Generated destination with public key length: " + pubBase64.length());

        return new SAMDestination(keyPair, pubBase64, privBase64);
    }

    /**
     * Restore a destination from stored keys.
     *
     * @param publicKeyBase64 I2P Base64 public destination
     * @param privateKeyBase64 I2P Base64 private destination
     * @return SAMDestination instance (without KeyPair for now)
     */
    public static SAMDestination fromKeys(String publicKeyBase64, String privateKeyBase64) {
        return new SAMDestination(null, publicKeyBase64, privateKeyBase64);
    }

    /**
     * Build the destination bytes in I2P format.
     * Format: PublicKey (256 bytes) + SigningPublicKey (32 bytes) + Certificate
     */
    private static byte[] buildDestinationBytes(PublicKey publicKey) {
        byte[] signingKeyBytes = publicKey.getEncoded();

        // I2P destination structure:
        // - 256 bytes: ElGamal public key (encryption)
        // - 32 bytes: Ed25519 public key (signing)
        // - Certificate: type (1 byte) + length (2 bytes) + payload

        // For SAM compatibility, we use a placeholder for ElGamal
        byte[] elGamalPlaceholder = new byte[256];
        Arrays.fill(elGamalPlaceholder, (byte) 0);

        // Extract raw Ed25519 public key (last 32 bytes of X.509 encoded)
        byte[] ed25519PubKey = extractEd25519PublicKey(signingKeyBytes);

        // Certificate: type 0x05 (Ed25519), length 0
        byte[] certificate = new byte[] { 0x05, 0x00, 0x00 };

        // Combine all parts
        byte[] destination = new byte[256 + 32 + 3];
        System.arraycopy(elGamalPlaceholder, 0, destination, 0, 256);
        System.arraycopy(ed25519PubKey, 0, destination, 256, 32);
        System.arraycopy(certificate, 0, destination, 288, 3);

        return destination;
    }

    /**
     * Build private key bytes in I2P format.
     * Format: PrivateKey (256 bytes) + SigningPrivateKey (64 bytes for Ed25519 seed + public)
     */
    private static byte[] buildPrivateKeyBytes(PrivateKey privateKey, byte[] publicDestination) {
        byte[] signingPrivKeyBytes = privateKey.getEncoded();

        // I2P private key structure:
        // - 256 bytes: ElGamal private key placeholder
        // - 64 bytes: Ed25519 private key (seed + public key)
        // - Public destination bytes

        byte[] elGamalPlaceholder = new byte[256];
        Arrays.fill(elGamalPlaceholder, (byte) 0);

        // Extract Ed25519 private key seed
        byte[] ed25519PrivKey = extractEd25519PrivateKey(signingPrivKeyBytes);

        byte[] result = new byte[256 + 64 + publicDestination.length];
        System.arraycopy(elGamalPlaceholder, 0, result, 0, 256);
        System.arraycopy(ed25519PrivKey, 0, result, 256, 64);
        System.arraycopy(publicDestination, 0, result, 320, publicDestination.length);

        return result;
    }

    /**
     * Extract the 32-byte Ed25519 public key from X.509 encoded key.
     */
    private static byte[] extractEd25519PublicKey(byte[] x509Encoded) {
        // X.509 format: subjectPublicKeyInfo structure
        // For Ed25519, the raw key is typically the last 32 bytes
        if (x509Encoded.length >= 32) {
            byte[] rawKey = new byte[32];
            System.arraycopy(x509Encoded, x509Encoded.length - 32, rawKey, 0, 32);
            return rawKey;
        }
        return Arrays.copyOf(x509Encoded, 32);
    }

    /**
     * Extract the Ed25519 private key bytes.
     */
    private static byte[] extractEd25519PrivateKey(byte[] pkcs8Encoded) {
        // PKCS#8 format: privateKeyInfo structure
        // For Ed25519, we need 64 bytes (seed + public key)
        if (pkcs8Encoded.length >= 64) {
            byte[] rawKey = new byte[64];
            System.arraycopy(pkcs8Encoded, pkcs8Encoded.length - 64, rawKey, 0, 64);
            return rawKey;
        }
        // Pad if necessary
        byte[] result = new byte[64];
        System.arraycopy(pkcs8Encoded, 0, result, 0, Math.min(pkcs8Encoded.length, 64));
        return result;
    }

    /**
     * Compute the b32 address from the public destination.
     * Real I2P: SHA-256 of the destination bytes → Base32 encode
     *
     * @return b32.i2p address
     */
    public String getB32Address() {
        if (b32Address != null) {
            return b32Address;
        }

        try {
            byte[] destinationBytes = I2PBase64.decode(publicKeyBase64);
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(destinationBytes);
            b32Address = toBase32(hash) + ".b32.i2p";
            return b32Address;
        } catch (Exception e) {
            Log.e(TAG, "Failed to compute b32 address", e);
            return null;
        }
    }

    /**
     * Get the public destination in I2P Base64 format.
     */
    public String getPublicKey() {
        return publicKeyBase64;
    }

    /**
     * Get the private destination in I2P Base64 format.
     */
    public String getPrivateKey() {
        return privateKeyBase64;
    }

    /**
     * Get the Ed25519 key pair (may be null if restored from keys).
     */
    public KeyPair getKeyPair() {
        return keyPair;
    }

    /**
     * Base32 encoding helper (RFC 4648).
     */
    private static String toBase32(byte[] data) {
        final String ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";
        StringBuilder output = new StringBuilder();
        int bits = 0;
        int value = 0;

        for (byte b : data) {
            value = (value << 8) | (b & 0xFF);
            bits += 8;

            while (bits >= 5) {
                output.append(ALPHABET.charAt((value >>> (bits - 5)) & 31));
                bits -= 5;
            }
        }

        if (bits > 0) {
            output.append(ALPHABET.charAt((value << (5 - bits)) & 31));
        }

        return output.toString();
    }

    @Override
    public String toString() {
        return "SAMDestination{" +
                "b32Address='" + getB32Address() + '\'' +
                ", publicKey='" + publicKeyBase64.substring(0, Math.min(20, publicKeyBase64.length())) + "...'" +
                '}';
    }
}
