import { and, asc, eq, inArray, ne } from 'drizzle-orm';
import { InvalidOperationError, NotFoundError } from '../errors.ts';
import { newId } from '../ids.ts';
import { checklistItems, checklists, projects } from '../schema.ts';
import { checklistCreateSchema, checklistUpdateSchema, type ChecklistCreate, type ChecklistUpdate } from '../schemas.ts';
import { definedOnly, keyAt, logActivity, nowIso, removeSearch, type DbLike, type ServiceContext } from './context.ts';
import { touchProject } from './projects.ts';

export interface ChecklistRow {
  id: string;
  projectId: string;
  title: string;
  kind: 'buy' | 'clarify' | 'todo';
}

function listKeys(tx: DbLike, projectId: string, excludeId?: string) {
  return tx
    .select({ key: checklists.sortKey })
    .from(checklists)
    .where(excludeId ? and(eq(checklists.projectId, projectId), ne(checklists.id, excludeId)) : eq(checklists.projectId, projectId))
    .orderBy(asc(checklists.sortKey))
    .all()
    .map((r) => r.key);
}

export function getChecklistRow(tx: DbLike, id: string): ChecklistRow {
  const row = tx
    .select({ id: checklists.id, projectId: checklists.projectId, title: checklists.title, kind: checklists.kind })
    .from(checklists)
    .where(eq(checklists.id, id))
    .get();
  if (!row) throw new NotFoundError('Checklist', id);
  return row;
}

export function createChecklist(ctx: ServiceContext, projectId: string, input: ChecklistCreate): ChecklistRow {
  const data = checklistCreateSchema.parse(input);
  const id = newId();
  const now = nowIso(ctx);
  ctx.db.transaction((tx) => {
    if (!tx.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)).get()) {
      throw new NotFoundError('Project', projectId);
    }
    tx.insert(checklists)
      .values({ id, projectId, title: data.title, kind: data.kind, sortKey: keyAt(listKeys(tx, projectId)), createdAt: now, updatedAt: now })
      .run();
    touchProject(tx, ctx, projectId);
    logActivity(tx, ctx, { projectId, entity: 'checklist', entityId: id, action: 'create', diff: data });
  });
  return { id, projectId, title: data.title, kind: data.kind };
}

export function updateChecklist(ctx: ServiceContext, id: string, input: ChecklistUpdate): ChecklistRow {
  const { position, ...fields } = checklistUpdateSchema.parse(input);
  ctx.db.transaction((tx) => {
    const current = getChecklistRow(tx, id);
    const patch: Partial<typeof checklists.$inferInsert> = { ...definedOnly(fields), updatedAt: nowIso(ctx) };
    if (position !== undefined) patch.sortKey = keyAt(listKeys(tx, current.projectId, id), position);
    if (fields.kind && fields.kind !== 'buy' && current.kind === 'buy') {
      // 'ordered' only exists on buy lists.
      tx.update(checklistItems)
        .set({ state: 'open', orderedAt: null })
        .where(and(eq(checklistItems.checklistId, id), eq(checklistItems.state, 'ordered')))
        .run();
    }
    tx.update(checklists).set(patch).where(eq(checklists.id, id)).run();
    touchProject(tx, ctx, current.projectId);
    logActivity(tx, ctx, { projectId: current.projectId, entity: 'checklist', entityId: id, action: 'update', diff: input });
  });
  return getChecklistRow(ctx.db, id);
}

export function deleteChecklist(ctx: ServiceContext, id: string): void {
  ctx.db.transaction((tx) => {
    const current = getChecklistRow(tx, id);
    const itemIds = tx.select({ id: checklistItems.id }).from(checklistItems).where(eq(checklistItems.checklistId, id)).all();
    for (const { id: itemId } of itemIds) removeSearch(tx, 'item', itemId);
    tx.delete(checklists).where(eq(checklists.id, id)).run();
    touchProject(tx, ctx, current.projectId);
    logActivity(tx, ctx, { projectId: current.projectId, entity: 'checklist', entityId: id, action: 'delete', diff: { title: current.title } });
  });
}

/** Finds a checklist of a project by id, exact title or kind; used by MCP-style lookups. */
export function findChecklist(tx: DbLike, projectId: string, ref: string): ChecklistRow | undefined {
  const rows = tx
    .select({ id: checklists.id, projectId: checklists.projectId, title: checklists.title, kind: checklists.kind })
    .from(checklists)
    .where(eq(checklists.projectId, projectId))
    .orderBy(asc(checklists.sortKey))
    .all();
  const lower = ref.toLowerCase();
  return rows.find((r) => r.id === ref) ?? rows.find((r) => r.title.toLowerCase() === lower) ?? rows.find((r) => r.kind === lower);
}

export function assertSameProject(tx: DbLike, checklistIds: string[]) {
  const rows = tx.select({ projectId: checklists.projectId }).from(checklists).where(inArray(checklists.id, checklistIds)).all();
  if (new Set(rows.map((r) => r.projectId)).size > 1) throw new InvalidOperationError('Items can only move within a project');
}
