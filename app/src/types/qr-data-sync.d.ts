declare module '@lo-fi/qr-data-sync' {
  interface SendOptions {
    maxFramesPerSecond?: number;
    frameTextChunkSize?: number;
    qrCodeSize?: number;
    onFrameRendered?: (frameInfo: { frameIndex: number; frameCount: number }) => void;
    signal?: AbortSignal;
  }

  interface ReceiveOptions {
    onFrameScanned?: (frameInfo: { framesScanned: number; frameCount: number }) => void;
    signal?: AbortSignal;
  }

  interface ReceiveResult {
    data: unknown;
    dataSetID: string;
    frameCount: number;
  }

  export function send(
    data: unknown,
    qrCodeElement: string | HTMLElement,
    options?: SendOptions
  ): Promise<boolean>;

  export function receive(
    videoElement: string | HTMLVideoElement,
    options?: ReceiveOptions
  ): Promise<ReceiveResult>;
}
