import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Html5Qrcode } from 'html5-qrcode';
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

export function QRContactScanner({ onContactScanned, onError }: QRContactScannerProps) {
  const { t } = useTranslation();
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [isRunning, setIsRunning] = useState(true);
  const [progress, setProgress] = useState<{ scanned: number; total: number }>({ scanned: 0, total: 0 });
  const framesRef = useRef<Map<number, string>>(new Map());
  const totalRef = useRef<number>(0);

  useEffect(() => {
    const scanner = new Html5Qrcode('qr-scanner-element');
    scannerRef.current = scanner;

    const onScanSuccess = (decodedText: string) => {
      try {
        const frame: ParsedFrame = JSON.parse(decodedText);
        if (typeof frame.i !== 'number' || typeof frame.t !== 'number' || typeof frame.d !== 'string') return;

        totalRef.current = frame.t;
        framesRef.current.set(frame.i, frame.d.trim());
        setProgress({ scanned: framesRef.current.size, total: frame.t });

        if (framesRef.current.size === frame.t) {
          // All frames collected, reassemble
          const parts: string[] = [];
          for (let i = 0; i < frame.t; i++) {
            const part = framesRef.current.get(i);
            if (!part) return;
            parts.push(part);
          }
          const raw = parts.join('');
          scanner.stop().catch(() => {});
          onContactScanned(raw);
        }
      } catch {
        // Not a valid frame, ignore
      }
    };

    scanner.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 250, height: 250 } },
      onScanSuccess,
      () => {} // ignore scan failures
    ).catch((err) => {
      console.error('[QRContactScanner] Start error:', err);
      onError(err instanceof Error ? err.message : 'Camera access denied');
    });

    return () => {
      scanner.stop().catch(() => {});
      framesRef.current.clear();
    };
  }, [onContactScanned, onError]);

  const stop = () => {
    scannerRef.current?.stop().catch(() => {});
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
      <div className="rounded-lg overflow-hidden">
        <div id="qr-scanner-element" className="w-full" />
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
