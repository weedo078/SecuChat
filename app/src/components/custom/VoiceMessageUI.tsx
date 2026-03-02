/**
 * Voice Message UI Components
 * 
 * Recording button with hold/toggle, waveform visualization,
 * playback with scrubbing.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Mic, Play, Pause, Square, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { voiceMessageManager, type VoiceMessage, type VoicePlaybackState } from '@/services/voiceMessages';

/**
 * Waveform visualization component
 */
function Waveform({
  data,
  progress = 0,
  height = 32,
  className = '',
  onClick,
}: {
  data: number[];
  progress?: number;
  height?: number;
  className?: string;
  onClick?: (percent: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bars = data.length || 30;
  const barWidth = 3;

  const handleClick = (e: React.MouseEvent) => {
    if (!onClick || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const percent = ((e.clientX - rect.left) / rect.width) * 100;
    onClick(Math.max(0, Math.min(100, percent)));
  };

  return (
    <div
      ref={containerRef}
      className={`flex items-center gap-[1px] ${onClick ? 'cursor-pointer' : ''} ${className}`}
      style={{ height }}
      onClick={handleClick}
    >
      {data.map((value, i) => {
        const barPercent = (i / bars) * 100;
        const isPlayed = barPercent < progress;
        const barHeight = Math.max(4, (value / 100) * height);
        return (
          <div
            key={i}
            className={`rounded-full transition-colors ${isPlayed ? 'bg-primary' : 'bg-muted-foreground/40'}`}
            style={{
              width: barWidth,
              height: barHeight,
              minWidth: barWidth,
            }}
          />
        );
      })}
    </div>
  );
}

/**
 * Voice recording button with hold/toggle
 */
export function VoiceRecordButton({
  onRecorded,
  disabled = false,
}: {
  onRecorded: (message: VoiceMessage) => void;
  disabled?: boolean;
}) {
  const [isRecording, setIsRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const [liveWaveform, setLiveWaveform] = useState<number[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval>>();
  const holdTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const isHolding = useRef(false);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    };
  }, []);

  const startRecording = useCallback(async () => {
    try {
      await voiceMessageManager.startRecording();
      setIsRecording(true);
      setDuration(0);

      timerRef.current = setInterval(() => {
        setDuration(voiceMessageManager.getRecordingDuration());
        setLiveWaveform(voiceMessageManager.getLiveWaveform().slice(-30));
      }, 100);
    } catch (err) {
      console.error('Recording error:', err);
    }
  }, []);

  const stopRecording = useCallback(async () => {
    if (timerRef.current) clearInterval(timerRef.current);
    const message = await voiceMessageManager.stopRecording();
    setIsRecording(false);
    setDuration(0);
    setLiveWaveform([]);
    if (message) onRecorded(message);
  }, [onRecorded]);

  const cancelRecording = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    voiceMessageManager.cancelRecording();
    setIsRecording(false);
    setDuration(0);
    setLiveWaveform([]);
  }, []);

  const handleMouseDown = () => {
    isHolding.current = true;
    holdTimerRef.current = setTimeout(() => {
      if (isHolding.current) startRecording();
    }, 200);
  };

  const handleMouseUp = () => {
    isHolding.current = false;
    if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    if (isRecording) stopRecording();
  };

  const handleClick = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  if (isRecording) {
    return (
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={cancelRecording} aria-label="Aufnahme abbrechen">
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
        <div className="flex items-center gap-2 bg-muted rounded-full px-3 py-1">
          <div className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
          <span className="text-xs font-mono min-w-[3rem]">
            {voiceMessageManager.constructor.prototype.constructor === voiceMessageManager.constructor
              ? `${Math.floor(duration / 60)}:${Math.floor(duration % 60).toString().padStart(2, '0')}`
              : '0:00'}
          </span>
          <Waveform data={liveWaveform} height={20} />
        </div>
        <Button
          variant="destructive"
          size="icon"
          onClick={handleClick}
          onMouseUp={handleMouseUp}
          aria-label="Aufnahme stoppen"
        >
          <Square className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      disabled={disabled}
      onClick={handleClick}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseLeave={() => { isHolding.current = false; }}
      aria-label="Sprachnachricht aufnehmen"
    >
      <Mic className="h-5 w-5" />
    </Button>
  );
}

/**
 * Voice message playback component (shown in chat bubble)
 */
export function VoiceMessagePlayer({
  messageId,
  waveform,
  duration,
  blob,
}: {
  messageId: string;
  waveform: number[];
  duration: number;
  blob?: Blob;
}) {
  const [playback, setPlayback] = useState<VoicePlaybackState | null>(null);

  useEffect(() => {
    const handler = (state: VoicePlaybackState) => {
      if (state.messageId === messageId) setPlayback(state);
    };
    voiceMessageManager.onPlaybackState(handler);
    return () => voiceMessageManager.offPlaybackState(handler);
  }, [messageId]);

  const handlePlay = () => {
    if (!blob) return;
    if (playback?.isPlaying) {
      voiceMessageManager.togglePlayback(messageId);
    } else {
      voiceMessageManager.playMessage(messageId, blob);
    }
  };

  const handleSeek = (percent: number) => {
    voiceMessageManager.seekTo(messageId, percent);
  };

  const isPlaying = playback?.isPlaying || false;
  const progress = playback?.progress || 0;
  const currentTime = playback?.currentTime || 0;

  const formatTime = (s: number) => {
    const mins = Math.floor(s / 60);
    const secs = Math.floor(s % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex items-center gap-2 min-w-[200px]">
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 shrink-0"
        onClick={handlePlay}
        disabled={!blob}
        aria-label={isPlaying ? 'Pause' : 'Abspielen'}
      >
        {isPlaying ? (
          <Pause className="h-4 w-4" />
        ) : (
          <Play className="h-4 w-4" />
        )}
      </Button>
      <div className="flex-1">
        <Waveform data={waveform} progress={progress} height={24} onClick={handleSeek} />
      </div>
      <span className="text-xs text-muted-foreground min-w-[3rem] text-right">
        {isPlaying ? formatTime(currentTime) : formatTime(duration)}
      </span>
    </div>
  );
}
