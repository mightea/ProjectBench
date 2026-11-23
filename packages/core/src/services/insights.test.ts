import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../db.ts';
import { createChecklist } from './checklists.ts';
import type { ServiceContext } from './context.ts';
import { agenda, buyOverview, searchAll } from './insights.ts';
import { addItems, updateItem } from './items.ts';
import { createProject, updateProject } from './projects.ts';
import { listTags } from './tags.ts';

let ctx: ServiceContext;
let close: () => void;

beforeEach(() => {
  const handle = openDb({ filename: ':memory:' });
  close = handle.close;
  ctx = { db: handle.db, actor: 'app', now: () => new Date('2026-11-22T10:00:00Z') };
});
afterEach(() => close());

function buyList(title: string) {
  const project = createProject(ctx, { title });
  return { project, list: createChecklist(ctx, project.id, { title: 'To buy', kind: 'buy' }) };
}

describe('buyOverview', () => {
  it('groups by preferred shop, ignoring case, with no shop last', () => {
    const { list } = buyList('Rack');
    addItems(ctx, list.id, [
      { text: 'No link' },
      { text: 'Fan', quantity: 4, links: [{ url: 'https://a.example.com/1', shop: 'Galaxus', price: 15.9, currency: 'CHF' }] },
      { text: 'Cable', links: [{ url: 'https://a.example.com/2', shop: 'galaxus', price: 4.1, currency: 'CHF' }] },
      { text: 'Unpriced', links: [{ url: 'https://b.example.com/3', shop: 'Brack' }] },
    ]);

    const { byShop } = buyOverview(ctx);
    expect(byShop.map((g) => g.name)).toEqual(['Brack', 'Galaxus', null]);
    expect(byShop[1]!.items).toHaveLength(2);
    expect(byShop[1]!.totals).toEqual([{ currency: 'CHF', amount: 67.7 }]);
    expect(byShop[0]).toMatchObject({ totals: [], unpriced: 1 });
  });

  it('keeps currencies apart', () => {
    const { list } = buyList('Rack');
    addItems(ctx, list.id, [
      { text: 'A', links: [{ url: 'https://a.example.com/1', shop: 'Shop', price: 10, currency: 'CHF' }] },
      { text: 'B', links: [{ url: 'https://a.example.com/2', shop: 'Shop', price: 5, currency: 'EUR' }] },
    ]);
    expect(buyOverview(ctx).byShop[0]!.totals).toEqual([
      { currency: 'CHF', amount: 10 },
      { currency: 'EUR', amount: 5 },
    ]);
  });

  it('separates ordered items, soonest first, and leaves out closed projects', () => {
    const { list } = buyList('Rack');
    const [late, soon, none] = addItems(ctx, list.id, [{ text: 'Late' }, { text: 'Soon' }, { text: 'No date' }]);
    updateItem(ctx, late!.id, { state: 'ordered', expectedDate: '2026-12-05' });
    updateItem(ctx, soon!.id, { state: 'ordered', expectedDate: '2026-11-24' });
    updateItem(ctx, none!.id, { state: 'ordered' });
    const closed = buyList('Finished');
    addItems(ctx, closed.list.id, [{ text: 'Hidden' }]);
    updateProject(ctx, closed.project.id, { status: 'done' });

    const overview = buyOverview(ctx);
    expect(overview.ordered.map((i) => i.text)).toEqual(['Soon', 'Late', 'No date']);
    expect(overview.byShop).toEqual([]);
    expect(overview.byProject).toEqual([]);
  });
});

describe('agenda', () => {
  it('includes open questions from open projects', () => {
    const project = createProject(ctx, { title: 'Rack' });
    const list = createChecklist(ctx, project.id, { title: 'To clarify', kind: 'clarify' });
    const [, answered] = addItems(ctx, list.id, [{ text: 'Which header?' }, { text: 'Answered' }]);
    updateItem(ctx, answered!.id, { state: 'done' });
    expect(agenda(ctx).openQuestions.map((i) => i.text)).toEqual(['Which header?']);
  });
});

describe('tags', () => {
  it('finds projects by tag, also after the tags change', () => {
    const p = createProject(ctx, { title: 'Bench lamp', tags: ['home-assistant'] });
    expect(searchAll(ctx, 'assistant').map((h) => [h.entityId, h.tags])).toEqual([[p.id, ['home-assistant']]]);
    updateProject(ctx, p.id, { tags: ['workshop'] });
    expect(searchAll(ctx, 'assistant')).toEqual([]);
    expect(searchAll(ctx, 'bench workshop').map((h) => h.entityId)).toEqual([p.id]);
  });

  it('limits search to a #tag and lists its projects when used alone', () => {
    const tagged = buyList('Rack');
    const other = buyList('Garage');
    updateProject(ctx, tagged.project.id, { tags: ['homelab'] });
    addItems(ctx, tagged.list.id, [{ text: 'Fan' }]);
    addItems(ctx, other.list.id, [{ text: 'Fan' }]);
    expect(searchAll(ctx, 'fan')).toHaveLength(2);
    expect(searchAll(ctx, '#HomeLab fan').map((h) => h.projectId)).toEqual([tagged.project.id]);
    expect(searchAll(ctx, '#homelab').map((h) => [h.entity, h.entityId])).toEqual([['project', tagged.project.id]]);
    expect(searchAll(ctx, '#missing')).toEqual([]);
  });

  it('filters the agenda and buy list by tag', () => {
    const tagged = buyList('Rack');
    const other = buyList('Garage');
    updateProject(ctx, tagged.project.id, { tags: ['homelab'], priority: 1 });
    updateProject(ctx, other.project.id, { priority: 1 });
    addItems(ctx, tagged.list.id, [{ text: 'Fan' }]);
    addItems(ctx, other.list.id, [{ text: 'Hook' }]);
    expect(buyOverview(ctx, 'homelab').byProject.map((g) => g.name)).toEqual(['Rack']);
    expect(agenda(ctx, 7, 'homelab').urgentProjects.map((p) => p.title)).toEqual(['Rack']);
    expect(agenda(ctx).urgentProjects).toHaveLength(2);
  });

  it('lists only tags that are in use', () => {
    const p = createProject(ctx, { title: 'Rack', tags: ['old'] });
    updateProject(ctx, p.id, { tags: ['new'] });
    expect(listTags(ctx.db)).toEqual([{ name: 'new', projects: 1 }]);
  });
});
