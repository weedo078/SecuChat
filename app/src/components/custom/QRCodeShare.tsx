import { useState, useEffect, useRef, useCallback } from 'react';
import { Copy, Check, Download, Camera, X, Upload, Share2, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useApp } from '@/contexts/AppContext';
import { cryptoService } from '@/services/crypto';
import jsQR from 'jsqr';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface QRCodeShareProps {
  isOpen: boolean;
  onClose: () => void;
}

export function QRCodeShare({ isOpen, onClose }: QRCodeShareProps) {
  const { user } = useApp();
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (user) {
      const connectionData = cryptoService.exportConnectionFile(user);
      await navigator.clipboard.writeText(connectionData);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDownload = () => {
    if (user) {
      const connectionData = cryptoService.exportConnectionFile(user);
      const blob = new Blob([connectionData], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${user.username}.secuchat`;
      link.click();
      URL.revokeObjectURL(url);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Kontakt teilen</DialogTitle>
          <DialogDescription>
            Teilen Sie Ihren Kontakt über eine .secuchat-Datei oder Verbindungsdaten.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="share" className="mt-4">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="share">
              <Share2 className="h-4 w-4 mr-2" />
              Teilen
            </TabsTrigger>
            <TabsTrigger value="scan">
              <UserPlus className="h-4 w-4 mr-2" />
              Hinzufügen
            </TabsTrigger>
          </TabsList>

          <TabsContent value="share" className="space-y-4">
            <div className="p-4 bg-muted rounded-lg">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                  <Share2 className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="font-medium">Kontaktdatei</p>
                  <p className="text-xs text-muted-foreground">
                    {user?.username}.secuchat
                  </p>
                </div>
              </div>
              <p className="text-sm text-muted-foreground">
                Laden Sie Ihre Kontaktdatei herunter und senden Sie sie an Freunde. 
                Diese können Sie dann importieren, um mit Ihnen zu chatten.
              </p>
            </div>

            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={handleCopy}>
                {copied ? (
                  <>
                    <Check className="h-4 w-4 mr-2" />
                    Kopiert
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4 mr-2" />
                    Kopieren
                  </>
                )}
              </Button>
              <Button variant="default" className="flex-1" onClick={handleDownload}>
                <Download className="h-4 w-4 mr-2" />
                .secuchat herunterladen
              </Button>
            </div>

            {user && (
              <>
                <div className="p-3 bg-muted rounded-lg">
                  <p className="text-xs text-muted-foreground mb-1">Ihr Fingerabdruck</p>
                  <p className="text-sm font-mono break-all">{user.fingerprint}</p>
                </div>
                {user.i2pAddress && (
                  <div className="p-3 bg-muted rounded-lg">
                    <p className="text-xs text-muted-foreground mb-1">Ihre I2P-Adresse</p>
                    <p className="text-sm font-mono break-all">{user.i2pAddress}</p>
                  </div>
                )}
              </>
            )}
          </TabsContent>

          <TabsContent value="scan">
            <QRScanner />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function QRScanner() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState('');
  const { addContact } = useApp();
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [scannedData, setScannedData] = useState<Record<string, string> | null>(null);
  const [importText, setImportText] = useState('');

  const stopCamera = useCallback(() => {
    if (videoRef.current?.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
    }
  }, []);

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch {
      setError('Kamera konnte nicht gestartet werden');
      setIsScanning(false);
    }
  }, []);

  // Use function declaration for recursive self-reference
  function scanQRCode() {
    if (!videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');

    if (!ctx || video.readyState !== video.HAVE_ENOUGH_DATA) {
      requestAnimationFrame(scanQRCode);
      return;
    }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(imageData.data, imageData.width, imageData.height);

    if (code) {
      try {
        const result = cryptoService.importConnectionFile(code.data);
        if (result.success && result.contact) {
          setScannedData(result.contact);
          setShowAddDialog(true);
          setIsScanning(false);
          return;
        }
      } catch {
        // Continue scanning on parse error
      }
    }

    requestAnimationFrame(scanQRCode);
  }

  /* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
  useEffect(() => {
    if (isScanning) {
      startCamera().then(() => scanQRCode());
    } else {
      stopCamera();
    }
    return () => stopCamera();
  }, [isScanning, startCamera, stopCamera]);
  /* eslint-enable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Check if it's a .secuchat file or JSON file
    if (file.name.endsWith('.secuchat') || file.name.endsWith('.json')) {
      try {
        const text = await file.text();
        const result = cryptoService.importConnectionFile(text);
        if (result.success && result.contact) {
          setScannedData(result.contact);
          setShowAddDialog(true);
        } else {
          setError(result.error || 'Ungültige Kontaktdatei');
        }
      } catch {
        setError('Fehler beim Lesen der Datei');
      }
      return;
    }

    // Try to read as QR code image
    const reader = new FileReader();
    reader.onload = async (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height);

        if (code) {
          try {
            const result = cryptoService.importConnectionFile(code.data);
            if (result.success && result.contact) {
              setScannedData(result.contact);
              setShowAddDialog(true);
            } else {
              setError('Ungültiger QR-Code');
            }
          } catch {
            setError('Fehler beim Lesen des QR-Codes');
          }
        } else {
          setError('Kein QR-Code gefunden');
        }
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const handleImportText = () => {
    if (!importText.trim()) return;
    
    try {
      const result = cryptoService.importConnectionFile(importText.trim());
      if (result.success && result.contact) {
        setScannedData(result.contact);
        setShowAddDialog(true);
        setImportText('');
        setError('');
      } else {
        setError(result.error || 'Ungültige Verbindungsdaten');
      }
    } catch {
      setError('Fehler beim Importieren');
    }
  };

  const handleAddContact = async () => {
    if (scannedData) {
      const contact = {
        id: crypto.randomUUID(),
        name: scannedData.name || 'Unbekannt',
        pgpPublicKey: scannedData.pgpPublicKey,
        fingerprint: scannedData.fingerprint,
        p2pIdentifier: scannedData.p2pIdentifier || '',
        i2pAddress: scannedData.i2pAddress || '',
        status: 'offline' as const,
      };
      await addContact(contact);
      setShowAddDialog(false);
      setScannedData(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Text Import */}
      <div className="space-y-2">
        <label className="text-sm font-medium">Verbindungsdaten einfügen</label>
        <textarea
          className="w-full h-24 p-3 rounded-md border border-input bg-background text-xs font-mono resize-none"
          placeholder='{"version": "1.0", ...}'
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
        />
        <Button 
          onClick={handleImportText} 
          disabled={!importText.trim()}
          className="w-full"
          variant="outline"
        >
          <Upload className="h-4 w-4 mr-2" />
          Aus Text importieren
        </Button>
      </div>

      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-background px-2 text-muted-foreground">
            Oder
          </span>
        </div>
      </div>

      {/* File Upload */}
      <div className="relative">
        <input
          type="file"
          accept=".secuchat,.json,image/*"
          onChange={handleFileUpload}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        />
        <Button variant="outline" className="w-full">
          <Upload className="h-4 w-4 mr-2" />
          .secuchat-Datei hochladen
        </Button>
      </div>

      {/* QR Scanner */}
      {isScanning ? (
        <div className="relative">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            className="w-full rounded-lg"
          />
          <canvas ref={canvasRef} className="hidden" />
          <Button
            variant="destructive"
            size="sm"
            className="absolute top-2 right-2"
            onClick={() => setIsScanning(false)}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <Button onClick={() => setIsScanning(true)} variant="outline" className="w-full">
          <Camera className="h-4 w-4 mr-2" />
          QR-Code scannen
        </Button>
      )}

      {error && (
        <p className="text-sm text-destructive text-center">{error}</p>
      )}

      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Kontakt gefunden</DialogTitle>
            <DialogDescription>
              Möchten Sie diesen Kontakt hinzufügen?
            </DialogDescription>
          </DialogHeader>
          {scannedData && (
            <div className="p-4 bg-muted rounded-lg mt-4">
              <p className="font-medium">{scannedData.name || 'Unbekannt'}</p>
              <p className="text-xs text-muted-foreground font-mono mt-1">
                {scannedData.fingerprint}
              </p>
              {scannedData.i2pAddress && (
                <p className="text-xs text-muted-foreground font-mono mt-1 truncate">
                  {scannedData.i2pAddress}
                </p>
              )}
            </div>
          )}
          <div className="flex gap-2 mt-4">
            <Button variant="outline" className="flex-1" onClick={() => setShowAddDialog(false)}>
              Abbrechen
            </Button>
            <Button className="flex-1" onClick={handleAddContact}>
              Hinzufügen
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
