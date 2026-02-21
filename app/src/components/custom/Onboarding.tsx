import { useState, useEffect } from 'react';
import { Shield, Key, Lock, Check, ChevronRight, ChevronLeft, Eye, EyeOff, Download, Copy, AlertCircle, Smartphone, QrCode, UserPlus, ExternalLink, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useApp } from '@/contexts/AppContext';
import { cryptoService } from '@/services/crypto';
import { storageService } from '@/services/storage';
import { i2pService, samService } from '@/services/i2p';
import { platformService, type PlatformInfo } from '@/services/platform';
import { uint8ArrayToBase64 } from '@/utils/base32';
import { DeviceQRCode } from './DeviceQRCode';
import type { AppSettings } from '@/types';

interface OnboardingProps {
  onComplete: () => void;
  isNewDevice?: boolean;  // True if pairing existing account
}

export function Onboarding({ onComplete, isNewDevice = false }: OnboardingProps) {
  const [step, setStep] = useState(1);
  const [username, setUsername] = useState('');
  const [deviceName, setDeviceName] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [confirmPassphrase, setConfirmPassphrase] = useState('');
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [keyPair, setKeyPair] = useState<{ publicKey: string; privateKey: string; fingerprint: string } | null>(null);
  const [i2pIdentity, setI2pIdentity] = useState<{ publicKey: string; privateKey: string; b32Address: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPairing, setShowPairing] = useState(false);
  const [platformInfo, setPlatformInfo] = useState<PlatformInfo | null>(null);
  const [i2pTestStatus, setI2pTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const { setUser } = useApp();

  // Detect platform on mount
  useEffect(() => {
    const info = platformService.getPlatformInfo();
    setPlatformInfo(info);
  }, []);

  const totalSteps = isNewDevice ? 3 : 5;
  const progress = (step / totalSteps) * 100;

  useEffect(() => {
    // Auto-detect device name based on platform
    const info = platformService.getPlatformInfo();
    if (info.type === 'android') setDeviceName('Android Phone');
    else if (info.type === 'desktop') setDeviceName('Desktop Browser');
    else setDeviceName('My Device');
  }, []);

  const handleNext = () => {
    if (step < totalSteps) {
      setStep(step + 1);
      setError(null);
    }
  };

  const handleBack = () => {
    if (step > 1) {
      setStep(step - 1);
      setError(null);
    }
  };

  const generateKeys = async () => {
    if (passphrase !== confirmPassphrase) {
      setError('Passphrases stimmen nicht überein');
      return;
    }
    
    setIsGenerating(true);
    setError(null);
    
    try {
      // Generate PGP keys
      const keys = await cryptoService.generateKeyPair(username, passphrase);
      setKeyPair(keys);
      
      // Generate I2P identity
      const i2p = await i2pService.generateIdentity();
      setI2pIdentity({
        publicKey: uint8ArrayToBase64(i2p.publicKey),
        privateKey: uint8ArrayToBase64(i2p.privateKey),
        b32Address: i2p.b32Address,
      });
      
      handleNext();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehler bei der Generierung');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleComplete = async () => {
    if (!keyPair || !i2pIdentity) return;

    try {
      const user = {
        id: crypto.randomUUID(),
        username,
        deviceId: crypto.randomUUID(),
        deviceName,
        pgpPublicKey: keyPair.publicKey,
        pgpPrivateKey: keyPair.privateKey,
        fingerprint: keyPair.fingerprint,
        i2pAddress: i2pIdentity.b32Address,
        i2pPublicKey: i2pIdentity.publicKey,
        i2pPrivateKey: i2pIdentity.privateKey,
        createdAt: new Date().toISOString(),
      };

      // Save default I2P settings based on platform
      const platform = platformService.getPlatformInfo();
      const savedSettings = await storageService.getSettings();
      const defaultSettings: AppSettings = savedSettings || {
        theme: 'dark',
        language: 'de',
        notifications: true,
        soundEnabled: true,
        autoLock: true,
        lockTimeout: 5,
        screenshotProtection: true,
        syncEnabled: true,
        deviceName,
        i2p: {
          mode: platform.i2pSupport === 'native' ? 'auto' : 'sam',
          sam: {
            enabled: i2pTestStatus === 'success',
            host: '127.0.0.1',
            port: 7657,
            nickname: 'securechat',
          },
        },
      };
      await storageService.saveSettings(defaultSettings);

      // Set encryption passphrase before saving user with private keys
      storageService.setEncryptionPassphrase(passphrase);
      
      await storageService.saveUser(user);
      setUser(user);
      onComplete();
    } catch {
      setError('Fehler beim Speichern');
    }
  };

  const testI2PConnection = async () => {
    setI2pTestStatus('testing');
    try {
      const available = await samService.isAvailable({
        host: '127.0.0.1',
        port: 7657,
        enabled: true,
      });
      setI2pTestStatus(available ? 'success' : 'error');
    } catch {
      setI2pTestStatus('error');
    }
  };

  const handleCopyPublicKey = async () => {
    if (keyPair) {
      await navigator.clipboard.writeText(keyPair.publicKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDownloadKeys = () => {
    if (!keyPair || !i2pIdentity) return;

    const data = {
      version: '2.0',
      type: 'backup',
      username,
      deviceName,
      fingerprint: keyPair.fingerprint,
      i2pAddress: i2pIdentity.b32Address,
      pgpPublicKey: keyPair.publicKey,
      pgpPrivateKey: keyPair.privateKey,
      i2pPublicKey: i2pIdentity.publicKey,
      i2pPrivateKey: i2pIdentity.privateKey,
      exportedAt: new Date().toISOString(),
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `securechat-backup-${username}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const canProceed = () => {
    switch (step) {
      case 1:
        return username.length >= 3 && deviceName.length >= 2;
      case 2:
        return passphrase.length >= 8 && passphrase === confirmPassphrase;
      case 3:
        return keyPair !== null && i2pIdentity !== null;
      case 4:
        // I2P setup step - allow skipping, can be configured later in settings
        return true;
      default:
        return false;
    }
  };

  // New device pairing flow
  if (isNewDevice) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-lg">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-4">
              <Smartphone className="h-8 w-8 text-primary" />
            </div>
            <h1 className="text-2xl font-bold mb-2">Gerät hinzufügen</h1>
            <p className="text-muted-foreground">
              Verbinden Sie dieses Gerät mit Ihrem bestehenden Account
            </p>
          </div>

          <Tabs defaultValue="scan" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="scan">
                <QrCode className="h-4 w-4 mr-2" />
                QR-Code scannen
              </TabsTrigger>
              <TabsTrigger value="manual">
                <UserPlus className="h-4 w-4 mr-2" />
                Manuell
              </TabsTrigger>
            </TabsList>

            <TabsContent value="scan">
              <div className="bg-card rounded-xl border border-border p-6">
                <DeviceScanner onDevicePaired={onComplete} />
              </div>
            </TabsContent>

            <TabsContent value="manual">
              <div className="bg-card rounded-xl border border-border p-6 space-y-4">
                <p className="text-sm text-muted-foreground">
                  Fügen Sie Ihre Backup-Datei ein oder geben Sie Ihre Schlüssel manuell ein.
                </p>
                <DeviceManualImport onComplete={onComplete} />
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    );
  }

  // New account flow
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-4">
            <Shield className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-2xl font-bold mb-2">Willkommen bei SecureChat</h1>
          <p className="text-muted-foreground">
            Einrichtung Ihrer sicheren Messaging-App
          </p>
        </div>

        {/* Progress */}
        <div className="mb-8">
          <Progress value={progress} className="h-2" />
          <div className="flex justify-between mt-2 text-xs text-muted-foreground">
            <span>Start</span>
            <span>Schritt {step} von {totalSteps}</span>
            <span>Fertig</span>
          </div>
        </div>

        {/* Error Alert */}
        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Content */}
        <div className="bg-card rounded-xl border border-border p-6">
          {step === 1 && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                  <span className="font-semibold text-primary">1</span>
                </div>
                <div>
                  <h2 className="font-semibold">Profil erstellen</h2>
                  <p className="text-sm text-muted-foreground">Wie sollen andere Sie sehen?</p>
                </div>
              </div>

              <div>
                <label className="text-sm font-medium mb-2 block">Ihr Name</label>
                <Input
                  placeholder="z.B. Max Mustermann"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="text-lg"
                />
              </div>

              <div>
                <label className="text-sm font-medium mb-2 block">Gerätename</label>
                <Input
                  placeholder="z.B. iPhone von Max"
                  value={deviceName}
                  onChange={(e) => setDeviceName(e.target.value)}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Hilft Ihnen, Ihre Geräte zu unterscheiden
                </p>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                  <span className="font-semibold text-primary">2</span>
                </div>
                <div>
                  <h2 className="font-semibold">Passphrase festlegen</h2>
                  <p className="text-sm text-muted-foreground">Schützt Ihre privaten Schlüssel</p>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium mb-2 block">Passphrase</label>
                  <div className="relative">
                    <Input
                      type={showPassphrase ? 'text' : 'password'}
                      placeholder="Starke Passphrase eingeben"
                      value={passphrase}
                      onChange={(e) => setPassphrase(e.target.value)}
                    />
                    <button
                      onClick={() => setShowPassphrase(!showPassphrase)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                    >
                      {showPassphrase ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="text-sm font-medium mb-2 block">Passphrase bestätigen</label>
                  <Input
                    type={showPassphrase ? 'text' : 'password'}
                    placeholder="Passphrase wiederholen"
                    value={confirmPassphrase}
                    onChange={(e) => setConfirmPassphrase(e.target.value)}
                  />
                </div>

                <div className="p-4 bg-yellow-500/10 rounded-lg">
                  <div className="flex items-start gap-2">
                    <Lock className="h-4 w-4 text-yellow-500 mt-0.5" />
                    <div className="text-sm">
                      <p className="font-medium text-yellow-500">Wichtig!</p>
                      <p className="text-muted-foreground">
                        Diese Passphrase kann nicht zurückgesetzt werden. 
                        Bewahren Sie sie sicher auf!
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                  <span className="font-semibold text-primary">3</span>
                </div>
                <div>
                  <h2 className="font-semibold">Schlüssel generieren</h2>
                  <p className="text-sm text-muted-foreground">Ihre verschlüsselte Identität</p>
                </div>
              </div>

              {!keyPair ? (
                <div className="text-center py-8">
                  <Key className="h-16 w-16 mx-auto mb-4 text-primary/50" />
                  <p className="text-muted-foreground mb-6">
                    Es werden PGP- und I2P-Schlüssel generiert...
                  </p>
                  <Button 
                    onClick={generateKeys} 
                    disabled={isGenerating}
                    className="w-full"
                  >
                    {isGenerating ? (
                      <>
                        <div className="h-4 w-4 border-2 border-current border-t-transparent rounded-full animate-spin mr-2" />
                        Generiere...
                      </>
                    ) : (
                      <>
                        <Key className="h-4 w-4 mr-2" />
                        Schlüssel generieren
                      </>
                    )}
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="p-4 bg-green-500/10 rounded-lg text-center">
                    <Check className="h-8 w-8 text-green-500 mx-auto mb-2" />
                    <p className="font-medium">Schlüssel erstellt!</p>
                  </div>
                  
                  {i2pIdentity && (
                    <div className="p-3 bg-muted rounded-lg">
                      <p className="text-xs text-muted-foreground">Ihre I2P-Adresse</p>
                      <p className="text-sm font-mono break-all">{i2pIdentity.b32Address}</p>
                    </div>
                  )}

                  <div className="p-3 bg-muted rounded-lg">
                    <p className="text-xs text-muted-foreground">Fingerabdruck</p>
                    <p className="text-sm font-mono break-all">{keyPair.fingerprint}</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {step === 4 && platformInfo && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                  <span className="font-semibold text-primary">4</span>
                </div>
                <div>
                  <h2 className="font-semibold">I2P-Netzwerk</h2>
                  <p className="text-sm text-muted-foreground">i2pd ist erforderlich</p>
                </div>
              </div>

              {/* iOS Warning */}
              {platformInfo.type === 'other' && (
                <div className="p-4 bg-red-500/10 rounded-lg border border-red-500/30">
                  <p className="text-sm text-red-500 font-medium flex items-center gap-2">
                    <AlertCircle className="h-4 w-4" />
                    iOS nicht unterstützt
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Diese App erfordert i2pd, das auf iOS nicht verfügbar ist. 
                    Bitte verwenden Sie Android oder Desktop.
                  </p>
                </div>
              )}

              {/* Platform-specific instructions */}
              <div className="p-4 bg-muted rounded-lg">
                <h3 className="font-medium mb-2">{platformInfo.instructions.title}</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  {platformInfo.instructions.description}
                </p>

                {platformInfo.i2pSupport !== 'unsupported' ? (
                  <>
                    <ol className="space-y-2 text-sm mb-4">
                      {platformInfo.instructions.steps.map((step, idx) => (
                        <li key={idx} className="flex items-start gap-2">
                          <span className="bg-primary/20 text-primary rounded-full w-5 h-5 flex items-center justify-center text-xs flex-shrink-0 mt-0.5">
                            {idx + 1}
                          </span>
                          <span>{step}</span>
                        </li>
                      ))}
                    </ol>

                    {platformInfo.instructions.downloadUrl && (
                      <a
                        href={platformInfo.instructions.downloadUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 text-sm text-primary hover:underline mb-4"
                      >
                        <ExternalLink className="h-4 w-4" />
                        i2pd herunterladen
                      </a>
                    )}

                    <div className="mt-4 pt-4 border-t border-border">
                      <Button
                        variant={i2pTestStatus === 'success' ? 'default' : 'outline'}
                        className="w-full"
                        onClick={testI2PConnection}
                        disabled={i2pTestStatus === 'testing' || platformInfo.type === 'other'}
                      >
                        {i2pTestStatus === 'testing' ? (
                          <>
                            <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                            Teste Verbindung...
                          </>
                        ) : i2pTestStatus === 'success' ? (
                          <>
                            <Check className="h-4 w-4 mr-2" />
                            i2pd verbunden!
                          </>
                        ) : i2pTestStatus === 'error' ? (
                          <>
                            <AlertCircle className="h-4 w-4 mr-2" />
                            i2pd nicht gefunden - bitte installieren
                          </>
                        ) : (
                          <>
                            <RefreshCw className="h-4 w-4 mr-2" />
                            Verbindung testen
                          </>
                        )}
                      </Button>
                    </div>
                  </>
                ) : (
                  <div className="p-3 bg-red-500/10 rounded-lg">
                    <p className="text-sm text-red-500 flex items-center gap-2">
                      <AlertCircle className="h-4 w-4" />
                      Plattform nicht unterstützt
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {platformInfo.instructions.configHelp}
                    </p>
                  </div>
                )}
              </div>

              <div className="p-3 bg-yellow-500/10 rounded-lg border border-yellow-500/30">
                <p className="text-sm text-yellow-500 font-medium flex items-center gap-2">
                  <Lock className="h-4 w-4" />
                  i2pd + SAM-Proxy erforderlich
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Für anonyme Kommunikation benötigen Sie i2pd (SAM auf Port 7656) und den SAM-Proxy (Port 7657).
                  Sie können dies auch später in den Einstellungen konfigurieren.
                </p>
              </div>
            </div>
          )}

          {step === 5 && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                  <span className="font-semibold text-primary">5</span>
                </div>
                <div>
                  <h2 className="font-semibold">Backup & Geräte</h2>
                  <p className="text-sm text-muted-foreground">Speichern Sie Ihre Schlüssel</p>
                </div>
              </div>

              <div className="p-4 bg-yellow-500/10 rounded-lg mb-4">
                <div className="flex items-start gap-2">
                  <Lock className="h-4 w-4 text-yellow-500 mt-0.5" />
                  <div className="text-sm">
                    <p className="font-medium text-yellow-500">Wichtig!</p>
                    <p className="text-muted-foreground">
                      Ohne dieses Backup können Sie Ihre Nachrichten nicht wiederherstellen!
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <Button variant="outline" className="w-full" onClick={handleCopyPublicKey}>
                  {copied ? (
                    <><Check className="h-4 w-4 mr-2" /> Kopiert!</>
                  ) : (
                    <><Copy className="h-4 w-4 mr-2" /> Public Key kopieren</>
                  )}
                </Button>

                <Button variant="outline" className="w-full" onClick={handleDownloadKeys}>
                  <Download className="h-4 w-4 mr-2" />
                  Backup herunterladen
                </Button>

                <Button variant="secondary" className="w-full" onClick={() => setShowPairing(true)}>
                  <Smartphone className="h-4 w-4 mr-2" />
                  Weiteres Gerät verbinden
                </Button>
              </div>

              {showPairing && i2pIdentity && keyPair && (
                <div className="mt-4 p-4 border border-border rounded-lg">
                  <p className="text-sm font-medium mb-2">QR-Code für neues Gerät</p>
                  <DeviceQRCode 
                    userData={{
                      username,
                      deviceName,
                      fingerprint: keyPair.fingerprint,
                      i2pAddress: i2pIdentity.b32Address,
                      pgpPublicKey: keyPair.publicKey,
                      i2pPublicKey: i2pIdentity.publicKey,
                    }}
                  />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Navigation */}
        {!showPairing && (
          <div className="flex justify-between mt-6">
            <Button variant="outline" onClick={handleBack} disabled={step === 1 || isGenerating}>
              <ChevronLeft className="h-4 w-4 mr-2" />
              Zurück
            </Button>

            {step < totalSteps ? (
              <Button onClick={step === 2 ? generateKeys : handleNext} disabled={!canProceed() || isGenerating}>
                {step === 2 ? 'Generieren' : 'Weiter'}
                <ChevronRight className="h-4 w-4 ml-2" />
              </Button>
            ) : (
              <Button onClick={handleComplete}>
                Fertigstellen
                <Check className="h-4 w-4 ml-2" />
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Device Scanner Component - uses external component
function DeviceScanner({ onDevicePaired }: { onDevicePaired: () => void }) {
  void onDevicePaired;
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Scannen Sie den QR-Code von Ihrem anderen Gerät.
      </p>
      <div className="border-2 border-dashed border-border rounded-lg p-8 text-center">
        <QrCode className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
        <p className="text-muted-foreground">Kamera-Zugriff erforderlich</p>
        <p className="text-sm text-muted-foreground mt-2">
          Diese Funktion wird in Kürze verfügbar sein.
        </p>
      </div>
    </div>
  );
}

// Manual Import Component - simplified
function DeviceManualImport({ onComplete }: { onComplete: () => void }) {
  const [importData, setImportData] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleImport = async () => {
    try {
      const parsed = JSON.parse(importData);
      if (!parsed.pgpPrivateKey || !parsed.i2pPrivateKey) {
        throw new Error('Ungültige Backup-Datei');
      }
      onComplete();
    } catch {
      setError('Fehler beim Import. Überprüfen Sie Ihre Backup-Datei.');
    }
  };

  return (
    <div className="space-y-4">
      <textarea
        className="w-full h-40 p-3 rounded-md border border-input bg-background text-xs font-mono"
        placeholder="Fügen Sie Ihre Backup-Daten hier ein..."
        value={importData}
        onChange={(e) => setImportData(e.target.value)}
      />
      
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Button onClick={handleImport} disabled={!importData} className="w-full">
        Importieren
      </Button>
    </div>
  );
}
