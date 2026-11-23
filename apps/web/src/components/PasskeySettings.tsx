import type { Passkey } from '@projectbench/core/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState, type FormEvent } from 'react';
import { api, type AuthState } from '../api.ts';
import { addPasskey, passkeysUsable } from '../lib/passkeys.ts';
import { Field, inputClass } from './Sheet.tsx';

const PASSKEYS_KEY = ['passkeys'] as const;

const formatDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

function PasskeyRow({ passkey, busy, onRemove }: { passkey: Passkey; busy: boolean; onRemove: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const used = passkey.lastUsedAt ? `Last used ${formatDate(passkey.lastUsedAt)}` : 'Never used';
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 border-b border-line-soft px-4 py-3 last:border-b-0">
      <div className="min-w-0">
        <p className="truncate font-semibold">{passkey.name}</p>
        <p className="text-xs text-muted">
          {used}
          {passkey.backedUp ? ' · Synced' : ' · This device only'}
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
            aria-label={`Confirm removing ${passkey.name}`}
            className="h-11 rounded-xl bg-danger-fill px-3 text-sm font-semibold text-white disabled:opacity-60"
          >
            Remove now
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => setConfirming(true)} aria-label={`Remove ${passkey.name}`} className="h-11 rounded-xl border border-line px-3 text-sm font-semibold text-danger">
          Remove
        </button>
      )}
    </li>
  );
}

export function PasskeySettings() {
  const queryClient = useQueryClient();
  const ids = { name: useId(), password: useId() };
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const auth = useQuery({ queryKey: ['auth'], queryFn: () => api.get<AuthState>('/api/auth/state') });
  const passkeys = useQuery({ queryKey: PASSKEYS_KEY, queryFn: () => api.get<Passkey[]>('/api/passkeys') });
  const usable = auth.data ? passkeysUsable(auth.data) : false;

  const refresh = () => Promise.all([queryClient.invalidateQueries({ queryKey: PASSKEYS_KEY }), queryClient.invalidateQueries({ queryKey: ['auth'] })]);

  const add = useMutation({
    mutationFn: () => addPasskey(name.trim(), password),
    onSuccess: (created) => {
      setPassword('');
      if (!created) return;
      setName('');
      setAdding(false);
      void refresh();
    },
    onError: () => setPassword(''),
  });
  const remove = useMutation({ mutationFn: (id: string) => api.delete(`/api/passkeys/${id}`), onSettled: refresh });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim() && password) add.mutate();
  };

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="font-display text-xl font-semibold">Passkeys</h2>
        <p className="text-sm text-muted">
          {usable
            ? 'Sign in with Face ID, Touch ID or your device PIN. Your password keeps working as a fallback.'
            : 'Passkeys work when ProjectBench is opened at its HTTPS address, set as PUBLIC_URL, in a browser that supports them.'}
        </p>
      </div>

      {passkeys.isError && (
        <p role="alert" className="text-sm text-danger">
          Couldn’t load passkeys.
        </p>
      )}
      {remove.isError && (
        <p role="alert" className="text-sm text-danger">
          {remove.error.message}
        </p>
      )}
      {!!passkeys.data?.length && (
        <ul aria-label="Passkeys" className="rounded-2xl border border-line bg-surface">
          {passkeys.data.map((p) => (
            <PasskeyRow key={p.id} passkey={p} busy={remove.isPending} onRemove={() => remove.mutate(p.id)} />
          ))}
        </ul>
      )}

      {usable &&
        (adding ? (
          <form onSubmit={submit} className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4">
            <Field label="Passkey name" htmlFor={ids.name}>
              <input id={ids.name} value={name} maxLength={80} placeholder="iPhone" autoFocus onChange={(e) => setName(e.target.value)} className={inputClass} />
            </Field>
            <Field label="Current password" htmlFor={ids.password}>
              <input id={ids.password} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} />
            </Field>
            {add.isError && (
              <p role="alert" className="text-sm text-danger">
                {add.error.message}
              </p>
            )}
            <div className="flex gap-2">
              <button type="button" onClick={() => (setAdding(false), setPassword(''), add.reset())} className="h-11 flex-1 rounded-xl border border-line text-sm font-semibold">
                Cancel
              </button>
              <button
                type="submit"
                disabled={!name.trim() || !password || add.isPending}
                className="h-11 flex-1 rounded-xl bg-accent text-sm font-semibold text-white hover:bg-accent-strong disabled:opacity-60"
              >
                {add.isPending ? 'One moment…' : 'Continue'}
              </button>
            </div>
          </form>
        ) : (
          <button type="button" onClick={() => setAdding(true)} className="h-11 self-start rounded-xl border border-line bg-surface px-4 text-sm font-semibold hover:bg-ground">
            Add a passkey
          </button>
        ))}
    </section>
  );
}
