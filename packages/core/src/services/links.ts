import { and, asc, eq, ne } from 'drizzle-orm';
import { NotFoundError } from '../errors.ts';
import { newId } from '../ids.ts';
import { checklistItems, checklists, itemLinks } from '../schema.ts';
import { linkCreateSchema, linkUpdateSchema, type ItemLink, type LinkCreate, type LinkUpdate } from '../schemas.ts';
import { definedOnly, keyAt, logActivity, nowIso, type DbLike, type ServiceContext } from './context.ts';
import { touchProject } from './projects.ts';

/** "https://www.galaxus.ch/de/s1/product/…" → "galaxus.ch" */
export function shopFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}

function linkKeys(tx: DbLike, itemId: string, excludeId?: string) {
  return tx
    .select({ key: itemLinks.sortKey })
    .from(itemLinks)
    .where(excludeId ? and(eq(itemLinks.itemId, itemId), ne(itemLinks.id, excludeId)) : eq(itemLinks.itemId, itemId))
    .orderBy(asc(itemLinks.sortKey))
    .all()
    .map((r) => r.key);
}

function projectOfItem(tx: DbLike, itemId: string): string {
  const row = tx
    .select({ projectId: checklists.projectId })
    .from(checklistItems)
    .innerJoin(checklists, eq(checklists.id, checklistItems.checklistId))
    .where(eq(checklistItems.id, itemId))
    .get();
  if (!row) throw new NotFoundError('Item', itemId);
  return row.projectId;
}

function clearPreferred(tx: DbLike, itemId: string, exceptId: string) {
  tx.update(itemLinks)
    .set({ preferred: false })
    .where(and(eq(itemLinks.itemId, itemId), ne(itemLinks.id, exceptId)))
    .run();
}

/** Inserts a link inside an existing transaction. The first link of an item becomes preferred. */
export function insertLink(tx: DbLike, ctx: ServiceContext, itemId: string, input: LinkCreate): string {
  const data = linkCreateSchema.parse(input);
  const id = newId();
  const now = nowIso(ctx);
  const keys = linkKeys(tx, itemId);
  const preferred = data.preferred ?? keys.length === 0;
  tx.insert(itemLinks)
    .values({
      id,
      itemId,
      url: data.url,
      shop: data.shop ?? shopFromUrl(data.url),
      price: data.price ?? null,
      currency: data.currency ?? 'CHF',
      note: data.note ?? null,
      preferred,
      sortKey: keyAt(keys),
      createdAt: now,
      updatedAt: now,
    })
    .run();
  if (preferred) clearPreferred(tx, itemId, id);
  return id;
}

function getLink(tx: DbLike, id: string): ItemLink & { itemId: string } {
  const l = tx.select().from(itemLinks).where(eq(itemLinks.id, id)).get();
  if (!l) throw new NotFoundError('Link', id);
  return { id: l.id, itemId: l.itemId, url: l.url, shop: l.shop, price: l.price, currency: l.currency, note: l.note, preferred: l.preferred };
}

export function addLink(ctx: ServiceContext, itemId: string, input: LinkCreate): ItemLink {
  let id = '';
  ctx.db.transaction((tx) => {
    const projectId = projectOfItem(tx, itemId);
    id = insertLink(tx, ctx, itemId, input);
    touchProject(tx, ctx, projectId);
    logActivity(tx, ctx, { projectId, entity: 'link', entityId: id, action: 'create', diff: input });
  });
  return getLink(ctx.db, id);
}

export function updateLink(ctx: ServiceContext, id: string, input: LinkUpdate): ItemLink {
  const { position, ...fields } = linkUpdateSchema.parse(input);
  ctx.db.transaction((tx) => {
    const current = getLink(tx, id);
    const projectId = projectOfItem(tx, current.itemId);
    const patch: Partial<typeof itemLinks.$inferInsert> = { ...definedOnly(fields), updatedAt: nowIso(ctx) };
    if (fields.url !== undefined && fields.shop === undefined && current.shop === shopFromUrl(current.url)) {
      patch.shop = shopFromUrl(fields.url);
    }
    if (position !== undefined) patch.sortKey = keyAt(linkKeys(tx, current.itemId, id), position);
    tx.update(itemLinks).set(patch).where(eq(itemLinks.id, id)).run();
    if (fields.preferred) clearPreferred(tx, current.itemId, id);
    touchProject(tx, ctx, projectId);
    logActivity(tx, ctx, { projectId, entity: 'link', entityId: id, action: 'update', diff: input });
  });
  return getLink(ctx.db, id);
}

export function deleteLink(ctx: ServiceContext, id: string): void {
  ctx.db.transaction((tx) => {
    const current = getLink(tx, id);
    const projectId = projectOfItem(tx, current.itemId);
    tx.delete(itemLinks).where(eq(itemLinks.id, id)).run();
    if (current.preferred) {
      // Hand "preferred" to the next link, if any.
      const next = tx.select({ id: itemLinks.id }).from(itemLinks).where(eq(itemLinks.itemId, current.itemId)).orderBy(asc(itemLinks.sortKey)).get();
      if (next) tx.update(itemLinks).set({ preferred: true }).where(eq(itemLinks.id, next.id)).run();
    }
    touchProject(tx, ctx, projectId);
    logActivity(tx, ctx, { projectId, entity: 'link', entityId: id, action: 'delete', diff: { url: current.url } });
  });
}
