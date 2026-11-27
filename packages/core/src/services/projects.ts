import { and, asc, desc, eq, inArray, ne, notInArray, sql, type SQL } from 'drizzle-orm';
import { InvalidOperationError, NotFoundError } from '../errors.ts';
import { newId } from '../ids.ts';
import { isPreviewableImage } from '../media.ts';
import { attachments, checklistItems, checklists, itemLinks, projects, projectTags, tags } from '../schema.ts';
import {
  projectCreateSchema,
  projectListQuerySchema,
  projectUpdateSchema,
  type Checklist,
  type ChecklistItem,
  type ChecklistKind,
  type ItemLink,
  type NextStep,
  type Progress,
  type ProjectCreate,
  type ProjectDetail,
  type ProjectListQuery,
  type ProjectRef,
  type ProjectSummary,
  type ProjectUpdate,
} from '../schemas.ts';
import {
  definedOnly,
  indexSearch,
  keyAt,
  logActivity,
  nowIso,
  removeProjectSearch,
  type DbLike,
  type ServiceContext,
} from './context.ts';
import { releaseFiles } from './file-refs.ts';
import { setProjectTags, tagsForProjects } from './tags.ts';

type ProjectRow = typeof projects.$inferSelect;

interface Aggregates {
  progress: Progress;
  kinds: Record<ChecklistKind, Progress>;
  nextStep: NextStep | null;
  nextItemDue: string | null;
}

const noProgress = (): Progress => ({ total: 0, done: 0, ordered: 0 });
const noKinds = (): Record<ChecklistKind, Progress> => ({ buy: noProgress(), clarify: noProgress(), todo: noProgress() });

function aggregatesFor(tx: DbLike, projectIds: string[]): Map<string, Aggregates> {
  const result = new Map<string, Aggregates>();
  if (projectIds.length === 0) return result;
  const rows = tx
    .select({
      projectId: checklists.projectId,
      kind: checklists.kind,
      total: sql<number>`count(${checklistItems.id})`,
      done: sql<number>`coalesce(sum(${checklistItems.state} = 'done'), 0)`,
      ordered: sql<number>`coalesce(sum(${checklistItems.state} = 'ordered'), 0)`,
      nextItemDue: sql<string | null>`min(case when ${checklistItems.state} != 'done' then ${checklistItems.dueDate} end)`,
    })
    .from(checklistItems)
    .innerJoin(checklists, eq(checklists.id, checklistItems.checklistId))
    .where(inArray(checklists.projectId, projectIds))
    .groupBy(checklists.projectId, checklists.kind)
    .all();
  for (const r of rows) {
    const agg = result.get(r.projectId) ?? { progress: noProgress(), kinds: noKinds(), nextStep: null, nextItemDue: null };
    agg.kinds[r.kind] = { total: r.total, done: r.done, ordered: r.ordered };
    agg.progress.total += r.total;
    agg.progress.done += r.done;
    agg.progress.ordered += r.ordered;
    if (r.nextItemDue && (!agg.nextItemDue || r.nextItemDue < agg.nextItemDue)) agg.nextItemDue = r.nextItemDue;
    result.set(r.projectId, agg);
  }

  const steps = tx
    .select({ projectId: checklists.projectId, id: checklistItems.id, text: checklistItems.text, note: checklistItems.note })
    .from(checklistItems)
    .innerJoin(checklists, eq(checklists.id, checklistItems.checklistId))
    .where(and(inArray(checklists.projectId, projectIds), eq(checklists.kind, 'todo'), eq(checklistItems.state, 'open')))
    .orderBy(asc(checklists.sortKey), asc(checklistItems.sortKey))
    .all();
  for (const { projectId, ...step } of steps) {
    const agg = result.get(projectId);
    if (agg && !agg.nextStep) agg.nextStep = step;
  }
  return result;
}

function toSummary(row: ProjectRow, tagNames: string[], agg?: Aggregates, parentTitle: string | null = null): ProjectSummary {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    priority: row.priority,
    dueDate: row.dueDate,
    color: row.color,
    icon: row.icon,
    coverAttachmentId: row.coverAttachmentId,
    parentId: row.parentId,
    parentTitle,
    tags: tagNames,
    progress: agg?.progress ?? noProgress(),
    kinds: agg?.kinds ?? noKinds(),
    nextStep: agg?.nextStep ?? null,
    nextItemDue: agg?.nextItemDue ?? null,
    updatedAt: row.updatedAt,
  };
}

export function listProjects(ctx: ServiceContext, query: ProjectListQuery = {}): ProjectSummary[] {
  const q = projectListQuerySchema.parse(query);
  const where: SQL[] = [];
  if (q.parentId) where.push(eq(projects.parentId, q.parentId));
  if (q.status === 'open') where.push(notInArray(projects.status, ['done', 'archived']));
  else if (q.status !== 'all') where.push(eq(projects.status, q.status));
  if (q.q) {
    const pattern = `%${q.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    where.push(sql`${projects.title} like ${pattern} escape '\\'`);
  }
  if (q.tag) {
    where.push(
      inArray(
        projects.id,
        ctx.db
          .select({ id: projectTags.projectId })
          .from(projectTags)
          .innerJoin(tags, eq(tags.id, projectTags.tagId))
          .where(eq(tags.name, q.tag.toLowerCase())),
      ),
    );
  }

  const order =
    q.sort === 'due'
      ? [sql`${projects.dueDate} is null`, asc(projects.dueDate), asc(projects.priority), asc(projects.sortKey)]
      : q.sort === 'updated'
        ? [desc(projects.updatedAt)]
        : [asc(projects.priority), asc(projects.sortKey)];

  const rows = ctx.db
    .select()
    .from(projects)
    .where(where.length ? and(...where) : undefined)
    .orderBy(...order)
    .all();
  const ids = rows.map((r) => r.id);
  const tagMap = tagsForProjects(ctx.db, ids);
  const aggs = aggregatesFor(ctx.db, ids);
  const parentTitles = titlesOf(ctx.db, rows.map((r) => r.parentId).filter((p): p is string => p !== null));
  return rows.map((r) => toSummary(r, tagMap.get(r.id) ?? [], aggs.get(r.id), r.parentId ? parentTitles.get(r.parentId) : null));
}

function titlesOf(tx: DbLike, ids: string[]): Map<string, string> {
  if (ids.length === 0) return new Map();
  const rows = tx.select({ id: projects.id, title: projects.title }).from(projects).where(inArray(projects.id, [...new Set(ids)])).all();
  return new Map(rows.map((r) => [r.id, r.title]));
}

export function getProject(ctx: ServiceContext, id: string): ProjectDetail {
  const row = ctx.db.select().from(projects).where(eq(projects.id, id)).get();
  if (!row) throw new NotFoundError('Project', id);

  const lists = ctx.db
    .select()
    .from(checklists)
    .where(eq(checklists.projectId, id))
    .orderBy(asc(checklists.sortKey))
    .all();
  const listIds = lists.map((l) => l.id);
  const items = listIds.length
    ? ctx.db
        .select()
        .from(checklistItems)
        .where(inArray(checklistItems.checklistId, listIds))
        .orderBy(asc(checklistItems.sortKey))
        .all()
    : [];
  const itemIds = items.map((i) => i.id);
  const links = itemIds.length
    ? ctx.db.select().from(itemLinks).where(inArray(itemLinks.itemId, itemIds)).orderBy(asc(itemLinks.sortKey)).all()
    : [];

  const linksByItem = new Map<string, ItemLink[]>();
  for (const l of links) {
    linksByItem.set(l.itemId, [
      ...(linksByItem.get(l.itemId) ?? []),
      { id: l.id, url: l.url, shop: l.shop, price: l.price, currency: l.currency, note: l.note, preferred: l.preferred },
    ]);
  }
  const itemsByList = new Map<string, ChecklistItem[]>();
  for (const i of items) {
    itemsByList.set(i.checklistId, [
      ...(itemsByList.get(i.checklistId) ?? []),
      {
        id: i.id,
        checklistId: i.checklistId,
        text: i.text,
        state: i.state,
        orderedAt: i.orderedAt,
        orderRef: i.orderRef,
        paidTotal: i.paidTotal,
        paidCurrency: i.paidCurrency,
        expectedDate: i.expectedDate,
        doneAt: i.doneAt,
        dueDate: i.dueDate,
        quantity: i.quantity,
        unit: i.unit,
        note: i.note,
        links: linksByItem.get(i.id) ?? [],
      },
    ]);
  }
  const checklistsOut: Checklist[] = lists.map((l) => ({
    id: l.id,
    title: l.title,
    kind: l.kind,
    items: itemsByList.get(l.id) ?? [],
  }));

  const parent = row.parentId
    ? (ctx.db
        .select({ id: projects.id, title: projects.title, status: projects.status, color: projects.color, icon: projects.icon })
        .from(projects)
        .where(eq(projects.id, row.parentId))
        .get() satisfies ProjectRef | undefined)
    : undefined;
  const summary = toSummary(row, tagsForProjects(ctx.db, [id]).get(id) ?? [], aggregatesFor(ctx.db, [id]).get(id), parent?.title);
  return {
    ...summary,
    description: row.description,
    startDate: row.startDate,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
    checklists: checklistsOut,
    parent: parent ?? null,
    subprojects: row.parentId ? [] : listProjects(ctx, { status: 'all', parentId: id }),
  };
}

/**
 * Checks that `projectId` (or a new project, when undefined) may become a sub-project of `parentId`.
 * Sub-projects are one level deep: a sub-project can't have its own, and a parent can't become one.
 */
function assertValidParent(tx: DbLike, parentId: string, projectId?: string) {
  if (parentId === projectId) throw new InvalidOperationError('A project can’t be a sub-project of itself');
  const parent = tx.select({ title: projects.title, parentId: projects.parentId }).from(projects).where(eq(projects.id, parentId)).get();
  if (!parent) throw new NotFoundError('Project', parentId);
  if (parent.parentId) {
    throw new InvalidOperationError(`“${parent.title}” is already a sub-project, and sub-projects can’t have their own`);
  }
  if (projectId) {
    const child = tx.select({ id: projects.id }).from(projects).where(eq(projects.parentId, projectId)).get();
    if (child) throw new InvalidOperationError('This project has sub-projects of its own, so it can’t become one');
  }
}

function siblingKeys(tx: DbLike, priority: number, excludeId?: string): string[] {
  return tx
    .select({ key: projects.sortKey })
    .from(projects)
    .where(excludeId ? and(eq(projects.priority, priority), ne(projects.id, excludeId)) : eq(projects.priority, priority))
    .orderBy(asc(projects.sortKey))
    .all()
    .map((r) => r.key);
}

export function createProject(ctx: ServiceContext, input: ProjectCreate): ProjectDetail {
  const data = projectCreateSchema.parse(input);
  const id = newId();
  const now = nowIso(ctx);
  ctx.db.transaction((tx) => {
    const priority = data.priority ?? 3;
    // A sub-project starts with its parent's look and tags, so it reads as part of it.
    const parent = data.parentId ? tx.select().from(projects).where(eq(projects.id, data.parentId)).get() : undefined;
    if (data.parentId) assertValidParent(tx, data.parentId);
    tx.insert(projects)
      .values({
        id,
        title: data.title,
        description: data.description ?? null,
        status: data.status ?? 'planned',
        priority,
        dueDate: data.dueDate ?? null,
        startDate: data.startDate ?? null,
        color: data.color !== undefined ? data.color : (parent?.color ?? null),
        icon: data.icon !== undefined ? data.icon : (parent?.icon ?? null),
        parentId: data.parentId ?? null,
        sortKey: keyAt(siblingKeys(tx, priority)),
        completedAt: data.status === 'done' ? now : null,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    const tagNames = data.tags ?? (parent ? (tagsForProjects(tx, [parent.id]).get(parent.id) ?? []) : undefined);
    if (tagNames?.length) setProjectTags(tx, id, tagNames);
    indexSearch(tx, {
      entity: 'project',
      entityId: id,
      projectId: id,
      title: data.title,
      body: data.description,
      tags: tagsForProjects(tx, [id]).get(id),
    });
    logActivity(tx, ctx, { projectId: id, entity: 'project', entityId: id, action: 'create', diff: data });
  });
  return getProject(ctx, id);
}

export function updateProject(ctx: ServiceContext, id: string, input: ProjectUpdate): ProjectDetail {
  const { tags: tagNames, position, ...fields } = projectUpdateSchema.parse(input);
  const now = nowIso(ctx);
  ctx.db.transaction((tx) => {
    const current = tx.select().from(projects).where(eq(projects.id, id)).get();
    if (!current) throw new NotFoundError('Project', id);
    if (fields.coverAttachmentId) {
      const cover = tx
        .select({ mime: attachments.mime })
        .from(attachments)
        .where(and(eq(attachments.id, fields.coverAttachmentId), eq(attachments.projectId, id)))
        .get();
      if (!cover) throw new NotFoundError('Attachment', fields.coverAttachmentId);
      if (!isPreviewableImage(cover.mime)) throw new InvalidOperationError('A cover must be an image');
    }
    if (fields.parentId) assertValidParent(tx, fields.parentId, id);

    const patch: Partial<typeof projects.$inferInsert> = { ...definedOnly(fields), updatedAt: now };
    const priority = fields.priority ?? current.priority;
    if (fields.priority !== undefined && fields.priority !== current.priority) {
      patch.sortKey = keyAt(siblingKeys(tx, priority, id), position);
    } else if (position !== undefined) {
      patch.sortKey = keyAt(siblingKeys(tx, priority, id), position);
    }
    if (fields.status !== undefined && fields.status !== current.status) {
      patch.completedAt = fields.status === 'done' ? now : null;
    }
    tx.update(projects).set(patch).where(eq(projects.id, id)).run();
    if (tagNames) setProjectTags(tx, id, tagNames);
    if (tagNames || fields.title !== undefined || fields.description !== undefined) {
      indexSearch(tx, {
        entity: 'project',
        entityId: id,
        projectId: id,
        title: fields.title ?? current.title,
        body: fields.description !== undefined ? fields.description : current.description,
        tags: tagsForProjects(tx, [id]).get(id),
      });
    }
    logActivity(tx, ctx, { projectId: id, entity: 'project', entityId: id, action: 'update', diff: input });
  });
  return getProject(ctx, id);
}

export function deleteProject(ctx: ServiceContext, id: string): void {
  const hashes = ctx.db.select({ sha256: attachments.sha256 }).from(attachments).where(eq(attachments.projectId, id)).all();
  ctx.db.transaction((tx) => {
    const res = tx.delete(projects).where(eq(projects.id, id)).run();
    if (res.changes === 0) throw new NotFoundError('Project', id);
    removeProjectSearch(tx, id);
    logActivity(tx, ctx, { projectId: null, entity: 'project', entityId: id, action: 'delete' });
  });
  releaseFiles(ctx, hashes.map((h) => h.sha256));
}

/** Marks a project as touched, e.g. when one of its items changes. */
export function touchProject(tx: DbLike, ctx: ServiceContext, projectId: string) {
  tx.update(projects).set({ updatedAt: nowIso(ctx) }).where(eq(projects.id, projectId)).run();
}
