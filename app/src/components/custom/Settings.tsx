import { useState } from 'react';
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
  X
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { useApp } from '@/contexts/AppContext';
import { i2pService, samService } from '@/services/i2p';
import { storageService } from '@/services/storage';
import { cryptoService } from '@/services/crypto';
import type { BackupData } from '@/types';
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
  const { settings, updateSettings, securitySettings, updateSecuritySettings } = useApp();
  const [showBackupDialog, setShowBackupDialog] = useState(false);
  const [showRestoreDialog, setShowRestoreDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showDuressPinDialog, setShowDuressPinDialog] = useState(false);
  const [showI2PDialog, setShowI2PDialog] = useState(false);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Einstellungen</DialogTitle>
          <DialogDescription>
            Konfigurieren Sie Ihre App-Einstellungen und Sicherheitsoptionen.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 -mx-6 px-6">
          <div className="space-y-6">
            {/* Appearance */}
            <section>
              <h3 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
                <Sun className="h-4 w-4" />
                Erscheinungsbild
              </h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 rounded-lg border border-border">
                  <div>
                    <p className="font-medium">Dunkles Theme</p>
                    <p className="text-sm text-muted-foreground">Dunkles Erscheinungsbild verwenden</p>
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

            {/* Notifications */}
            <section>
              <h3 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
                <Bell className="h-4 w-4" />
                Benachrichtigungen
              </h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 rounded-lg border border-border">
                  <div>
                    <p className="font-medium">Benachrichtigungen aktivieren</p>
                    <p className="text-sm text-muted-foreground">Push-Benachrichtigungen erhalten</p>
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
                    <p className="font-medium">Ton</p>
                    <p className="text-sm text-muted-foreground">Ton bei neuen Nachrichten</p>
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
                Sicherheit
              </h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 rounded-lg border border-border">
                  <div>
                    <p className="font-medium">Automatische Sperre</p>
                    <p className="text-sm text-muted-foreground">App nach Inaktivität sperren</p>
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
                      <p className="font-medium">Sperrzeit</p>
                      <p className="text-sm text-muted-foreground">Minuten bis zur automatischen Sperre</p>
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
                    <p className="font-medium">Screenshot-Schutz</p>
                    <p className="text-sm text-muted-foreground">Screenshots in der App verhindern</p>
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
                    <p className="font-medium">Duress PIN</p>
                    <p className="text-sm text-muted-foreground">
                      {securitySettings.duressPin ? 'Konfiguriert' : 'Nicht konfiguriert'}
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
                I2P Netzwerk
              </h3>
              <div className="space-y-3">
                <button
                  onClick={() => setShowI2PDialog(true)}
                  className="w-full flex items-center justify-between p-3 rounded-lg border border-border hover:bg-accent transition-colors"
                >
                  <div className="text-left">
                    <p className="font-medium">I2P-Verbindung</p>
                    <p className="text-sm text-muted-foreground">
                      {settings.i2p.sam.enabled ? 'SAM-Modus aktiviert' : 'Browser-nativer Modus'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {settings.i2p.sam.enabled ? (
                      <span className="flex items-center gap-1 text-xs text-green-500">
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
                Backup & Wiederherstellung
              </h3>
              <div className="space-y-3">
                <button
                  onClick={() => setShowBackupDialog(true)}
                  className="w-full flex items-center justify-between p-3 rounded-lg border border-border hover:bg-accent transition-colors"
                >
                  <div className="text-left">
                    <p className="font-medium">Backup erstellen</p>
                    <p className="text-sm text-muted-foreground">Verschlüsseltes Backup exportieren</p>
                  </div>
                  <Download className="h-4 w-4 text-muted-foreground" />
                </button>

                <button
                  onClick={() => setShowRestoreDialog(true)}
                  className="w-full flex items-center justify-between p-3 rounded-lg border border-border hover:bg-accent transition-colors"
                >
                  <div className="text-left">
                    <p className="font-medium">Wiederherstellen</p>
                    <p className="text-sm text-muted-foreground">Backup importieren</p>
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
                Gefahrenzone
              </h3>
              <button
                onClick={() => setShowDeleteDialog(true)}
                className="w-full flex items-center justify-between p-3 rounded-lg border border-destructive/30 hover:bg-destructive/10 transition-colors"
              >
                <div className="text-left">
                  <p className="font-medium text-destructive">Alle Daten löschen</p>
                  <p className="text-sm text-muted-foreground">Alle Chats und Kontakte löschen</p>
                </div>
                <Trash2 className="h-4 w-4 text-destructive" />
              </button>
            </section>
          </div>
        </ScrollArea>
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
  const [backupData, setBackupData] = useState('');
  const [copied, setCopied] = useState(false);

  const generateBackup = async () => {
    const backup = await storageService.createBackup();
    // Encrypt backup with user's public key
    const encrypted = await cryptoService.encryptMessage(
      JSON.stringify(backup),
      backup.user.pgpPublicKey
    );
    setBackupData(encrypted);
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(backupData);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([backupData], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `securechat-backup-${new Date().toISOString().split('T')[0]}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Backup erstellen</DialogTitle>
          <DialogDescription>
            Erstellen Sie ein verschlüsseltes Backup Ihrer Daten.
          </DialogDescription>
        </DialogHeader>

        {!backupData ? (
          <div className="mt-4">
            <p className="text-sm text-muted-foreground mb-4">
              Das Backup enthält alle Ihre Chats, Kontakte und Einstellungen. 
              Es wird mit Ihrem PGP-Schlüssel verschlüsselt.
            </p>
            <Button onClick={generateBackup} className="w-full">
              Backup generieren
            </Button>
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            <textarea
              className="w-full h-40 p-3 rounded-md border border-input bg-background text-xs font-mono resize-none"
              value={backupData}
              readOnly
            />
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={handleCopy}>
                {copied ? 'Kopiert!' : 'Kopieren'}
              </Button>
              <Button variant="outline" className="flex-1" onClick={handleDownload}>
                Herunterladen
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function RestoreDialog({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [restoreData, setRestoreData] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const handleRestore = async () => {
    try {
      setError('');
      if (!passphrase || passphrase.length < 8) {
        setError('Bitte geben Sie eine Passphrase mit mindestens 8 Zeichen ein');
        return;
      }
      // Decrypt backup using user's private key
      const decryptedJson = await cryptoService.decryptMessage(restoreData);
      const backup: BackupData = JSON.parse(decryptedJson);
      // Set encryption passphrase before restoring to ensure keys are encrypted
      storageService.setEncryptionPassphrase(passphrase);
      await storageService.restoreBackup(backup);
      setSuccess(true);
    } catch (err) {
      setError('Ungültiges Backup-Format oder Entschlüsselung fehlgeschlagen');
      console.error('Restore error:', err);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      setRestoreData(event.target?.result as string);
    };
    reader.readAsText(file);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Backup wiederherstellen</DialogTitle>
          <DialogDescription>
            Stellen Sie Ihre Daten aus einem Backup wieder her.
          </DialogDescription>
        </DialogHeader>

        {success ? (
          <div className="mt-4 text-center">
            <p className="text-green-500 font-medium">Wiederherstellung erfolgreich!</p>
            <p className="text-sm text-muted-foreground mt-2">
              Bitte starten Sie die App neu, um die Wiederherstellung abzuschließen.
            </p>
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            <textarea
              className="w-full h-32 p-3 rounded-md border border-input bg-background text-xs font-mono resize-none"
              placeholder="Backup-Daten einfügen..."
              value={restoreData}
              onChange={(e) => setRestoreData(e.target.value)}
            />
            
            <div className="relative">
              <input
                type="file"
                accept=".txt"
                onChange={handleFileUpload}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />
              <Button variant="outline" className="w-full">
                <Upload className="h-4 w-4 mr-2" />
                Backup-Datei hochladen
              </Button>
            </div>

            <input
              type="password"
              className="w-full p-3 rounded-md border border-input bg-background text-sm"
              placeholder="Passphrase für die Verschlüsselung (min. 8 Zeichen)..."
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Diese Passphrase wird verwendet, um Ihre Private Keys zu verschlüsseln.
            </p>

            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}

            <Button 
              onClick={handleRestore} 
              className="w-full"
              disabled={!restoreData || !passphrase || passphrase.length < 8}
            >
              Wiederherstellen
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DeleteDataDialog({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [confirmText, setConfirmText] = useState('');
  const [deleted, setDeleted] = useState(false);

  const handleDelete = async () => {
    if (confirmText === 'LÖSCHEN') {
      await storageService.clearAllData();
      setDeleted(true);
    }
  };

  return (
    <AlertDialog open={isOpen} onOpenChange={onClose}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="text-destructive">Alle Daten löschen?</AlertDialogTitle>
          <AlertDialogDescription>
            Diese Aktion kann nicht rückgängig gemacht werden. Alle Ihre Chats, 
            Kontakte und Schlüssel werden dauerhaft gelöscht.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {deleted ? (
          <div className="text-center py-4">
            <p className="text-green-500 font-medium">Alle Daten wurden gelöscht</p>
          </div>
        ) : (
          <>
            <div className="my-4">
              <p className="text-sm text-muted-foreground mb-2">
                Geben Sie "LÖSCHEN" ein, um zu bestätigen:
              </p>
              <input
                type="text"
                className="w-full p-2 rounded-md border border-input"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="LÖSCHEN"
              />
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel>Abbrechen</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDelete}
                className="bg-destructive"
                disabled={confirmText !== 'LÖSCHEN'}
              >
                Löschen
              </AlertDialogAction>
            </AlertDialogFooter>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}

function DuressPinDialog({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { securitySettings, updateSecuritySettings } = useApp();
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [error, setError] = useState('');

  const handleSave = () => {
    if (pin.length < 4) {
      setError('PIN muss mindestens 4 Zeichen haben');
      return;
    }
    if (pin !== confirmPin) {
      setError('PINs stimmen nicht überein');
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
          <DialogTitle>Duress PIN</DialogTitle>
          <DialogDescription>
            Eine Duress PIN löscht alle Daten, wenn sie eingegeben wird.
            Nützlich in Notsituationen.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 space-y-4">
          {securitySettings.duressPin ? (
            <div className="text-center py-4">
              <p className="text-muted-foreground mb-4">Duress PIN ist konfiguriert</p>
              <Button variant="destructive" onClick={handleRemove}>
                Duress PIN entfernen
              </Button>
            </div>
          ) : (
            <>
              <div className="relative">
                <input
                  type={showPin ? 'text' : 'password'}
                  className="w-full p-2 pr-10 rounded-md border border-input"
                  placeholder="PIN eingeben"
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
                placeholder="PIN bestätigen"
                value={confirmPin}
                onChange={(e) => setConfirmPin(e.target.value)}
              />

              {error && (
                <p className="text-sm text-destructive">{error}</p>
              )}

              <Button onClick={handleSave} className="w-full">
                Speichern
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function I2PConfigDialog({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
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
      setPortError('Ungültiger Port. Der Port muss zwischen 1 und 65535 liegen.');
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
      toast.success('I2P-Konfiguration erfolgreich gespeichert');
      onClose();
    } catch (error) {
      console.error('[Settings] Failed to reinitialize I2P:', error);
      toast.error('Fehler beim Anwenden der I2P-Konfiguration');
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>I2P-Netzwerkkonfiguration</DialogTitle>
          <DialogDescription>
            Konfigurieren Sie die Verbindung zu Ihrem I2P-Router.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 space-y-6">
          {/* Current Status */}
          <div className="p-3 rounded-lg bg-muted">
            <p className="text-sm font-medium mb-1">Aktueller Status</p>
            <div className="flex items-center gap-2 text-sm">
              <span className={`w-2 h-2 rounded-full ${i2pStatus?.samConnected ? 'bg-green-500' : 'bg-red-500'}`} />
              <span className="text-muted-foreground">
                {i2pStatus?.samConnected 
                  ? 'Verbunden mit I2P (SAM)' 
                  : 'Nicht verbunden'}
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
            <p className="text-sm font-medium">SAM Konfiguration</p>
            
            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground">Host</label>
                <input
                  type="text"
                  className="w-full p-2 rounded-md border border-input mt-1"
                  value={samHost}
                  onChange={(e) => setSamHost(e.target.value)}
                  placeholder="127.0.0.1"
                />
              </div>

              <div>
                <label className="text-xs text-muted-foreground">Port</label>
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
                {testing ? 'Teste...' : 'Verbindung testen'}
              </Button>

              {testResult === 'success' && (
                <p className="text-xs text-green-500 flex items-center gap-1">
                  <Check className="h-3 w-3" />
                  SAM-Verbindung erfolgreich
                </p>
              )}

              {testResult === 'error' && (
                <p className="text-xs text-destructive flex items-center gap-1">
                  <X className="h-3 w-3" />
                  Keine SAM-Verbindung möglich
                </p>
              )}
            </div>
          </div>

          {/* Info Box */}
          <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
            <p className="text-sm font-medium text-blue-400 mb-1">Einrichtung</p>
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
              Abbrechen
            </Button>
            <Button className="flex-1" onClick={handleSave}>
              Speichern
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
