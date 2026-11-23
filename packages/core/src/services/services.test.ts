import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../db.ts';
import { InvalidOperationError, NotFoundError } from '../errors.ts';
import { createChecklist, deleteChecklist, findChecklist, updateChecklist } from './checklists.ts';
import type { ServiceContext } from './context.ts';
import { addItems, deleteItem, updateItem } from './items.ts';
import { addLink, deleteLink, shopFromUrl, updateLink } from './links.ts';
import { createProject, deleteProject, getProject, listProjects, updateProject } from './projects.ts';
import { listTags } from './tags.ts';

let ctx: ServiceContext;
let close: () => void;
let sqlite: ReturnType<typeof openDb>['sqlite'];
let clock: Date;

beforeEach(() => {
  const handle = openDb({ filename: ':memory:' });
  close = handle.close;
  sqlite = handle.sqlite;
  clock = new Date('2026-11-22T10:00:00Z');
  ctx = { db: handle.db, actor: 'app', now: () => clock };
});
afterEach(() => close());

const tick = (minutes = 1) => {
  clock = new Date(clock.getTime() + minutes * 60_000);
};

const search = (term: string) =>
  sqlite.prepare('select entity, entity_id as id from search where search match ?').all(term) as {
    entity: string;
    id: string;
  }[];

describe('projects', () => {
  it('creates a project with defaults, tags and search entry', () => {
    const p = createProject(ctx, { title: '  Rack fan controller ', tags: ['Homelab', '#electronics', 'homelab'] });
    expect(p).toMatchObject({ title: 'Rack fan controller', status: 'planned', priority: 3, dueDate: null });
    expect(p.tags).toEqual(['electronics', 'homelab']);
    expect(p.progress).toEqual({ total: 0, done: 0, ordered: 0 });
    expect(search('rack')).toEqual([{ entity: 'project', id: p.id }]);
    expect(listTags(ctx.db)).toEqual([
      { name: 'electronics', projects: 1 },
      { name: 'homelab', projects: 1 },
    ]);
  });

  it('rejects invalid input', () => {
    expect(() => createProject(ctx, { title: '' })).toThrow();
    expect(() => createProject(ctx, { title: 'x', priority: 7 })).toThrow();
    expect(() => createProject(ctx, { title: 'x', dueDate: '30.11.2026' })).toThrow();
  });

  it('lists open projects sorted by priority, then manual order', () => {
    const a = createProject(ctx, { title: 'A', priority: 2 });
    const b = createProject(ctx, { title: 'B', priority: 1 });
    const c = createProject(ctx, { title: 'C', priority: 2 });
    createProject(ctx, { title: 'Done one', status: 'done' });
    expect(listProjects(ctx).map((p) => p.title)).toEqual(['B', 'A', 'C']);

    updateProject(ctx, c.id, { position: 0 });
    expect(listProjects(ctx).map((p) => p.id)).toEqual([b.id, c.id, a.id]);

    expect(listProjects(ctx, { status: 'done' }).map((p) => p.title)).toEqual(['Done one']);
    expect(listProjects(ctx, { status: 'all' })).toHaveLength(4);
  });

  it('sorts by due date with undated projects last', () => {
    createProject(ctx, { title: 'No date' });
    createProject(ctx, { title: 'Later', dueDate: '2026-12-15' });
    createProject(ctx, { title: 'Soon', dueDate: '2026-11-30' });
    expect(listProjects(ctx, { sort: 'due' }).map((p) => p.title)).toEqual(['Soon', 'Later', 'No date']);
  });

  it('filters by tag and title', () => {
    createProject(ctx, { title: 'Rack tray', tags: ['homelab', '3d-printing'] });
    createProject(ctx, { title: 'BMW winter service', tags: ['motorcycle'] });
    createProject(ctx, { title: '100% done_ish' });
    expect(listProjects(ctx, { tag: 'homelab' }).map((p) => p.title)).toEqual(['Rack tray']);
    expect(listProjects(ctx, { q: 'bmw' }).map((p) => p.title)).toEqual(['BMW winter service']);
    expect(listProjects(ctx, { q: '%' }).map((p) => p.title)).toEqual(['100% done_ish']);
  });

  it('updates fields, completion time and tags', () => {
    const p = createProject(ctx, { title: 'Tablet', tags: ['homelab'] });
    tick();
    const u = updateProject(ctx, p.id, { status: 'done', dueDate: '2026-12-06', tags: ['ha'], description: 'Wall mount' });
    expect(u).toMatchObject({ status: 'done', dueDate: '2026-12-06', tags: ['ha'], description: 'Wall mount' });
    expect(u.completedAt).toBe(clock.toISOString());
    expect(u.updatedAt > p.updatedAt).toBe(true);
    expect(updateProject(ctx, p.id, { status: 'active', dueDate: null }).completedAt).toBeNull();
    expect(search('wall')).toEqual([{ entity: 'project', id: p.id }]);
  });

  it('deletes a project with everything in it', () => {
    const p = createProject(ctx, { title: 'Temp' });
    const list = createChecklist(ctx, p.id, { title: 'To buy', kind: 'buy' });
    addItems(ctx, list.id, [{ text: 'Screws', links: [{ url: 'https://shop.example.com/s' }] }]);
    deleteProject(ctx, p.id);
    expect(() => getProject(ctx, p.id)).toThrow(NotFoundError);
    expect(search('screws')).toEqual([]);
    expect(() => deleteProject(ctx, p.id)).toThrow(NotFoundError);
  });
});

describe('checklists and items', () => {
  let projectId: string;
  let buyId: string;
  let todoId: string;

  beforeEach(() => {
    projectId = createProject(ctx, { title: 'Rack fan controller' }).id;
    buyId = createChecklist(ctx, projectId, { title: 'To buy', kind: 'buy' }).id;
    todoId = createChecklist(ctx, projectId, { title: 'To do' }).id;
  });

  it('adds items in order and computes progress', () => {
    const items = addItems(ctx, buyId, [
      { text: 'Noctua NF-A4x20 PWM', quantity: 4 },
      { text: 'JST-XH kit' },
      { text: 'ESP32-C3', quantity: 2, dueDate: '2026-11-28' },
    ]);
    updateItem(ctx, items[2]!.id, { state: 'done' });
    updateItem(ctx, items[1]!.id, { state: 'ordered', orderRef: '8142', expectedDate: '2026-12-05' });

    const p = getProject(ctx, projectId);
    expect(p.checklists.map((c) => c.title)).toEqual(['To buy', 'To do']);
    expect(p.checklists[0]!.items.map((i) => i.text)).toEqual(['Noctua NF-A4x20 PWM', 'JST-XH kit', 'ESP32-C3']);
    expect(p.progress).toEqual({ total: 3, done: 1, ordered: 1 });
    expect(listProjects(ctx)[0]!.progress).toEqual({ total: 3, done: 1, ordered: 1 });
  });

  it('tracks open → ordered → done timestamps', () => {
    const [item] = addItems(ctx, buyId, [{ text: 'Fans' }]);
    const ordered = updateItem(ctx, item!.id, { state: 'ordered' });
    expect(ordered.orderedAt).toBe(clock.toISOString());
    tick();
    const done = updateItem(ctx, item!.id, { state: 'done' });
    expect(done.doneAt).toBe(clock.toISOString());
    expect(done.orderedAt).toBe(ordered.orderedAt);
    const reopened = updateItem(ctx, item!.id, { state: 'open' });
    expect(reopened).toMatchObject({ state: 'open', doneAt: null, orderedAt: null });
  });

  it('only allows "ordered" on buy lists', () => {
    const [item] = addItems(ctx, todoId, [{ text: 'Flash firmware' }]);
    expect(() => updateItem(ctx, item!.id, { state: 'ordered' })).toThrow(InvalidOperationError);
  });

  it('reorders and moves items between checklists', () => {
    const [a, b, c] = addItems(ctx, todoId, [{ text: 'A' }, { text: 'B' }, { text: 'C' }]);
    updateItem(ctx, c!.id, { position: 0 });
    updateItem(ctx, a!.id, { position: 2 });
    const order = () => getProject(ctx, projectId).checklists[1]!.items.map((i) => i.text);
    expect(order()).toEqual(['C', 'B', 'A']);

    const [fans] = addItems(ctx, buyId, [{ text: 'Fans' }]);
    updateItem(ctx, fans!.id, { state: 'ordered' });
    const moved = updateItem(ctx, fans!.id, { checklistId: todoId, position: 1 });
    expect(moved.state).toBe('open');
    expect(order()).toEqual(['C', 'Fans', 'B', 'A']);
    expect(b).toBeTruthy();
  });

  it('refuses to move items to another project', () => {
    const other = createProject(ctx, { title: 'Other' });
    const otherList = createChecklist(ctx, other.id, { title: 'List' });
    const [item] = addItems(ctx, todoId, [{ text: 'X' }]);
    expect(() => updateItem(ctx, item!.id, { checklistId: otherList.id })).toThrow(InvalidOperationError);
  });

  it('reorders checklists and resets ordered items when a buy list changes kind', () => {
    updateChecklist(ctx, todoId, { position: 0 });
    expect(getProject(ctx, projectId).checklists.map((c) => c.title)).toEqual(['To do', 'To buy']);

    const [item] = addItems(ctx, buyId, [{ text: 'Fans' }]);
    updateItem(ctx, item!.id, { state: 'ordered' });
    updateChecklist(ctx, buyId, { kind: 'todo' });
    expect(getProject(ctx, projectId).checklists[1]!.items[0]!.state).toBe('open');
  });

  it('deletes items and checklists and keeps search in sync', () => {
    const [item] = addItems(ctx, todoId, [{ text: 'Solder headers', note: 'use the fine tip' }]);
    expect(search('tip')).toEqual([{ entity: 'item', id: item!.id }]);
    updateItem(ctx, item!.id, { text: 'Solder pin headers' });
    expect(search('pin')).toHaveLength(1);
    deleteItem(ctx, item!.id);
    expect(search('solder')).toEqual([]);

    addItems(ctx, buyId, [{ text: 'Heat inserts' }]);
    deleteChecklist(ctx, buyId);
    expect(search('inserts')).toEqual([]);
    expect(getProject(ctx, projectId).checklists).toHaveLength(1);
  });

  it('finds checklists by id, title or kind', () => {
    expect(findChecklist(ctx.db, projectId, 'buy')?.id).toBe(buyId);
    expect(findChecklist(ctx.db, projectId, 'to do')?.id).toBe(todoId);
    expect(findChecklist(ctx.db, projectId, todoId)?.id).toBe(todoId);
    expect(findChecklist(ctx.db, projectId, 'nope')).toBeUndefined();
  });

  it('logs activity with the actor', () => {
    const mcp: ServiceContext = { ...ctx, actor: 'mcp' };
    addItems(mcp, buyId, [{ text: 'Fans' }]);
    const rows = sqlite
      .prepare("select actor, action from activity where entity = 'checklist' and action = 'add_items'")
      .all();
    expect(rows).toEqual([{ actor: 'mcp', action: 'add_items' }]);
  });
});

describe('links', () => {
  let itemId: string;

  beforeEach(() => {
    const p = createProject(ctx, { title: 'Rack' });
    const list = createChecklist(ctx, p.id, { title: 'To buy', kind: 'buy' });
    itemId = addItems(ctx, list.id, [{ text: 'Noctua NF-A4x20 PWM' }])[0]!.id;
  });

  it('derives the shop name from the URL', () => {
    expect(shopFromUrl('https://www.galaxus.ch/de/s1/product/123')).toBe('galaxus.ch');
    expect(shopFromUrl('not a url')).toBeNull();
  });

  it('makes the first link preferred and keeps only one preferred', () => {
    const a = addLink(ctx, itemId, { url: 'https://www.galaxus.ch/p/1', price: 15.9 });
    expect(a).toMatchObject({ shop: 'galaxus.ch', preferred: true, currency: 'CHF', price: 15.9 });
    const b = addLink(ctx, itemId, { url: 'https://www.digitec.ch/p/1', shop: 'Digitec', preferred: true });
    expect(b.preferred).toBe(true);

    const links = () => getProject(ctx, getProjectId()).checklists[0]!.items[0]!.links;
    expect(links().map((l) => [l.shop, l.preferred])).toEqual([
      ['galaxus.ch', false],
      ['Digitec', true],
    ]);

    updateLink(ctx, a.id, { preferred: true });
    expect(links().map((l) => l.preferred)).toEqual([true, false]);

    deleteLink(ctx, a.id);
    expect(links()).toHaveLength(1);
    expect(links()[0]!.preferred).toBe(true);
  });

  it('rejects non-http links', () => {
    expect(() => addLink(ctx, itemId, { url: 'javascript:alert(1)' })).toThrow();
    expect(() => addLink(ctx, itemId, { url: 'ftp://example.com/x' })).toThrow();
  });

  function getProjectId() {
    return listProjects(ctx)[0]!.id;
  }
});
