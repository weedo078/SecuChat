import { useState, useRef, useEffect } from 'react';
import { Upload, Globe, Shield, AlertTriangle, Check, Download, UserPlus, FileDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { useApp } from '@/contexts/AppContext';
import { i2pService } from '@/services/i2p';
import { cryptoService } from '@/services/crypto';
import type { Contact } from '@/types';

interface AddContactDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onContactAdded?: (contact: Contact) => void;
  initialTab?: 'import' | 'share' | 'manual';
}

/** New format (v1.0) */
interface ContactData {
  version: '1.0';
  metadata: {
    timestamp: string;
    username: string;
    deviceId: string;
  };
  keys: {
    pgpPublicKey: string;
    fingerprint: string;
  };
  network: {
    p2pIdentifier: string;
    protocol: string;
    i2pAddress: string;
  };
}

/** Legacy format (v2 compact) for backwards compatibility */
interface ContactDataLegacy {
  v: '2';
  t: 'sc';
  n: string;
  i: string;
  f: string;
  k?: string;
  ts?: number;
}

export function AddContactDialog({ isOpen, onClose, onContactAdded, initialTab = 'import' }: AddContactDialogProps) {
  const { user, i2pStatus, addContact, updateContact } = useApp();
  const [activeTab, setActiveTab] = useState<string>(initialTab);

  useEffect(() => {
    if (isOpen) setActiveTab(initialTab);
  }, [isOpen, initialTab]);

  const [importedContact, setImportedContact] = useState<ContactData | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [isAddingContact, setIsAddingContact] = useState(false);

  const [manualName, setManualName] = useState('');
  const [manualI2p, setManualI2p] = useState('');
  const [manualPgp, setManualPgp] = useState('');
  const [manualError, setManualError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Parse ──────────────────────────────────────────────────────────────────

  const parseContactData = (raw: string): ContactData | null => {
    try {
      const data = JSON.parse(raw);
      console.log('[Import] Parsed JSON keys:', Object.keys(data));
      
      // New format (v1.0)
      if (data.version === '1.0' && data.metadata && data.keys && data.network) {
        console.log('[Import] Recognized as v1.0 format');
        return data as ContactData;
      }
      
      // Legacy compact format (v2)
      if (data.v === '2' && data.t === 'sc') {
        console.log('[Import] Recognized as legacy v2 format, converting...');
        const legacy = data as ContactDataLegacy;
        return {
          version: '1.0',
          metadata: {
            timestamp: new Date(legacy.ts || Date.now()).toISOString(),
            username: legacy.n,
            deviceId: '',
          },
          keys: {
            pgpPublicKey: legacy.k || '',
            fingerprint: legacy.f,
          },
          network: {
            p2pIdentifier: '',
            protocol: legacy.i ? 'i2p-webrtc' : 'webrtc',
            i2pAddress: legacy.i,
          },
        };
      }
      
      console.warn('[Import] Unknown format. v:', data.v, 't:', data.t, 'version:', data.version);
      return null;
    } catch (e) {
      console.error('[Import] JSON parse error:', e);
      return null;
    }
  };

  // ── Import ─────────────────────────────────────────────────────────────────

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
        ? { version: contact.version, username: contact.metadata.username, hasKey: !!contact.keys.pgpPublicKey }
        : null);

      if (contact) {
        setImportedContact(contact);
      } else {
        console.warn('[Import] Failed to parse file');
        setImportError('Ungültige Datei. Bitte eine .secuchat Kontaktdatei importieren.');
      }
    } catch (error) {
      console.error('[Import] Exception:', error);
      setImportError('Fehler beim Import: ' + (error instanceof Error ? error.message : 'Unbekannter Fehler'));
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
      if (importedContact.keys.pgpPublicKey) {
        console.log('[Import] Validating PGP key, length:', importedContact.keys.pgpPublicKey.length, 'starts with:', importedContact.keys.pgpPublicKey.slice(0, 30));
        const validation = await cryptoService.validatePublicKey(importedContact.keys.pgpPublicKey);
        console.log('[Import] PGP validation result:', validation);
        if (!validation.valid) {
          setImportError('Ungültiger PGP Public Key in der Kontaktdatei');
          return;
        }
      } else {
        console.log('[Import] No PGP key in contact data');
      }

      const contact: Contact = {
        id: crypto.randomUUID(),
        name: importedContact.metadata.username,
        pgpPublicKey: importedContact.keys.pgpPublicKey || '',
        fingerprint: importedContact.keys.fingerprint,
        p2pIdentifier: importedContact.network.p2pIdentifier || importedContact.network.i2pAddress,
        i2pAddress: importedContact.network.i2pAddress,
        status: 'unknown',
      };

      // Use addContact from AppContext to update both storage AND React state
      await addContact(contact);

      if (i2pStatus?.samConnected && importedContact.network.i2pAddress) {
        try {
          await i2pService.connectToPeer(importedContact.network.i2pAddress);
          const onlineContact = { ...contact, status: 'online' as const };
          await updateContact(onlineContact);
        } catch {
          // I2P not ready, contact is saved anyway
        }
      }

      onContactAdded?.(contact);
      resetAndClose();
    } finally {
      setIsAddingContact(false);
    }
  };

  // ── Export ─────────────────────────────────────────────────────────────────

  const exportContactFile = () => {
    if (!user) return;
    // Use new format (v1.0) as defined in crypto.ts
    const contactData = {
      version: '1.0',
      metadata: {
        timestamp: new Date().toISOString(),
        username: user.username,
        deviceId: user.deviceId,
      },
      keys: {
        pgpPublicKey: user.pgpPublicKey,
        fingerprint: user.fingerprint,
      },
      network: {
        p2pIdentifier: user.id,
        protocol: user.i2pAddress ? 'i2p-webrtc' : 'webrtc',
        i2pAddress: user.i2pAddress,
      },
    };
    const blob = new Blob([JSON.stringify(contactData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${user.username}.secuchat`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // ── Manual ─────────────────────────────────────────────────────────────────

  const addManualContact = async () => {
    if (!manualName || !manualI2p || !manualPgp) {
      setManualError('Alle Felder sind erforderlich');
      return;
    }
    setIsAddingContact(true);
    try {
      const validation = await cryptoService.validatePublicKey(manualPgp);
      if (!validation.valid) {
        setManualError('Ungültiger PGP Public Key');
        return;
      }
      const contact: Contact = {
        id: crypto.randomUUID(),
        name: manualName,
        pgpPublicKey: manualPgp,
        fingerprint: validation.fingerprint!,
        p2pIdentifier: manualI2p,
        i2pAddress: manualI2p,
        status: 'unknown',
      };
      await addContact(contact);
      if (i2pStatus?.samConnected) {
        try {
          await i2pService.connectToPeer(manualI2p);
          await updateContact({ ...contact, status: 'online' as const });
        } catch { /* I2P not ready */ }
      }
      onContactAdded?.(contact);
      resetAndClose();
    } finally {
      setIsAddingContact(false);
    }
  };

  // ── Reset ──────────────────────────────────────────────────────────────────

  const resetAndClose = () => {
    setImportedContact(null);
    setImportError(null);
    setManualError(null);
    setManualName('');
    setManualI2p('');
    setManualPgp('');
    setActiveTab('import');
    setIsAddingContact(false);
    onClose();
  };

  // ── Anonymity display ──────────────────────────────────────────────────────

  const anonymity = i2pStatus?.samConnected
    ? { icon: <Shield className="h-4 w-4 text-green-500" aria-hidden="true" />, text: 'Anonym (I2P)', color: 'text-green-500', description: 'Ihre IP-Adresse ist durch I2P verborgen' }
    : { icon: <AlertTriangle className="h-4 w-4 text-red-500" aria-hidden="true" />, text: 'Nicht verbunden', color: 'text-red-500', description: 'i2pd nicht verbunden — Kontakt wird gespeichert, aber nicht erreichbar' };

  return (
    <Dialog open={isOpen} onOpenChange={resetAndClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Kontakt hinzufügen</DialogTitle>
          <DialogDescription>
            Kontakt über .secuchat Datei oder manuell hinzufügen.
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
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="import">
              <Upload className="h-4 w-4 mr-2" aria-hidden="true" />
              Importieren
            </TabsTrigger>
            <TabsTrigger value="share">
              <FileDown className="h-4 w-4 mr-2" aria-hidden="true" />
              Meine Datei
            </TabsTrigger>
            <TabsTrigger value="manual">
              <Globe className="h-4 w-4 mr-2" aria-hidden="true" />
              Manuell
            </TabsTrigger>
          </TabsList>

          {/* ── Import Tab ── */}
          <TabsContent value="import" className="space-y-4">
            {!importedContact ? (
              <>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full p-6 rounded-lg border-2 border-dashed border-border hover:border-primary hover:bg-accent transition-colors flex flex-col items-center gap-3"
                  aria-label=".secuchat Kontaktdatei importieren"
                >
                  <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                    <Upload className="h-6 w-6 text-primary" aria-hidden="true" />
                  </div>
                  <div className="text-center">
                    <p className="font-medium">Kontaktdatei öffnen</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      .secuchat Datei vom Kontakt importieren
                    </p>
                  </div>
                </button>

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
                    <p className="text-sm text-muted-foreground">Lese Datei...</p>
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
                <div className="p-4 bg-green-500/10 rounded-lg border border-green-500/30">
                  <div className="flex items-center gap-2 mb-3">
                    <Check className="h-5 w-5 text-green-500" aria-hidden="true" />
                    <p className="font-medium text-green-500">Kontakt erkannt</p>
                  </div>
                  <div className="space-y-1.5 text-sm">
                    <p><span className="text-muted-foreground">Name:</span> <span className="font-medium">{importedContact.metadata.username}</span></p>
                    <p className="font-mono text-xs break-all"><span className="text-muted-foreground">I2P: </span>{importedContact.network.i2pAddress.slice(0, 40)}…</p>
                    <p className="font-mono text-xs"><span className="text-muted-foreground">PGP: </span>{importedContact.keys.fingerprint.slice(0, 16)}…</p>
                    {!importedContact.keys.pgpPublicKey && (
                      <p className="text-xs text-yellow-500 mt-2">Kein PGP-Key in der Datei — verschlüsselte Kommunikation erst nach Schlüsselaustausch möglich.</p>
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
                    Zurück
                  </Button>
                  <Button className="flex-1" onClick={addImportedContact} disabled={isAddingContact}>
                    {isAddingContact ? (
                      <><div className="h-4 w-4 border-2 border-current border-t-transparent rounded-full animate-spin mr-2" />Wird hinzugefügt…</>
                    ) : (
                      <><UserPlus className="h-4 w-4 mr-2" aria-hidden="true" />Hinzufügen</>
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
                <div className="p-4 rounded-lg border border-border space-y-2 text-sm">
                  <p><span className="text-muted-foreground">Name:</span> <span className="font-medium">{user.username}</span></p>
                  <p className="font-mono text-xs break-all"><span className="text-muted-foreground">I2P: </span>{user.i2pAddress?.slice(0, 40)}…</p>
                  <p className="font-mono text-xs"><span className="text-muted-foreground">PGP: </span>{user.fingerprint?.slice(0, 16)}…</p>
                </div>

                <Button className="w-full" onClick={exportContactFile}>
                  <Download className="h-4 w-4 mr-2" aria-hidden="true" />
                  {user.username}.secuchat speichern
                </Button>

                <p className="text-xs text-muted-foreground text-center">
                  Schick diese Datei deinem Kontakt — er kann sie direkt importieren.
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">Kein Profil gefunden.</p>
            )}
          </TabsContent>

          {/* ── Manual Tab ── */}
          <TabsContent value="manual" className="space-y-4">
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium mb-1 block">Name</label>
                <Input
                  placeholder="Name des Kontakts"
                  value={manualName}
                  onChange={(e) => setManualName(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">I2P-Adresse</label>
                <Input
                  placeholder="xxxx...xxxx.b32.i2p"
                  value={manualI2p}
                  onChange={(e) => setManualI2p(e.target.value)}
                  className="font-mono text-sm"
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">PGP Public Key</label>
                <textarea
                  className="w-full h-32 p-3 rounded-md border border-input bg-background text-xs font-mono resize-none"
                  placeholder="-----BEGIN PGP PUBLIC KEY BLOCK-----"
                  value={manualPgp}
                  onChange={(e) => setManualPgp(e.target.value)}
                />
              </div>
              <Button
                className="w-full"
                onClick={addManualContact}
                disabled={!manualName || !manualI2p || !manualPgp || isAddingContact}
              >
                {isAddingContact ? (
                  <><div className="h-4 w-4 border-2 border-current border-t-transparent rounded-full animate-spin mr-2" />Wird hinzugefügt…</>
                ) : (
                  <><UserPlus className="h-4 w-4 mr-2" aria-hidden="true" />Kontakt hinzufügen</>
                )}
              </Button>
            </div>

            {manualError && (
              <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm" role="alert">
                {manualError}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
