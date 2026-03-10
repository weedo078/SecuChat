import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Shield, Key, Lock, Check, ChevronRight, ChevronLeft, Eye, EyeOff, Download, Copy, AlertCircle, Smartphone, QrCode, UserPlus, ExternalLink, RefreshCw, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useApp } from '@/contexts/AppContext';
import { cryptoService } from '@/services/crypto';
import { storageService } from '@/services/storage';
import { backupService } from '@/services/backup';
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
  const { t } = useTranslation();
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
  const [showRestoreFlow, setShowRestoreFlow] = useState(false);
  const [restoreBackupFile, setRestoreBackupFile] = useState<File | null>(null);
  const [restoreKeyFile, setRestoreKeyFile] = useState<File | null>(null);
  const [restoreValidation, setRestoreValidation] = useState<import('@/services/backup').ValidationResult | null>(null);
  const [restorePassphrase, setRestorePassphrase] = useState('');
  const [isRestoring, setIsRestoring] = useState(false);
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

  const isMountedRef = useRef(true);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // In Electron, auto-test the connection when the user reaches step 4
  useEffect(() => {
    if (step === 4 && platformService.isElectron() && i2pTestStatus === 'idle') {
      testI2PConnection();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const generateKeys = async () => {
    if (passphrase !== confirmPassphrase) {
      setError(t('onboarding.passphraseMismatch'));
      return;
    }

    setIsGenerating(true);
    setError(null);

    try {
      // Generate PGP keys
      const keys = await cryptoService.generateKeyPair(username, passphrase);
      if (!isMountedRef.current) return;
      setKeyPair(keys);

      // Generate I2P identity
      const i2p = await i2pService.generateIdentity();
      if (!isMountedRef.current) return;
      setI2pIdentity({
        publicKey: uint8ArrayToBase64(i2p.publicKey),
        privateKey: uint8ArrayToBase64(i2p.privateKey),
        b32Address: i2p.b32Address,
      });

      handleNext();
    } catch (err) {
      if (!isMountedRef.current) return;
      setError(err instanceof Error ? err.message : t('onboarding.generationError'));
    } finally {
      if (isMountedRef.current) {
        setIsGenerating(false);
      }
    }
  };

  const handleComplete = async () => {
    if (!keyPair || !i2pIdentity) return;

    try {
      // Initialize storage first (required for localStorage fallback)
      await storageService.init();

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
        i2pSamDestination: undefined as string | undefined,  // Will be set on first I2P init
        createdAt: new Date().toISOString(),
      };

      // Save default I2P settings based on platform
      const platform = platformService.getPlatformInfo();
      const savedSettings = await storageService.getSettings();
      const defaultSettings: AppSettings = savedSettings || {
        theme: 'dark',
        language: 'de',
        notifications: true,
        notificationSettings: {
          enabled: true,
          sound: true,
          vibration: true,
          showPreview: true,
          priority: 'high',
        },
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
            port: platformService.isAndroidNative() ? 7656 : 7657,
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
    } catch (err) {
      console.error('[Onboarding] Save error:', err);
      setError(t('onboarding.saveError', { error: err instanceof Error ? err.message : t('onboarding.unknownError') }));
    }
  };

  const testI2PConnection = async () => {
    setI2pTestStatus('testing');
    setError(null);

    // Electron has bundled i2pd that may need a moment to start — give it more time
    // Android native uses direct TCP connection (port 7656), not WebSocket proxy (port 7657)
    const timeoutMs = platformService.isElectron() ? 30000 : 15000;
    const samPort = platformService.isAndroidNative() ? 7656 : 7657;

    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('TIMEOUT')), timeoutMs);
      });

      const available = await Promise.race([
        samService.isAvailable({
          host: '127.0.0.1',
          port: samPort,
          enabled: true,
        }),
        timeoutPromise,
      ]);

      setI2pTestStatus(available ? 'success' : 'error');
      if (!available) {
        setError(t('onboarding.i2pdNotReachable'));
      }
    } catch (err) {
      setI2pTestStatus('error');
      if (err instanceof Error && err.message === 'TIMEOUT') {
        if (platformService.isElectron()) {
          setError(t('onboarding.i2pdElectronTimeout', { timeout: timeoutMs / 1000 }));
        } else {
          setError(t('onboarding.i2pdBrowserTimeout', { timeout: timeoutMs / 1000 }));
        }
      } else {
        setError(t('onboarding.i2pdTestError'));
      }
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
      <div className="h-dvh bg-background flex items-start justify-center p-4 overflow-y-auto">
        <div className="w-full max-w-lg my-auto">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-4">
              <Smartphone className="h-8 w-8 text-primary" />
            </div>
            <h1 className="text-2xl font-bold mb-2">{t('onboarding.addDevice')}</h1>
            <p className="text-muted-foreground">
              {t('onboarding.connectExistingAccount')}
            </p>
          </div>

          <Tabs defaultValue="scan" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="scan">
                <QrCode className="h-4 w-4 mr-2" />
                {t('onboarding.scanQr')}
              </TabsTrigger>
              <TabsTrigger value="manual">
                <UserPlus className="h-4 w-4 mr-2" />
                {t('onboarding.manual')}
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
                  {t('onboarding.manualImportDescription')}
                </p>
                <DeviceManualImport onComplete={onComplete} />
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    );
  }

  const handleBackupFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setRestoreBackupFile(file);
    setError(null);
    try {
      const content = await backupService.readFile(file);
      const validation = backupService.validateBackupFile(content);
      setRestoreValidation(validation);
      if (!validation.valid) {
        setError(validation.error || t('onboarding.invalidBackup'));
      }
    } catch {
      setRestoreValidation(null);
      setError(t('onboarding.fileReadError'));
    }
  };

  const handleKeyFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setRestoreKeyFile(file);
      setError(null);
    }
  };

  const handleRestoreBackup = async () => {
    if (!restoreBackupFile || !restoreKeyFile || !restoreValidation?.valid) return;
    setIsRestoring(true);
    setError(null);
    try {
      const backupContent = await backupService.readFile(restoreBackupFile);
      const keyContent = await backupService.readFile(restoreKeyFile);
      const restored = await backupService.restoreBackup(backupContent, keyContent);

      // Set encryption passphrase for private key storage
      if (restorePassphrase.length >= 8) {
        storageService.setEncryptionPassphrase(restorePassphrase);
        // Re-save user to encrypt private keys with new passphrase
        if (restored.user) {
          await storageService.saveUser(restored.user);
        }
      }

      // Import crypto keys if available
      if (restored.user?.pgpPrivateKey && restored.user?.pgpPublicKey) {
        try {
          await cryptoService.importKeyPair(
            restored.user.pgpPrivateKey,
            restored.user.pgpPublicKey,
            restorePassphrase
          );
        } catch {
          // Key import may fail if passphrase doesn't match PGP key passphrase
          // User can unlock later
        }
      }

      setUser(restored.user);
      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('onboarding.restoreFailed'));
    } finally {
      setIsRestoring(false);
    }
  };

  // Restore from backup flow
  if (showRestoreFlow) {
    return (
      <div className="h-dvh bg-background flex items-start justify-center p-4 overflow-y-auto">
        <div className="w-full max-w-lg my-auto">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-4">
              <Upload className="h-8 w-8 text-primary" />
            </div>
            <h1 className="text-2xl font-bold mb-2">{t('onboarding.restoreTitle')}</h1>
            <p className="text-muted-foreground">
              {t('onboarding.restoreSubtitle')}
            </p>
          </div>

          {error && (
            <Alert variant="destructive" className="mb-4">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="bg-card rounded-xl border border-border p-6 space-y-4">
            {/* Info */}
            <div className="bg-amber-50 border border-amber-200 p-4 rounded-lg">
              <p className="text-amber-800 text-sm font-medium">
                {t('onboarding.twoFilesRequired')}
              </p>
              <p className="text-amber-700 text-xs mt-1">
                {t('onboarding.twoFilesDescription')}
              </p>
            </div>

            {/* Backup file picker */}
            <div>
              <label className="text-sm font-medium mb-2 block">{t('onboarding.backupFile')}</label>
              <div className="relative">
                <input
                  type="file"
                  accept=".secuchat,.json"
                  onChange={handleBackupFileSelect}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
                <Button variant="outline" className="w-full">
                  <Upload className="h-4 w-4 mr-2" />
                  {restoreBackupFile ? restoreBackupFile.name : t('onboarding.selectBackupFile')}
                </Button>
              </div>
            </div>

            {/* Key file picker */}
            <div>
              <label className="text-sm font-medium mb-2 block">{t('onboarding.keyFile')}</label>
              <div className="relative">
                <input
                  type="file"
                  accept=".secuchat,.json"
                  onChange={handleKeyFileSelect}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
                <Button
                  variant="outline"
                  className="w-full"
                  disabled={!restoreValidation?.valid}
                >
                  <Key className="h-4 w-4 mr-2" />
                  {restoreKeyFile ? restoreKeyFile.name : t('onboarding.selectKeyFile')}
                </Button>
              </div>
              {!restoreValidation?.valid && (
                <p className="text-xs text-muted-foreground mt-1">
                  {t('onboarding.selectBackupFirst')}
                </p>
              )}
            </div>

            {/* Validation info */}
            {restoreValidation?.valid && (
              <div className="p-4 bg-green-500/10 rounded-lg space-y-1">
                <div className="flex items-center gap-2">
                  <Check className="h-4 w-4 text-green-500" />
                  <span className="font-medium text-green-500">{t('onboarding.validBackup')}</span>
                </div>
                {restoreValidation.username && (
                  <p className="text-sm text-muted-foreground">{t('onboarding.user', { name: restoreValidation.username })}</p>
                )}
              </div>
            )}

            {/* Passphrase for key encryption in storage */}
            {restoreValidation?.valid && (
              <div>
                <label className="text-sm font-medium mb-2 block">{t('onboarding.passphraseForEncryption')}</label>
                <Input
                  type="password"
                  placeholder={t('onboarding.minChars')}
                  value={restorePassphrase}
                  onChange={(e) => setRestorePassphrase(e.target.value)}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  {t('onboarding.protectsKeys')}
                </p>
              </div>
            )}

            {/* Restore button */}
            <Button
              onClick={handleRestoreBackup}
              disabled={!restoreValidation?.valid || !restoreKeyFile || isRestoring || restorePassphrase.length < 8}
              className="w-full"
            >
              {isRestoring ? (
                <>
                  <div className="h-4 w-4 border-2 border-current border-t-transparent rounded-full animate-spin mr-2" />
                  {t('onboarding.restoring')}
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4 mr-2" />
                  {t('onboarding.restoreBackup')}
                </>
              )}
            </Button>
          </div>

          <div className="flex justify-center mt-6">
            <Button variant="outline" onClick={() => { setShowRestoreFlow(false); setError(null); setRestoreBackupFile(null); setRestoreKeyFile(null); setRestoreValidation(null); }}>
              <ChevronLeft className="h-4 w-4 mr-2" />
              {t('onboarding.backToSetup')}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // New account flow
  return (
    <div className="h-dvh bg-background flex items-start justify-center p-4 overflow-y-auto">
      <div className="w-full max-w-lg my-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-4">
            <Shield className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-2xl font-bold mb-2">{t('onboarding.welcomeTitle')}</h1>
          <p className="text-muted-foreground">
            {t('onboarding.welcomeSubtitle')}
          </p>
        </div>

        {/* Progress */}
        <div className="mb-8">
          <Progress value={progress} className="h-2" />
          <div className="flex justify-between mt-2 text-xs text-muted-foreground">
            <span>{t('onboarding.start')}</span>
            <span>{t('onboarding.stepOf', { step, total: totalSteps })}</span>
            <span>{t('onboarding.done')}</span>
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
                  <h2 className="font-semibold">{t('onboarding.step1Title')}</h2>
                  <p className="text-sm text-muted-foreground">{t('onboarding.step1Subtitle')}</p>
                </div>
              </div>

              <div>
                <label className="text-sm font-medium mb-2 block">{t('onboarding.yourName')}</label>
                <Input
                  placeholder={t('onboarding.namePlaceholder')}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="text-lg"
                />
              </div>

              <div>
                <label className="text-sm font-medium mb-2 block">{t('onboarding.deviceName')}</label>
                <Input
                  placeholder={t('onboarding.deviceNamePlaceholder')}
                  value={deviceName}
                  onChange={(e) => setDeviceName(e.target.value)}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  {t('onboarding.deviceNameHelp')}
                </p>
              </div>

              <div className="pt-4 border-t border-border">
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => setShowRestoreFlow(true)}
                >
                  <Upload className="h-4 w-4 mr-2" />
                  {t('onboarding.loadBackup')}
                </Button>
                <p className="text-xs text-muted-foreground mt-1 text-center">
                  {t('onboarding.loadBackupHelp')}
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
                  <h2 className="font-semibold">{t('onboarding.step2Title')}</h2>
                  <p className="text-sm text-muted-foreground">{t('onboarding.step2Subtitle')}</p>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium mb-2 block">{t('common.passphrase')}</label>
                  <div className="relative">
                    <Input
                      type={showPassphrase ? 'text' : 'password'}
                      placeholder={t('onboarding.passphrasePlaceholder')}
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
                  <label className="text-sm font-medium mb-2 block">{t('onboarding.confirmPassphrase')}</label>
                  <Input
                    type={showPassphrase ? 'text' : 'password'}
                    placeholder={t('onboarding.confirmPassphrasePlaceholder')}
                    value={confirmPassphrase}
                    onChange={(e) => setConfirmPassphrase(e.target.value)}
                  />
                </div>

                <div className="p-4 bg-yellow-500/10 rounded-lg">
                  <div className="flex items-start gap-2">
                    <Lock className="h-4 w-4 text-yellow-500 mt-0.5" />
                    <div className="text-sm">
                      <p className="font-medium text-yellow-500">{t('onboarding.passphraseImportant')}</p>
                      <p className="text-muted-foreground">
                        {t('onboarding.passphraseWarning')}
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
                  <h2 className="font-semibold">{t('onboarding.step3Title')}</h2>
                  <p className="text-sm text-muted-foreground">{t('onboarding.step3Subtitle')}</p>
                </div>
              </div>

              {!keyPair ? (
                <div className="text-center py-8">
                  <Key className="h-16 w-16 mx-auto mb-4 text-primary/50" />
                  <p className="text-muted-foreground mb-6">
                    {t('onboarding.generatingKeys')}
                  </p>
                  <Button
                    onClick={generateKeys}
                    disabled={isGenerating}
                    className="w-full"
                  >
                    {isGenerating ? (
                      <>
                        <div className="h-4 w-4 border-2 border-current border-t-transparent rounded-full animate-spin mr-2" />
                        {t('common.generating')}
                      </>
                    ) : (
                      <>
                        <Key className="h-4 w-4 mr-2" />
                        {t('onboarding.generateKeys')}
                      </>
                    )}
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="p-4 bg-green-500/10 rounded-lg text-center">
                    <Check className="h-8 w-8 text-green-500 mx-auto mb-2" />
                    <p className="font-medium">{t('onboarding.keysCreated')}</p>
                  </div>

                  {i2pIdentity && (
                    <div className="p-3 bg-muted rounded-lg">
                      <p className="text-xs text-muted-foreground">{t('onboarding.yourI2pAddress')}</p>
                      <p className="text-sm font-mono break-all">{i2pIdentity.b32Address}</p>
                    </div>
                  )}

                  <div className="p-3 bg-muted rounded-lg">
                    <p className="text-xs text-muted-foreground">{t('onboarding.fingerprint')}</p>
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
                  <h2 className="font-semibold">{t('onboarding.step4Title')}</h2>
                  <p className="text-sm text-muted-foreground">{t('onboarding.step4Subtitle')}</p>
                </div>
              </div>

              {/* iOS Warning */}
              {platformInfo.type === 'other' && (
                <div className="p-4 bg-red-500/10 rounded-lg border border-red-500/30">
                  <p className="text-sm text-red-500 font-medium flex items-center gap-2">
                    <AlertCircle className="h-4 w-4" />
                    {t('onboarding.iosNotSupported')}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t('onboarding.iosWarning')}
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
                        {t('onboarding.downloadI2pd')}
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
                            {t('onboarding.testingConnection')}
                          </>
                        ) : i2pTestStatus === 'success' ? (
                          <>
                            <Check className="h-4 w-4 mr-2" />
                            {t('onboarding.i2pdConnected')}
                          </>
                        ) : i2pTestStatus === 'error' ? (
                          <>
                            <AlertCircle className="h-4 w-4 mr-2" />
                            {t('onboarding.i2pdNotFound')}
                          </>
                        ) : (
                          <>
                            <RefreshCw className="h-4 w-4 mr-2" />
                            {t('onboarding.testConnection')}
                          </>
                        )}
                      </Button>
                    </div>
                  </>
                ) : (
                  <div className="p-3 bg-red-500/10 rounded-lg">
                    <p className="text-sm text-red-500 flex items-center gap-2">
                      <AlertCircle className="h-4 w-4" />
                      {t('onboarding.platformNotSupported')}
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
                  {platformService.isElectron() ? t('onboarding.i2pdIntegrated') : t('onboarding.i2pdSamRequired')}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {platformService.isElectron()
                    ? t('onboarding.i2pdIntegratedDesc')
                    : t('onboarding.i2pdSamRequiredDesc')}
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
                  <h2 className="font-semibold">{t('onboarding.step5Title')}</h2>
                  <p className="text-sm text-muted-foreground">{t('onboarding.step5Subtitle')}</p>
                </div>
              </div>

              <div className="p-4 bg-yellow-500/10 rounded-lg mb-4">
                <div className="flex items-start gap-2">
                  <Lock className="h-4 w-4 text-yellow-500 mt-0.5" />
                  <div className="text-sm">
                    <p className="font-medium text-yellow-500">{t('onboarding.backupImportant')}</p>
                    <p className="text-muted-foreground">
                      {t('onboarding.backupWarning')}
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <Button variant="outline" className="w-full" onClick={handleCopyPublicKey}>
                  {copied ? (
                    <><Check className="h-4 w-4 mr-2" /> {t('common.copied')}</>
                  ) : (
                    <><Copy className="h-4 w-4 mr-2" /> {t('onboarding.copyPublicKey')}</>
                  )}
                </Button>

                <Button variant="outline" className="w-full" onClick={handleDownloadKeys}>
                  <Download className="h-4 w-4 mr-2" />
                  {t('onboarding.downloadBackup')}
                </Button>

                <Button variant="secondary" className="w-full" onClick={() => setShowPairing(true)}>
                  <Smartphone className="h-4 w-4 mr-2" />
                  {t('onboarding.connectDevice')}
                </Button>
              </div>

              {showPairing && i2pIdentity && keyPair && (
                <div className="mt-4 p-4 border border-border rounded-lg">
                  <p className="text-sm font-medium mb-2">{t('onboarding.qrForDevice')}</p>
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
              {t('common.back')}
            </Button>

            {step < totalSteps ? (
              <Button onClick={step === 2 ? generateKeys : handleNext} disabled={!canProceed() || isGenerating}>
                {step === 2 ? t('onboarding.generate') : t('common.next')}
                <ChevronRight className="h-4 w-4 ml-2" />
              </Button>
            ) : (
              <Button onClick={handleComplete}>
                {t('onboarding.finish')}
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
  const { t } = useTranslation();
  void onDevicePaired;
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {t('onboarding.scanQrDescription')}
      </p>
      <div className="border-2 border-dashed border-border rounded-lg p-8 text-center">
        <QrCode className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
        <p className="text-muted-foreground">{t('onboarding.cameraRequired')}</p>
        <p className="text-sm text-muted-foreground mt-2">
          {t('onboarding.comingSoon')}
        </p>
      </div>
    </div>
  );
}

// Manual Import Component - imports device keys as contact
function DeviceManualImport({ onComplete }: { onComplete: () => void }) {
  const { t } = useTranslation();
  const [importData, setImportData] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleImport = async () => {
    try {
      const parsed = JSON.parse(importData);

      // Validate required fields according to Device-Import format
      if (!parsed.version || !parsed.metadata || !parsed.keys || !parsed.network) {
        throw new Error(t('onboarding.invalidFormat'));
      }

      // Validate version
      if (parsed.version !== '1.0') {
        throw new Error(t('onboarding.unsupportedVersion', { version: parsed.version }));
      }

      // Validate metadata
      if (!parsed.metadata.timestamp || !parsed.metadata.username || !parsed.metadata.deviceId) {
        throw new Error(t('onboarding.invalidMetadata'));
      }

      // Validate keys
      if (!parsed.keys.pgpPublicKey || !parsed.keys.fingerprint || !parsed.keys.i2pAddress || !parsed.keys.i2pPublicKey) {
        throw new Error(t('onboarding.invalidKeys'));
      }

      // Validate network
      if (!parsed.network.p2pIdentifier || !parsed.network.protocol || !parsed.network.i2pAddress) {
        throw new Error(t('onboarding.invalidNetwork'));
      }

      // Create contact from imported device data
      const contact = {
        id: crypto.randomUUID(),
        name: parsed.metadata.username,
        pgpPublicKey: parsed.keys.pgpPublicKey,
        fingerprint: parsed.keys.fingerprint,
        p2pIdentifier: parsed.network.p2pIdentifier,
        i2pAddress: parsed.keys.i2pAddress,
        status: 'offline' as const,
        lastSeen: parsed.metadata.timestamp,
      };

      // Save contact to storage
      await storageService.saveContact(contact);

      setSuccess(true);
      setError(null);

      // Complete after short delay to show success message
      setTimeout(() => {
        onComplete();
      }, 1500);
    } catch (err) {
      if (err instanceof SyntaxError) {
        setError(t('onboarding.invalidJson'));
      } else {
        setError(err instanceof Error ? err.message : t('onboarding.importError'));
      }
      setSuccess(false);
    }
  };

  return (
    <div className="space-y-4">
      <textarea
        className="w-full h-40 p-3 rounded-md border border-input bg-background text-xs font-mono"
        placeholder='{"version": "1.0", "metadata": {...}, "keys": {...}, "network": {...}}'
        value={importData}
        onChange={(e) => setImportData(e.target.value)}
      />

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {success && (
        <Alert className="bg-green-500/10 border-green-500/30">
          <Check className="h-4 w-4 text-green-500" />
          <AlertDescription className="text-green-500">{t('onboarding.contactImported')}</AlertDescription>
        </Alert>
      )}

      <Button onClick={handleImport} disabled={!importData || success} className="w-full">
        {success ? t('common.imported') : t('common.import')}
      </Button>
    </div>
  );
}
