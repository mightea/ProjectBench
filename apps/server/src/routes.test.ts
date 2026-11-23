import { openDb } from '@projectbench/core';
import type { ChecklistItem, ProjectDetail, ProjectSummary } from '@projectbench/core/schemas';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp, SESSION_COOKIE } from './app.ts';

let close: () => void;
let app: ReturnType<typeof createApp>;
let cookie = '';

beforeEach(async () => {
  const handle = openDb({ filename: ':memory:' });
  close = handle.close;
  app = createApp({ db: handle.db, config: { secureCookies: false, webDist: '/nonexistent' } });
  const res = await app.request('/api/auth/setup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'workbench-2026' }),
  });
  cookie = `${SESSION_COOKIE}=${res.headers.get('set-cookie')!.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))![1]}`;
});
afterEach(() => close());

async function call<T = unknown>(method: string, path: string, payload?: unknown): Promise<{ status: number; data: T }> {
  const res = await app.request(path, {
    method,
    headers: { cookie, 'content-type': 'application/json' },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const text = await res.text();
  return { status: res.status, data: (text ? JSON.parse(text) : null) as T };
}

describe('REST API', () => {
  it('requires a session', async () => {
    const res = await app.request('/api/projects');
    expect(res.status).toBe(401);
  });

  it('runs through a project with a buy list', async () => {
    const created = await call<ProjectDetail>('POST', '/api/projects', { title: 'Rack fan controller', priority: 1, tags: ['homelab'] });
    expect(created.status).toBe(201);
    const id = created.data.id;

    const list = await call<{ id: string }>('POST', `/api/projects/${id}/checklists`, { title: 'To buy', kind: 'buy' });
    expect(list.status).toBe(201);

    const single = await call<ChecklistItem[]>('POST', `/api/checklists/${list.data.id}/items`, {
      text: 'Noctua NF-A4x20 PWM',
      quantity: 4,
      links: [{ url: 'https://www.galaxus.ch/p/1', price: 15.9 }],
    });
    expect(single.status).toBe(201);
    expect(single.data[0]!.links[0]!.shop).toBe('galaxus.ch');

    const many = await call<ChecklistItem[]>('POST', `/api/checklists/${list.data.id}/items`, {
      items: [{ text: 'JST-XH kit' }, { text: 'ESP32-C3', quantity: 2 }],
    });
    expect(many.data).toHaveLength(2);

    const ordered = await call<ChecklistItem>('PATCH', `/api/items/${many.data[0]!.id}`, { state: 'ordered', orderRef: '8142' });
    expect(ordered.data).toMatchObject({ state: 'ordered', orderRef: '8142' });

    const link = await call('POST', `/api/items/${many.data[0]!.id}/links`, { url: 'https://www.aliexpress.com/item/1' });
    expect(link.status).toBe(201);

    const detail = await call<ProjectDetail>('GET', `/api/projects/${id}`);
    expect(detail.data.progress).toEqual({ total: 3, done: 0, ordered: 1 });
    expect(detail.data.checklists[0]!.items.map((i) => i.text)).toEqual(['Noctua NF-A4x20 PWM', 'JST-XH kit', 'ESP32-C3']);

    const listed = await call<ProjectSummary[]>('GET', '/api/projects?tag=homelab');
    expect(listed.data.map((p) => p.title)).toEqual(['Rack fan controller']);

    const tags = await call('GET', '/api/tags');
    expect(tags.data).toEqual([{ name: 'homelab', projects: 1 }]);

    expect((await call('DELETE', `/api/projects/${id}`)).status).toBe(204);
    expect((await call('GET', `/api/projects/${id}`)).status).toBe(404);
  });

  it('reports validation and state errors', async () => {
    const bad = await call<{ error: string; issues: unknown[] }>('POST', '/api/projects', { title: '' });
    expect(bad.status).toBe(400);
    expect(bad.data.issues.length).toBeGreaterThan(0);

    expect((await call('GET', '/api/projects?status=nonsense')).status).toBe(400);

    const p = await call<ProjectDetail>('POST', '/api/projects', { title: 'P' });
    const todo = await call<{ id: string }>('POST', `/api/projects/${p.data.id}/checklists`, { title: 'To do' });
    const items = await call<ChecklistItem[]>('POST', `/api/checklists/${todo.data.id}/items`, { text: 'Flash firmware' });
    const conflict = await call('PATCH', `/api/items/${items.data[0]!.id}`, { state: 'ordered' });
    expect(conflict.status).toBe(409);

    expect((await call('PATCH', '/api/items/does-not-exist', { text: 'x' })).status).toBe(404);
    expect((await call('POST', `/api/items/${items.data[0]!.id}/links`, { url: 'javascript:alert(1)' })).status).toBe(400);
  });
});
