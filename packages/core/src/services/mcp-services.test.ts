import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../db.ts';
import { AmbiguousMatchError, NotFoundError } from '../errors.ts';
import type { ServiceContext } from './context.ts';
import {
  addItemsToProject,
  agenda,
  createApiToken,
  createProject,
  listApiTokens,
  matchByName,
  resolveProject,
  revokeApiToken,
  searchAll,
  setItemLinks,
  updateItem,
  updateProject,
  validateApiToken,
} from './index.ts';

let close: () => void;
let ctx: ServiceContext;

beforeEach(() => {
  const handle = openDb({ filename: ':memory:' });
  close = handle.close;
  ctx = { db: handle.db, actor: 'mcp', now: () => new Date('2026-11-23T12:00:00') };
});
afterEach(() => close());

describe('name matching', () => {
  const records = [{ title: 'Rack fan controller' }, { title: 'Rack tray' }, { title: 'Küche Regal' }];
  const titles = (ref: string) => matchByName(records, ref).map((r) => r.title);

  it('prefers stricter matches', () => {
    expect(titles('RACK TRAY')).toEqual(['Rack tray']);
    expect(titles('fan')).toEqual(['Rack fan controller']);
    expect(titles('controller rack')).toEqual(['Rack fan controller']);
    expect(titles('rack')).toEqual(['Rack fan controller', 'Rack tray']);
  });

  it('ignores accents and tolerates small typos', () => {
    expect(titles('kuche')).toEqual(['Küche Regal']);
    expect(titles('controler')).toEqual(['Rack fan controller']);
    expect(titles('zzz')).toEqual([]);
    expect(titles('  ')).toEqual([]);
  });

  it('resolves ids and titles, and prefers open projects', () => {
    const open = createProject(ctx, { title: 'Garden shed' });
    const old = createProject(ctx, { title: 'Garden shed v1', status: 'archived' });
    expect(resolveProject(ctx, old.id).id).toBe(old.id);
    expect(resolveProject(ctx, 'garden').id).toBe(open.id);
    expect(() => resolveProject(ctx, 'nothing like it')).toThrow(NotFoundError);
    createProject(ctx, { title: 'Garden bench' });
    expect(() => resolveProject(ctx, 'garden')).toThrow(AmbiguousMatchError);
  });
});

describe('API tokens', () => {
  it('validates live tokens only and stores no raw value', () => {
    const created = createApiToken(ctx, { name: 'Laptop' });
    expect(validateApiToken(ctx.db, created.token)).toBe(true);
    expect(validateApiToken(ctx.db, `${created.token}x`)).toBe(false);
    expect(validateApiToken(ctx.db, undefined)).toBe(false);
    expect(JSON.stringify(listApiTokens(ctx))).not.toContain(created.token);
    expect(listApiTokens(ctx)[0]!.lastUsedAt).not.toBeNull();

    const revoked = revokeApiToken(ctx, created.id);
    expect(revoked.revokedAt).not.toBeNull();
    expect(revokeApiToken(ctx, created.id).revokedAt).toBe(revoked.revokedAt);
    expect(validateApiToken(ctx.db, created.token)).toBe(false);
  });
});

describe('checklist lookup', () => {
  it('reuses a list by kind or name and creates a missing one', () => {
    const { id } = createProject(ctx, { title: 'Shelf' });
    const first = addItemsToProject(ctx, id, 'to buy', [{ text: 'Wood' }]);
    expect(first).toMatchObject({ checklistCreated: true, checklist: { title: 'To buy', kind: 'buy' } });
    expect(addItemsToProject(ctx, id, 'buy', [{ text: 'Glue' }]).checklist.id).toBe(first.checklist.id);
    const custom = addItemsToProject(ctx, id, 'Hardware store', [{ text: 'Screws' }], 'buy');
    expect(custom).toMatchObject({ checklistCreated: true, checklist: { title: 'Hardware store', kind: 'buy' } });
    expect(() => addItemsToProject(ctx, id, 'buy', [{ text: 'Paint' }])).toThrow(AmbiguousMatchError);
  });
});

describe('item links', () => {
  it('keeps exactly one preferred link', () => {
    const { id } = createProject(ctx, { title: 'Shelf' });
    const [item] = addItemsToProject(ctx, id, 'buy', [
      { text: 'Fan', links: [{ url: 'https://a.example.com/1' }, { url: 'https://b.example.com/2' }] },
    ]).items;
    const removed = setItemLinks(ctx, item!.id, { remove: [item!.links[0]!.id] });
    expect(removed.links.map((l) => l.preferred)).toEqual([true]);
    const replaced = setItemLinks(ctx, item!.id, { replace: [{ url: 'https://c.example.com/3' }, { url: 'https://d.example.com/4', preferred: true }] });
    expect(replaced.links.map((l) => l.preferred)).toEqual([false, true]);
    expect(() => setItemLinks(ctx, item!.id, { remove: ['missing'] })).toThrow(NotFoundError);
    expect(() => setItemLinks(ctx, item!.id, { replace: [], add: [{ url: 'https://e.example.com' }] })).toThrow();
    expect(setItemLinks(ctx, item!.id, { replace: [] }).links).toEqual([]);
  });
});

describe('search and agenda', () => {
  it('treats search operators as plain text', () => {
    const { id } = createProject(ctx, { title: 'Noctua fans' });
    addItemsToProject(ctx, id, 'buy', [{ text: 'NF-A12 fan' }]);
    expect(searchAll(ctx, 'noct').map((h) => h.entity)).toEqual(['project']);
    expect(searchAll(ctx, 'NF-A12 OR "').length).toBe(0);
    expect(searchAll(ctx, 'NF-A12').map((h) => h.entity)).toEqual(['item']);
    expect(searchAll(ctx, '***')).toEqual([]);
  });

  it('groups due items, deliveries and projects', () => {
    const { id } = createProject(ctx, { title: 'Rack', priority: 1, dueDate: '2026-11-25' });
    const { items } = addItemsToProject(ctx, id, 'buy', [
      { text: 'Late', dueDate: '2026-11-20' },
      { text: 'Soon', dueDate: '2026-11-30' },
      { text: 'Far', dueDate: '2026-12-30' },
      { text: 'Parcel' },
    ]);
    updateItem(ctx, items[3]!.id, { state: 'ordered', expectedDate: '2026-11-22' });
    const a = agenda(ctx);
    expect(a.today).toBe('2026-11-23');
    expect(a.overdueItems.map((i) => i.text)).toEqual(['Late']);
    expect(a.upcomingItems.map((i) => i.text)).toEqual(['Soon']);
    expect(a.lateDeliveries.map((i) => i.text)).toEqual(['Parcel']);
    expect(a.upcomingProjects.map((p) => p.title)).toEqual(['Rack']);

    updateProject(ctx, id, { status: 'archived' });
    expect(agenda(ctx).overdueItems).toEqual([]);
  });
});
