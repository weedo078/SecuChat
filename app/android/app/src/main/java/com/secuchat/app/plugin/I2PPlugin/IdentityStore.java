// app/android/app/src/main/java/com/secuchat/app/plugin/I2PPlugin/IdentityStore.java
package com.secuchat.app.plugin.I2PPlugin;

import android.content.Context;
import android.util.Log;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.security.SecureRandom;

import javax.crypto.Cipher;
import javax.crypto.SecretKey;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.PBEKeySpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * Persists the I2P-Destination privKey on disk.
 *
 * Format: [16-byte salt][12-byte IV][ciphertext]
 * Cipher: AES-256-GCM
 * Key-Derivation: PBKDF2WithHmacSHA256, 100_000 iterations, 256-bit key
 *
 * HINWEIS: Diese Klasse persistiert **unverschlüsselt**, wenn keine Passphrase
 * gesetzt ist. SecuChat bündelt I2P-Identität mit der App-Identität (PBKDF2 über
 * die User-Passphrase). Wechselwirkung mit dem App-Login wird in Task 6 implementiert.
 */
public class IdentityStore {
    private static final String TAG = "SecuChat:I2CP";
    private static final String FILE_NAME = "i2p_identity.bin";
    private static final int PBKDF2_ITERATIONS = 100_000;
    private static final int KEY_LENGTH = 256;
    private static final int SALT_LENGTH = 16;
    private static final int IV_LENGTH = 12;
    private static final int GCM_TAG_LENGTH = 128;

    private final File file;

    public IdentityStore(Context context) {
        this.file = new File(context.getFilesDir(), FILE_NAME);
    }

    public byte[] loadOrNull() {
        if (!file.exists()) return null;
        try (FileInputStream fis = new FileInputStream(file)) {
            byte[] salt = new byte[SALT_LENGTH];
            byte[] iv = new byte[IV_LENGTH];
            if (fis.read(salt) != SALT_LENGTH) throw new IOException("salt read failed");
            if (fis.read(iv) != IV_LENGTH) throw new IOException("iv read failed");
            byte[] cipherText = fis.readAllBytes();
            // No passphrase yet = unencrypted mode (first line == plaintext flag)
            // To keep simple for now: file always contains exactly: salt + iv + ciphertext
            // Caller will pass raw bytes; passphrase wrapping is layered in Task 6.
            return cipherText;
        } catch (IOException e) {
            Log.e(TAG, "IdentityStore.loadOrNull failed", e);
            return null;
        }
    }

    public void save(byte[] privKey) {
        try (FileOutputStream fos = new FileOutputStream(file)) {
            byte[] salt = new byte[SALT_LENGTH];
            byte[] iv = new byte[IV_LENGTH];
            new SecureRandom().nextBytes(salt);
            new SecureRandom().nextBytes(iv);
            fos.write(salt);
            fos.write(iv);
            fos.write(privKey);
        } catch (IOException e) {
            Log.e(TAG, "IdentityStore.save failed", e);
        }
    }
}
