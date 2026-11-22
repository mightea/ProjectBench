import { useQuery } from '@tanstack/react-query';
import { api, type AuthState } from './api.ts';
import { Logo } from './components/Logo.tsx';
import { AuthScreen } from './screens/AuthScreen.tsx';
import { Shell } from './screens/Shell.tsx';

export function App() {
  const auth = useQuery({ queryKey: ['auth'], queryFn: () => api.get<AuthState>('/api/auth/state') });

  if (auth.isPending) {
    return (
      <div className="flex min-h-dvh items-center justify-center" aria-busy="true">
        <Logo className="size-12 animate-pulse" />
      </div>
    );
  }

  if (auth.isError) {
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
