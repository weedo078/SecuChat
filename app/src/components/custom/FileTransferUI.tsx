/**
 * File Transfer UI Components
 * 
 * Accept/Reject dialog, progress bar, drag-and-drop.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { File, Download, Upload, Image as ImageIcon } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  fileTransferManager,
  type FileTransferMeta,
  type FileTransferProgress,
} from '@/services/fileTransfer';

/**
 * File transfer accept/reject dialog
 */
export function FileTransferDialog() {
  const [pendingOffer, setPendingOffer] = useState<{
    from: string;
    meta: FileTransferMeta;
    resolve: (accepted: boolean) => void;
  } | null>(null);

  useEffect(() => {
    const handler = async (from: string, meta: FileTransferMeta): Promise<boolean> => {
      return new Promise((resolve) => {
        setPendingOffer({ from, meta, resolve });
      });
    };

    fileTransferManager.onOffer(handler);
    return () => fileTransferManager.offOffer(handler);
  }, []);

  const handleAccept = () => {
    pendingOffer?.resolve(true);
    setPendingOffer(null);
  };

  const handleReject = () => {
    pendingOffer?.resolve(false);
    setPendingOffer(null);
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  if (!pendingOffer) return null;

  const { meta } = pendingOffer;
  const isImage = meta.mimeType.startsWith('image/');

  return (
    <AlertDialog open={!!pendingOffer}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Datei empfangen</AlertDialogTitle>
          <AlertDialogDescription>
            Möchtest du diese Datei empfangen?
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-3">
          {/* Thumbnail preview for images */}
          {isImage && meta.thumbnailDataUrl && (
            <div className="flex justify-center">
              <img
                src={meta.thumbnailDataUrl}
                alt="Vorschau"
                className="max-h-32 rounded-lg"
              />
            </div>
          )}

          <div className="flex items-center gap-3 bg-muted p-3 rounded-lg">
            {isImage ? (
              <ImageIcon className="h-8 w-8 text-blue-500 shrink-0" />
            ) : (
              <File className="h-8 w-8 text-muted-foreground shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm truncate">{meta.fileName}</p>
              <p className="text-xs text-muted-foreground">
                {formatSize(meta.fileSize)} · {meta.mimeType}
              </p>
            </div>
          </div>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel onClick={handleReject}>Ablehnen</AlertDialogCancel>
          <AlertDialogAction onClick={handleAccept}>
            <Download className="h-4 w-4 mr-2" />
            Empfangen
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * File transfer progress indicator
 */
export function FileTransferProgressBar({
  transferId,
}: {
  transferId: string;
}) {
  const [progress, setProgress] = useState<FileTransferProgress | null>(null);

  useEffect(() => {
    const handler = (p: FileTransferProgress) => {
      if (p.transferId === transferId) setProgress(p);
    };
    fileTransferManager.onProgress(handler);
    return () => fileTransferManager.offProgress(handler);
  }, [transferId]);

  if (!progress) return null;

  const formatSpeed = (bytesPerSec: number) => {
    if (bytesPerSec < 1024) return `${bytesPerSec} B/s`;
    if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
    return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {progress.direction === 'send' ? 'Senden' : 'Empfangen'}
          {progress.status === 'completed' && ' ✓'}
          {progress.status === 'failed' && ' ✗'}
        </span>
        <span>{progress.percent}% {progress.speed > 0 && `· ${formatSpeed(progress.speed)}`}</span>
      </div>
      <Progress value={progress.percent} className="h-1" />
    </div>
  );
}

/**
 * Drag-and-drop file upload zone
 */
export function FileDropZone({
  onFileDrop,
  children,
}: {
  onFileDrop: (file: File) => void;
  children: React.ReactNode;
}) {
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current++;
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current--;
    if (dragCounter.current === 0) setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    dragCounter.current = 0;

    const file = e.dataTransfer.files[0];
    if (file) onFileDrop(file);
  }, [onFileDrop]);

  return (
    <div
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className="relative"
    >
      {children}
      {isDragging && (
        <div className="absolute inset-0 bg-primary/10 border-2 border-dashed border-primary rounded-lg flex items-center justify-center z-50">
          <div className="text-center">
            <Upload className="h-8 w-8 text-primary mx-auto mb-2" />
            <p className="text-sm font-medium text-primary">Datei hier ablegen</p>
          </div>
        </div>
      )}
    </div>
  );
}
