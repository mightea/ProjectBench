import { and, asc, eq, inArray, isNotNull, ne, notInArray, sql, type SQL } from 'drizzle-orm';
import { attachments, checklistItems, checklists, projects } from '../schema.ts';
import type { Agenda, BuyGroup, BuyOverview, ChecklistItem, ItemLink, ItemWithContext, SearchHit } from '../schemas.ts';
import type { ServiceContext } from './context.ts';
import { getItem } from './items.ts';
import { listNotes } from './notes.ts';
import { getProject, listProjects } from './projects.ts';

const openProject = notInArray(projects.status, ['done', 'archived']);

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

/** Full-text search across projects, items and notes. Every word must match, as a prefix. */
export function searchAll(ctx: ServiceContext, query: string, limit = 30): SearchHit[] {
  const terms = query.match(/[\p{L}\p{N}]+/gu);
  if (!terms) return [];
  const match = terms.map((term) => `"${term}"*`).join(' ');
  return ctx.db.all<SearchHit>(sql`
    select search.entity as entity, search.entity_id as entityId, search.project_id as projectId,
           p.title as projectTitle, search.title as title,
           snippet(search, 4, '', '', '…', 16) as snippet
    from search
    join projects p on p.id = search.project_id
    where search match ${match}
    order by rank
    limit ${limit}
  `);
}

/** What needs attention in the next `days` days, across all open projects. */
export function agenda(ctx: ServiceContext, days = 7): Agenda {
  const now = ctx.now?.() ?? new Date();
  const today = localDate(now);
  const end = new Date(now);
  end.setDate(end.getDate() + days);
  const until = localDate(end);

  const byDue = (a: ChecklistItem, b: ChecklistItem) => (a.dueDate ?? '').localeCompare(b.dueDate ?? '');
  const byExpected = (a: ChecklistItem, b: ChecklistItem) => (a.expectedDate ?? '').localeCompare(b.expectedDate ?? '');

  const dueItems = itemsWhere(ctx, and(openProject, ne(checklistItems.state, 'done'), isNotNull(checklistItems.dueDate))).sort(byDue);
  const deliveries = itemsWhere(ctx, and(openProject, eq(checklistItems.state, 'ordered'), isNotNull(checklistItems.expectedDate))).sort(byExpected);
  const open = listProjects(ctx, { status: 'open', sort: 'due' });

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
    openQuestions: openQuestions(ctx),
  };
}

export const preferredLink = (item: ChecklistItem): ItemLink | undefined =>
  item.links.find((l) => l.preferred) ?? item.links[0];

export interface ShoppingFilter {
  state?: 'open' | 'ordered';
  shop?: string;
  projectId?: string;
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
export function buyOverview(ctx: ServiceContext): BuyOverview {
  const items = shoppingList(ctx);
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
export function openQuestions(ctx: ServiceContext, projectId?: string): ItemWithContext[] {
  return itemsWhere(
    ctx,
    and(eq(checklists.kind, 'clarify'), eq(checklistItems.state, 'open'), projectId ? eq(projects.id, projectId) : openProject),
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
