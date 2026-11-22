import { useCallback, useSyncExternalStore } from 'react';

const subscribe = (cb: () => void) => {
  window.addEventListener('popstate', cb);
  return () => window.removeEventListener('popstate', cb);
};

/** Minimal path-based routing; enough until the app needs nested routes. */
export function useRoute() {
  const path = useSyncExternalStore(subscribe, () => window.location.pathname);
  const navigate = useCallback((to: string) => {
    if (to === window.location.pathname) return;
    window.history.pushState(null, '', to);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, []);
  return { path, navigate };
}
