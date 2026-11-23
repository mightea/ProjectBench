import { and, asc, eq, inArray, isNotNull, ne, notInArray, sql, type SQL } from 'drizzle-orm';
import { attachments, checklistItems, checklists, projects } from '../schema.ts';
import type { ChecklistItem, ChecklistKind, ItemLink, ProjectSummary } from '../schemas.ts';
import type { ServiceContext } from './context.ts';
import { getItem } from './items.ts';
import { listNotes } from './notes.ts';
import { getProject, listProjects } from './projects.ts';

export interface ItemWithContext extends ChecklistItem {
  projectId: string;
  projectTitle: string;
  checklistTitle: string;
  checklistKind: ChecklistKind;
}

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

export interface SearchHit {
  entity: 'project' | 'item' | 'note';
  entityId: string;
  projectId: string;
  projectTitle: string;
  title: string;
  snippet: string;
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

export interface Agenda {
  today: string;
  until: string;
  overdueItems: ItemWithContext[];
  upcomingItems: ItemWithContext[];
  lateDeliveries: ItemWithContext[];
  upcomingDeliveries: ItemWithContext[];
  overdueProjects: ProjectSummary[];
  upcomingProjects: ProjectSummary[];
  urgentProjects: ProjectSummary[];
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
    .select({ filename: attachments.filename })
    .from(attachments)
    .where(eq(attachments.projectId, projectId))
    .orderBy(asc(attachments.filename))
    .all();
  if (files.length) {
    lines.push('', '## Attachments', '');
    for (const file of files) lines.push(`- ${file.filename}`);
  }
  return lines.join('\n');
}
