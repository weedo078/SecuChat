import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
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

// Single-Frame .secuchat v2 Format (z.B. fuer gedruckte QRs):
// {v:2, t:"sc", n:username, i:b32, f:fingerprint, ts:timestamp}
interface SingleContactPayload {
  v: string;
  t: string;
  n?: string;
  i: string;
  f: string;
  ts?: number;
}

function isSingleContactPayload(x: unknown): x is SingleContactPayload {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  return (
    o.v === '2' &&
    o.t === 'sc' &&
    typeof o.i === 'string' &&
    typeof o.f === 'string'
  );
}

// BarcodeDetector ist eine W3C-Web-Plattform-API, die in Chromium-WebViews
// (Chrome 150 / Android 16) nativ als window.BarcodeDetector verfuegbar ist.
// Sie ist einer JS-Library (jsQR, html5-qrcode/ZXing) ueberlegen, weil sie
// direkt auf den Plattform-Decoder (z.B. Google's ML Kit auf Android)
// zugreift. jsQR hingegen scheiterte auf dem WebView konsequent — der
// Locator lieferte fuer einen mit zbarimg ohne weiteres dekodierbaren
// TestQR-Frame null. html5-qrcode hat das gleiche Problem, weil es ZXing
// als JS-Bundle mitbringt.
//
// Per 2026-08-14 auf A54 verifiziert: BarcodeDetector liefert fuer den
// gedruckten TestQR c.a. 5ms, jsQR lieferte null.
declare global {
  interface Window {
    BarcodeDetector?: new (options?: { formats?: string[] }) => BarcodeDetectorInstance;
  }
  interface BarcodeDetectorInstance {
    detect(source: CanvasImageSource | ImageBitmapSource): Promise<Array<{ rawValue: string }>>;
  }
}

/**
 * Multi-Frame QR-Scanner fuer SecuChat.
 *
 * Decoder: window.BarcodeDetector (native Chromium API). Wird mit
 * `{formats: ["qr_code"]}` instanziert und bekommt einen per drawImage
 * aus dem <video>-Element gewonnenen Canvas-Frame.
 *
 * Architektur:
 *  - <video> rendert Live-Frames der environment-cam (480x640).
 *  - requestVideoFrameCallback ruft fuer jeden neuen Frame die
 *    BarcodeDetector.detect(canvasMethode) auf.
 *  - Bei Decode-Erfolg wird der JSON-Frame geparst und in framesMap
 *    akkumuliert. Sobald alle Sub-Frames (t Total) da sind, ruft
 *    onContactScanned auf.
 *  - Capacitor-Android-WebView: getUserMedia + <video>.render + drawImage
 *    funktioniert zuverlaessig; ImageCapture.takePhoto() hingegen wirft
 *    "UnknownError: platform error" (Workaround siehe memory).
 */
export function QRContactScanner({ onContactScanned, onError }: QRContactScannerProps) {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<BarcodeDetectorInstance | null>(null);
  const rvfcHandleRef = useRef<number | null>(null);
  const stopFlagRef = useRef<boolean>(false);
  const framesRef = useRef<Map<number, string>>(new Map());
  const totalRef = useRef<number>(0);

  const [isRunning, setIsRunning] = useState(true);
  const [progress, setProgress] = useState<{ scanned: number; total: number }>({ scanned: 0, total: 0 });

  useEffect(() => {
    stopFlagRef.current = false;
    framesRef.current = new Map();

    if (typeof window.BarcodeDetector !== 'function') {
      onError('WebView unterstuetzt window.BarcodeDetector nicht. Bitte App-Update oder alternativen Browser nutzen.');
      return;
    }

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

        const v = videoRef.current;
        if (!v) {
          stream.getTracks().forEach((t) => t.stop());
          throw new Error('Video-Element nicht gemounted');
        }
        v.srcObject = stream;
        v.muted = true;
        v.playsInline = true;
        v.autoplay = true;
        try {
          await v.play();
        } catch (playErr) {
          console.warn('[QR-Scan] video.play() rejected:', playErr);
        }

        // Native Decoder-Instanz.
        detectorRef.current = new window.BarcodeDetector!({ formats: ['qr_code'] });

        // Offscreen-Canvas.
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) throw new Error('Canvas 2D context unavailable');
        canvasRef.current = canvas;
        ctxRef.current = ctx;

        const handleDecoded = (decoded: string): boolean => {
          console.log('[QR-Scan] decoded:', decoded.slice(0, 80), 'len=', decoded.length);
          try {
            const parsed = JSON.parse(decoded) as unknown;

            // Fall 1: Single-Frame .secuchat v2 Payload (statischer QR,
            // z.B. gedruckt). Wird direkt an onContactScanned gereicht.
            if (isSingleContactPayload(parsed)) {
              console.log('[QR-Scan] single-frame contact payload', parsed.n, parsed.i);
              stopFlagRef.current = true;
              onContactScanned(decoded);
              return true;
            }

            // Fall 2: Animierter Multi-Frame (i, t, d).
            const frame = parsed as Partial<ParsedFrame>;
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

        const scanFrame = async () => {
          if (stopFlagRef.current) return;
          const v = videoRef.current;
          const c = canvasRef.current;
          const ctx = ctxRef.current;
          const detector = detectorRef.current;
          if (!v || !c || !ctx || !detector) {
            schedule();
            return;
          }
          if (v.readyState < 2 || v.videoWidth === 0 || v.videoHeight === 0) {
            schedule();
            return;
          }

          try {
            if (c.width !== v.videoWidth || c.height !== v.videoHeight) {
              c.width = v.videoWidth;
              c.height = v.videoHeight;
            }
            ctx.drawImage(v, 0, 0, c.width, c.height);
            const results = await detector.detect(c);
            for (const r of results) {
              if (r.rawValue && handleDecoded(r.rawValue)) return;
            }
          } catch (err) {
            console.log('[QR-Scan] scan error:', err instanceof Error ? err.message : String(err));
          }
          schedule();
        };

        const schedule = () => {
          if (stopFlagRef.current) return;
          const v = videoRef.current;
          if (v && typeof (v as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number }).requestVideoFrameCallback === 'function') {
            rvfcHandleRef.current = (v as HTMLVideoElement & { requestVideoFrameCallback: (cb: () => void) => number })
              .requestVideoFrameCallback(() => scanFrame());
          } else {
            requestAnimationFrame(() => scanFrame());
          }
        };

        // Erster Aufruf nach kurzem Delay (Video braucht ersten Frame).
        setTimeout(schedule, 200);
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
      const v = videoRef.current;
      if (v && rvfcHandleRef.current !== null && typeof (v as HTMLVideoElement & { cancelVideoFrameCallback?: (id: number) => void }).cancelVideoFrameCallback === 'function') {
        try {
          (v as HTMLVideoElement & { cancelVideoFrameCallback: (id: number) => void }).cancelVideoFrameCallback(rvfcHandleRef.current);
        } catch { /* ignore */ }
      }
      rvfcHandleRef.current = null;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      framesRef.current.clear();
    };
  }, [onContactScanned, onError]);

  const stop = () => {
    stopFlagRef.current = true;
    const v = videoRef.current;
    if (v && rvfcHandleRef.current !== null && typeof (v as HTMLVideoElement & { cancelVideoFrameCallback?: (id: number) => void }).cancelVideoFrameCallback === 'function') {
      try {
        (v as HTMLVideoElement & { cancelVideoFrameCallback: (id: number) => void }).cancelVideoFrameCallback(rvfcHandleRef.current);
      } catch { /* ignore */ }
    }
    rvfcHandleRef.current = null;
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
      <div className="rounded-lg overflow-hidden bg-black relative">
        <video
          ref={videoRef}
          id="qr-scanner-element"
          className="w-full h-auto block"
          style={{ aspectRatio: '4 / 3', minHeight: '300px', objectFit: 'cover' }}
          playsInline
          muted
          autoPlay
        />
        {progress.total === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-white text-sm bg-black/40">
            <p>📷 Kamera aktiv — halte den animierten QR-Code in den Rahmen</p>
          </div>
        )}
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
