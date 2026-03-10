// Native File Sharing Service
// Uses Capacitor Share and FileOpener plugins for contact export/import
// Only used when running as a native Android/iOS app

import { isNativeStorageAvailable, nativeFilesystem } from './nativeStorage';

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

    const filename = options.filename || `secuchat-contact-${contactData.name.replace(/\s+/g, '-')}.json`;

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

    // Write to Downloads directory for user access
    const uri = await nativeFilesystem.writeFile(filename, content, 'downloads');

    console.log('[NativeFileSharing] Contact exported to:', uri);

    // Optionally share the file
    if (options.share && Share) {
      await Share.share({
        title: `SecuChat Contact: ${contactData.name}`,
        text: `Contact ${contactData.name} - I2P: ${contactData.i2pAddress}`,
        url: uri,
        dialogTitle: 'Share Contact',
      });
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
    let contactData: {
      v?: string;
      t?: string;
      n?: string;
      i?: string;
      f?: string;
      k?: string;
      name?: string;
      i2pAddress?: string;
      fingerprint?: string;
      pgpPublicKey?: string;
    };

    try {
      contactData = JSON.parse(content);
    } catch {
      return { success: false, error: 'Invalid JSON file' };
    }

    // Handle v2 format
    if (contactData.v === '2' && contactData.t === 'sc') {
      return {
        success: true,
        data: {
          name: contactData.n || '',
          i2pAddress: contactData.i || '',
          fingerprint: contactData.f || '',
          pgpPublicKey: contactData.k,
        },
      };
    }

    // Handle legacy format
    if (contactData.name && contactData.i2pAddress) {
      return {
        success: true,
        data: {
          name: contactData.name,
          i2pAddress: contactData.i2pAddress,
          fingerprint: contactData.fingerprint || '',
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
