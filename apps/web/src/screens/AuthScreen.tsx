import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useState, type FormEvent } from 'react';
import { api } from '../api.ts';
import { Logo } from '../components/Logo.tsx';
import { signInWithPasskey } from '../lib/passkeys.ts';

interface Props {
  mode: 'setup' | 'login';
  minLength: number;
  offerPasskey: boolean;
}

export function AuthScreen({ mode, minLength, offerPasskey }: Props) {
  const queryClient = useQueryClient();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const passwordId = useId();
  const confirmId = useId();
  const errorId = useId();

  const submit = useMutation({
    mutationFn: () => api.post(mode === 'setup' ? '/api/auth/setup' : '/api/auth/login', { password }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['auth'] }),
  });

  const passkey = useMutation({
    mutationFn: signInWithPasskey,
    onSuccess: (signedIn) => {
      if (signedIn) return queryClient.invalidateQueries({ queryKey: ['auth'] });
    },
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    passkey.reset();
    if (mode === 'setup') {
      if (password.length < minLength) return setLocalError(`Use at least ${minLength} characters.`);
      if (password !== confirm) return setLocalError('The passwords don’t match.');
    }
    submit.mutate();
  };

  const error = localError ?? passkey.error?.message ?? submit.error?.message ?? null;
  const busy = submit.isPending || passkey.isPending;

  return (
    <main className="flex min-h-dvh items-center justify-center px-5 py-10">
      <form onSubmit={onSubmit} className="flex w-full max-w-sm flex-col gap-6" aria-describedby={error ? errorId : undefined}>
        <div className="flex flex-col items-center gap-3 text-center">
          <Logo className="size-14" />
          <h1 className="font-display text-3xl font-semibold tracking-tight">ProjectBench</h1>
          <p className="text-muted">
            {mode === 'setup'
              ? 'Choose a password. You’ll use it to sign in on your phone and computer.'
              : 'Sign in to your projects.'}
          </p>
        </div>

        <div className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-5">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={passwordId} className="text-sm font-semibold text-ink">
              {mode === 'setup' ? 'New password' : 'Password'}
            </label>
            <input
              id={passwordId}
              type="password"
              autoComplete={mode === 'setup' ? 'new-password' : 'current-password'}
              autoFocus
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-12 rounded-xl border border-line px-3.5 text-base outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
            {mode === 'setup' && <p className="text-xs text-muted">At least {minLength} characters.</p>}
          </div>

          {mode === 'setup' && (
            <div className="flex flex-col gap-1.5">
              <label htmlFor={confirmId} className="text-sm font-semibold text-ink">
                Repeat password
              </label>
              <input
                id={confirmId}
                type="password"
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="h-12 rounded-xl border border-line px-3.5 text-base outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
              />
            </div>
          )}

          {error && (
            <p id={errorId} role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm font-medium text-danger">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="h-12 rounded-xl bg-accent font-semibold text-white hover:bg-accent-strong disabled:opacity-60"
          >
            {submit.isPending ? 'One moment…' : mode === 'setup' ? 'Set password and continue' : 'Sign in'}
          </button>

          {mode === 'login' && offerPasskey && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setLocalError(null);
                submit.reset();
                passkey.mutate();
              }}
              className="h-12 rounded-xl border border-line-strong bg-surface font-semibold hover:bg-ground disabled:opacity-60"
            >
              {passkey.isPending ? 'Waiting for your device…' : 'Sign in with a passkey'}
            </button>
          )}
        </div>
      </form>
    </main>
  );
}
