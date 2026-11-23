import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import type { QueryClient } from '@tanstack/react-query';
import type { PersistQueryClientOptions } from '@tanstack/react-query-persist-client';
import { del, get, set } from 'idb-keyval';

const MAX_AGE = 30 * 24 * 60 * 60 * 1000;
/** Raise when the shape of cached API responses changes. */
const CACHE_VERSION = '1';
/** Also named in the service worker's runtime caching in vite.config.ts. */
export const THUMBNAIL_CACHE = 'projectbench-thumbnails';

/** Read views kept on the device. API tokens and search results are never stored. */
const OFFLINE_QUERIES = new Set(['auth', 'projects', 'project', 'tags', 'agenda', 'buy']);

/**
 * Must outlive MAX_AGE, or restored queries are dropped. Infinity sets no timer: a finite value
 * above 2^31 - 1 ms (24.8 days) overflows setTimeout and collects the query immediately.
 */
export const CACHE_GC_TIME = Number.POSITIVE_INFINITY;

export const persistOptions: Omit<PersistQueryClientOptions, 'queryClient'> = {
  persister: createAsyncStoragePersister({
    key: 'projectbench-cache',
    storage: { getItem: async (key) => (await get<string>(key)) ?? null, setItem: (key, value) => set(key, value), removeItem: (key) => del(key) },
  }),
  maxAge: MAX_AGE,
  buster: CACHE_VERSION,
  dehydrateOptions: {
    // A failed refresh must not drop data that is still good to read.
    shouldDehydrateQuery: (query) => query.state.data !== undefined && OFFLINE_QUERIES.has(String(query.queryKey[0])),
  },
};

/** Removes everything readable from this device once the session has ended. */
export function clearOfflineData(queryClient: QueryClient) {
  queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'auth' });
  if ('caches' in window) void caches.delete(THUMBNAIL_CACHE);
}
