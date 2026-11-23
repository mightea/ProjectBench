import { useSyncExternalStore } from 'react';

/** False after a request got no answer, for example when the home server is out of reach. */
let reachable = true;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

export function setServerReachable(value: boolean) {
  if (value === reachable) return;
  reachable = value;
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener('online', listener);
  window.addEventListener('offline', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('online', listener);
    window.removeEventListener('offline', listener);
  };
}

/** True when the device has no network or the server doesn't answer. */
export function useOffline(): boolean {
  return useSyncExternalStore(subscribe, () => !navigator.onLine || !reachable);
}
