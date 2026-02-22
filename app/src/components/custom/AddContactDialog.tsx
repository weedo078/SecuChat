import { useState, useRef } from 'react';
import { QrCode, Upload, Camera, Globe, Shield, AlertTriangle, Check, Download, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import { useApp } from '@/contexts/AppContext';
import { i2pService } from '@/services/i2p';
import { storageService } from '@/services/storage';
import { cryptoService } from '@/services/crypto';
import type { Contact } from '@/types';

interface AddContactDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onContactAdded?: (contact: Contact) => void;
}

/**
 * QR code contact data — lightweight version for QR codes.
 * PGP key is omitted (too large for QR) and exchanged via file or I2P.
 */
interface ContactQRData {
  v: '2';
  t: 'sc';               // securechat
  n: string;              // username
  i: string;              // i2pAddress
  f: string;              // pgpFingerprint
  /** Full PGP key — only present in file exports, not QR codes */
  k?: string;             // pgpPublicKey (optional)
  ts?: number;            // timestamp
}

/** Legacy format for backwards compatibility */
interface ContactQRDataV1 {
  version: '1.0';
  type: 'securechat-contact';
  username: string;
  i2pAddress: string;
  pgpPublicKey: string;
  pgpFingerprint: string;
  timestamp: number;
}

export function AddContactDialog({ isOpen, onClose, onContactAdded }: AddContactDialogProps) {
  const { user, i2pStatus } = useApp();
  const [activeTab, setActiveTab] = useState('scan');
  
  // QR Code states
  const [myQRCode, setMyQRCode] = useState<string | null>(null);
  const [showMyQR, setShowMyQR] = useState(false);
  const [scannedContact, setScannedContact] = useState<ContactQRData | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [isGeneratingQR, setIsGeneratingQR] = useState(false);
  
  // File import states
  const [isImporting, setIsImporting] = useState(false);
  
  // Add contact states
  const [isAddingContact, setIsAddingContact] = useState(false);
  
  // Manual input
  const [manualName, setManualName] = useState('');
  const [manualI2p, setManualI2p] = useState('');
  const [manualPgp, setManualPgp] = useState('');
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  // Generate my QR code — compact format (no PGP key, too large)
  const generateMyQR = async () => {
    if (!user) return;
    setIsGeneratingQR(true);
    try {
      const contactData: ContactQRData = {
        v: '2',
        t: 'sc',
        n: user.username,
        i: user.i2pAddress,
        f: user.fingerprint,
      };

      const dataUrl = await QRCode.toDataURL(JSON.stringify(contactData), {
        width: 400,
        margin: 2,
        errorCorrectionLevel: 'M',
      });
      setMyQRCode(dataUrl);
      setShowMyQR(true);
    } catch (error) {
      console.error('Failed to generate QR:', error);
    } finally {
      setIsGeneratingQR(false);
    }
  };

  // Handle file upload
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    console.log('[Import] File selected:', file.name, 'type:', file.type, 'size:', file.size);
    setIsImporting(true);
    setScanError(null);

    try {
      const name = file.name.toLowerCase();
      const isJson = file.type === 'application/json' || name.endsWith('.json') || name.endsWith('.secuchat');
      console.log('[Import] isJson:', isJson);

      // Try as QR image first (skip for JSON files)
      if (!isJson) {
        console.log('[Import] Trying QR image decode...');
        const qrData = await decodeQRFromImage(file);
        console.log('[Import] QR decode result:', qrData);
        if (qrData) {
          await processScannedQR(qrData);
          return;
        }
      }

      // Try as contact file
      console.log('[Import] Trying contact file parse...');
      const contact = await importContactFromFile(file);
      console.log('[Import] Contact parse result:', contact ? { v: contact.v, t: contact.t, n: contact.n, hasKey: !!contact.k } : null);
      if (contact) {
        setScannedContact(contact);
        return;
      }

      console.warn('[Import] Failed to parse file as QR or contact JSON');
      setScanError('Konnte Datei nicht erkennen. Bitte QR-Code Bild oder .json Kontaktdatei verwenden.');
    } catch (error) {
      console.error('[Import] Exception:', error);
      setScanError('Fehler beim Import: ' + (error instanceof Error ? error.message : 'Unbekannter Fehler'));
    } finally {
      setIsImporting(false);
    }
  };

  // Parse QR/file data — supports v1 and v2 formats
  const parseContactData = (raw: string): ContactQRData | null => {
    try {
      const data = JSON.parse(raw);
      console.log('[Import] Parsed JSON keys:', Object.keys(data));
      // v2 compact format
      if (data.v === '2' && data.t === 'sc') {
        console.log('[Import] Recognized as v2 format');
        return data as ContactQRData;
      }
      // v1 legacy format → convert to v2
      if (data.version === '1.0' && data.type === 'securechat-contact') {
        console.log('[Import] Recognized as v1 format, converting...');
        const legacy = data as ContactQRDataV1;
        return {
          v: '2',
          t: 'sc',
          n: legacy.username,
          i: legacy.i2pAddress,
          f: legacy.pgpFingerprint,
          k: legacy.pgpPublicKey,
          ts: legacy.timestamp,
        };
      }
      console.warn('[Import] Unknown format. v:', data.v, 't:', data.t, 'version:', data.version);
      return null;
    } catch (e) {
      console.error('[Import] JSON parse error:', e);
      return null;
    }
  };

  // Decode QR from image
  const decodeQRFromImage = (file: File): Promise<ContactQRData | null> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(null);
            return;
          }
          ctx.drawImage(img, 0, 0);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(imageData.data, canvas.width, canvas.height);
          resolve(code ? parseContactData(code.data) : null);
        };
        img.onerror = () => resolve(null);
        img.src = e.target?.result as string;
      };
      reader.readAsDataURL(file);
    });
  };

  // Import contact from JSON file
  const importContactFromFile = (file: File): Promise<ContactQRData | null> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        resolve(parseContactData(e.target?.result as string));
      };
      reader.onerror = () => resolve(null);
      reader.readAsText(file);
    });
  };

  // Process scanned QR data
  const processScannedQR = async (qrData: ContactQRData) => {
    setScanError(null);
    setScannedContact(qrData);
  };

  // Add scanned contact
  const addContact = async () => {
    if (!scannedContact) return;

    setIsAddingContact(true);
    try {
      // Validate PGP key if present
      if (scannedContact.k) {
        console.log('[Import] Validating PGP key, length:', scannedContact.k.length, 'starts with:', scannedContact.k.slice(0, 30));
        const validation = await cryptoService.validatePublicKey(scannedContact.k);
        console.log('[Import] PGP validation result:', validation);
        if (!validation.valid) {
          setScanError('Ungültiger PGP Public Key');
          return;
        }
      } else {
        console.log('[Import] No PGP key in contact data, skipping validation');
      }

      // Create contact
      const contact: Contact = {
        id: crypto.randomUUID(),
        name: scannedContact.n,
        pgpPublicKey: scannedContact.k || '',  // May be empty from QR (key exchanged later)
        fingerprint: scannedContact.f,
        p2pIdentifier: scannedContact.i,
        i2pAddress: scannedContact.i,
        status: 'unknown',
      };

      // Save contact
      await storageService.saveContact(contact);

      // Try to connect via I2P
      if (i2pStatus?.samConnected && scannedContact.i) {
        try {
          await i2pService.connectToPeer(scannedContact.i);
          contact.status = 'online';
          await storageService.saveContact(contact);
        } catch {
          // I2P connection failed, but contact is saved
        }
      }

      onContactAdded?.(contact);
      resetAndClose();
    } finally {
      setIsAddingContact(false);
    }
  };

  // Add contact manually
  const addManualContact = async () => {
    if (!manualName || !manualI2p || !manualPgp) {
      setScanError('Alle Felder sind erforderlich');
      return;
    }

    setIsAddingContact(true);
    try {
      // Validate PGP key
      const validation = await cryptoService.validatePublicKey(manualPgp);
      if (!validation.valid) {
        setScanError('Ungültiger PGP Public Key');
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

      await storageService.saveContact(contact);
      
      // Try to connect via I2P
      if (i2pStatus?.samConnected) {
        try {
          await i2pService.connectToPeer(manualI2p);
          contact.status = 'online';
          await storageService.saveContact(contact);
        } catch {
          // I2P connection failed, but contact is saved
        }
      }

      onContactAdded?.(contact);
      resetAndClose();
    } finally {
      setIsAddingContact(false);
    }
  };

  // Export my contact as file (includes full PGP key)
  const exportContactFile = () => {
    if (!user) return;

    const contactData: ContactQRData = {
      v: '2',
      t: 'sc',
      n: user.username,
      i: user.i2pAddress,
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
  };

  // Reset state and close
  const resetAndClose = () => {
    setMyQRCode(null);
    setShowMyQR(false);
    setScannedContact(null);
    setScanError(null);
    setManualName('');
    setManualI2p('');
    setManualPgp('');
    setActiveTab('scan');
    setIsAddingContact(false);
    onClose();
  };

  // Get anonymity level display
  const getAnonymityDisplay = () => {
    if (i2pStatus?.samConnected) {
      return {
        icon: <Shield className="h-4 w-4 text-green-500" aria-hidden="true" />,
        text: 'Anonym (I2P)',
        color: 'text-green-500',
        description: 'Ihre IP-Adresse ist durch I2P verborgen',
      };
    }
    return {
      icon: <AlertTriangle className="h-4 w-4 text-red-500" aria-hidden="true" />,
      text: 'Nicht verbunden',
      color: 'text-red-500',
      description: 'i2pd nicht verbunden - Kontakt wird gespeichert, aber nicht erreichbar',
    };
  };

  const anonymity = getAnonymityDisplay();

  return (
    <Dialog open={isOpen} onOpenChange={resetAndClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Kontakt hinzufügen</DialogTitle>
          <DialogDescription>
            Fügen Sie einen Kontakt über I2P hinzu.
          </DialogDescription>
        </DialogHeader>

        {/* Anonymity Warning */}
        <div className={`p-3 rounded-lg bg-muted flex items-start gap-2`}>
          {anonymity.icon}
          <div>
            <p className={`text-sm font-medium ${anonymity.color}`}>{anonymity.text}</p>
            <p className="text-xs text-muted-foreground">{anonymity.description}</p>
          </div>
        </div>

        {/* i2pd not connected warning */}
        {!i2pStatus?.samConnected && (
          <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30">
            <p className="text-sm text-red-500 font-medium flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
              i2pd nicht verbunden
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Der Kontakt wird gespeichert, aber Sie können erst kommunizieren, 
              wenn i2pd läuft.
            </p>
          </div>
        )}

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="scan">
              <Camera className="h-4 w-4 mr-2" aria-hidden="true" />
              Scannen
            </TabsTrigger>
            <TabsTrigger value="myqr">
              <QrCode className="h-4 w-4 mr-2" aria-hidden="true" />
              Mein QR
            </TabsTrigger>
            <TabsTrigger value="manual">
              <Globe className="h-4 w-4 mr-2" aria-hidden="true" />
              Manuell
            </TabsTrigger>
          </TabsList>

          {/* Scan Tab */}
          <TabsContent value="scan" className="space-y-4">
            {!scannedContact ? (
              <>
                <div className="space-y-3">
                  {/* Camera option */}
                  <button
                    onClick={() => cameraInputRef.current?.click()}
                    className="w-full p-4 rounded-lg border border-border hover:bg-accent transition-colors flex items-center gap-3"
                    aria-label="Kamera zum Scannen verwenden"
                  >
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                      <Camera className="h-5 w-5 text-primary" aria-hidden="true" />
                    </div>
                    <div className="text-left">
                      <p className="font-medium">Kamera verwenden</p>
                      <p className="text-sm text-muted-foreground">QR-Code direkt scannen</p>
                    </div>
                  </button>

                  {/* File upload */}
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full p-4 rounded-lg border border-border hover:bg-accent transition-colors flex items-center gap-3"
                    aria-label="QR-Code aus Datei importieren"
                  >
                    <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center">
                      <Upload className="h-5 w-5" aria-hidden="true" />
                    </div>
                    <div className="text-left">
                      <p className="font-medium">Datei importieren</p>
                      <p className="text-sm text-muted-foreground">.secuchat Kontaktdatei oder QR-Code Bild</p>
                    </div>
                  </button>
                </div>

                <input
                  ref={cameraInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={handleFileUpload}
                />
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,.json,.secuchat"
                  className="hidden"
                  onChange={handleFileUpload}
                />

                {isImporting && (
                  <div className="text-center py-4">
                    <div className="h-6 w-6 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">Verarbeite...</p>
                  </div>
                )}

                {scanError && (
                  <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm" role="alert">
                    {scanError}
                  </div>
                )}
              </>
            ) : (
              <div className="space-y-4">
                <div className="p-4 bg-green-500/10 rounded-lg border border-green-500/30">
                  <div className="flex items-center gap-2 mb-2">
                    <Check className="h-5 w-5 text-green-500" aria-hidden="true" />
                    <p className="font-medium text-green-500">Kontakt gefunden!</p>
                  </div>
                  <div className="space-y-1 text-sm">
                    <p><span className="text-muted-foreground">Name:</span> {scannedContact.n}</p>
                    <p><span className="text-muted-foreground">I2P:</span> {scannedContact.i.slice(0, 30)}...</p>
                    <p><span className="text-muted-foreground">PGP:</span> {scannedContact.f.slice(0, 16)}...</p>
                    {!scannedContact.k && (
                      <p className="text-xs text-yellow-500">PGP-Key wird beim ersten Kontakt ausgetauscht</p>
                    )}
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button 
                    variant="outline" 
                    className="flex-1" 
                    onClick={() => setScannedContact(null)}
                    disabled={isAddingContact}
                  >
                    Zurück
                  </Button>
                  <Button 
                    className="flex-1" 
                    onClick={addContact}
                    disabled={isAddingContact}
                  >
                    {isAddingContact ? (
                      <>
                        <div className="h-4 w-4 border-2 border-current border-t-transparent rounded-full animate-spin mr-2" />
                        Wird hinzugefügt...
                      </>
                    ) : (
                      <>
                        <UserPlus className="h-4 w-4 mr-2" aria-hidden="true" />
                        Hinzufügen
                      </>
                    )}
                  </Button>
                </div>
              </div>
            )}
          </TabsContent>

          {/* My QR Tab */}
          <TabsContent value="myqr" className="space-y-4">
            {!showMyQR ? (
              <div className="text-center py-8">
                <QrCode className="h-16 w-16 mx-auto mb-4 text-muted-foreground" aria-hidden="true" />
                <p className="text-muted-foreground mb-4">
                  Generieren Sie einen QR-Code mit Ihrer I2P-Adresse und Ihrem PGP-Key.
                </p>
                <Button onClick={generateMyQR} disabled={isGeneratingQR}>
                  {isGeneratingQR ? (
                    <>
                      <div className="h-4 w-4 border-2 border-current border-t-transparent rounded-full animate-spin mr-2" />
                      Generiere...
                    </>
                  ) : (
                    <>
                      <QrCode className="h-4 w-4 mr-2" aria-hidden="true" />
                      QR-Code generieren
                    </>
                  )}
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex justify-center">
                  {myQRCode && (
                    <img 
                      src={myQRCode} 
                      alt="Mein QR-Code" 
                      className="w-64 h-64 rounded-lg border border-border"
                    />
                  )}
                </div>
                
                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1" onClick={() => setShowMyQR(false)}>
                    Neu generieren
                  </Button>
                  <Button variant="outline" className="flex-1" onClick={exportContactFile}>
                    <Download className="h-4 w-4 mr-2" aria-hidden="true" />
                    .secuchat speichern
                  </Button>
                </div>

                <div className="p-3 rounded-lg bg-muted text-sm">
                  <p className="text-muted-foreground">
                    Zeigen Sie diesen QR-Code anderen, damit Sie Ihnen eine Kontaktanfrage senden können.
                  </p>
                </div>
              </div>
            )}
          </TabsContent>

          {/* Manual Tab */}
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
                  <>
                    <div className="h-4 w-4 border-2 border-current border-t-transparent rounded-full animate-spin mr-2" />
                    Wird hinzugefügt...
                  </>
                ) : (
                  <>
                    <UserPlus className="h-4 w-4 mr-2" aria-hidden="true" />
                    Kontakt hinzufügen
                  </>
                )}
              </Button>
            </div>

            {scanError && (
              <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm" role="alert">
                {scanError}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
