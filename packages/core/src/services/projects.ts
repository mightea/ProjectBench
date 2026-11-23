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

function toSummary(row: ProjectRow, tagNames: string[], agg?: Aggregates): ProjectSummary {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    priority: row.priority,
    dueDate: row.dueDate,
    color: row.color,
    icon: row.icon,
    coverAttachmentId: row.coverAttachmentId,
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
  return rows.map((r) => toSummary(r, tagMap.get(r.id) ?? [], aggs.get(r.id)));
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

  const summary = toSummary(row, tagsForProjects(ctx.db, [id]).get(id) ?? [], aggregatesFor(ctx.db, [id]).get(id));
  return {
    ...summary,
    description: row.description,
    startDate: row.startDate,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
    checklists: checklistsOut,
  };
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
    tx.insert(projects)
      .values({
        id,
        title: data.title,
        description: data.description ?? null,
        status: data.status ?? 'planned',
        priority,
        dueDate: data.dueDate ?? null,
        startDate: data.startDate ?? null,
        color: data.color ?? null,
        icon: data.icon ?? null,
        sortKey: keyAt(siblingKeys(tx, priority)),
        completedAt: data.status === 'done' ? now : null,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    if (data.tags) setProjectTags(tx, id, data.tags);
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
