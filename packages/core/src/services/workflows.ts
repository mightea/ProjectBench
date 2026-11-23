import { asc, eq } from 'drizzle-orm';
import type { Db } from '../db.ts';
import { AmbiguousMatchError, NotFoundError } from '../errors.ts';
import { checklistItems, checklists, itemLinks } from '../schema.ts';
import {
  itemLinksSetSchema,
  type ChecklistItem,
  type ChecklistKind,
  type ItemCreate,
  type ItemLinksSet,
  type ProjectCreate,
  type ProjectDetail,
} from '../schemas.ts';
import { createChecklist, getChecklistRow, type ChecklistRow } from './checklists.ts';
import { logActivity, type ServiceContext } from './context.ts';
import { addItems, getItem } from './items.ts';
import { insertLink } from './links.ts';
import { createProject, getProject, touchProject } from './projects.ts';
import { matchByName, normalizeName, resolveProject } from './resolve.ts';

const KIND_TITLES: Record<ChecklistKind, string> = { buy: 'To buy', clarify: 'To clarify', todo: 'To do' };

const KIND_ALIASES: Record<string, ChecklistKind> = {
  buy: 'buy',
  'to buy': 'buy',
  shopping: 'buy',
  'shopping list': 'buy',
  clarify: 'clarify',
  'to clarify': 'clarify',
  questions: 'clarify',
  'open questions': 'clarify',
  todo: 'todo',
  'to do': 'todo',
  todos: 'todo',
  tasks: 'todo',
};

/** Runs several service calls as one transaction; nested service transactions become savepoints. */
function atomically<T>(ctx: ServiceContext, run: (tx: ServiceContext) => T): T {
  return ctx.db.transaction((tx) => run({ ...ctx, db: tx as unknown as Db }));
}

function projectChecklists(ctx: ServiceContext, projectId: string): ChecklistRow[] {
  return ctx.db
    .select({ id: checklists.id, projectId: checklists.projectId, title: checklists.title, kind: checklists.kind })
    .from(checklists)
    .where(eq(checklists.projectId, projectId))
    .orderBy(asc(checklists.sortKey))
    .all();
}

function single(ref: string, hits: ChecklistRow[]): ChecklistRow {
  if (hits.length > 1) throw new AmbiguousMatchError('checklist', ref, hits.map(({ id, title }) => ({ id, title })));
  return hits[0]!;
}

/** Finds a checklist by id, name or kind, and creates it if the project has no match. */
function findOrCreateChecklist(
  ctx: ServiceContext,
  projectId: string,
  ref: string,
  kind?: ChecklistKind,
): { checklist: ChecklistRow; created: boolean } {
  const lists = projectChecklists(ctx, projectId);
  const byId = lists.find((l) => l.id === ref);
  if (byId) return { checklist: byId, created: false };

  const wanted = normalizeName(ref);
  const sameName = lists.filter((l) => normalizeName(l.title) === wanted && (!kind || l.kind === kind));
  if (sameName.length) return { checklist: single(ref, sameName), created: false };

  const aliasKind = KIND_ALIASES[wanted];
  if (aliasKind && (!kind || kind === aliasKind)) {
    const ofKind = lists.filter((l) => l.kind === aliasKind);
    if (ofKind.length) return { checklist: single(ref, ofKind), created: false };
    return { checklist: createChecklist(ctx, projectId, { title: KIND_TITLES[aliasKind], kind: aliasKind }), created: true };
  }

  const fuzzy = matchByName(kind ? lists.filter((l) => l.kind === kind) : lists, ref);
  if (fuzzy.length) return { checklist: single(ref, fuzzy), created: false };
  return { checklist: createChecklist(ctx, projectId, { title: ref.trim(), kind: kind ?? 'todo' }), created: true };
}

export interface AddItemsResult {
  project: { id: string; title: string };
  checklist: ChecklistRow;
  checklistCreated: boolean;
  items: ChecklistItem[];
}

/** Adds items to a project's checklist, named by id, title or kind. */
export function addItemsToProject(
  ctx: ServiceContext,
  projectRef: string,
  checklistRef: string,
  items: ItemCreate[],
  kind?: ChecklistKind,
): AddItemsResult {
  const project = resolveProject(ctx, projectRef);
  return atomically(ctx, (tx) => {
    const { checklist, created } = findOrCreateChecklist(tx, project.id, checklistRef, kind);
    return { project, checklist, checklistCreated: created, items: addItems(tx, checklist.id, items) };
  });
}

export interface StarterChecklist {
  title?: string;
  kind: ChecklistKind;
  items?: ItemCreate[];
}

/** Creates a project together with its starter checklists, or nothing at all. */
export function createProjectWithChecklists(
  ctx: ServiceContext,
  input: ProjectCreate,
  starters: StarterChecklist[] = [],
): ProjectDetail {
  return atomically(ctx, (tx) => {
    const project = createProject(tx, input);
    for (const starter of starters) {
      const list = createChecklist(tx, project.id, { title: starter.title ?? KIND_TITLES[starter.kind], kind: starter.kind });
      if (starter.items?.length) addItems(tx, list.id, starter.items);
    }
    return getProject(tx, project.id);
  });
}

/** Adds, removes or replaces an item's links and keeps exactly one link preferred. */
export function setItemLinks(ctx: ServiceContext, itemId: string, input: ItemLinksSet): ChecklistItem {
  const data = itemLinksSetSchema.parse(input);
  ctx.db.transaction((tx) => {
    const item = tx.select().from(checklistItems).where(eq(checklistItems.id, itemId)).get();
    if (!item) throw new NotFoundError('Item', itemId);
    const { projectId } = getChecklistRow(tx, item.checklistId);
    const existing = tx.select().from(itemLinks).where(eq(itemLinks.itemId, itemId)).all();

    const removeIds = data.replace ? existing.map((l) => l.id) : (data.remove ?? []);
    for (const linkId of removeIds) {
      if (!existing.some((l) => l.id === linkId)) throw new NotFoundError('Link', linkId);
      tx.delete(itemLinks).where(eq(itemLinks.id, linkId)).run();
    }
    for (const link of data.replace ?? data.add ?? []) insertLink(tx, ctx, itemId, link);

    const remaining = tx.select().from(itemLinks).where(eq(itemLinks.itemId, itemId)).orderBy(asc(itemLinks.sortKey)).all();
    if (remaining.length > 0 && !remaining.some((l) => l.preferred)) {
      tx.update(itemLinks).set({ preferred: true }).where(eq(itemLinks.id, remaining[0]!.id)).run();
    }
    touchProject(tx, ctx, projectId);
    logActivity(tx, ctx, { projectId, entity: 'item', entityId: itemId, action: 'set_links', diff: input });
  });
  return getItem(ctx.db, itemId);
}
