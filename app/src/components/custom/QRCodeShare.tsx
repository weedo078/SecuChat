import { useState, useEffect, useRef, useCallback } from 'react';
import { Copy, Check, Download, Camera, X, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useApp } from '@/contexts/AppContext';
import { cryptoService } from '@/services/crypto';
import * as QRCodeLib from 'qrcode';
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
  const [qrCodeData, setQrCodeData] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (isOpen && user) {
      // Compact QR data — no PGP key (too large for QR)
      const qrData = JSON.stringify({
        v: '2',
        t: 'sc',
        n: user.username,
        i: user.i2pAddress,
        f: user.fingerprint,
      });
      QRCodeLib.toDataURL(qrData, {
        width: 300,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#ffffff',
        },
      }).then(url => {
        setQrCodeData(url);
      });
    }
  }, [isOpen, user]);

  const handleCopy = async () => {
    if (user) {
      // Full contact data with PGP key for clipboard
      const fullData = JSON.stringify({
        v: '2',
        t: 'sc',
        n: user.username,
        i: user.i2pAddress,
        f: user.fingerprint,
        k: user.pgpPublicKey,
        ts: Date.now(),
      }, null, 2);
      await navigator.clipboard.writeText(fullData);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDownload = () => {
    if (qrCodeData) {
      const link = document.createElement('a');
      link.href = qrCodeData;
      link.download = `securechat-qr-${user?.username}.png`;
      link.click();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Kontakt teilen</DialogTitle>
          <DialogDescription>
            Teilen Sie Ihren Kontakt über QR-Code oder Verbindungsdatei.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="share" className="mt-4">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="share">Teilen</TabsTrigger>
            <TabsTrigger value="scan">Scannen</TabsTrigger>
          </TabsList>

          <TabsContent value="share" className="space-y-4">
            {qrCodeData && (
              <div className="flex flex-col items-center">
                <div className="p-4 bg-white rounded-lg">
                  <img src={qrCodeData} alt="QR Code" className="w-64 h-64" />
                </div>
                <p className="text-sm text-muted-foreground mt-2 text-center">
                  Scannen Sie diesen Code, um den Kontakt hinzuzufügen
                </p>
              </div>
            )}

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
              <Button variant="outline" className="flex-1" onClick={handleDownload}>
                <Download className="h-4 w-4 mr-2" />
                Herunterladen
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
        <div className="flex flex-col gap-4">
          <Button onClick={() => setIsScanning(true)} className="w-full">
            <Camera className="h-4 w-4 mr-2" />
            Kamera starten
          </Button>
          
          <div className="relative">
            <input
              type="file"
              accept="image/*"
              onChange={handleFileUpload}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            />
            <Button variant="outline" className="w-full">
              <Upload className="h-4 w-4 mr-2" />
              Bild hochladen
            </Button>
          </div>
        </div>
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
