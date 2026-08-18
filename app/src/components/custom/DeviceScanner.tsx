import { useState, useRef, useEffect, useCallback } from 'react';
import { Camera, X, AlertCircle, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import jsQR from 'jsqr';
import { i2pService } from '@/services/i2p';
import { storageService } from '@/services/storage';
import type { User } from '@/types';

interface DeviceScannerProps {
  onDevicePaired: () => void;
}

export function DeviceScanner({ onDevicePaired }: DeviceScannerProps) {
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const stopCamera = useCallback(() => {
    if (videoRef.current?.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
    }
  }, []);

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
      handleScan(code.data);
      return;
    }

    requestAnimationFrame(scanQRCode);
  }

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      scanQRCode();
    } catch {
      setError('Kamera konnte nicht gestartet werden');
      setScanning(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- scanQRCode is a function declaration, stable reference
  }, []);

  // Start camera in user-gesture handlers to avoid set-state-in-effect
  const handleStartClick = useCallback(() => {
    setScanning(true);
    startCamera();
  }, [startCamera]);

  const handleStopClick = useCallback(() => {
    setScanning(false);
    stopCamera();
  }, [stopCamera]);

  // Stop camera on unmount
  useEffect(() => {
    return () => stopCamera();
  }, [stopCamera]);

  const handleScan = async (data: string) => {
    try {
      const parsed = JSON.parse(data);

      // Support both old and new format
      const isV2 = parsed.v === '2' && parsed.t === 'dp';
      const isV1 = parsed.version === '2.0' && parsed.type === 'device-pairing';

      if (!isV2 && !isV1) {
        throw new Error('Ungültiger QR-Code');
      }

      if (isV2) {
        // v2 compact format — QR only contains identifiers
        // Private keys must be imported via backup file
        setError('Bitte importieren Sie Ihre Backup-Datei, um dieses Gerät zu verbinden. Der QR-Code enthält nur die Identifikation.');
        return;
      }

      // v1 legacy format with full keys
      if (parsed.keys?.i2pPublicKey && parsed.keys?.i2pPrivateKey) {
        await i2pService.restoreIdentity(parsed.keys.i2pPublicKey, parsed.keys.i2pPrivateKey);
      }

      const user: User = {
        id: parsed.metadata?.deviceId || crypto.randomUUID(),
        username: parsed.metadata?.username || 'Unknown',
        deviceId: crypto.randomUUID(),
        pgpPublicKey: parsed.keys?.pgpPublicKey || '',
        pgpPrivateKey: parsed.keys?.pgpPrivateKey,
        fingerprint: parsed.keys?.fingerprint || '',
        i2pAddress: parsed.keys?.i2pAddress || '',
        i2pPublicKey: parsed.keys?.i2pPublicKey,
        i2pPrivateKey: parsed.keys?.i2pPrivateKey,
        createdAt: new Date().toISOString(),
      };

      await storageService.saveUser(user);
      setSuccess(true);
      setTimeout(onDevicePaired, 1000);
    } catch (err) {
      if (err instanceof Error && err.message === 'Ungültiger QR-Code') {
        setError('Ungültiger QR-Code. Nur Geräte-Pairing QR-Codes werden unterstützt.');
      } else {
        setError('Fehler beim Scannen. Stellen Sie sicher, dass es ein gültiger Geräte-QR-Code ist.');
      }
    }
  };

  if (success) {
    return (
      <div className="text-center py-8">
        <div className="w-16 h-16 rounded-full bg-teal-400/10 flex items-center justify-center mx-auto mb-4">
          <Check className="h-8 w-8 text-teal-400" />
        </div>
        <p className="font-medium">Gerät erfolgreich verbunden!</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {scanning ? (
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
            size="icon"
            className="absolute top-2 right-2"
            onClick={handleStopClick}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <div className="border-2 border-dashed border-border rounded-lg p-8 text-center">
          <Camera className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
          <p className="text-muted-foreground mb-4">Kamera-Zugriff erforderlich</p>
          <Button onClick={handleStartClick}>
            Kamera starten
          </Button>
        </div>
      )}
    </div>
  );
}
