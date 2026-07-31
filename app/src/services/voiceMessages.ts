/**
 * Voice Messages Service — Record, encode, and play voice messages
 * 
 * Uses Opus encoding via MediaRecorder API, generates waveform data
 * for visualization, supports recording and playback with scrubbing.
 */

import { logger } from '@/utils/logger';

export interface VoiceMessage {
  id: string;
  duration: number; // seconds
  blob: Blob;
  waveform: number[]; // 30 values, 0-100
  mimeType: string;
}

export interface VoicePlaybackState {
  messageId: string;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  progress: number; // 0-100
}

class VoiceMessageManager {
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];
  private audioStream: MediaStream | null = null;
  private recordingStartTime: number = 0;
  private analyser: AnalyserNode | null = null;
  private audioContext: AudioContext | null = null;
  private liveWaveform: number[] = [];
  private waveformInterval: ReturnType<typeof setInterval> | null = null;

  // Playback
  private audioElements: Map<string, HTMLAudioElement> = new Map();
  private playbackHandlers: ((state: VoicePlaybackState) => void)[] = [];
  private playbackTimers: Map<string, ReturnType<typeof setInterval>> = new Map();

  /**
   * Start recording a voice message
   */
  async startRecording(): Promise<void> {
    try {
      this.audioStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 48000,
        },
      });

      // Set up AudioContext for waveform visualization
      this.audioContext = new AudioContext();
      const source = this.audioContext.createMediaStreamSource(this.audioStream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      source.connect(this.analyser);

      // Use Opus codec if supported
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';

      this.mediaRecorder = new MediaRecorder(this.audioStream, {
        mimeType,
        audioBitsPerSecond: 12000, // Low bitrate for speech
      });

      this.audioChunks = [];
      this.liveWaveform = [];

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.audioChunks.push(event.data);
        }
      };

      this.mediaRecorder.start(100); // 100ms chunks
      this.recordingStartTime = Date.now();

      // Capture waveform data every 100ms
      this.waveformInterval = setInterval(() => {
        if (this.analyser) {
          const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
          this.analyser.getByteFrequencyData(dataArray);
          // RMS of frequency data as a 0-100 value
          const rms = Math.sqrt(
            dataArray.reduce((sum, val) => sum + val * val, 0) / dataArray.length
          );
          this.liveWaveform.push(Math.min(100, Math.round((rms / 128) * 100)));
        }
      }, 100);

      logger.log('[Voice] Recording started');
    } catch (error) {
      logger.error('[Voice] Failed to start recording:', error);
      throw new Error('Mikrofon-Zugriff fehlgeschlagen. Bitte Berechtigung erteilen.', { cause: error });
    }
  }

  /**
   * Stop recording and return the voice message
   */
  async stopRecording(): Promise<VoiceMessage | null> {
    if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') {
      return null;
    }

    return new Promise((resolve) => {
      this.mediaRecorder!.onstop = () => {
        const duration = (Date.now() - this.recordingStartTime) / 1000;

        // Discard if too short
        if (duration < 1) {
          logger.log('[Voice] Recording too short, discarded');
          this.cleanup();
          resolve(null);
          return;
        }

        const blob = new Blob(this.audioChunks, { type: this.mediaRecorder!.mimeType });
        const waveform = this.simplifyWaveform(this.liveWaveform, 30);

        const message: VoiceMessage = {
          id: crypto.randomUUID(),
          duration: Math.round(duration * 10) / 10,
          blob,
          waveform,
          mimeType: this.mediaRecorder!.mimeType,
        };

        this.cleanup();
        resolve(message);
      };

      this.mediaRecorder!.stop();
    });
  }

  /**
   * Cancel recording
   */
  cancelRecording(): void {
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }
    this.cleanup();
  }

  /**
   * Check if currently recording
   */
  isRecording(): boolean {
    return this.mediaRecorder?.state === 'recording';
  }

  /**
   * Get live waveform data (for recording visualization)
   */
  getLiveWaveform(): number[] {
    return [...this.liveWaveform];
  }

  /**
   * Get recording duration in seconds
   */
  getRecordingDuration(): number {
    if (!this.recordingStartTime) return 0;
    return (Date.now() - this.recordingStartTime) / 1000;
  }

  /**
   * Play a voice message
   */
  playMessage(messageId: string, blob: Blob): void {
    // Stop any currently playing message
    this.stopAllPlayback();

    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    this.audioElements.set(messageId, audio);

    audio.onloadedmetadata = () => {
      const duration = audio.duration;

      audio.play();

      const timer = setInterval(() => {
        const state: VoicePlaybackState = {
          messageId,
          isPlaying: !audio.paused,
          currentTime: audio.currentTime,
          duration,
          progress: duration > 0 ? (audio.currentTime / duration) * 100 : 0,
        };
        this.playbackHandlers.forEach(h => h(state));
      }, 50);

      this.playbackTimers.set(messageId, timer);
    };

    audio.onended = () => {
      this.stopPlayback(messageId);
      this.playbackHandlers.forEach(h => h({
        messageId,
        isPlaying: false,
        currentTime: 0,
        duration: audio.duration,
        progress: 100,
      }));
    };
  }

  /**
   * Pause/resume playback
   */
  togglePlayback(messageId: string): void {
    const audio = this.audioElements.get(messageId);
    if (!audio) return;

    if (audio.paused) {
      audio.play();
    } else {
      audio.pause();
    }
  }

  /**
   * Seek to position (0-100)
   */
  seekTo(messageId: string, percent: number): void {
    const audio = this.audioElements.get(messageId);
    if (!audio || !audio.duration) return;

    audio.currentTime = (percent / 100) * audio.duration;
  }

  /**
   * Stop playback
   */
  stopPlayback(messageId: string): void {
    const audio = this.audioElements.get(messageId);
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
      URL.revokeObjectURL(audio.src);
      this.audioElements.delete(messageId);
    }

    const timer = this.playbackTimers.get(messageId);
    if (timer) {
      clearInterval(timer);
      this.playbackTimers.delete(messageId);
    }
  }

  /**
   * Stop all playback
   */
  stopAllPlayback(): void {
    for (const [id] of this.audioElements) {
      this.stopPlayback(id);
    }
  }

  /**
   * Register playback state handler
   */
  onPlaybackState(handler: (state: VoicePlaybackState) => void): void {
    this.playbackHandlers.push(handler);
  }

  offPlaybackState(handler: (state: VoicePlaybackState) => void): void {
    this.playbackHandlers = this.playbackHandlers.filter(h => h !== handler);
  }

  /**
   * Generate waveform from audio blob (for received messages)
   */
  async generateWaveformFromBlob(blob: Blob): Promise<number[]> {
    try {
      const audioContext = new AudioContext();
      const arrayBuffer = await blob.arrayBuffer();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      const channelData = audioBuffer.getChannelData(0);

      const samples = 30;
      const blockSize = Math.floor(channelData.length / samples);
      const waveform: number[] = [];

      for (let i = 0; i < samples; i++) {
        let sum = 0;
        const start = i * blockSize;
        for (let j = start; j < start + blockSize && j < channelData.length; j++) {
          sum += channelData[j] * channelData[j];
        }
        const rms = Math.sqrt(sum / blockSize);
        waveform.push(Math.min(100, Math.round(rms * 200)));
      }

      await audioContext.close();
      return waveform;
    } catch {
      // Return flat waveform as fallback
      return Array(30).fill(20);
    }
  }

  /**
   * Format duration as m:ss
   */
  static formatDuration(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  /**
   * Simplify waveform to N bars
   */
  private simplifyWaveform(data: number[], bars: number): number[] {
    if (data.length === 0) return Array(bars).fill(10);
    if (data.length <= bars) {
      const result = [...data];
      while (result.length < bars) result.push(10);
      return result;
    }

    const blockSize = Math.floor(data.length / bars);
    const result: number[] = [];
    for (let i = 0; i < bars; i++) {
      const start = i * blockSize;
      let sum = 0;
      let count = 0;
      for (let j = start; j < start + blockSize && j < data.length; j++) {
        sum += data[j];
        count++;
      }
      result.push(count > 0 ? Math.round(sum / count) : 10);
    }
    return result;
  }

  /**
   * Cleanup recording resources
   */
  private cleanup(): void {
    if (this.waveformInterval) {
      clearInterval(this.waveformInterval);
      this.waveformInterval = null;
    }

    if (this.audioStream) {
      this.audioStream.getTracks().forEach(t => t.stop());
      this.audioStream = null;
    }

    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }

    this.analyser = null;
    this.mediaRecorder = null;
    this.audioChunks = [];
  }

  destroy(): void {
    this.cancelRecording();
    this.stopAllPlayback();
    this.playbackHandlers = [];
  }
}

export const voiceMessageManager = new VoiceMessageManager();
