import { QueryClient } from '@tanstack/react-query';
import { persistQueryClientRestore, persistQueryClientSave, type PersistedClient, type Persister } from '@tanstack/react-query-persist-client';
import { describe, expect, it, vi } from 'vitest';
import { CACHE_GC_TIME, persistOptions } from './offline.ts';

function memoryPersister(): Persister {
  let stored: PersistedClient | undefined;
  return {
    persistClient: (client) => {
      stored = JSON.parse(JSON.stringify(client)) as PersistedClient;
    },
    restoreClient: () => stored,
    removeClient: () => {
      stored = undefined;
    },
  };
}

const newClient = () => new QueryClient({ defaultOptions: { queries: { gcTime: CACHE_GC_TIME, retry: false } } });

describe('offline cache', () => {
  it('keeps restored queries past the garbage collection timer', async () => {
    vi.useFakeTimers();
    try {
      const persister = memoryPersister();
      const options = { ...persistOptions, persister };
      const before = newClient();
      before.setQueryData(['project', 'p1'], { title: 'Rack' });
      await persistQueryClientSave({ ...options, queryClient: before });

      const after = newClient();
      await persistQueryClientRestore({ ...options, queryClient: after });
      await vi.advanceTimersByTimeAsync(1000);
      expect(after.getQueryData(['project', 'p1'])).toEqual({ title: 'Rack' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('stores read views but never API tokens or search results', async () => {
    const persister = memoryPersister();
    const client = newClient();
    client.setQueryData(['agenda'], { today: '2026-11-23' });
    client.setQueryData(['tokens'], [{ id: 't1' }]);
    client.setQueryData(['search', 'rack'], []);
    await persistQueryClientSave({ ...persistOptions, persister, queryClient: client });

    const saved = (await persister.restoreClient())!;
    expect(saved.clientState.queries.map((q) => q.queryKey[0])).toEqual(['agenda']);
  });
});
