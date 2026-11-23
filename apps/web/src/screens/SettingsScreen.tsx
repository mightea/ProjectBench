import type { ApiToken, ApiTokenCreated } from '@projectbench/core/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState, type FormEvent } from 'react';
import { api } from '../api.ts';
import { LogoutIcon } from '../components/icons.tsx';
import { inputClass } from '../components/Sheet.tsx';

const TOKENS_KEY = ['tokens'] as const;

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

function CopyButton({ value, label }: { value: string; label: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setState('copied');
    } catch {
      // The clipboard API needs HTTPS; on plain HTTP the text can still be selected by hand.
      setState('failed');
    }
  };
  return (
    <button
      type="button"
      onClick={copy}
      aria-label={label}
      className="h-11 shrink-0 rounded-xl border border-line bg-surface px-4 text-sm font-semibold hover:bg-ground"
    >
      {state === 'copied' ? 'Copied' : state === 'failed' ? 'Select it' : 'Copy'}
    </button>
  );
}

function Snippet({ title, value }: { title: string; value: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[13px] font-semibold text-[#3F4450]">{title}</h3>
        <CopyButton value={value} label={`Copy ${title}`} />
      </div>
      <pre className="overflow-x-auto rounded-xl bg-ground p-3 text-xs select-all">{value}</pre>
    </div>
  );
}

function NewToken({ token, onDone }: { token: ApiTokenCreated; onDone: () => void }) {
  const url = `${window.location.origin}/mcp`;
  return (
    <section aria-label="New token" className="flex flex-col gap-3.5 rounded-2xl border border-accent bg-surface p-4">
      <div>
        <h2 className="font-display text-lg font-semibold">Copy your token now</h2>
        <p className="text-sm text-muted">It is stored hashed, so ProjectBench can’t show “{token.name}” again.</p>
      </div>
      <Snippet title="Token" value={token.token} />
      <Snippet
        title="Claude Code"
        value={`claude mcp add --transport http projectbench ${url} --header "Authorization: Bearer ${token.token}"`}
      />
      <button type="button" onClick={onDone} className="h-11 rounded-xl bg-accent px-5 font-semibold text-white hover:bg-accent-strong">
        Done
      </button>
    </section>
  );
}

function TokenRow({ token, onRevoke, busy }: { token: ApiToken; onRevoke: () => void; busy: boolean }) {
  const [confirming, setConfirming] = useState(false);
  const used = token.lastUsedAt ? `Last used ${formatDate(token.lastUsedAt)}` : 'Never used';
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 border-b border-line-soft px-4 py-3 last:border-b-0">
      <div className="min-w-0">
        <p className={`truncate font-semibold ${token.revokedAt ? 'text-muted line-through' : ''}`}>{token.name}</p>
        <p className="text-xs text-muted">
          <code>{token.prefix}…</code> · {token.revokedAt ? `Revoked ${formatDate(token.revokedAt)}` : used}
        </p>
      </div>
      {!token.revokedAt &&
        (confirming ? (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="h-11 rounded-xl border border-line px-3 text-sm font-semibold"
            >
              Keep
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onRevoke}
              aria-label={`Confirm revoking ${token.name}`}
              className="h-11 rounded-xl bg-danger px-3 text-sm font-semibold text-white disabled:opacity-60"
            >
              Revoke now
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            aria-label={`Revoke ${token.name}`}
            className="h-11 rounded-xl border border-line px-3 text-sm font-semibold text-danger"
          >
            Revoke
          </button>
        ))}
    </li>
  );
}

export function SettingsScreen({ onLogout }: { onLogout: () => void }) {
  const nameId = useId();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [created, setCreated] = useState<ApiTokenCreated | null>(null);
  const tokens = useQuery({ queryKey: TOKENS_KEY, queryFn: () => api.get<ApiToken[]>('/api/tokens') });
  const refresh = () => queryClient.invalidateQueries({ queryKey: TOKENS_KEY });

  const create = useMutation({
    mutationFn: (tokenName: string) => api.post<ApiTokenCreated>('/api/tokens', { name: tokenName }),
    onSuccess: (token) => {
      setCreated(token);
      setName('');
      void refresh();
    },
  });
  const revoke = useMutation({ mutationFn: (id: string) => api.delete(`/api/tokens/${id}`), onSettled: refresh });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim()) create.mutate(name.trim());
  };

  return (
    <>
      <header className="flex items-end justify-between px-5 pt-6 pb-3 md:px-8 md:pt-8">
        <h1 className="font-display text-[32px] font-semibold tracking-tight">Settings</h1>
        <button
          type="button"
          onClick={onLogout}
          aria-label="Sign out"
          className="flex size-11 items-center justify-center rounded-full border border-line bg-surface md:hidden"
        >
          <LogoutIcon width={20} height={20} />
        </button>
      </header>
      <main className="flex max-w-2xl flex-1 flex-col gap-4 px-4 pb-28 md:px-8 md:pb-10">
        <section className="flex flex-col gap-1">
          <h2 className="font-display text-xl font-semibold">Claude access</h2>
          <p className="text-sm text-muted">
            Tokens let Claude read and update your projects through MCP. Claude can’t delete anything, and each change appears in the activity log.
          </p>
        </section>

        {created && <NewToken token={created} onDone={() => setCreated(null)} />}

        <form onSubmit={submit} className="flex flex-col gap-1.5">
          <label htmlFor={nameId} className="text-[13px] font-semibold text-[#3F4450]">
            New token name
          </label>
          <div className="flex gap-2">
            <input
              id={nameId}
              value={name}
              maxLength={80}
              placeholder="Claude Code on MacBook"
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
            />
            <button
              type="submit"
              disabled={!name.trim() || create.isPending}
              className="h-12 shrink-0 rounded-xl bg-accent px-5 font-semibold text-white hover:bg-accent-strong disabled:opacity-60"
            >
              Create
            </button>
          </div>
          {create.isError && (
            <p role="alert" className="text-sm text-danger">
              {create.error.message}
            </p>
          )}
        </form>

        {tokens.isPending && <p className="text-sm text-muted">Loading tokens…</p>}
        {tokens.isError && (
          <p role="alert" className="text-sm text-danger">
            Couldn’t load tokens.
          </p>
        )}
        {revoke.isError && (
          <p role="alert" className="text-sm text-danger">
            {revoke.error.message}
          </p>
        )}
        {tokens.data?.length === 0 && <p className="text-sm text-muted">No tokens yet.</p>}
        {!!tokens.data?.length && (
          <ul aria-label="Tokens" className="rounded-2xl border border-line bg-surface">
            {tokens.data.map((token) => (
              <TokenRow key={token.id} token={token} busy={revoke.isPending} onRevoke={() => revoke.mutate(token.id)} />
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
