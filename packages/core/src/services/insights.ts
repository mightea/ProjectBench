import { and, asc, eq, inArray, isNotNull, ne, notInArray, sql, type SQL } from 'drizzle-orm';
import { attachments, checklistItems, checklists, projects } from '../schema.ts';
import { normalizeTag, type Agenda, type BuyGroup, type BuyOverview, type ChecklistItem, type ItemLink, type ItemWithContext, type SearchHit } from '../schemas.ts';
import type { ServiceContext } from './context.ts';
import { getItem } from './items.ts';
import { listNotes } from './notes.ts';
import { getProject, listProjects } from './projects.ts';
import { tagsForProjects } from './tags.ts';

const openProject = notInArray(projects.status, ['done', 'archived']);

const projectIdsWithTag = (tag: string) =>
  sql`(select pt.project_id from project_tags pt join tags t on t.id = pt.tag_id where t.name = ${normalizeTag(tag)})`;
const hasTag = (tag?: string) => (tag ? sql`${projects.id} in ${projectIdsWithTag(tag)}` : undefined);

function itemsWhere(ctx: ServiceContext, where: SQL | undefined): ItemWithContext[] {
  return ctx.db
    .select({
      id: checklistItems.id,
      projectId: projects.id,
      projectTitle: projects.title,
      checklistTitle: checklists.title,
      checklistKind: checklists.kind,
    })
    .from(checklistItems)
    .innerJoin(checklists, eq(checklists.id, checklistItems.checklistId))
    .innerJoin(projects, eq(projects.id, checklists.projectId))
    .where(where)
    .orderBy(asc(projects.priority), asc(projects.sortKey), asc(checklists.sortKey), asc(checklistItems.sortKey))
    .all()
    .map(({ id, ...context }) => ({ ...getItem(ctx.db, id), ...context }));
}

/** Calendar date in the server's time zone. */
function localDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const TAG_TERM = /(?:^|\s)#([^\s#]+)/g;

/**
 * Full-text search across projects (with their tags), items and notes. Every word must match, as
 * a prefix. `#tag` limits results to projects with that tag; on its own it lists those projects.
 */
export function searchAll(ctx: ServiceContext, query: string, limit = 30): SearchHit[] {
  const tagNames = [...query.matchAll(TAG_TERM)].map((m) => m[1]!);
  const terms = query.replace(TAG_TERM, ' ').match(/[\p{L}\p{N}]+/gu) ?? [];
  if (terms.length === 0 && tagNames.length === 0) return [];

  const conditions = tagNames.map((tag) => sql`search.project_id in ${projectIdsWithTag(tag)}`);
  conditions.push(terms.length ? sql`search match ${terms.map((term) => `"${term}"*`).join(' ')}` : sql`search.entity = 'project'`);
  const hits = ctx.db.all<Omit<SearchHit, 'tags'>>(sql`
    select search.entity as entity, search.entity_id as entityId, search.project_id as projectId,
           p.title as projectTitle, search.title as title,
           snippet(search, 4, '', '', '…', 16) as snippet
    from search
    join projects p on p.id = search.project_id
    where ${sql.join(conditions, sql` and `)}
    order by ${terms.length ? sql`rank` : sql`p.priority, p.title`}
    limit ${limit}
  `);
  const tagMap = tagsForProjects(ctx.db, [...new Set(hits.map((h) => h.projectId))]);
  return hits.map((hit) => ({ ...hit, tags: tagMap.get(hit.projectId) ?? [] }));
}

/** What needs attention in the next `days` days, across open projects, optionally with one tag. */
export function agenda(ctx: ServiceContext, days = 7, tag?: string): Agenda {
  const now = ctx.now?.() ?? new Date();
  const today = localDate(now);
  const end = new Date(now);
  end.setDate(end.getDate() + days);
  const until = localDate(end);

  const byDue = (a: ChecklistItem, b: ChecklistItem) => (a.dueDate ?? '').localeCompare(b.dueDate ?? '');
  const byExpected = (a: ChecklistItem, b: ChecklistItem) => (a.expectedDate ?? '').localeCompare(b.expectedDate ?? '');

  const dueItems = itemsWhere(ctx, and(openProject, hasTag(tag), ne(checklistItems.state, 'done'), isNotNull(checklistItems.dueDate))).sort(byDue);
  const deliveries = itemsWhere(ctx, and(openProject, hasTag(tag), eq(checklistItems.state, 'ordered'), isNotNull(checklistItems.expectedDate))).sort(byExpected);
  const open = listProjects(ctx, { status: 'open', sort: 'due', tag });

  return {
    today,
    until,
    overdueItems: dueItems.filter((i) => i.dueDate! < today),
    upcomingItems: dueItems.filter((i) => i.dueDate! >= today && i.dueDate! <= until),
    lateDeliveries: deliveries.filter((i) => i.expectedDate! < today),
    upcomingDeliveries: deliveries.filter((i) => i.expectedDate! >= today && i.expectedDate! <= until),
    overdueProjects: open.filter((p) => p.dueDate !== null && p.dueDate < today),
    upcomingProjects: open.filter((p) => p.dueDate !== null && p.dueDate >= today && p.dueDate <= until),
    urgentProjects: open.filter((p) => p.priority === 1),
    openQuestions: openQuestions(ctx, undefined, tag),
  };
}

export const preferredLink = (item: ChecklistItem): ItemLink | undefined =>
  item.links.find((l) => l.preferred) ?? item.links[0];

export interface ShoppingFilter {
  state?: 'open' | 'ordered';
  shop?: string;
  projectId?: string;
  tag?: string;
}

/** Items still to buy or on order. Without a project, only open projects count. */
export function shoppingList(ctx: ServiceContext, filter: ShoppingFilter = {}): ItemWithContext[] {
  const states = filter.state ? [filter.state] : (['open', 'ordered'] as const);
  const items = itemsWhere(
    ctx,
    and(
      eq(checklists.kind, 'buy'),
      inArray(checklistItems.state, [...states]),
      filter.projectId ? eq(projects.id, filter.projectId) : openProject,
      hasTag(filter.tag),
    ),
  );
  if (!filter.shop) return items;
  const shop = filter.shop.toLowerCase();
  return items.filter((item) => preferredLink(item)?.shop?.toLowerCase().includes(shop));
}

/** Adds up preferred-link prices per currency; items without a price are counted instead. */
function buyGroup(key: string, name: string | null, items: ItemWithContext[]): BuyGroup {
  const cents = new Map<string, number>();
  let unpriced = 0;
  for (const item of items) {
    const link = preferredLink(item);
    if (!link || link.price === null) {
      unpriced += 1;
      continue;
    }
    const currency = link.currency ?? 'CHF';
    cents.set(currency, (cents.get(currency) ?? 0) + Math.round(link.price * (item.quantity ?? 1) * 100));
  }
  const totals = [...cents].map(([currency, amount]) => ({ currency, amount: amount / 100 }));
  return { key, name, items, totals, unpriced };
}

function groupBy(items: ItemWithContext[], keyOf: (item: ItemWithContext) => string, nameOf: (item: ItemWithContext) => string | null) {
  const groups = new Map<string, ItemWithContext[]>();
  for (const item of items) groups.set(keyOf(item), [...(groups.get(keyOf(item)) ?? []), item]);
  return [...groups].map(([key, members]) => buyGroup(key, nameOf(members[0]!), members));
}

/** The Buy screen: what to order, by shop and by project, and what is on the way. */
export function buyOverview(ctx: ServiceContext, tag?: string): BuyOverview {
  const items = shoppingList(ctx, { tag });
  const toOrder = items.filter((i) => i.state === 'open');
  const shopOf = (item: ItemWithContext) => preferredLink(item)?.shop ?? null;
  const byShop = groupBy(toOrder, (i) => shopOf(i)?.toLowerCase() ?? '', shopOf).sort((a, b) => {
    if (a.name === null || b.name === null) return a.name === b.name ? 0 : a.name === null ? 1 : -1;
    return a.name.localeCompare(b.name);
  });
  const ordered = items
    .filter((i) => i.state === 'ordered')
    .sort((a, b) => (a.expectedDate ?? '9999').localeCompare(b.expectedDate ?? '9999'));
  return { byShop, byProject: groupBy(toOrder, (i) => i.projectId, (i) => i.projectTitle), ordered };
}

/** Open "to clarify" items. Without a project, only open projects count. */
export function openQuestions(ctx: ServiceContext, projectId?: string, tag?: string): ItemWithContext[] {
  return itemsWhere(
    ctx,
    and(eq(checklists.kind, 'clarify'), eq(checklistItems.state, 'open'), projectId ? eq(projects.id, projectId) : openProject, hasTag(tag)),
  );
}

const CHECKBOX = { open: '[ ]', ordered: '[~]', done: '[x]' } as const;

function itemMarkdown(item: ChecklistItem): string[] {
  const quantity = item.quantity !== null ? `${item.quantity}${item.unit ? ` ${item.unit}` : ''} × ` : '';
  const facts = [
    item.dueDate && `due ${item.dueDate}`,
    item.state === 'ordered' && 'ordered',
    item.orderRef && `order ${item.orderRef}`,
    item.expectedDate && `expected ${item.expectedDate}`,
    `id: ${item.id}`,
  ].filter(Boolean);
  const lines = [`- ${CHECKBOX[item.state]} ${quantity}${item.text} (${facts.join(', ')})`];
  if (item.note) lines.push(`  - Note: ${item.note.replace(/\s*\n\s*/g, ' ')}`);
  for (const link of item.links) {
    const price = link.price !== null ? ` ${link.currency ?? ''} ${link.price.toFixed(2)}`.trimEnd() : '';
    lines.push(`  - ${link.preferred ? 'Preferred: ' : ''}${link.shop ?? 'Link'}${price}: ${link.url} (link id: ${link.id})`);
  }
  return lines;
}

/** The full project as Markdown: fields, checklists, recent notes and attachment names. */
export function projectMarkdown(ctx: ServiceContext, projectId: string): string {
  const p = getProject(ctx, projectId);
  const lines = [
    `# ${p.title}`,
    '',
    `- ID: ${p.id}`,
    `- Status: ${p.status}`,
    `- Priority: P${p.priority}`,
    `- Due: ${p.dueDate ?? 'none'}`,
    `- Tags: ${p.tags.length ? p.tags.join(', ') : 'none'}`,
    `- Progress: ${p.progress.done} of ${p.progress.total} done, ${p.progress.ordered} ordered`,
  ];
  if (p.description) lines.push('', '## Description', '', p.description);

  lines.push('', '## Checklists');
  if (p.checklists.length === 0) lines.push('', 'No checklists yet.');
  for (const list of p.checklists) {
    lines.push('', `### ${list.title} (${list.kind}, id: ${list.id})`, '');
    if (list.items.length === 0) lines.push('No items.');
    for (const item of list.items) lines.push(...itemMarkdown(item));
  }

  const notes = listNotes(ctx, projectId);
  if (notes.length) {
    lines.push('', '## Recent notes');
    for (const note of notes) lines.push('', `**${note.createdAt.slice(0, 10)}** (${note.source})`, '', note.body);
  }

  const files = ctx.db
    .select({ id: attachments.id, filename: attachments.filename, mime: attachments.mime })
    .from(attachments)
    .where(eq(attachments.projectId, projectId))
    .orderBy(asc(attachments.filename))
    .all();
  if (files.length) {
    lines.push('', '## Attachments', '');
    for (const file of files) lines.push(`- ${file.filename} (${file.mime}, id: ${file.id})`);
  }
  return lines.join('\n');
}
