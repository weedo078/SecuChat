import { Skeleton } from '@/components/ui/skeleton';

/**
 * Skeleton-Loader für Messages während Decrypt.
 *
 * 5 alternierende Skeleton-Blöcke (Pulse-Animation) als Platzhalter.
 * Wird in ChatView gerendert wenn `decrypting && messages.length === 0`.
 */
export function MessageSkeleton() {
  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4" role="status" aria-label="Nachrichten werden entschlüsselt">
      <div className="flex justify-start">
        <Skeleton className="h-12 w-3/4" />
      </div>
      <div className="flex justify-end">
        <Skeleton className="h-10 w-2/3" />
      </div>
      <div className="flex justify-start">
        <Skeleton className="h-14 w-4/5" />
      </div>
      <div className="flex justify-end">
        <Skeleton className="h-10 w-1/2" />
      </div>
      <div className="flex justify-start">
        <Skeleton className="h-12 w-3/5" />
      </div>
    </div>
  );
}
