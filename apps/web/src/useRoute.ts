import { useCallback, useSyncExternalStore } from 'react';

const subscribe = (cb: () => void) => {
  window.addEventListener('popstate', cb);
  return () => window.removeEventListener('popstate', cb);
};

/** Minimal path-based routing; enough until the app needs nested routes. */
export function useRoute() {
  const path = useSyncExternalStore(subscribe, () => window.location.pathname);
  const navigate = useCallback((to: string) => {
    if (to === window.location.pathname + window.location.search) return;
    window.history.pushState(null, '', to);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, []);
  return { path, navigate };
}

/** The tag filter of the current screen, kept in the URL so it survives reloads and Back. */
export function useTagFilter(): [string | null, (tag: string | null) => void] {
  const search = useSyncExternalStore(subscribe, () => window.location.search);
  const tag = new URLSearchParams(search).get('tag');
  const setTag = useCallback((next: string | null) => {
    const params = new URLSearchParams(window.location.search);
    if (next) params.set('tag', next);
    else params.delete('tag');
    const query = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, []);
  return [tag, setTag];
}
