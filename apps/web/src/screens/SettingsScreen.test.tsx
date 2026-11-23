import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsScreen } from './SettingsScreen.tsx';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

const existing = {
  id: 't1',
  name: 'Laptop',
  prefix: 'pb_abcdefgh',
  createdAt: '2026-11-22T10:00:00Z',
  lastUsedAt: null,
  revokedAt: null,
};

function renderScreen() {
  const calls: { method: string; url: string }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const url = String(input);
      calls.push({ method, url });
      if (method === 'POST') return json({ ...existing, id: 't2', name: 'Phone', token: 'pb_secret-value' }, 201);
      if (method === 'DELETE') return new Response(null, { status: 204 });
      return json([existing]);
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <SettingsScreen onLogout={() => {}} />
    </QueryClientProvider>,
  );
  return calls;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('SettingsScreen', () => {
  it('shows a new token once and hides it after Done', async () => {
    renderScreen();
    await screen.findByText('Laptop');
    fireEvent.change(screen.getByLabelText('New token name'), { target: { value: 'Phone' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    const panel = await screen.findByRole('region', { name: 'New token' });
    expect(within(panel).getByText('pb_secret-value')).toBeTruthy();
    expect(within(panel).getByText(/claude mcp add --transport http/)).toBeTruthy();

    fireEvent.click(within(panel).getByRole('button', { name: 'Done' }));
    expect(screen.queryByText('pb_secret-value')).toBeNull();
  });

  it('asks before revoking', async () => {
    const calls = renderScreen();
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke Laptop' }));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm revoking Laptop' }));
    await waitFor(() => expect(calls).toContainEqual({ method: 'DELETE', url: '/api/tokens/t1' }));
  });
});
