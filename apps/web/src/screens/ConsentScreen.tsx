import type { OAuthRequestInfo } from '@projectbench/core/schemas';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../api.ts';
import { Logo } from '../components/Logo.tsx';

/** Asks the owner whether an app may connect. Reached from /oauth/authorize. */
export function ConsentScreen() {
  const id = new URLSearchParams(window.location.search).get('request') ?? '';
  const request = useQuery({
    queryKey: ['oauth-request', id],
    queryFn: () => api.get<OAuthRequestInfo>(`/api/oauth/requests/${encodeURIComponent(id)}`),
    enabled: !!id,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const decide = useMutation({
    mutationFn: (approve: boolean) => api.post<{ redirectTo: string }>(`/api/oauth/requests/${encodeURIComponent(id)}`, { approve }),
    onSuccess: ({ redirectTo }) => window.location.assign(redirectTo),
  });
  const info = request.data;
  const leaving = decide.isPending || decide.isSuccess;

  return (
    <main className="flex min-h-dvh items-center justify-center px-5 py-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <Logo className="size-14" />
          <h1 className="font-display text-2xl font-semibold tracking-tight">{info ? `Connect ${info.clientName}?` : 'Connect an app'}</h1>
        </div>

        <div className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-5">
          {request.isPending && !!id && <p className="text-sm text-muted">Loading…</p>}
          {(!id || request.isError) && (
            <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm font-medium text-danger">
              {request.error?.message ?? 'This link is not complete. Start connecting again from the app.'}
            </p>
          )}
          {info && (
            <>
              <p className="text-sm text-ink-soft">It will be able to read and update your projects, checklists, notes and files. It can’t delete anything, and its changes appear in the activity log.</p>
              <dl className="flex flex-col gap-1 rounded-xl bg-ground p-3 text-sm">
                <dt className="text-xs font-semibold text-muted">You’ll be sent back to</dt>
                <dd className="font-semibold break-all">{info.redirectHost}</dd>
              </dl>
              <p className="text-xs text-muted">The name above is what the app says about itself. Only allow this if you just started the connection and recognise the address.</p>
              {decide.isError && (
                <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm font-medium text-danger">
                  {decide.error.message}
                </p>
              )}
              <div className="flex gap-2">
                <button type="button" disabled={leaving} onClick={() => decide.mutate(false)} className="h-12 flex-1 rounded-xl border border-line-strong bg-surface font-semibold hover:bg-ground disabled:opacity-60">
                  Decline
                </button>
                <button type="button" disabled={leaving} onClick={() => decide.mutate(true)} className="h-12 flex-1 rounded-xl bg-accent font-semibold text-white hover:bg-accent-strong disabled:opacity-60">
                  Allow
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
