import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App.tsx';

function renderWithState(state: object) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(state), { status: 200, headers: { 'content-type': 'application/json' } })),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('App', () => {
  it('asks for a new password on first start', async () => {
    renderWithState({ passwordSet: false, authenticated: false, minPasswordLength: 10 });
    expect(await screen.findByLabelText('New password')).toBeTruthy();
    expect(screen.getByLabelText('Repeat password')).toBeTruthy();
  });

  it('shows the sign-in form when a password exists', async () => {
    renderWithState({ passwordSet: true, authenticated: false, minPasswordLength: 10 });
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeTruthy();
  });

  it('shows the app with its tabs when signed in', async () => {
    renderWithState({ passwordSet: true, authenticated: true, minPasswordLength: 10 });
    expect(await screen.findByRole('heading', { name: 'Today' })).toBeTruthy();
    expect(screen.getAllByRole('link', { name: 'Projects' }).length).toBeGreaterThan(0);
  });
});
