import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App.tsx';
import { setServerReachable } from './lib/connection.ts';
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
  icon: null,
  coverAttachmentId: null,
  tags: ['homelab'],
  progress: { total: 2, done: 0, ordered: 1 },
  kinds: { buy: { total: 2, done: 0, ordered: 1 }, clarify: { total: 0, done: 0, ordered: 0 }, todo: { total: 0, done: 0, ordered: 0 } },
  nextStep: null,
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

const emptyAgenda = {
  today: '2026-11-23',
  until: '2026-11-30',
  overdueItems: [],
  upcomingItems: [],
  lateDeliveries: [],
  upcomingDeliveries: [],
  overdueProjects: [],
  upcomingProjects: [],
  urgentProjects: [],
  openQuestions: [],
};
const emptyBuy = { byShop: [], byProject: [], ordered: [] };

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

  it('opens on Today with overdue items and urgent projects', async () => {
    const overdue = { ...project.checklists[0]!.items[0]!, dueDate: '2020-01-01', projectId: 'p1', projectTitle: project.title, checklistTitle: 'To buy', checklistKind: 'buy' };
    renderApp(signedIn, {
      '/api/agenda': { ...emptyAgenda, overdueItems: [overdue], urgentProjects: [project] },
      '/api/buy': emptyBuy,
    });
    expect(await screen.findByRole('heading', { name: 'Today' })).toBeTruthy();
    expect(await screen.findByRole('link', { name: 'Noctua NF-A4x20 PWM' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Mark as ordered: Noctua NF-A4x20 PWM' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Urgent projects' })).toBeTruthy();
    expect(window.location.pathname).toBe('/today');
  });

  it('shows the projects list', async () => {
    renderApp(signedIn, { '/api/projects': [project] }, '/projects');
    expect(await screen.findByRole('heading', { name: 'Projects', level: 1 })).toBeTruthy();
    expect(await within(await screen.findByRole('main')).findByText('Rack fan controller')).toBeTruthy();
    expect(within(screen.getByRole('main')).getByRole('heading', { name: 'Active · 1' })).toBeTruthy();
    expect(within(screen.getByRole('main')).getByText('1 on the way')).toBeTruthy();
  });

  it('shows a shop basket with its total and opens the mark ordered sheet', async () => {
    const item = { ...project.checklists[0]!.items[0]!, projectId: 'p1', projectTitle: project.title, checklistTitle: 'To buy', checklistKind: 'buy' };
    renderApp(
      signedIn,
      {
        '/api/buy': {
          byShop: [{ key: 'galaxus.ch', name: 'galaxus.ch', items: [item], totals: [{ currency: 'CHF', amount: 63.6 }], unpriced: 0 }],
          byProject: [{ key: 'p1', name: project.title, items: [item], totals: [{ currency: 'CHF', amount: 63.6 }], unpriced: 0 }],
          ordered: [],
        },
      },
      '/buy',
    );
    const shop = await screen.findByRole('region', { name: 'galaxus.ch' });
    expect(within(shop).getAllByText('CHF 63.60').length).toBeGreaterThan(0);
    fireEvent.click(within(shop).getByRole('button', { name: 'Mark ordered…' }));
    expect(await screen.findByRole('dialog', { name: 'Ordered at galaxus.ch' })).toBeTruthy();
  });

  it('groups search results by type', async () => {
    renderApp(
      signedIn,
      { '/api/search': [{ entity: 'note', entityId: 'n1', projectId: 'p1', projectTitle: project.title, tags: [], title: '', snippet: 'Fan header pinout' }] },
      '/search',
    );
    fireEvent.change(await screen.findByRole('searchbox'), { target: { value: 'pinout' } });
    const notes = await screen.findByRole('region', { name: 'Notes' }, { timeout: 2000 });
    expect(within(notes).getByRole('link', { name: /Fan header pinout/ }).getAttribute('href')).toBe('/projects/p1');
  });

  it('keeps showing cached data when the server is out of reach', async () => {
    window.history.replaceState(null, '', '/today');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['auth'], signedIn);
    client.setQueryData(['agenda'], { ...emptyAgenda, urgentProjects: [project] });
    client.setQueryData(['buy'], emptyBuy);
    render(
      <QueryClientProvider client={client}>
        <App />
      </QueryClientProvider>,
    );
    expect(await screen.findByText(/reading the saved copy/)).toBeTruthy();
    expect(screen.getByText('Rack fan controller')).toBeTruthy();
    setServerReachable(true);
  });

  it('removes cached data once signed out', async () => {
    window.history.replaceState(null, '', '/');
    vi.stubGlobal('fetch', vi.fn(async () => json({ passwordSet: true, authenticated: false, minPasswordLength: 10 })));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['project', 'p1'], project);
    render(
      <QueryClientProvider client={client}>
        <App />
      </QueryClientProvider>,
    );
    await screen.findByRole('button', { name: 'Sign in' });
    await waitFor(() => expect(client.getQueryData(['project', 'p1'])).toBeUndefined());
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
    expect(within(list).getByRole('button', { name: 'Mark as ordered: Noctua NF-A4x20 PWM' })).toBeTruthy();
    expect(within(list).queryByText('JST-XH kit')).toBeNull();
    fireEvent.click(within(list).getByRole('button', { name: /1 on the way/ }));
    expect(within(list).getByText(/ordered .*#8142 · no ETA/)).toBeTruthy();
    expect(within(list).getByRole('button', { name: 'Mark as received: JST-XH kit' })).toBeTruthy();
  });

  it('edits due date and tags from the edit project sheet', async () => {
    renderApp(signedIn, { '/api/projects/p1': project, '/api/tags': [{ name: 'homelab', projects: 1 }] }, '/projects/p1');
    fireEvent.click(await screen.findByRole('button', { name: 'Edit project' }));
    const sheet = await screen.findByRole('dialog', { name: 'Edit project' });
    const patches = () =>
      vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'PATCH').map(([, init]) => JSON.parse(String(init!.body)));
    fireEvent.change(within(sheet).getByLabelText('Due date'), { target: { value: '2027-03-01' } });
    const tags = within(sheet).getByLabelText(/^Tags/);
    fireEvent.change(tags, { target: { value: 'Rack Parts' } });
    fireEvent.keyDown(tags, { key: 'Enter' });
    expect(patches()).toEqual([]);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(patches()).toContainEqual(expect.objectContaining({ dueDate: '2027-03-01', tags: ['homelab', 'rack-parts'] })));
  });

  it('filters projects by the tag in the URL', async () => {
    renderApp(signedIn, { '/api/projects': [project], '/api/tags': [{ name: 'homelab', projects: 1 }] }, '/projects?tag=homelab');
    await within(await screen.findByRole('main')).findByText('Rack fan controller');
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('/api/projects?') && String(url).includes('tag=homelab'))).toBe(true);
    expect((await screen.findByRole('button', { name: '#homelab' })).getAttribute('aria-pressed')).toBe('true');
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
