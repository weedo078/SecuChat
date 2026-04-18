import { useEffect, useRef, useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import QRCode from 'qrcode';
import { Button } from '@/components/ui/button';
import { StopCircle } from 'lucide-react';

interface AnimatedContactQRProps {
  contactData: {
    v: '2';
    t: 'sc';
    n: string;
    i: string;
    f: string;
    k?: string;
    ts?: number;
  };
}

const CHUNK_SIZE = 100;
const FPS = 4;

function splitIntoFrames(data: string, chunkSize: number): string[] {
  const frames: string[] = [];
  const totalFrames = Math.ceil(data.length / chunkSize);
  for (let i = 0; i < totalFrames; i++) {
    const chunk = data.slice(i * chunkSize, (i + 1) * chunkSize);
    frames.push(JSON.stringify({ i, t: totalFrames, d: chunk.padEnd(chunkSize) }));
  }
  return frames;
}

export function AnimatedContactQR({ contactData }: AnimatedContactQRProps) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isRunning, setIsRunning] = useState(true);
  const [frameInfo, setFrameInfo] = useState<{ index: number; total: number }>({ index: 0, total: 0 });
  const abortedRef = useRef(false);

  // Memoize frames so the array is stable across renders and doesn't
  // trigger endless effect restarts
  const frames = useMemo(() => splitIntoFrames(JSON.stringify(contactData), CHUNK_SIZE), [contactData]);

  useEffect(() => {
    abortedRef.current = false;
    let frameIndex = 0;
    let timeoutId: ReturnType<typeof setTimeout>;

    const animate = async () => {
      if (abortedRef.current || !canvasRef.current) return;
      const frame = frames[frameIndex % frames.length];
      try {
        await QRCode.toCanvas(canvasRef.current, frame, {
          width: 280,
          margin: 2,
          color: { dark: '#000000', light: '#ffffff' },
          errorCorrectionLevel: 'M',
        });
        setFrameInfo({ index: (frameIndex % frames.length) + 1, total: frames.length });
      } catch (err) {
        console.error('[AnimatedContactQR] Render error:', err);
      }
      frameIndex++;
      if (!abortedRef.current) {
        timeoutId = setTimeout(animate, 1000 / FPS);
      }
    };

    animate();

    return () => {
      abortedRef.current = true;
      clearTimeout(timeoutId);
    };
  }, [frames]);

  const stop = () => {
    abortedRef.current = true;
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
      <div className="flex justify-center">
        <div className="p-4 bg-white rounded-lg">
          <canvas ref={canvasRef} width={280} height={280} />
        </div>
      </div>
      <div className="text-center text-sm text-muted-foreground">
        {frameInfo.total > 0 && (
          <p>{t('qr.frameProgress', { current: frameInfo.index, total: frameInfo.total })}</p>
        )}
        <p className="text-xs mt-1">{t('qr.scanInstructions')}</p>
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
