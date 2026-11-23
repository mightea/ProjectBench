import type { OAuthConnection } from '@projectbench/core/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api.ts';

const CONNECTIONS_KEY = ['oauth-connections'] as const;

const formatDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

function ConnectionRow({ connection, busy, onRemove }: { connection: OAuthConnection; busy: boolean; onRemove: () => void }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 border-b border-line-soft px-4 py-3 last:border-b-0">
      <div className="min-w-0">
        <p className="truncate font-semibold">{connection.name}</p>
        <p className="truncate text-xs text-muted">
          {connection.redirectHost} · {connection.lastUsedAt ? `Last used ${formatDate(connection.lastUsedAt)}` : `Connected ${formatDate(connection.createdAt)}`}
        </p>
      </div>
      {confirming ? (
        <div className="flex gap-2">
          <button type="button" onClick={() => setConfirming(false)} className="h-11 rounded-xl border border-line px-3 text-sm font-semibold">
            Keep
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onRemove}
            aria-label={`Confirm disconnecting ${connection.name}`}
            className="h-11 rounded-xl bg-danger-fill px-3 text-sm font-semibold text-white disabled:opacity-60"
          >
            Disconnect now
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => setConfirming(true)} aria-label={`Disconnect ${connection.name}`} className="h-11 rounded-xl border border-line px-3 text-sm font-semibold text-danger">
          Disconnect
        </button>
      )}
    </li>
  );
}

export function ConnectedApps() {
  const queryClient = useQueryClient();
  const data = useQuery({
    queryKey: CONNECTIONS_KEY,
    queryFn: () => api.get<{ endpoint: string | null; connections: OAuthConnection[] }>('/api/oauth/connections'),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/api/oauth/connections/${encodeURIComponent(id)}`),
    onSettled: () => queryClient.invalidateQueries({ queryKey: CONNECTIONS_KEY }),
  });

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="font-display text-xl font-semibold">Connected apps</h2>
        {data.data?.endpoint ? (
          <>
            <p className="text-sm text-muted">Add this URL as a custom connector in claude.ai or another MCP client. You’ll sign in and approve it here.</p>
            <code className="overflow-x-auto rounded-xl bg-ground p-3 text-xs select-all">{data.data.endpoint}</code>
          </>
        ) : (
          data.data && <p className="text-sm text-muted">Connecting apps needs ProjectBench on an HTTPS address, set as PUBLIC_URL.</p>
        )}
      </div>
      {data.isError && (
        <p role="alert" className="text-sm text-danger">
          Couldn’t load connected apps.
        </p>
      )}
      {remove.isError && (
        <p role="alert" className="text-sm text-danger">
          {remove.error.message}
        </p>
      )}
      {!!data.data?.connections.length && (
        <ul aria-label="Connected apps" className="rounded-2xl border border-line bg-surface">
          {data.data.connections.map((c) => (
            <ConnectionRow key={c.id} connection={c} busy={remove.isPending} onRemove={() => remove.mutate(c.id)} />
          ))}
        </ul>
      )}
    </section>
  );
}
