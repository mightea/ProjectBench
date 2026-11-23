import { and, asc, eq, ne } from 'drizzle-orm';
import { InvalidOperationError, NotFoundError } from '../errors.ts';
import { newId } from '../ids.ts';
import { checklistItems, itemLinks } from '../schema.ts';
import {
  itemsCreateSchema,
  itemUpdateSchema,
  type ChecklistItem,
  type ItemCreate,
  type ItemState,
  type ItemUpdate,
} from '../schemas.ts';
import { assertSameProject, getChecklistRow } from './checklists.ts';
import { definedOnly, indexSearch, keyAt, logActivity, nowIso, removeSearch, type DbLike, type ServiceContext } from './context.ts';
import { insertLink } from './links.ts';
import { touchProject } from './projects.ts';

function itemKeys(tx: DbLike, checklistId: string, excludeId?: string) {
  return tx
    .select({ key: checklistItems.sortKey })
    .from(checklistItems)
    .where(
      excludeId
        ? and(eq(checklistItems.checklistId, checklistId), ne(checklistItems.id, excludeId))
        : eq(checklistItems.checklistId, checklistId),
    )
    .orderBy(asc(checklistItems.sortKey))
    .all()
    .map((r) => r.key);
}

export function getItem(tx: DbLike, id: string): ChecklistItem {
  const i = tx.select().from(checklistItems).where(eq(checklistItems.id, id)).get();
  if (!i) throw new NotFoundError('Item', id);
  const links = tx.select().from(itemLinks).where(eq(itemLinks.itemId, id)).orderBy(asc(itemLinks.sortKey)).all();
  return {
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
    links: links.map((l) => ({
      id: l.id,
      url: l.url,
      shop: l.shop,
      price: l.price,
      currency: l.currency,
      note: l.note,
      preferred: l.preferred,
    })),
  };
}

export function addItems(ctx: ServiceContext, checklistId: string, items: ItemCreate[]): ChecklistItem[] {
  const data = itemsCreateSchema.parse({ items });
  const ids: string[] = [];
  const now = nowIso(ctx);
  ctx.db.transaction((tx) => {
    const list = getChecklistRow(tx, checklistId);
    const keys = itemKeys(tx, checklistId);
    for (const item of data.items) {
      const id = newId();
      const sortKey = keyAt(keys);
      keys.push(sortKey);
      tx.insert(checklistItems)
        .values({
          id,
          checklistId,
          text: item.text,
          quantity: item.quantity ?? null,
          unit: item.unit ?? null,
          dueDate: item.dueDate ?? null,
          note: item.note ?? null,
          sortKey,
          createdAt: now,
          updatedAt: now,
        })
        .run();
      for (const link of item.links ?? []) insertLink(tx, ctx, id, link);
      indexSearch(tx, { entity: 'item', entityId: id, projectId: list.projectId, title: item.text, body: item.note });
      ids.push(id);
    }
    touchProject(tx, ctx, list.projectId);
    logActivity(tx, ctx, {
      projectId: list.projectId,
      entity: 'checklist',
      entityId: checklistId,
      action: 'add_items',
      diff: data.items.map((i) => i.text),
    });
  });
  return ids.map((id) => getItem(ctx.db, id));
}

function statePatch(
  current: { state: ItemState; orderedAt: string | null },
  next: ItemState,
  kind: string,
  now: string,
): Partial<typeof checklistItems.$inferInsert> {
  if (next === current.state) return {};
  if (next === 'ordered' && kind !== 'buy') throw new InvalidOperationError('Only items on a buy list can be ordered');
  switch (next) {
    case 'open':
      return { state: 'open', orderedAt: null, doneAt: null, paidTotal: null, paidCurrency: null };
    case 'ordered':
      return { state: 'ordered', orderedAt: current.orderedAt ?? now, doneAt: null };
    case 'done':
      return { state: 'done', doneAt: now };
  }
}

export function updateItem(ctx: ServiceContext, id: string, input: ItemUpdate): ChecklistItem {
  const { state, checklistId: targetId, position, ...fields } = itemUpdateSchema.parse(input);
  const now = nowIso(ctx);
  ctx.db.transaction((tx) => {
    const current = tx.select().from(checklistItems).where(eq(checklistItems.id, id)).get();
    if (!current) throw new NotFoundError('Item', id);
    const moving = targetId !== undefined && targetId !== current.checklistId;
    if (moving) assertSameProject(tx, [current.checklistId, targetId]);
    const list = getChecklistRow(tx, moving ? targetId : current.checklistId);

    const patch: Partial<typeof checklistItems.$inferInsert> = { ...definedOnly(fields), updatedAt: now };
    if (fields.paidTotal === null) patch.paidCurrency = null;
    else if (fields.paidTotal !== undefined) patch.paidCurrency = fields.paidCurrency ?? current.paidCurrency ?? 'CHF';
    if (state) Object.assign(patch, statePatch(current, state, list.kind, now));
    if (moving) {
      patch.checklistId = targetId;
      if (list.kind !== 'buy' && (patch.state ?? current.state) === 'ordered') Object.assign(patch, { state: 'open', orderedAt: null, paidTotal: null, paidCurrency: null });
    }
    if (moving || position !== undefined) patch.sortKey = keyAt(itemKeys(tx, list.id, id), position);

    tx.update(checklistItems).set(patch).where(eq(checklistItems.id, id)).run();
    if (fields.text !== undefined || fields.note !== undefined) {
      indexSearch(tx, {
        entity: 'item',
        entityId: id,
        projectId: list.projectId,
        title: fields.text ?? current.text,
        body: fields.note !== undefined ? fields.note : current.note,
      });
    }
    touchProject(tx, ctx, list.projectId);
    logActivity(tx, ctx, { projectId: list.projectId, entity: 'item', entityId: id, action: 'update', diff: input });
  });
  return getItem(ctx.db, id);
}

export function deleteItem(ctx: ServiceContext, id: string): void {
  ctx.db.transaction((tx) => {
    const current = tx.select().from(checklistItems).where(eq(checklistItems.id, id)).get();
    if (!current) throw new NotFoundError('Item', id);
    const list = getChecklistRow(tx, current.checklistId);
    tx.delete(checklistItems).where(eq(checklistItems.id, id)).run();
    removeSearch(tx, 'item', id);
    touchProject(tx, ctx, list.projectId);
    logActivity(tx, ctx, { projectId: list.projectId, entity: 'item', entityId: id, action: 'delete', diff: { text: current.text } });
  });
}
