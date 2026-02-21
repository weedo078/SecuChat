/**
 * Platform Detection Service
 * Detects platform and provides I2P setup instructions
 * Supports: Android (with i2pd), Desktop Browser (with i2pd), Other (WebRTC fallback)
 */

export type PlatformType = 'android' | 'desktop' | 'other';
export type I2PSupportLevel = 'native' | 'external-required' | 'unsupported';

export interface PlatformInfo {
  type: PlatformType;
  name: string;
  i2pSupport: I2PSupportLevel;
  canInstallI2PD: boolean;
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

  isElectron(): boolean {
    return typeof (window as unknown as Record<string, unknown>).electronAPI !== 'undefined' &&
      !!(window as unknown as Record<string, { isElectron?: boolean }>).electronAPI?.isElectron;
  }

  detectPlatform(): PlatformType {
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

    // Electron desktop app has i2pd bundled — treat as native
    if (this.isElectron()) {
      this.cachedInfo = {
        type: 'desktop',
        name: 'SecuChat Desktop',
        i2pSupport: 'native',
        canInstallI2PD: false,
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

  private getElectronInstructions(): I2PInstructions {
    return {
      title: 'i2pd läuft automatisch',
      description: 'SecuChat Desktop startet i2pd automatisch im Hintergrund. Kein manuelles Setup erforderlich.',
      steps: [
        'i2pd wurde bereits zusammen mit SecuChat gestartet',
        'Beim ersten Start dauert der Aufbau des I2P-Netzwerks 5–10 Minuten',
        'Bitte klicken Sie auf "Verbindung testen" — bei Erfolg können Sie fortfahren',
        'Falls der Test fehlschlägt, warten Sie kurz und versuchen Sie es erneut',
      ],
      configHelp: 'i2pd ist in SecuChat Desktop integriert und startet automatisch.',
    };
  }

  private getAndroidInstructions(): I2PInstructions {
    return {
      title: 'i2pd auf Android installieren',
      description: 'Für maximale Anonymität installieren Sie i2pd aus F-Droid.',
      steps: [
        'F-Droid App installieren (falls noch nicht vorhanden)',
        'In F-Droid nach "i2pd" suchen',
        'i2pd installieren und öffnen',
        'In i2pd: Einstellungen → SAM → Aktivieren',
        'Port auf 7656 belassen',
        'Zurück und i2pd starten',
        'Hier auf "Verbindung testen" klicken',
      ],
      downloadUrl: 'https://f-droid.org/packages/org.purplei2p.i2pd/',
      configHelp: 'SAM muss auf Port 7656 aktiviert sein. i2pd läuft dann im Hintergrund.',
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
    const info = this.getPlatformInfo();
    return info.name;
  }

  // Quick check if I2P is supported
  isI2PSupported(): boolean {
    const info = this.getPlatformInfo();
    return info.i2pSupport !== 'unsupported';
  }
}

export const platformService = new PlatformService();
