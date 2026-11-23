import { useQueryClient } from '@tanstack/react-query';
import { useOffline } from '../lib/connection.ts';

/** Says that what's on screen is the saved copy and that changes can't be made. */
export function OfflineBanner() {
  const offline = useOffline();
  const queryClient = useQueryClient();
  if (!offline) return null;
  return (
    <div role="status" className="flex items-center justify-between gap-3 bg-warning-soft px-4 py-1 pt-[max(env(safe-area-inset-top),4px)] text-[13px] font-medium text-warning-ink md:px-8">
      <span>Offline. You’re reading the saved copy, and changes can’t be saved.</span>
      <button type="button" onClick={() => queryClient.refetchQueries({ type: 'active' })} className="h-11 shrink-0 rounded-lg px-2 font-semibold underline">
        Retry
      </button>
    </div>
  );
}
