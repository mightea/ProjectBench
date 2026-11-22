import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App.tsx';
import { parseItemLine } from './project/ChecklistCard.tsx';
import { nextState } from './project/ItemRow.tsx';

const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });

function renderApp(auth: object, routes: Record<string, unknown> = {}, path = '/') {
  window.history.replaceState(null, '', path);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/auth/state')) return json(auth);
      const match = Object.keys(routes).find((r) => url.startsWith(r));
      return json(match ? routes[match] : []);
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>,
  );
}

const signedIn = { passwordSet: true, authenticated: true, minPasswordLength: 10 };

const project = {
  id: 'p1',
  title: 'Rack fan controller',
  status: 'active',
  priority: 1,
  dueDate: null,
  color: null,
  tags: ['homelab'],
  progress: { total: 2, done: 1, ordered: 1 },
  nextItemDue: null,
  updatedAt: '2026-11-22T10:00:00Z',
  description: null,
  startDate: null,
  completedAt: null,
  createdAt: '2026-11-22T10:00:00Z',
  checklists: [
    {
      id: 'c1',
      title: 'To buy',
      kind: 'buy',
      items: [
        {
          id: 'i1',
          checklistId: 'c1',
          text: 'Noctua NF-A4x20 PWM',
          state: 'open',
          orderedAt: null,
          orderRef: null,
          expectedDate: null,
          doneAt: null,
          dueDate: null,
          quantity: 4,
          unit: null,
          note: null,
          links: [{ id: 'l1', url: 'https://www.galaxus.ch/p/1', shop: 'galaxus.ch', price: 15.9, currency: 'CHF', note: null, preferred: true }],
        },
        {
          id: 'i2',
          checklistId: 'c1',
          text: 'JST-XH kit',
          state: 'ordered',
          orderedAt: '2026-11-18T10:00:00Z',
          orderRef: '8142',
          expectedDate: null,
          doneAt: null,
          dueDate: null,
          quantity: null,
          unit: null,
          note: null,
          links: [],
        },
      ],
    },
  ],
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('App', () => {
  it('asks for a new password on first start', async () => {
    renderApp({ passwordSet: false, authenticated: false, minPasswordLength: 10 });
    expect(await screen.findByLabelText('New password')).toBeTruthy();
    expect(screen.getByLabelText('Repeat password')).toBeTruthy();
  });

  it('shows the sign-in form when a password exists', async () => {
    renderApp({ passwordSet: true, authenticated: false, minPasswordLength: 10 });
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeTruthy();
  });

  it('opens on the projects list', async () => {
    renderApp(signedIn, { '/api/projects': [project] });
    expect(await screen.findByRole('heading', { name: 'Projects' })).toBeTruthy();
    expect(await screen.findByText('Rack fan controller')).toBeTruthy();
    expect(window.location.pathname).toBe('/projects');
  });

  it('offers to create the first project when the list is empty', async () => {
    renderApp(signedIn, { '/api/projects': [] }, '/projects');
    expect(await screen.findByText('No projects yet')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'New project' })[0]!);
    expect(await screen.findByRole('dialog', { name: 'New project' })).toBeTruthy();
  });

  it('shows a project with its buy list, links and ordered items', async () => {
    renderApp(signedIn, { '/api/projects/p1': project }, '/projects/p1');
    expect(await screen.findByRole('heading', { name: 'Rack fan controller' })).toBeTruthy();
    const list = screen.getByRole('region', { name: 'To buy' });
    expect(within(list).getByText('Noctua NF-A4x20 PWM')).toBeTruthy();
    expect(within(list).getByRole('link', { name: /galaxus\.ch/ }).getAttribute('href')).toBe('https://www.galaxus.ch/p/1');
    expect(within(list).getByText('Ordered · #8142')).toBeTruthy();
    expect(within(list).getByRole('button', { name: 'Mark as ordered: Noctua NF-A4x20 PWM' })).toBeTruthy();
    expect(within(list).getByRole('button', { name: 'Mark as received: JST-XH kit' })).toBeTruthy();
  });
});

describe('helpers', () => {
  it('parses quantities from item lines', () => {
    expect(parseItemLine('3x M3 screw')).toEqual({ text: 'M3 screw', quantity: 3 });
    expect(parseItemLine('- [ ] 2.5 × wire')).toEqual({ text: 'wire', quantity: 2.5 });
    expect(parseItemLine('ESP32-C3')).toEqual({ text: 'ESP32-C3' });
    expect(parseItemLine('   ')).toBeNull();
  });

  it('cycles item states by checklist kind', () => {
    expect(nextState('buy', 'open')).toBe('ordered');
    expect(nextState('buy', 'ordered')).toBe('done');
    expect(nextState('buy', 'done')).toBe('open');
    expect(nextState('todo', 'open')).toBe('done');
    expect(nextState('clarify', 'done')).toBe('open');
  });
});
