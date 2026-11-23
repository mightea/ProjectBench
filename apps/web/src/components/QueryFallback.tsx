import type { UseQueryResult } from '@tanstack/react-query';
import { ApiError } from '../api.ts';

/** What to show while a query has no data: loading, not saved for offline, or an error. */
export function QueryFallback({ query }: { query: Pick<UseQueryResult, 'error' | 'fetchStatus'> }) {
  const offline = query.fetchStatus === 'paused' || (query.error instanceof ApiError && query.error.status === 0);
  if (offline) {
    return (
      <p className="rounded-xl border border-dashed border-line bg-surface px-4 py-6 text-center text-sm text-muted">
        This hasn’t been saved on this device yet. It will load when you’re back online.
      </p>
    );
  }
  if (query.error) {
    return (
      <p role="alert" className="rounded-xl bg-danger-soft px-4 py-3 text-danger">
        {query.error.message}
      </p>
    );
  }
  return <p className="px-1 py-6 text-muted">Loading…</p>;
}
