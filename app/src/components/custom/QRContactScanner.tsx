import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import jsQR from 'jsqr';
import { Button } from '@/components/ui/button';
import { StopCircle } from 'lucide-react';

interface QRContactScannerProps {
  onContactScanned: (raw: string) => void;
  onError: (error: string) => void;
}

interface ParsedFrame {
  i: number;
  t: number;
  d: string;
}

/**
 * Multi-Frame QR-Scanner fuer SecuChat.
 *
 * Capacitor-Android-WebView Camera-Workaround:
 *  - getUserMedia() liefert einen live MediaStreamTrack (readyState=live,
 *    settings.height=640).
 *  - Das <video>-Element, dem wir den Stream zuweisen, rendert ABER
 *    schwarze Frames (drawImage(video,…) liefert Pixel=0).
 *  - html5-qrcode liest genau aus diesem <video> → sieht nichts.
 *  - Loesung: ImageCapture.takePhoto() greift DIREKT auf den Track zu
 *    (umgeht den Video-Render), liefert ein echtes JPEG, das wir per
 *    createImageBitmap in einen OffscreenCanvas rendern und dann jsQR
 *    auf die Pixel-Data anwenden.
 *
 * Frame-Loop mit setTimeout (10 FPS ≈ 100ms): jeder Scanversuch kostet
 * 1 takePhoto() → reicht fuer 11 Frames bei 4 FPS Anzeige (2.75s Animation).
 */
export function QRContactScanner({ onContactScanned, onError }: QRContactScannerProps) {
  const { t } = useTranslation();
  const imageCaptureRef = useRef<ImageCapture | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const stopFlagRef = useRef<boolean>(false);
  const framesRef = useRef<Map<number, string>>(new Map());
  const totalRef = useRef<number>(0);

  const [isRunning, setIsRunning] = useState(true);
  const [progress, setProgress] = useState<{ scanned: number; total: number }>({ scanned: 0, total: 0 });

  useEffect(() => {
    stopFlagRef.current = false;
    framesRef.current = new Map();

    let cancelled = false;

    const start = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;

        const track = stream.getVideoTracks()[0];
        if (!track) throw new Error('No video track in MediaStream');

        // ImageCapture braucht explizit Support; Capacitor-Android-WebView hat es.
        if (typeof ImageCapture === 'undefined') {
          throw new Error('ImageCapture API not supported in this WebView');
        }
        const imageCapture = new ImageCapture(track);
        imageCaptureRef.current = imageCapture;

        // Offscreen canvas for jsQR input. Wird nicht ins DOM gehaengt.
        const canvas = document.createElement('canvas');
        canvasRef.current = canvas;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) throw new Error('Canvas 2D context unavailable');
        ctxRef.current = ctx;

        const handleDecoded = (decoded: string) => {
          console.log('[QR-Scan] decoded:', decoded.slice(0, 80), 'len=', decoded.length);
          try {
            const frame: ParsedFrame = JSON.parse(decoded);
            if (
              typeof frame.i !== 'number' ||
              typeof frame.t !== 'number' ||
              typeof frame.d !== 'string'
            ) {
              console.warn('[QR-Scan] invalid frame shape:', decoded.slice(0, 80));
              return false;
            }
            totalRef.current = frame.t;
            framesRef.current.set(frame.i, frame.d.trim());
            console.log(
              '[QR-Scan] frame', frame.i, '/', frame.t,
              'chunkLen=', frame.d.length,
              'mapSize=', framesRef.current.size,
            );
            setProgress({ scanned: framesRef.current.size, total: frame.t });

            if (framesRef.current.size === frame.t) {
              const parts: string[] = [];
              let missing = false;
              for (let i = 0; i < frame.t; i++) {
                const part = framesRef.current.get(i);
                if (!part) {
                  missing = true;
                  console.warn('[QR-Scan] missing frame', i);
                  break;
                }
                parts.push(part);
              }
              if (missing) return false;
              const raw = parts.join('');
              console.log('[QR-Scan] complete, rawLen=', raw.length, 'rawPrefix=', raw.slice(0, 60));
              stopFlagRef.current = true;
              onContactScanned(raw);
              return true;
            }
            return false;
          } catch {
            console.log('[QR-Scan] parse-error, prefix=', decoded.slice(0, 80));
            return false;
          }
        };

        const scanOnce = async (): Promise<void> => {
          if (stopFlagRef.current) return;
          const ic = imageCaptureRef.current;
          const c = canvasRef.current;
          const ctx = ctxRef.current;
          if (!ic || !c || !ctx) return;

          try {
            const blob = await ic.takePhoto();
            if (stopFlagRef.current) return;
            const bitmap = await createImageBitmap(blob);
            if (stopFlagRef.current) {
              bitmap.close();
              return;
            }
            if (c.width !== bitmap.width || c.height !== bitmap.height) {
              c.width = bitmap.width;
              c.height = bitmap.height;
            }
            ctx.drawImage(bitmap, 0, 0);
            bitmap.close();

            const imageData = ctx.getImageData(0, 0, c.width, c.height);
            const result = jsQR(imageData.data, imageData.width, imageData.height, {
              inversionAttempts: 'attemptBoth',
            });
            if (result && result.data) {
              const done = handleDecoded(result.data);
              if (done) return;
            }
          } catch (err) {
            // takePhoto() kann transient fehlschlagen (z.B. noch kein Frame);
            // einfach weiter versuchen.
            console.log('[QR-Scan] takePhoto error:', err instanceof Error ? err.message : String(err));
          }

          if (!stopFlagRef.current) {
            timeoutRef.current = setTimeout(scanOnce, 100); // 10 FPS
          }
        };

        // Erste Aufnahme nach kurzem Delay (Track braucht einen Moment).
        timeoutRef.current = setTimeout(scanOnce, 200);
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : (typeof err === 'string' ? err : 'Camera access denied');
        onError(msg);
      }
    };

    start();

    return () => {
      cancelled = true;
      stopFlagRef.current = true;
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      framesRef.current.clear();
    };
  }, [onContactScanned, onError]);

  const stop = () => {
    stopFlagRef.current = true;
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    setIsRunning(false);
  };

  if (!isRunning) {
    return (
      <div className="text-center py-4 text-muted-foreground">
        <p>{t('qr.stopped')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg overflow-hidden bg-black">
        {/* Hidden preview area — wir zeigen kein Camera-Bild, weil der
            Capacitor-WebView-Render schwarz ist. Die eigentliche Scan-
            Logik laeuft ueber ImageCapture.takePhoto() + jsQR auf einem
            Offscreen-Canvas (oben), nicht ueber dieses Element. */}
        <div
          id="qr-scanner-element"
          className="w-full flex items-center justify-center text-muted-foreground text-sm"
          style={{ aspectRatio: '4 / 3', minHeight: '300px' }}
        >
          <p>📷 Kamera aktiv — halte den animierten QR-Code in den Rahmen</p>
        </div>
      </div>
      <div className="text-center text-sm text-muted-foreground">
        {progress.total > 0 ? (
          <p>{t('qr.scanProgress', { current: progress.scanned, total: progress.total })}</p>
        ) : (
          <p>{t('qr.pointAtQR')}</p>
        )}
      </div>
      <div className="flex justify-center">
        <Button variant="outline" size="sm" onClick={stop}>
          <StopCircle className="h-4 w-4 mr-2" />
          {t('common.stop')}
        </Button>
      </div>
    </div>
  );
}