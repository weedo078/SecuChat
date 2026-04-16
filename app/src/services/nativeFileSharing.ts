// Native File Sharing Service
// Uses Capacitor Share and FileOpener plugins for contact export/import
// Only used when running as a native Android/iOS app

import { isNativeStorageAvailable, nativeFilesystem } from './nativeStorage';
import { cryptoService } from './crypto';

// Lazy-loaded Capacitor modules
let Share: typeof import('@capacitor/share').Share | null = null;
let FileOpener: typeof import('@capacitor-community/file-opener').FileOpener | null = null;
let FilePicker: typeof import('@capawesome/capacitor-file-picker').FilePicker | null = null;

/**
 * Initialize Capacitor sharing plugins (lazy-loaded)
 */
async function initSharingPlugins(): Promise<void> {
  if (Share && FileOpener && FilePicker) return;

  try {
    const shareModule = await import('@capacitor/share');
    Share = shareModule.Share;

    try {
      const fileOpenerModule = await import('@capacitor-community/file-opener');
      FileOpener = fileOpenerModule.FileOpener;
    } catch {
      console.warn('[NativeFileSharing] FileOpener plugin not available');
    }

    try {
      const filePickerModule = await import('@capawesome/capacitor-file-picker');
      FilePicker = filePickerModule.FilePicker;
    } catch {
      console.warn('[NativeFileSharing] FilePicker plugin not available');
    }

    console.log('[NativeFileSharing] Sharing plugins initialized');
  } catch (error) {
    console.error('[NativeFileSharing] Failed to load sharing plugins:', error);
    throw new Error('Sharing plugins not available');
  }
}

/**
 * Export contact to device storage and optionally share it
 */
export async function exportContact(
  contactData: {
    name: string;
    i2pAddress: string;
    fingerprint: string;
    pgpPublicKey?: string;
  },
  options: {
    share?: boolean;
    filename?: string;
  } = {}
): Promise<{ success: boolean; uri?: string; error?: string }> {
  if (!isNativeStorageAvailable()) {
    return { success: false, error: 'Not running in native environment' };
  }

  try {
    await initSharingPlugins();

    const filename = options.filename || `secuchat-contact-${contactData.name.replace(/\s+/g, '-')}.secuchat`;

    console.warn('[NativeFileSharing] WARNING: Exported contact file contains cryptographic keys. Handle securely.');

    // Create contact file content
    const content = JSON.stringify({
      v: '2',
      t: 'sc',
      n: contactData.name,
      i: contactData.i2pAddress,
      f: contactData.fingerprint,
      k: contactData.pgpPublicKey,
      exportedAt: new Date().toISOString(),
    }, null, 2);

    // Write to external storage Downloads folder (directly accessible via adb)
    const downloadPath = `Download/${filename}`;
    await nativeFilesystem.writeFile(downloadPath, content, 'external');

    const uri = await nativeFilesystem.getUri(downloadPath, 'external');
    console.log('[NativeFileSharing] Contact saved to Downloads:', uri);

    // Also open share dialog so user can send via other apps
    if (Share) {
      try {
        console.log('[NativeFileSharing] Opening share dialog...');
        await Share.share({
          title: `SecuChat Contact: ${contactData.name}`,
          text: `Contact ${contactData.name} - I2P: ${contactData.i2pAddress}`,
          url: uri,
          dialogTitle: 'Kontakt teilen',
        });
      } catch (shareError) {
        if (shareError instanceof Error) {
          const msg = shareError.message.toLowerCase();
          if (msg.includes('cancel') || msg.includes('dismissed') || msg.includes('abort') || msg.includes('canceled')) {
            console.log('[NativeFileSharing] User cancelled share dialog');
            return { success: true, uri };
          }
        }
        console.warn('[NativeFileSharing] Share cancelled, file already saved to Downloads');
      }
    }

    return { success: true, uri };
  } catch (error) {
    console.error('[NativeFileSharing] Export failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Export failed',
    };
  }
}

/**
 * Import contact from file picker
 * Returns the parsed contact data or null if cancelled
 */
export async function importContact(): Promise<{
  success: boolean;
  data?: {
    name: string;
    i2pAddress: string;
    fingerprint: string;
    pgpPublicKey?: string;
  };
  error?: string;
}> {
  if (!isNativeStorageAvailable()) {
    return { success: false, error: 'Not running in native environment' };
  }

  try {
    await initSharingPlugins();

    if (!FilePicker) {
      return { success: false, error: 'FilePicker plugin not available' };
    }

    // Open native file picker
    const result = await FilePicker.pickFiles({
      types: ['application/json', 'text/plain'],
      readData: true,
    });

    if (!result.files || result.files.length === 0) {
      return { success: false, error: 'No file selected' };
    }

    const file = result.files[0];

    if (!file.data) {
      return { success: false, error: 'Could not read file data' };
    }

    // Decode base64 data
    const content = atob(file.data);

    // Parse JSON
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let contactData: any;

    try {
      contactData = JSON.parse(content);
    } catch {
      return { success: false, error: 'Invalid JSON file' };
    }

    // Handle v1.0 format (full export from AddContactDialog)
    if (contactData.version === '1.0' && contactData.metadata && contactData.keys && contactData.network) {
      const v1 = contactData as {
        version: string;
        metadata: { username: string; timestamp: string; deviceId: string };
        keys: { pgpPublicKey: string; fingerprint: string };
        network: { p2pIdentifier: string; protocol: string; i2pAddress: string };
      };

      if (!v1.keys.fingerprint) {
        return { success: false, error: 'Fehlender Fingerprint — Kontaktdatei möglicherweise manipuliert' };
      }
      if (!v1.network.i2pAddress) {
        return { success: false, error: 'Fehlende I2P-Adresse — ungültige Kontaktdatei' };
      }

      if (v1.keys.pgpPublicKey) {
        try {
          const { valid } = await cryptoService.validatePublicKey(v1.keys.pgpPublicKey);
          if (!valid) {
            return { success: false, error: 'Ungültiger PGP-Schlüssel in Kontaktdatei' };
          }
        } catch {
          return { success: false, error: 'PGP-Schlüssel konnte nicht validiert werden' };
        }
      }

      return {
        success: true,
        data: {
          name: v1.metadata.username || '',
          i2pAddress: v1.network.i2pAddress,
          fingerprint: v1.keys.fingerprint,
          pgpPublicKey: v1.keys.pgpPublicKey || undefined,
        },
      };
    }

    // Handle v2 compact format
    if (contactData.v === '2' && contactData.t === 'sc') {
      // Validate required fields
      if (!contactData.f) {
        return { success: false, error: 'Fehlender Fingerprint — Kontaktdatei möglicherweise manipuliert' };
      }
      if (!contactData.i) {
        return { success: false, error: 'Fehlende I2P-Adresse — ungültige Kontaktdatei' };
      }

      // Validate PGP key if present
      if (contactData.k) {
        try {
          const { valid } = await cryptoService.validatePublicKey(contactData.k);
          if (!valid) {
            return { success: false, error: 'Ungültiger PGP-Schlüssel in Kontaktdatei' };
          }
        } catch {
          return { success: false, error: 'PGP-Schlüssel konnte nicht validiert werden' };
        }
      }

      return {
        success: true,
        data: {
          name: contactData.n || '',
          i2pAddress: contactData.i,
          fingerprint: contactData.f,
          pgpPublicKey: contactData.k,
        },
      };
    }

    // Handle legacy flat format
    if (contactData.name && contactData.i2pAddress) {
      // Validate required fields
      if (!contactData.fingerprint) {
        return { success: false, error: 'Fehlender Fingerprint — Kontaktdatei möglicherweise manipuliert' };
      }

      // Validate PGP key if present
      if (contactData.pgpPublicKey) {
        try {
          const { valid } = await cryptoService.validatePublicKey(contactData.pgpPublicKey);
          if (!valid) {
            return { success: false, error: 'Ungültiger PGP-Schlüssel in Kontaktdatei' };
          }
        } catch {
          return { success: false, error: 'PGP-Schlüssel konnte nicht validiert werden' };
        }
      }

      return {
        success: true,
        data: {
          name: contactData.name,
          i2pAddress: contactData.i2pAddress,
          fingerprint: contactData.fingerprint,
          pgpPublicKey: contactData.pgpPublicKey,
        },
      };
    }

    return { success: false, error: 'Invalid contact file format' };
  } catch (error) {
    console.error('[NativeFileSharing] Import failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Import failed',
    };
  }
}

/**
 * Open a file with the system's default app
 */
export async function openFile(
  path: string,
  mimeType: string
): Promise<{ success: boolean; error?: string }> {
  if (!isNativeStorageAvailable()) {
    return { success: false, error: 'Not running in native environment' };
  }

  try {
    await initSharingPlugins();

    if (!FileOpener) {
      return { success: false, error: 'FileOpener plugin not available' };
    }

    await FileOpener.open({
      filePath: path,
      contentType: mimeType,
      openWithDefault: true,
    });

    return { success: true };
  } catch (error) {
    console.error('[NativeFileSharing] Open file failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to open file',
    };
  }
}

/**
 * Share text content via system share sheet
 */
export async function shareText(
  title: string,
  text: string,
  url?: string
): Promise<{ success: boolean; error?: string }> {
  if (!isNativeStorageAvailable()) {
    return { success: false, error: 'Not running in native environment' };
  }

  try {
    await initSharingPlugins();

    if (!Share) {
      return { success: false, error: 'Share plugin not available' };
    }

    await Share.share({
      title,
      text,
      url,
      dialogTitle: 'Share',
    });

    return { success: true };
  } catch (error) {
    // User cancelled is not an error
    if (error instanceof Error && error.message?.includes('cancel')) {
      return { success: true };
    }

    console.error('[NativeFileSharing] Share failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Share failed',
    };
  }
}

/**
 * Check if native sharing is available
 */
export function canShareNatively(): boolean {
  const available = isNativeStorageAvailable();
  console.log('[NativeFileSharing] canShareNatively:', available);
  return available;
}

/**
 * Request permissions for file access (Android 13+)
 */
export async function requestFilePermissions(): Promise<{
  granted: boolean;
  canRead: boolean;
  canWrite: boolean;
}> {
  if (!isNativeStorageAvailable()) {
    return { granted: false, canRead: false, canWrite: false };
  }

  // On Android 13+, we need to request specific permissions
  // For now, assume granted (Capacitor handles basic permissions)
  // In production, use @capacitor-community/android-permissions

  return { granted: true, canRead: true, canWrite: true };
}
