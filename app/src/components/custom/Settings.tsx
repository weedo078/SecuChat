import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  Sun,
  Bell,
  Shield,
  Download,
  Upload,
  Trash2,
  ChevronRight,
  Eye,
  EyeOff,
  Network,
  Check,
  X,
  Globe
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { useApp } from '@/contexts/AppContext';
import { i2pService, samService } from '@/services/i2p';
import { storageService } from '@/services/storage';
import { backupService, type ValidationResult } from '@/services/backup';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface SettingsProps {
  isOpen: boolean;
  onClose: () => void;
}

export function Settings({ isOpen, onClose }: SettingsProps) {
  const { t, i18n } = useTranslation();
  const { settings, updateSettings, securitySettings, updateSecuritySettings } = useApp();
  const [showBackupDialog, setShowBackupDialog] = useState(false);
  const [showRestoreDialog, setShowRestoreDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showDuressPinDialog, setShowDuressPinDialog] = useState(false);
  const [showI2PDialog, setShowI2PDialog] = useState(false);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>{t('settings.title')}</DialogTitle>
          <DialogDescription>
            {t('settings.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto -mx-6 px-6">
          <div className="space-y-6">
            {/* Appearance */}
            <section>
              <h3 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
                <Sun className="h-4 w-4" />
                {t('settings.appearance')}
              </h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 rounded-lg border border-border">
                  <div>
                    <p className="font-medium">{t('settings.darkTheme')}</p>
                    <p className="text-sm text-muted-foreground">{t('settings.darkThemeDesc')}</p>
                  </div>
                  <Switch
                    checked={settings.theme === 'dark'}
                    onCheckedChange={(checked) =>
                      updateSettings({ theme: checked ? 'dark' : 'light' })
                    }
                  />
                </div>
              </div>
            </section>

            <Separator />

            {/* Language */}
            <section>
              <h3 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
                <Globe className="h-4 w-4" />
                {t('settings.language')}
              </h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 rounded-lg border border-border">
                  <div>
                    <p className="font-medium">{t('settings.language')}</p>
                    <p className="text-sm text-muted-foreground">{t('settings.languageDesc')}</p>
                  </div>
                  <Select
                    value={i18n.language.startsWith('de') ? 'de' : i18n.language.startsWith('en') ? 'en' : i18n.language}
                    onValueChange={(value) => {
                      i18n.changeLanguage(value);
                      localStorage.setItem('securechat-language', value);
                    }}
                  >
                    <SelectTrigger className="w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="de">Deutsch</SelectItem>
                      <SelectItem value="en">English</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </section>

            <Separator />

            {/* Notifications */}
            <section>
              <h3 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
                <Bell className="h-4 w-4" />
                {t('settings.notifications')}
              </h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 rounded-lg border border-border">
                  <div>
                    <p className="font-medium">{t('settings.enableNotifications')}</p>
                    <p className="text-sm text-muted-foreground">{t('settings.enableNotificationsDesc')}</p>
                  </div>
                  <Switch
                    checked={settings.notifications}
                    onCheckedChange={(checked) =>
                      updateSettings({ notifications: checked })
                    }
                  />
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg border border-border">
                  <div>
                    <p className="font-medium">{t('settings.sound')}</p>
                    <p className="text-sm text-muted-foreground">{t('settings.soundDesc')}</p>
                  </div>
                  <Switch
                    checked={settings.soundEnabled}
                    onCheckedChange={(checked) =>
                      updateSettings({ soundEnabled: checked })
                    }
                  />
                </div>
              </div>
            </section>

            <Separator />

            {/* Security */}
            <section>
              <h3 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
                <Shield className="h-4 w-4" />
                {t('settings.security')}
              </h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 rounded-lg border border-border">
                  <div>
                    <p className="font-medium">{t('settings.autoLock')}</p>
                    <p className="text-sm text-muted-foreground">{t('settings.autoLockDesc')}</p>
                  </div>
                  <Switch
                    checked={securitySettings.autoLockEnabled}
                    onCheckedChange={(checked) =>
                      updateSecuritySettings({ autoLockEnabled: checked })
                    }
                  />
                </div>

                {securitySettings.autoLockEnabled && (
                  <div className="flex items-center justify-between p-3 rounded-lg border border-border ml-4">
                    <div>
                      <p className="font-medium">{t('settings.lockTime')}</p>
                      <p className="text-sm text-muted-foreground">{t('settings.lockTimeDesc')}</p>
                    </div>
                    <Select
                      value={securitySettings.autoLockTimeout.toString()}
                      onValueChange={(value) =>
                        updateSecuritySettings({ autoLockTimeout: parseInt(value) })
                      }
                    >
                      <SelectTrigger className="w-24">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">1 Min</SelectItem>
                        <SelectItem value="5">5 Min</SelectItem>
                        <SelectItem value="10">10 Min</SelectItem>
                        <SelectItem value="30">30 Min</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div className="flex items-center justify-between p-3 rounded-lg border border-border">
                  <div>
                    <p className="font-medium">{t('settings.screenshotProtection')}</p>
                    <p className="text-sm text-muted-foreground">{t('settings.screenshotProtectionDesc')}</p>
                  </div>
                  <Switch
                    checked={settings.screenshotProtection}
                    onCheckedChange={(checked) =>
                      updateSettings({ screenshotProtection: checked })
                    }
                  />
                </div>

                <button
                  onClick={() => setShowDuressPinDialog(true)}
                  className="w-full flex items-center justify-between p-3 rounded-lg border border-border hover:bg-accent transition-colors"
                >
                  <div className="text-left">
                    <p className="font-medium">{t('settings.duressPin')}</p>
                    <p className="text-sm text-muted-foreground">
                      {securitySettings.duressPin ? t('settings.duressPinConfigured') : t('settings.duressPinNotConfigured')}
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </button>
              </div>
            </section>

            <Separator />

            {/* I2P Network */}
            <section>
              <h3 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
                <Network className="h-4 w-4" />
                {t('settings.i2pNetwork')}
              </h3>
              <div className="space-y-3">
                <button
                  onClick={() => setShowI2PDialog(true)}
                  className="w-full flex items-center justify-between p-3 rounded-lg border border-border hover:bg-accent transition-colors"
                >
                  <div className="text-left">
                    <p className="font-medium">{t('settings.i2pConnection')}</p>
                    <p className="text-sm text-muted-foreground">
                      {settings.i2p.sam.enabled ? t('settings.samEnabled') : t('settings.browserNative')}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {settings.i2p.sam.enabled ? (
                      <span className="flex items-center gap-1 text-xs text-teal-400">
                        <Check className="h-3 w-3" />
                        SAM
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-xs text-amber-500">
                        <X className="h-3 w-3" />
                        WebRTC
                      </span>
                    )}
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                </button>
              </div>
            </section>

            <Separator />

            {/* Backup & Restore */}
            <section>
              <h3 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
                <Download className="h-4 w-4" />
                {t('settings.backupRestore')}
              </h3>
              <div className="space-y-3">
                <button
                  onClick={() => setShowBackupDialog(true)}
                  className="w-full flex items-center justify-between p-3 rounded-lg border border-border hover:bg-accent transition-colors"
                >
                  <div className="text-left">
                    <p className="font-medium">{t('settings.createBackup')}</p>
                    <p className="text-sm text-muted-foreground">{t('settings.createBackupDesc')}</p>
                  </div>
                  <Download className="h-4 w-4 text-muted-foreground" />
                </button>

                <button
                  onClick={() => setShowRestoreDialog(true)}
                  className="w-full flex items-center justify-between p-3 rounded-lg border border-border hover:bg-accent transition-colors"
                >
                  <div className="text-left">
                    <p className="font-medium">{t('settings.restore')}</p>
                    <p className="text-sm text-muted-foreground">{t('settings.restoreDesc')}</p>
                  </div>
                  <Upload className="h-4 w-4 text-muted-foreground" />
                </button>
              </div>
            </section>

            <Separator />

            {/* Danger Zone */}
            <section>
              <h3 className="text-sm font-medium text-destructive mb-3 flex items-center gap-2">
                <Trash2 className="h-4 w-4" />
                {t('settings.dangerZone')}
              </h3>
              <button
                onClick={() => setShowDeleteDialog(true)}
                className="w-full flex items-center justify-between p-3 rounded-lg border border-destructive/30 hover:bg-destructive/10 transition-colors"
              >
                <div className="text-left">
                  <p className="font-medium text-destructive">{t('settings.deleteAllData')}</p>
                  <p className="text-sm text-muted-foreground">{t('settings.deleteAllDataDesc')}</p>
                </div>
                <Trash2 className="h-4 w-4 text-destructive" />
              </button>
            </section>
          </div>
        </div>
      </DialogContent>

      <BackupDialog isOpen={showBackupDialog} onClose={() => setShowBackupDialog(false)} />
      <RestoreDialog isOpen={showRestoreDialog} onClose={() => setShowRestoreDialog(false)} />
      <DeleteDataDialog isOpen={showDeleteDialog} onClose={() => setShowDeleteDialog(false)} />
      <DuressPinDialog isOpen={showDuressPinDialog} onClose={() => setShowDuressPinDialog(false)} />
      <I2PConfigDialog isOpen={showI2PDialog} onClose={() => setShowI2PDialog(false)} />
    </Dialog>
  );
}

function BackupDialog({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const [isCreating, setIsCreating] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [warningAccepted, setWarningAccepted] = useState(false);

  const handleCreateBackup = async () => {
    setIsCreating(true);
    setError('');
    try {
      const { backupFile, keyFile } = await backupService.createBackup();

      // Download both files
      backupService.downloadBackup(backupFile);

      // Small delay to ensure first download starts
      await new Promise(resolve => setTimeout(resolve, 500));

      backupService.downloadBackupKey(keyFile);

      setDone(true);
      toast.success(t('backup.backupAndKeyDownloaded'));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('backup.backupFailed'));
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) { setDone(false); setError(''); setWarningAccepted(false); } onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('backup.title')}</DialogTitle>
          <DialogDescription>
            {t('backup.description')}
          </DialogDescription>
        </DialogHeader>

        {done ? (
          <div className="mt-4 text-center py-4 space-y-4">
            <Check className="h-8 w-8 text-teal-400 mx-auto" />
            <div>
              <p className="font-medium text-teal-400">{t('backup.created')}</p>
              <p className="text-sm text-muted-foreground mt-1">
                {t('backup.twoFilesDownloaded')}
              </p>
            </div>
            <div className="text-left bg-muted p-4 rounded-lg space-y-2 text-sm">
              <p><strong>1. Backup_*.secuchat</strong> - Ihre verschlüsselten Daten</p>
              <p><strong>2. BackupKey_*.secuchat</strong> - Der Entschlüsselungsschlüssel</p>
            </div>
            <div className="bg-amber-50 border border-amber-200 p-4 rounded-lg">
              <p className="text-amber-800 text-sm font-medium">
                ⚠️ {t('backup.keepBothFiles')}
              </p>
              <p className="text-amber-700 text-xs mt-1">
                {t('backup.withoutKeyFile')}
              </p>
            </div>
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            <div className="bg-destructive/10 border border-destructive/20 p-4 rounded-lg">
              <p className="text-destructive font-medium text-sm">
                ⚠️ {t('backup.warning')}
              </p>
              <p className="text-destructive/80 text-xs mt-2">
                {t('backup.twoFilesCreated')}
              </p>
              <ul className="text-destructive/80 text-xs mt-1 list-disc list-inside">
                <li><strong>Backup_*.secuchat</strong> - Ihre verschlüsselten Daten</li>
                <li><strong>BackupKey_*.secuchat</strong> - Der private Schlüssel zum Entschlüsseln</li>
              </ul>
              <p className="text-destructive/80 text-xs mt-2 font-medium">
                {t('backup.keepKeyFileSafe')}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="warning-accept"
                checked={warningAccepted}
                onChange={(e) => setWarningAccepted(e.target.checked)}
                className="rounded border-border"
              />
              <label htmlFor="warning-accept" className="text-sm text-muted-foreground">
                {t('backup.understandBothFiles')}
              </label>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <Button
              onClick={handleCreateBackup}
              disabled={isCreating || !warningAccepted}
              className="w-full"
            >
              {isCreating ? (
                <>
                  <div className="h-4 w-4 border-2 border-current border-t-transparent rounded-full animate-spin mr-2" />
                  {t('backup.creating')}
                </>
              ) : (
                <>
                  <Download className="h-4 w-4 mr-2" />
                  {t('backup.createTwoFiles')}
                </>
              )}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function RestoreDialog({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const [backupFile, setBackupFile] = useState<File | null>(null);
  const [keyFile, setKeyFile] = useState<File | null>(null);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);

  const handleBackupFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setBackupFile(f);
    setError('');
    try {
      const content = await backupService.readFile(f);
      const v = backupService.validateBackupFile(content);
      setValidation(v);
      if (!v.valid) setError(v.error || t('backup.invalidFile'));
    } catch {
      setValidation(null);
      setError(t('backup.fileReadError'));
    }
  };

  const handleKeyFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setKeyFile(f);
  };

  const handleRestore = async () => {
    if (!backupFile || !keyFile || !validation?.valid) return;
    setIsRestoring(true);
    setError('');
    try {
      const backupContent = await backupService.readFile(backupFile);
      const keyContent = await backupService.readFile(keyFile);
      if (passphrase.length >= 8) {
        storageService.setEncryptionPassphrase(passphrase);
      }
      await backupService.restoreBackup(backupContent, keyContent);
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('backup.restoreFailed'));
    } finally {
      setIsRestoring(false);
    }
  };

  const resetState = () => {
    setBackupFile(null);
    setKeyFile(null);
    setValidation(null);
    setPassphrase('');
    setError('');
    setSuccess(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) resetState(); onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('backup.restoreTitle')}</DialogTitle>
          <DialogDescription>
            {t('backup.restoreDescription')}
          </DialogDescription>
        </DialogHeader>

        {success ? (
          <div className="mt-4 text-center py-4">
            <Check className="h-8 w-8 text-teal-400 mx-auto mb-2" />
            <p className="text-teal-400 font-medium">{t('backup.restoreSuccess')}</p>
            <p className="text-sm text-muted-foreground mt-2">
              {t('backup.restartApp')}
            </p>
          </div>
        ) : (
          <div className="mt-4 space-y-4">
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
                  {backupFile ? backupFile.name : t('backup.selectBackupFile')}
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
                  disabled={!validation?.valid}
                />
                <Button variant="outline" className="w-full" disabled={!validation?.valid}>
                  <Shield className="h-4 w-4 mr-2" />
                  {keyFile ? keyFile.name : t('backup.selectKeyFile')}
                </Button>
              </div>
            </div>

            {validation?.valid && (
              <div className="p-3 bg-teal-400/10 rounded-lg text-sm space-y-1">
                <p className="text-teal-400 font-medium flex items-center gap-1">
                  <Check className="h-3 w-3" /> {t('backup.validBackup')}
                </p>
                {validation.username && <p className="text-muted-foreground">{t('backup.user', { name: validation.username })}</p>}
              </div>
            )}

            {validation?.valid && (
              <>
                <Input
                  type="password"
                  placeholder={t('backup.passphrasePlaceholder')}
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  {t('backup.passphraseHelp')}
                </p>
              </>
            )}

            {error && <p className="text-sm text-destructive">{error}</p>}

            <Button
              onClick={handleRestore}
              className="w-full"
              disabled={!validation?.valid || !keyFile || isRestoring || passphrase.length < 8}
            >
              {isRestoring ? t('backup.restoring') : t('settings.restore')}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DeleteDataDialog({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const [confirmText, setConfirmText] = useState('');
  const [deleted, setDeleted] = useState(false);

  const handleDelete = async () => {
    if (confirmText === t('deleteData.confirmWord')) {
      await storageService.clearAllData();
      setDeleted(true);
    }
  };

  return (
    <AlertDialog open={isOpen} onOpenChange={onClose}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="text-destructive">{t('deleteData.title')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('deleteData.description')}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {deleted ? (
          <div className="text-center py-4">
            <p className="text-teal-400 font-medium">{t('deleteData.allDataDeleted')}</p>
          </div>
        ) : (
          <>
            <div className="my-4">
              <p className="text-sm text-muted-foreground mb-2">
                {t('deleteData.confirmPrompt')}
              </p>
              <input
                type="text"
                className="w-full p-2 rounded-md border border-input"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder={t('deleteData.confirmWord')}
              />
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDelete}
                className="bg-destructive"
                disabled={confirmText !== t('deleteData.confirmWord')}
              >
                {t('common.delete')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}

function DuressPinDialog({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const { securitySettings, updateSecuritySettings } = useApp();
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [error, setError] = useState('');

  const handleSave = () => {
    if (pin.length < 4) {
      setError(t('duressPin.pinTooShort'));
      return;
    }
    if (pin !== confirmPin) {
      setError(t('duressPin.pinMismatch'));
      return;
    }

    updateSecuritySettings({ duressPin: pin });
    onClose();
  };

  const handleRemove = () => {
    updateSecuritySettings({ duressPin: undefined });
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('duressPin.title')}</DialogTitle>
          <DialogDescription>
            {t('duressPin.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 space-y-4">
          {securitySettings.duressPin ? (
            <div className="text-center py-4">
              <p className="text-muted-foreground mb-4">{t('duressPin.configured')}</p>
              <Button variant="destructive" onClick={handleRemove}>
                {t('duressPin.remove')}
              </Button>
            </div>
          ) : (
            <>
              <div className="relative">
                <input
                  type={showPin ? 'text' : 'password'}
                  className="w-full p-2 pr-10 rounded-md border border-input"
                  placeholder={t('duressPin.enterPin')}
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                />
                <button
                  onClick={() => setShowPin(!showPin)}
                  className="absolute right-3 top-1/2 -translate-y-1/2"
                >
                  {showPin ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>

              <input
                type={showPin ? 'text' : 'password'}
                className="w-full p-2 rounded-md border border-input"
                placeholder={t('duressPin.confirmPin')}
                value={confirmPin}
                onChange={(e) => setConfirmPin(e.target.value)}
              />

              {error && (
                <p className="text-sm text-destructive">{error}</p>
              )}

              <Button onClick={handleSave} className="w-full">
                {t('common.save')}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function I2PConfigDialog({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const { settings, updateSettings, i2pStatus } = useApp();
  const [samHost, setSamHost] = useState(settings.i2p.sam.host);
  const [samPort, setSamPort] = useState(settings.i2p.sam.port.toString());
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<'success' | 'error' | null>(null);
  const [portError, setPortError] = useState<string | null>(null);

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);

    const available = await samService.isAvailable({
      host: samHost,
      port: parseInt(samPort),
      enabled: true,
    });

    setTestResult(available ? 'success' : 'error');
    setTesting(false);
  };

  const handleSave = async () => {
    // Validate port range (1-65535)
    const portNum = parseInt(samPort);
    if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
      setPortError(t('i2pConfig.invalidPort'));
      return;
    }
    setPortError(null);

    const newI2pSettings = {
      mode: 'sam' as const,
      sam: {
        enabled: true,
        host: samHost,
        port: portNum,
        nickname: 'securechat',
      },
    };

    await updateSettings({ i2p: newI2pSettings });

    // Reinitialize I2P with new settings
    try {
      await i2pService.initialize(newI2pSettings.sam);
      toast.success(t('i2pConfig.configSaved'));
      onClose();
    } catch (error) {
      console.error('[Settings] Failed to reinitialize I2P:', error);
      toast.error(t('i2pConfig.configError'));
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('i2pConfig.title')}</DialogTitle>
          <DialogDescription>
            {t('i2pConfig.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 space-y-6">
          {/* Current Status */}
          <div className="p-3 rounded-lg bg-muted">
            <p className="text-sm font-medium mb-1">{t('i2pConfig.currentStatus')}</p>
            <div className="flex items-center gap-2 text-sm">
              <span className={`w-2 h-2 rounded-full ${i2pStatus?.samConnected ? 'bg-teal-400' : 'bg-red-500'}`} />
              <span className="text-muted-foreground">
                {i2pStatus?.samConnected
                  ? t('i2pConfig.connectedSam')
                  : t('i2pConfig.notConnected')}
              </span>
            </div>
            {i2pStatus?.address && (
              <p className="text-xs text-muted-foreground mt-1 font-mono truncate">
                {i2pStatus.address}
              </p>
            )}
          </div>

          {/* SAM Configuration */}
          <div className="space-y-4 border rounded-lg p-4">
            <p className="text-sm font-medium">{t('i2pConfig.samConfig')}</p>

            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground">{t('i2pConfig.host')}</label>
                <input
                  type="text"
                  className="w-full p-2 rounded-md border border-input mt-1"
                  value={samHost}
                  onChange={(e) => setSamHost(e.target.value)}
                  placeholder="127.0.0.1"
                />
              </div>

              <div>
                <label className="text-xs text-muted-foreground">{t('i2pConfig.port')}</label>
                <input
                  type="number"
                  className={`w-full p-2 rounded-md border mt-1 ${portError ? 'border-destructive' : 'border-input'}`}
                  value={samPort}
                  onChange={(e) => {
                    setSamPort(e.target.value);
                    setPortError(null);
                  }}
                  placeholder="7657"
                />
                {portError && (
                  <p className="text-xs text-destructive mt-1">{portError}</p>
                )}
              </div>

              <Button
                variant="outline"
                size="sm"
                onClick={handleTestConnection}
                disabled={testing}
                className="w-full"
              >
                {testing ? t('i2pConfig.testing') : t('i2pConfig.testConnection')}
              </Button>

              {testResult === 'success' && (
                <p className="text-xs text-teal-400 flex items-center gap-1">
                  <Check className="h-3 w-3" />
                  {t('i2pConfig.samSuccess')}
                </p>
              )}

              {testResult === 'error' && (
                <p className="text-xs text-destructive flex items-center gap-1">
                  <X className="h-3 w-3" />
                  {t('i2pConfig.samFailed')}
                </p>
              )}
            </div>
          </div>

          {/* Info Box */}
          <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
            <p className="text-sm font-medium text-blue-400 mb-1">{t('i2pConfig.setup')}</p>
            <p className="text-xs text-muted-foreground">
              1. i2pd mit SAM aktivieren (Port 7656):
            </p>
            <code className="text-xs font-mono bg-black/30 p-2 rounded mt-2 block">
              [sam]<br />
              enabled = true<br />
              address = 127.0.0.1<br />
              port = 7656
            </code>
            <p className="text-xs text-muted-foreground mt-2">
              2. SAM-Proxy starten (Port 7657):
            </p>
            <code className="text-xs font-mono bg-black/30 p-2 rounded mt-2 block">
              cd sam-proxy && npm start
            </code>
          </div>

          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button className="flex-1" onClick={handleSave}>
              {t('common.save')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
