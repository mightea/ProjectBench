import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { api, type AuthState } from './api.ts';
import { Logo } from './components/Logo.tsx';
import { clearOfflineData } from './lib/offline.ts';
import { AuthScreen } from './screens/AuthScreen.tsx';
import { Shell } from './screens/Shell.tsx';

export function App() {
  const queryClient = useQueryClient();
  const auth = useQuery({ queryKey: ['auth'], queryFn: () => api.get<AuthState>('/api/auth/state') });
  const signedOut = auth.data?.authenticated === false;

  useEffect(() => {
    if (signedOut) clearOfflineData(queryClient);
  }, [signedOut, queryClient]);

  // A cached session keeps the app readable while the server is out of reach.
  if (!auth.data) {
    if (!auth.isError && auth.fetchStatus !== 'paused') {
      return (
        <div className="flex min-h-dvh items-center justify-center" aria-busy="true">
          <Logo className="size-12 animate-pulse" />
        </div>
      );
    }
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-muted">Can’t reach the ProjectBench server.</p>
        <button
          type="button"
          onClick={() => auth.refetch()}
          className="h-11 rounded-xl bg-accent px-5 font-semibold text-white hover:bg-accent-strong"
        >
          Try again
        </button>
      </div>
    );
  }

  if (!auth.data.authenticated) {
    return <AuthScreen mode={auth.data.passwordSet ? 'login' : 'setup'} minLength={auth.data.minPasswordLength} />;
  }

  return <Shell />;
}
