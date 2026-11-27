import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createApiToken, getProject, openDb, revokeApiToken, schema, type Db } from '@projectbench/core';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app.ts';

let close: () => void;
let db: Db;
let app: ReturnType<typeof createApp>;
let token: string;
let tokenId: string;
let client: Client;

const appFetch = ((input: string | URL | Request, init?: RequestInit) =>
  app.fetch(new Request(input, init))) as typeof fetch;

type ToolResult = { isError?: boolean; content: { type: string; text: string }[] };

async function tool(name: string, args: Record<string, unknown> = {}) {
  const result = (await client.callTool({ name, arguments: args })) as ToolResult;
  return { isError: result.isError ?? false, text: result.content[0]!.text };
}
const data = async <T = any>(name: string, args: Record<string, unknown> = {}) => {
  const result = await tool(name, args);
  expect(result.isError, result.text).toBe(false);
  return JSON.parse(result.text) as T;
};

beforeEach(async () => {
  const handle = openDb({ filename: ':memory:' });
  close = handle.close;
  db = handle.db;
  app = createApp({ db, config: { secureCookies: false, webDist: '/nonexistent' } });
  const created = createApiToken({ db, actor: 'app' }, { name: 'test' });
  token = created.token;
  tokenId = created.id;
  client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL('http://localhost/mcp'), {
      fetch: appFetch,
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
});
afterEach(async () => {
  await client.close();
  close();
});

const rpc = (headers: Record<string, string>) =>
  app.request('/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });

describe('MCP auth', () => {
  it('rejects missing, wrong and revoked tokens', async () => {
    expect((await rpc({})).status).toBe(401);
    expect((await rpc({ authorization: 'Bearer pb_wrong' })).status).toBe(401);
    expect((await rpc({ authorization: `Bearer ${token}` })).status).toBe(200);
    revokeApiToken({ db, actor: 'app' }, tokenId);
    expect((await rpc({ authorization: `Bearer ${token}` })).status).toBe(401);
  });

  it('does not accept a session cookie', async () => {
    const setup = await app.request('/api/auth/setup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'workbench-2026' }),
    });
    const cookie = setup.headers.get('set-cookie')!.split(';')[0]!;
    expect((await rpc({ cookie })).status).toBe(401);
  });

  it('answers GET and DELETE with 405 for a valid token', async () => {
    for (const method of ['GET', 'DELETE']) {
      const res = await app.request('/mcp', { method, headers: { authorization: `Bearer ${token}` } });
      expect(res.status).toBe(405);
    }
  });
});

describe('MCP tools', () => {
  it('exposes the planned tools and nothing destructive', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        'add_attachment',
        'add_items',
        'add_note',
        'agenda',
        'create_project',
        'get_attachment',
        'get_project',
        'list_projects',
        'open_questions',
        'search',
        'set_item_links',
        'shopping_list',
        'update_item',
        'update_project',
      ].sort(),
    );
    expect(tools.filter((t) => /delete/i.test(t.name))).toEqual([]);
  });

  it('answers "what do I still need to buy" after a full workflow', async () => {
    await tool('create_project', {
      title: 'Rack tray',
      priority: 1,
      tags: ['homelab'],
      checklists: [{ kind: 'clarify', items: [{ text: 'Which depth fits?' }] }],
    });
    const added = await data('add_items', {
      project: 'rack tra',
      checklist: 'buy',
      items: [
        { text: 'Noctua fan', quantity: 2, links: [{ url: 'https://www.galaxus.ch/fan', price: 24.9 }] },
        { text: 'M3 screws' },
      ],
    });
    expect(added.checklist.created).toBe(true);
    expect(added.checklist.title).toBe('To buy');
    const [fan, screws] = added.items;

    await data('update_item', { item_id: fan.id, state: 'ordered', order_ref: 'A-123', expected_date: '2099-01-02' });
    await data('set_item_links', { item_id: screws.id, add: [{ url: 'https://example.com/screws', shop: 'Bolts' }] });

    const open = await data<any[]>('shopping_list', { state: 'open' });
    expect(open.map((i) => i.text)).toEqual(['M3 screws']);
    const ordered = await data<any[]>('shopping_list', { state: 'ordered', project: 'Rack tray' });
    expect(ordered[0]).toMatchObject({ text: 'Noctua fan', order_ref: 'A-123', shop: 'galaxus.ch', price: 24.9 });

    const questions = await data<any[]>('open_questions');
    expect(questions.map((q) => q.text)).toEqual(['Which depth fits?']);

    await data('add_note', { project: 'Rack tray', body: 'Decided on 2U depth' });
    const hits = await data<any[]>('search', { query: 'depth' });
    expect(hits.map((h) => h.entity).sort()).toEqual(['item', 'note']);

    const markdown = await tool('get_project', { project: 'rack tray' });
    expect(markdown.text).toContain('# Rack tray');
    expect(markdown.text).toContain('[~] 2 × Noctua fan');
    expect(markdown.text).toContain('Decided on 2U depth');

    const activity = db.select().from(schema.activity).all().filter((a) => a.entity !== 'token');
    expect(activity.length).toBeGreaterThan(0);
    expect(activity.every((a) => a.actor === 'mcp')).toBe(true);
    const note = db.select().from(schema.notes).where(eq(schema.notes.body, 'Decided on 2U depth')).get();
    expect(note?.source).toBe('mcp');
  });

  it('lists candidates for an ambiguous title instead of guessing', async () => {
    await tool('create_project', { title: 'Rack tray' });
    await tool('create_project', { title: 'Rack fan controller' });
    const result = await tool('get_project', { project: 'rack' });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('Rack tray');
    expect(result.text).toContain('Rack fan controller');
  });

  it('reports business rule errors as tool errors', async () => {
    await tool('create_project', { title: 'Shelf' });
    const added = await data('add_items', { project: 'Shelf', checklist: 'todo', items: [{ text: 'Sand it' }] });
    const result = await tool('update_item', { item_id: added.items[0].id, state: 'ordered' });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('buy list');
  });

  it('rolls back a project when a starter item is invalid', async () => {
    const result = await tool('create_project', {
      title: 'Broken',
      checklists: [{ kind: 'buy', items: [{ text: 'Fan', links: [{ url: 'not-a-url' }] }] }],
    });
    expect(result.isError).toBe(true);
    expect(db.select().from(schema.projects).all()).toEqual([]);
  });

  it('archives through update_project and hides the project from open lists', async () => {
    const created = await tool('create_project', { title: 'Old idea' });
    const id = created.text.match(/ID: (\S+)/)![1]!;
    await tool('update_project', { project: 'Old idea', status: 'archived', due_date: '2030-01-01' });
    expect(getProject({ db, actor: 'mcp' }, id)).toMatchObject({ status: 'archived', dueDate: '2030-01-01' });
    expect(await data('list_projects')).toEqual([]);
  });

  it('sets and clears a project color and icon through update_project', async () => {
    const created = await tool('create_project', { title: 'Bench light' });
    const id = created.text.match(/ID: (\S+)/)![1]!;
    await tool('update_project', { project: id, color: 'amber', icon: 'light' });
    expect(getProject({ db, actor: 'mcp' }, id)).toMatchObject({ color: 'amber', icon: 'light' });
    await tool('update_project', { project: id, color: null, icon: null });
    expect(getProject({ db, actor: 'mcp' }, id)).toMatchObject({ color: null, icon: null });
  });

  it('builds an agenda', async () => {
    await tool('create_project', { title: 'Late', priority: 1, due_date: '2000-01-01' });
    const result = await data('agenda', { days: 3 });
    expect(result.overdue_projects.map((p: { title: string }) => p.title)).toEqual(['Late']);
    expect(result.urgent_projects).toHaveLength(1);
  });
});

describe('token API', () => {
  it('needs a session and never returns the token again', async () => {
    expect((await app.request('/api/tokens')).status).toBe(401);
    const setup = await app.request('/api/auth/setup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'workbench-2026' }),
    });
    const cookie = setup.headers.get('set-cookie')!.split(';')[0]!;
    const headers = { cookie, 'content-type': 'application/json' };
    const created = await app.request('/api/tokens', { method: 'POST', headers, body: JSON.stringify({ name: 'Phone' }) });
    expect(created.status).toBe(201);
    const body = (await created.json()) as { id: string; token: string };
    expect(body.token).toMatch(/^pb_/);

    const listed = await (await app.request('/api/tokens', { headers })).text();
    expect(listed).not.toContain(body.token);
    expect(listed).not.toContain('tokenHash');

    const revoked = await app.request(`/api/tokens/${body.id}`, { method: 'DELETE', headers });
    expect(revoked.status).toBe(200);
    expect((await rpc({ authorization: `Bearer ${body.token}` })).status).toBe(401);
  });
});

describe('sub-projects', () => {
  it('creates, lists, shows and detaches a sub-project', async () => {
    await tool('create_project', { title: 'Motometer', tags: ['moto'] });
    const created = await tool('create_project', { title: 'First test PCB', parent: 'motometer', checklists: [{ kind: 'buy' }] });
    expect(created.isError, created.text).toBe(false);
    expect(created.text).toContain('Sub-project of: Motometer');

    const subs = await data<{ title: string; parent: { title: string }; tags: string[] }[]>('list_projects', { parent: 'Motometer' });
    expect(subs).toEqual([expect.objectContaining({ title: 'First test PCB', parent: expect.objectContaining({ title: 'Motometer' }), tags: ['moto'] })]);

    const parent = await tool('get_project', { project: 'Motometer' });
    expect(parent.text).toContain('## Sub-projects');
    expect(parent.text).toContain('First test PCB');

    const nested = await tool('create_project', { title: 'Too deep', parent: 'First test PCB' });
    expect(nested.isError).toBe(true);

    const detached = await tool('update_project', { project: 'First test PCB', parent: null });
    expect(detached.text).not.toContain('Sub-project of');
  });
});
