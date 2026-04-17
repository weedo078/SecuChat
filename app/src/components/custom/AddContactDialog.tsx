import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Upload, Shield, AlertTriangle, Check, Download, UserPlus, FileDown, QrCode, ScanLine } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useApp } from '@/contexts/AppContext';
import { i2pService } from '@/services/i2p';
import { cryptoService } from '@/services/crypto';
import { exportContact, importContact, canShareNatively } from '@/services/nativeFileSharing';
import { AnimatedContactQR } from '@/components/custom/AnimatedContactQR';
import { QRContactScanner } from '@/components/custom/QRContactScanner';
import type { Contact } from '@/types';

interface AddContactDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onContactAdded?: (contact: Contact) => void;
  initialTab?: 'import' | 'share';
}

/** v2 contact format - the canonical format for .secuchat files */
interface ContactData {
  v: '2';
  t: 'sc';
  n: string;
  i: string;
  f: string;
  k?: string;
  ts?: number;
}

export function AddContactDialog({ isOpen, onClose, onContactAdded, initialTab = 'import' }: AddContactDialogProps) {
  const { t } = useTranslation();
  const { user, i2pStatus, addContact, updateContact } = useApp();
  const [activeTab, setActiveTab] = useState<string>(initialTab);

  useEffect(() => {
    if (isOpen) setActiveTab(initialTab);
  }, [isOpen, initialTab]);

  const [importedContact, setImportedContact] = useState<ContactData | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [isAddingContact, setIsAddingContact] = useState(false);
  const [showQRShare, setShowQRShare] = useState(false);
  const [showQRScan, setShowQRScan] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Listen for contact import from native Android (file opened from file manager)
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as string;
      if (detail) {
        const contact = parseContactData(detail);
        if (contact) {
          setImportedContact(contact);
          setImportError(null);
          setActiveTab('import');
        } else {
          setImportError(t('addContact.invalidFile'));
        }
      }
    };
    window.addEventListener('secuchat-contact-import', handler);
    return () => window.removeEventListener('secuchat-contact-import', handler);
  }, [t]);

  // ── QR Scan Result ────────────────────────────────────────────────────────

  const handleQRScanned = (raw: string) => {
    const contact = parseContactData(raw);
    if (contact) {
      setImportedContact(contact);
      setShowQRScan(false);
    } else {
      setImportError(t('addContact.invalidFile'));
    }
  };

  // ── Parse ──────────────────────────────────────────────────────────────────

  const parseContactData = (raw: string): ContactData | null => {
    try {
      const data = JSON.parse(raw);
      if (data.v === '2' && data.t === 'sc' && data.f && data.i) {
        return data as ContactData;
      }
      return null;
    } catch (e) {
      console.error('[Import] JSON parse error:', e);
      return null;
    }
  };

  // ── Import ─────────────────────────────────────────────────────────────────

  const handleNativeImport = async () => {
    if (!canShareNatively()) return;

    setIsImporting(true);
    setImportError(null);

    try {
      const result = await importContact();

      if (result.success && result.data) {
        const contact: ContactData = {
          v: '2',
          t: 'sc',
          n: result.data.name || '',
          i: result.data.i2pAddress,
          f: result.data.fingerprint,
          k: result.data.pgpPublicKey,
          ts: Date.now(),
        };
        setImportedContact(contact);
      } else {
        console.warn('[Import] Native import failed:', result.error);
        // Fall back to file input
        fileInputRef.current?.click();
      }
    } catch (error) {
      console.error('[Import] Native import exception:', error);
      // Fall back to file input
      fileInputRef.current?.click();
    } finally {
      setIsImporting(false);
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    console.log('[Import] File selected:', file.name, 'type:', file.type, 'size:', file.size);
    setIsImporting(true);
    setImportError(null);

    try {
      const contact = await new Promise<ContactData | null>((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(parseContactData(e.target?.result as string));
        reader.onerror = () => resolve(null);
        reader.readAsText(file);
      });

      console.log('[Import] Contact parse result:', contact
        ? { name: contact.n, hasKey: !!contact.k }
        : null);

      if (contact) {
        setImportedContact(contact);
      } else {
        console.warn('[Import] Failed to parse file');
        setImportError(t('addContact.invalidFile'));
      }
    } catch (error) {
      console.error('[Import] Exception:', error);
      setImportError(t('addContact.importError', { error: error instanceof Error ? error.message : 'Unknown error' }));
    } finally {
      setIsImporting(false);
      // Reset input so same file can be selected again
      event.target.value = '';
    }
  };

  const addImportedContact = async () => {
    if (!importedContact) return;
    setIsAddingContact(true);
    try {
      if (importedContact.k) {
        console.log('[Import] Validating PGP key, length:', importedContact.k.length, 'starts with:', importedContact.k.slice(0, 30));
        const validation = await cryptoService.validatePublicKey(importedContact.k);
        console.log('[Import] PGP validation result:', validation);
        if (!validation.valid) {
          setImportError(t('addContact.invalidPgpKey'));
          return;
        }
      } else {
        console.log('[Import] No PGP key in contact data');
      }

      const contact: Contact = {
        id: crypto.randomUUID(),
        name: importedContact.n,
        pgpPublicKey: importedContact.k || '',
        fingerprint: importedContact.f,
        p2pIdentifier: importedContact.i,
        i2pAddress: importedContact.i,
        status: 'unknown',
      };

      // Use addContact from AppContext to update both storage AND React state
      console.log('[AddContact] Saving contact to storage:', contact.name);
      await addContact(contact);

      if (i2pStatus?.samConnected && importedContact.i) {
        console.log('[AddContact] I2P connected, attempting peer connection to:', importedContact.i.slice(0, 20) + '...');
        try {
          await i2pService.connectToPeer(importedContact.i);
          console.log('[AddContact] Peer connected successfully, updating status to online');
          const onlineContact = { ...contact, status: 'online' as const };
          await updateContact(onlineContact);
        } catch (err) {
          console.warn('[AddContact] I2P peer connection failed:', err);
          // I2P not ready, contact is saved anyway
        }
      } else {
        console.log('[AddContact] I2P not connected, skipping peer connection');
      }

      onContactAdded?.(contact);
      resetAndClose();
    } finally {
      setIsAddingContact(false);
    }
  };

  // ── Export ─────────────────────────────────────────────────────────────────

  const exportContactFile = async () => {
    if (!user) return;

    console.log('[AddContactDialog] Export starting, canShareNatively:', canShareNatively());

    // On native Android, use the native share dialog
    if (canShareNatively()) {
      try {
        toast.info('Exportiere Kontakt...', {
          description: 'Datei wird vorbereitet',
        });

        const result = await exportContact(
          {
            name: user.username,
            i2pAddress: user.i2pAddress || '',
            fingerprint: user.fingerprint,
            pgpPublicKey: user.pgpPublicKey,
          },
          { share: true }
        );

        if (result.success) {
          toast.success('Kontakt exportiert', {
            description: 'Teilen-Dialog wird geöffnet',
          });
          return;
        } else {
          console.error('[AddContactDialog] Export failed:', result.error);
          toast.error('Export fehlgeschlagen', {
            description: result.error || 'Versuche Download-Modus',
          });
          // Fall through to browser download
        }
      } catch (error) {
        console.error('[AddContactDialog] Native export error:', error);
        toast.error('Native Export Fehler', {
          description: 'Wechsle zu Download-Modus',
        });
        // Fall back to browser download
      }
    }

    // Use browser download for web/PWA
    const contactData = {
      v: '2',
      t: 'sc',
      n: user.username,
      i: user.i2pAddress || '',
      f: user.fingerprint,
      k: user.pgpPublicKey,
      ts: Date.now(),
    };
    const blob = new Blob([JSON.stringify(contactData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${user.username}.secuchat`;
    link.click();
    URL.revokeObjectURL(url);

    toast.success('Kontakt heruntergeladen', {
      description: `${user.username}.secuchat wurde gespeichert`,
    });
  };

  // ── Reset ──────────────────────────────────────────────────────────────────

  const resetAndClose = () => {
    setImportedContact(null);
    setImportError(null);
    setActiveTab('import');
    setIsAddingContact(false);
    onClose();
  };

  // ── Anonymity display ──────────────────────────────────────────────────────

  const anonymity = i2pStatus?.samConnected
    ? { icon: <Shield className="h-4 w-4 text-teal-400" aria-hidden="true" />, text: t('addContact.anonymous'), color: 'text-teal-400', description: t('addContact.anonymousDesc') }
    : { icon: <AlertTriangle className="h-4 w-4 text-red-500" aria-hidden="true" />, text: t('addContact.notConnected'), color: 'text-red-500', description: t('addContact.notConnectedDesc') };

  return (
    <Dialog open={isOpen} onOpenChange={resetAndClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('addContact.title')}</DialogTitle>
          <DialogDescription>
            {t('addContact.description')}
          </DialogDescription>
        </DialogHeader>

        {/* Anonymity status */}
        <div className="p-3 rounded-lg bg-muted flex items-start gap-2">
          {anonymity.icon}
          <div>
            <p className={`text-sm font-medium ${anonymity.color}`}>{anonymity.text}</p>
            <p className="text-xs text-muted-foreground">{anonymity.description}</p>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="import">
              <Upload className="h-4 w-4 mr-2" aria-hidden="true" />
              {t('addContact.importTab')}
            </TabsTrigger>
            <TabsTrigger value="share">
              <FileDown className="h-4 w-4 mr-2" aria-hidden="true" />
              {t('addContact.shareTab')}
            </TabsTrigger>
          </TabsList>

          {/* ── Import Tab ── */}
          <TabsContent value="import" className="space-y-4">
            {showQRScan ? (
              <QRContactScanner
                onContactScanned={handleQRScanned}
                onError={(err) => { setImportError(err); setShowQRScan(false); }}
              />
            ) : !importedContact ? (
              <>
                <button
                  onClick={() => canShareNatively() ? handleNativeImport() : fileInputRef.current?.click()}
                  className="w-full p-6 rounded-lg border-2 border-dashed border-border hover:border-primary hover:bg-accent transition-colors flex flex-col items-center gap-3"
                  aria-label={t('addContact.importSecuchat')}
                >
                  <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                    <Upload className="h-6 w-6 text-primary" aria-hidden="true" />
                  </div>
                  <div className="text-center">
                    <p className="font-medium">{t('addContact.openContactFile')}</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      {t('addContact.importSecuchat')}
                    </p>
                  </div>
                </button>

                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => setShowQRScan(true)}
                >
                  <ScanLine className="h-4 w-4 mr-2" />
                  {t('addContact.scanQR')}
                </Button>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".secuchat,.json"
                  className="hidden"
                  onChange={handleFileUpload}
                />

                {isImporting && (
                  <div className="text-center py-4">
                    <div className="h-6 w-6 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">{t('addContact.readingFile')}</p>
                  </div>
                )}

                {importError && (
                  <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm" role="alert">
                    {importError}
                  </div>
                )}
              </>
            ) : (
              <div className="space-y-4">
                <div className="p-4 bg-teal-400/10 rounded-lg border border-teal-400/30">
                  <div className="flex items-center gap-2 mb-3">
                    <Check className="h-5 w-5 text-teal-400" aria-hidden="true" />
                    <p className="font-medium text-teal-400">{t('addContact.contactDetected')}</p>
                  </div>
                  <div className="space-y-1.5 text-sm">
                    <p><span className="text-muted-foreground">Name:</span> <span className="font-medium">{importedContact.n}</span></p>
                    <p className="font-mono text-xs break-all"><span className="text-muted-foreground">I2P: </span>{importedContact.i.slice(0, 40)}…</p>
                    <p className="font-mono text-xs"><span className="text-muted-foreground">PGP: </span>{importedContact.f.slice(0, 16)}…</p>
                    {!importedContact.k && (
                      <p className="text-xs text-yellow-500 mt-2">{t('addContact.noPgpKey')}</p>
                    )}
                  </div>
                </div>

                {importError && (
                  <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm" role="alert">
                    {importError}
                  </div>
                )}

                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1" onClick={() => { setImportedContact(null); setImportError(null); }} disabled={isAddingContact}>
                    {t('common.back')}
                  </Button>
                  <Button className="flex-1" onClick={addImportedContact} disabled={isAddingContact}>
                    {isAddingContact ? (
                      <><div className="h-4 w-4 border-2 border-current border-t-transparent rounded-full animate-spin mr-2" />{t('addContact.adding')}</>
                    ) : (
                      <><UserPlus className="h-4 w-4 mr-2" aria-hidden="true" />{t('common.add')}</>
                    )}
                  </Button>
                </div>
              </div>
            )}
          </TabsContent>

          {/* ── Share Tab ── */}
          <TabsContent value="share" className="space-y-4">
            {user ? (
              <>
                {/* I2P address guard */}
                {!user.i2pSamDestination ? (
                  <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-sm space-y-1" role="alert">
                    <p className="font-medium text-destructive">{t('addContact.exportNotPossible')}</p>
                    <p className="text-destructive/80 text-xs">
                      {t('addContact.exportNotPossibleDesc')}
                    </p>
                  </div>
                ) : !i2pStatus?.samConnected ? (
                  <div className="p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/30 text-sm space-y-1" role="status">
                    <p className="font-medium text-yellow-600 dark:text-yellow-400">{t('addContact.i2pNotConnected')}</p>
                    <p className="text-yellow-600/80 dark:text-yellow-400/80 text-xs">
                      {t('addContact.i2pNotConnectedDesc')}
                    </p>
                  </div>
                ) : null}

                <div className="p-4 rounded-lg border border-border space-y-2 text-sm">
                  <p><span className="text-muted-foreground">Name:</span> <span className="font-medium">{user.username}</span></p>
                  <p className="font-mono text-xs break-all"><span className="text-muted-foreground">I2P: </span>{user.i2pAddress?.slice(0, 40)}…</p>
                  <p className="font-mono text-xs"><span className="text-muted-foreground">PGP: </span>{user.fingerprint?.slice(0, 16)}…</p>
                </div>

                <Button className="w-full" onClick={exportContactFile} disabled={!user.i2pSamDestination}>
                  <Download className="h-4 w-4 mr-2" aria-hidden="true" />
                  {t('addContact.saveFile', { name: user.username })}
                </Button>

                {user.i2pSamDestination && (
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => setShowQRShare(!showQRShare)}
                  >
                    <QrCode className="h-4 w-4 mr-2" />
                    {showQRShare ? t('qr.hideQR') : t('qr.showQR')}
                  </Button>
                )}

                {showQRShare && user.i2pSamDestination && (
                  <AnimatedContactQR
                    contactData={{
                      v: '2',
                      t: 'sc',
                      n: user.username,
                      i: user.i2pAddress || '',
                      f: user.fingerprint,
                      k: user.pgpPublicKey,
                      ts: Date.now(),
                    }}
                  />
                )}

                {user.i2pSamDestination && !showQRShare && (
                  <p className="text-xs text-muted-foreground text-center">
                    {t('addContact.sendFileToContact')}
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">{t('addContact.noProfile')}</p>
            )}
          </TabsContent>

        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
