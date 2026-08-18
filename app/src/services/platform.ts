/**
 * Platform Detection Service
 * Detects platform and provides I2P setup instructions
 *
 * Platforms:
 *  - Android (Capacitor): native I2CP via net.i2p.android app
 *  - Electron desktop: Java I2P required externally (I2CP on 127.0.0.1:7654)
 *  - Desktop Browser: i2pd / Java I2P via separate process (SAM at 7656/7657)
 *  - Other (mobile web, etc.): WebRTC fallback
 *
 * Two parallel flows for I2P-availability on Electron:
 *  - Synchronous: `getPlatformInfo()` returns a cached default WITHOUT
 *    `i2pAvailable` (the sync API cannot await an IPC probe). Callers that
 *    only need `i2pSupport` / `instructions` continue to work unchanged.
 *  - Asynchronous: `getPlatformInfoAsync()` probes
 *    `electronAPI.i2pInvoke('isAvailable')` and writes the result back to
 *    `cachedInfo.i2pAvailable` + adjusts `i2pSupport` accordingly
 *    (`'native'` when reachable, `'external-required'` when missing).
 */

import type { CapacitorPlatform } from '@/types/platform';
import type { ElectronI2PAPI } from './electronI2pTypes';

export type PlatformType = 'android' | 'desktop' | 'other';
export type I2PSupportLevel = 'native' | 'external-required' | 'unsupported';

// Capacitor native platform detection state
let capacitorPlatform: CapacitorPlatform | null = null;
let capacitorChecked = false;

/**
 * Shape returned by the Electron `i2p:isAvailable` IPC handler.
 * Mirrors `I2PPlugin.isI2pAvailable()` in `electron/src/i2p/i2p-plugin.ts`.
 */
interface I2pAvailableResult {
  available: boolean;
}

export interface PlatformInfo {
  type: PlatformType;
  name: string;
  i2pSupport: I2PSupportLevel;
  canInstallI2PD: boolean;
  /**
   * Set ONLY by the async `getPlatformInfoAsync()` path on Electron after
   * probing the IPC bridge. `undefined` means "not yet probed" — callers
   * that read this field in a sync context should treat `undefined` as
   * "unknown, assume false" and migrate to the async API.
   */
  i2pAvailable?: boolean;
  instructions: I2PInstructions;
}

export interface I2PInstructions {
  title: string;
  description: string;
  steps: string[];
  downloadUrl?: string;
  configHelp: string;
}

class PlatformService {
  private cachedInfo: PlatformInfo | null = null;

  /**
   * Detect if running in a Capacitor native environment
   * Lazy-loads Capacitor to avoid errors in browser
   */
  async detectCapacitor(): Promise<CapacitorPlatform | null> {
    if (capacitorChecked) {
      return capacitorPlatform;
    }

    try {
      // Lazy load Capacitor to avoid errors in browser
      const { Capacitor } = await import('@capacitor/core');
      const info = Capacitor.getPlatform();

      if (Capacitor.isNativePlatform()) {
        capacitorPlatform = info as CapacitorPlatform;
        console.log('[Platform] Capacitor native platform detected:', info);
      } else {
        capacitorPlatform = null;
      }
    } catch {
      // Capacitor not available (running in browser)
      capacitorPlatform = null;
    }

    capacitorChecked = true;
    return capacitorPlatform;
  }

  /**
   * Synchronous check for Capacitor (use after detectCapacitor has been called)
   */
  isCapacitorNative(): boolean {
    return capacitorPlatform !== null;
  }

  /**
   * Check if running on Android native
   */
  isAndroidNative(): boolean {
    return capacitorPlatform === 'android';
  }

  /**
   * Check if running on iOS native
   */
  isIOSNative(): boolean {
    return capacitorPlatform === 'ios';
  }

  /**
   * Check if running in any native environment (Capacitor or Electron)
   */
  isNative(): boolean {
    return this.isCapacitorNative() || this.isElectron();
  }

  /**
   * Check if running in web browser (not native)
   */
  isWeb(): boolean {
    return !this.isNative();
  }

  isElectron(): boolean {
    // Capacitor native is never Electron
    if (capacitorPlatform !== null) return false;
    // Primary: contextBridge API set by preload.ts
    const api = (window as unknown as Record<string, { isElectron?: boolean } | undefined>).electronAPI;
    if (api?.isElectron) return true;
    // Fallback: Electron always injects "Electron/<version>" into the user-agent
    return /Electron\//.test(navigator.userAgent);
  }

  detectPlatform(): PlatformType {
    // Capacitor native overrides everything
    if (capacitorPlatform === 'android') return 'android';
    if (capacitorPlatform === 'ios') return 'other'; // iOS not fully supported yet
    if (this.isElectron()) return 'desktop';
    const ua = navigator.userAgent;
    
    // Android detection
    if (/Android/i.test(ua)) {
      return 'android';
    }
    
    // Desktop detection (Windows, macOS, Linux)
    if (/Windows|Mac|Linux|X11/i.test(ua) && !/Mobile|Android|iPhone|iPad/i.test(ua)) {
      return 'desktop';
    }
    
    // Everything else (iOS, tablets, etc.)
    return 'other';
  }

  getPlatformInfo(): PlatformInfo {
    if (this.cachedInfo) {
      return this.cachedInfo;
    }

    // Electron desktop: SecuChat Desktop is an I2CP client — the user must
    // install and run Java I2P separately, exposing its I2CP port on
    // 127.0.0.1:7654. i2pd is NOT bundled. We default `i2pSupport` to
    // `'external-required'` in the sync path because we can't probe the
    // IPC bridge without an `await`; the async `getPlatformInfoAsync()`
    // upgrades it to `'native'` after a successful probe.
    if (this.isElectron()) {
      this.cachedInfo = {
        type: 'desktop',
        name: 'SecuChat Desktop',
        i2pSupport: 'external-required',
        canInstallI2PD: false,
        // `i2pAvailable` is intentionally NOT set in the sync path — see
        // `getPlatformInfoAsync()` for the probe-and-cache flow.
        instructions: this.getElectronInstructions(),
      };
      return this.cachedInfo;
    }

    const type = this.detectPlatform();

    switch (type) {
      case 'android':
        this.cachedInfo = {
          type: 'android',
          name: 'Android',
          i2pSupport: 'native',
          canInstallI2PD: true,
          instructions: this.getAndroidInstructions(),
        };
        break;

      case 'desktop':
        this.cachedInfo = {
          type: 'desktop',
          name: 'Desktop Browser',
          i2pSupport: 'external-required',
          canInstallI2PD: true,
          instructions: this.getDesktopInstructions(),
        };
        break;
        
      case 'other':
      default:
        this.cachedInfo = {
          type: 'other',
          name: 'Ihr Gerät',
          i2pSupport: 'unsupported',
          canInstallI2PD: false,
          instructions: this.getFallbackInstructions(),
        };
        break;
    }

    return this.cachedInfo;
  }

  /**
   * Async variant of `getPlatformInfo()` that PROBES the Electron IPC
   * bridge for actual I2P-router availability, then writes the result
   * back into the cache so subsequent sync `getPlatformInfo()` calls
   * also see the up-to-date value.
   *
   * Why both paths:
   *  - The sync path cannot await an IPC roundtrip — it would deadlock
   *    callers like Onboarding's first render, where `getPlatformInfo()`
   *    runs in `useState(...)` initialisers.
   *  - On Electron, `'native'` vs `'external-required'` is a runtime
   *    fact (router installed? running?); the cached default of
   *    `'external-required'` is the safe "ask the user to install" mode
   *    for the first render, and the async probe upgrades it when the
   *    preload probe succeeds.
   *
   * Returns the cached `PlatformInfo` with `i2pAvailable` populated.
   */
  async getPlatformInfoAsync(): Promise<PlatformInfo> {
    // Seed the cache via the sync path so non-Electron platforms get the
    // same shape they always did (no async-only behaviour).
    const base = this.getPlatformInfo();

    if (base.type !== 'desktop' || !this.isElectron()) {
      // Probe is Electron-only. For other platforms the cache is already
      // complete (no I2P-runtime check possible).
      return base;
    }

    const i2pAvailable = await this.probeI2pAvailable();
    const next: PlatformInfo = {
      ...base,
      i2pAvailable,
      i2pSupport: i2pAvailable ? 'native' : 'external-required',
      instructions: this.getElectronInstructions(),
    };
    this.cachedInfo = next;
    return next;
  }

  /**
   * Fire an `i2pInvoke('isAvailable')` against the Electron IPC bridge
   * and decode the `{ available: boolean }` payload. Failures (no API,
   * missing method, IPC error) all collapse to `false` so the caller can
   * treat the boolean as a single signal: "should we present the user
   * with the install-Java-I2P instructions, or trust that the router is
   * already running?"
   */
  private async probeI2pAvailable(): Promise<boolean> {
    const api = (window as unknown as { electronAPI?: ElectronI2PAPI })
      .electronAPI;
    if (!api?.i2pInvoke) {
      return false;
    }
    try {
      const result = (await api.i2pInvoke('isAvailable')) as
        | I2pAvailableResult
        | undefined;
      return result?.available === true;
    } catch {
      // Probe failures (no preload, bridge not ready, renderer running
      // outside Electron even though isElectron() returned true — e.g.
      // a stale service-worker cache) must NOT throw. The user sees the
      // install instructions and proceeds manually.
      return false;
    }
  }

  private getElectronInstructions(): I2PInstructions {
    // SecuChat Desktop is an I2CP-client. It does NOT bundle i2pd — the user
    // must install Java I2P separately and let it expose I2CP on
    // 127.0.0.1:7654. We dispatch OS-specific steps/install URLs.
    const os = this.detectOS();

    if (os === 'windows') {
      return {
        title: 'Java I2P erforderlich',
        description:
          'SecuChat Desktop benötigt den Java I2P-Router auf 127.0.0.1:7654. Bitte installiere Java I2P über den offiziellen Windows-Installer.',
        steps: [
          'Lade den I2P-Installer von https://i2p.net/en/downloads herunter und führe die .exe aus',
          'Starte den I2P-Router über "i2p Router Console" (Desktop-Verknüpfung) — der Dienst lauscht auf I2CP-Port 7654',
          'Warte, bis die Netzwerk-Integration im Router-Konsolen-Status "OK" zeigt (kann 5–10 Minuten dauern)',
          'Klicke hier auf "Verbindung testen" — bei Erfolg kannst du fortfahren',
        ],
        downloadUrl: 'https://i2p.net/en/downloads',
        configHelp:
          'Java I2P läuft separat; SecuChat verbindet sich via I2CP auf 127.0.0.1:7654. Im Windows-Installer keine SAM-Konfiguration nötig — SecuChat nutzt direkt I2CP.',
      };
    }

    // Linux (default for Electron desktop per current reachability — also
    // covers macOS until we ship a Homebrew recipe; matches the brief).
    return {
      title: 'Java I2P erforderlich',
      description:
        'SecuChat Desktop benötigt den Java I2P-Router auf 127.0.0.1:7654. Bitte installiere Java I2P.',
      steps: [
        'Linux: sudo apt-add-repository ppa:i2p-maintainers/i2p && sudo apt-get install -y i2p',
        'Starte den I2P-Router (i2prouter-nowrapper auf Linux)',
        'Warte, bis die Netzwerk-Integration im Router-Konsolen-Status "OK" zeigt (kann 5–10 Minuten dauern)',
        'Klicke hier auf "Verbindung testen" — bei Erfolg kannst du fortfahren',
      ],
      downloadUrl: 'https://i2p.net/en/docs/guides/installing-i2p-on-debian-and-ubuntu/',
      configHelp:
        'Java I2P läuft separat; SecuChat verbindet sich via I2CP auf 127.0.0.1:7654.',
    };
  }

  private getAndroidInstructions(): I2PInstructions {
    return {
      title: 'Java I2P auf Android einrichten',
      description:
        'SecuChat nutzt auf Android den Java-I2P-Router aus dem Google Play Store. Nach der Installation konfigurieren Sie Sprache, I2CP und Bandbreite.',
      steps: [
        'Java I2P aus dem Google Play Store installieren und öffnen',
        'Beim ersten Start: einmalig die Sprache festlegen (z. B. Deutsch)',
        'In Java I2P: Einstellungen → Erweitert → Haken bei I2CP aktivieren',
        'In Java I2P: Einstellungen → Bandbreite und Netzwerk → "Bei Booten aktivieren" einschalten',
        'In Java I2P: Einstellungen → Bandbreite und Netzwerk → Up- und Download-Bandbreite auf Maximum stellen',
        'In Java I2P: Einstellungen → Bandbreite und Netzwerk → UPnP aktivieren',
        'Java I2P starten (lange drücken zum Starten) und hier auf "Verbindung testen" klicken',
      ],
      downloadUrl: 'https://play.google.com/store/apps/details?id=net.i2p.android',
      configHelp:
        'Java I2P muss laufen und I2CP auf Port 7654 bereitstellen. SecuChat verbindet sich direkt.',
    };
  }

  private getDesktopInstructions(): I2PInstructions {
    const os = this.detectOS();
    
    if (os === 'windows') {
      return {
        title: 'i2pd auf Windows installieren',
        description: 'Installieren Sie i2pd für echtes I2P-Netzwerk.',
        steps: [
          'i2pd von der offiziellen Website herunterladen',
          'Installer ausführen',
          'i2pd.conf bearbeiten: SAM aktivieren',
          'i2pd als Service starten',
          'Hier auf "Verbindung testen" klicken',
        ],
        downloadUrl: 'https://github.com/PurpleI2P/i2pd/releases',
        configHelp: 'In i2pd.conf: [sam] enabled = true, port = 7656',
      };
    }
    
    if (os === 'macos') {
      return {
        title: 'i2pd auf macOS installieren',
        description: 'Installieren Sie i2pd über Homebrew.',
        steps: [
          'Terminal öffnen',
          'brew install i2pd ausführen',
          'i2pd --conf=/usr/local/etc/i2pd/i2pd.conf start',
          'SAM in der Konfiguration aktivieren',
          'Hier auf "Verbindung testen" klicken',
        ],
        downloadUrl: 'https://formulae.brew.sh/formula/i2pd',
        configHelp: 'Konfiguration unter /usr/local/etc/i2pd/i2pd.conf',
      };
    }
    
    // Linux
    return {
      title: 'i2pd auf Linux installieren',
      description: 'Installieren Sie i2pd über Ihren Paketmanager.',
      steps: [
        'sudo apt install i2pd (Debian/Ubuntu) oder',
        'sudo pacman -S i2pd (Arch) oder',
        'sudo dnf install i2pd (Fedora)',
        '/etc/i2pd/i2pd.conf bearbeiten: SAM aktivieren',
        'sudo systemctl start i2pd',
        'Hier auf "Verbindung testen" klicken',
      ],
      downloadUrl: 'https://i2pd.readthedocs.io/en/latest/user-guide/install/',
      configHelp: 'SAM in /etc/i2pd/i2pd.conf aktivieren, Port 7656',
    };
  }

  private getFallbackInstructions(): I2PInstructions {
    return {
      title: 'WebRTC-Modus (Fallback)',
      description: 'Auf diesem Gerät ist kein echtes I2P verfügbar. Die App nutzt WebRTC für P2P-Verbindungen.',
      steps: [
        'Keine Installation nötig',
        'Die App funktioniert direkt im Browser',
        'Verbindungen sind Ende-zu-Ende verschlüsselt',
        'Hinweis: IP-Adressen sind für Kommunikationspartner sichtbar',
      ],
      configHelp: 'Für maximale Anonymität nutzen Sie Android oder Desktop mit i2pd.',
    };
  }

  private detectOS(): 'windows' | 'macos' | 'linux' | 'unknown' {
    const ua = navigator.userAgent;
    
    if (/Windows/i.test(ua)) return 'windows';
    if (/Mac/i.test(ua) && !/iPhone|iPad/i.test(ua)) return 'macos';
    if (/Linux/i.test(ua)) return 'linux';
    
    return 'unknown';
  }

  // Check if running as PWA (installed)
  isPWA(): boolean {
    return window.matchMedia('(display-mode: standalone)').matches || 
           (window.navigator as unknown as { standalone?: boolean }).standalone === true;
  }

  // Check if can show install prompt
  canInstallPWA(): boolean {
    return 'BeforeInstallPromptEvent' in window;
  }

  // Get user-friendly platform name
  getPlatformName(): string {
    // Check for native platforms first
    if (this.isAndroidNative()) return 'SecuChat Android';
    if (this.isIOSNative()) return 'SecuChat iOS';
    if (this.isElectron()) return 'SecuChat Desktop';

    const info = this.getPlatformInfo();
    return info.name;
  }

  /**
   * Get detailed platform info for logging/debugging
   */
  async getDetailedPlatformInfo(): Promise<{
    type: string;
    isNative: boolean;
    isCapacitor: boolean;
    capacitorPlatform: string | null;
    isElectron: boolean;
    isWeb: boolean;
    userAgent: string;
  }> {
    const capPlatform = await this.detectCapacitor();

    return {
      type: this.detectPlatform(),
      isNative: this.isNative(),
      isCapacitor: this.isCapacitorNative(),
      capacitorPlatform: capPlatform,
      isElectron: this.isElectron(),
      isWeb: this.isWeb(),
      userAgent: navigator.userAgent,
    };
  }

  // Quick check if I2P is supported
  isI2PSupported(): boolean {
    const info = this.getPlatformInfo();
    return info.i2pSupport !== 'unsupported';
  }
}

export const platformService = new PlatformService();

// Convenience exports for direct function access
export const isNative = () => platformService.isNative();
export const isAndroid = () => platformService.isAndroidNative();
export const isWeb = () => platformService.isWeb();
export const platform = platformService;
