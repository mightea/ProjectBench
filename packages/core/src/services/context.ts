import { and, eq, sql } from 'drizzle-orm';
import { generateKeyBetween } from 'fractional-indexing';
import type { Db } from '../db.ts';
import { newId } from '../ids.ts';
import { activity } from '../schema.ts';

export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type DbLike = Db | Tx;

export interface ServiceContext {
  db: Db;
  /** Who made the change; shown in the activity log. */
  actor: 'app' | 'mcp';
  /** Injectable clock for tests. */
  now?: () => Date;
}

export const nowIso = (ctx: ServiceContext) => (ctx.now?.() ?? new Date()).toISOString();

/**
 * Sort key for placing an element at `index` among `siblingKeys` (sorted, without the element itself).
 * Without an index it goes to the end.
 */
export function keyAt(siblingKeys: string[], index?: number): string {
  const i = index === undefined ? siblingKeys.length : Math.max(0, Math.min(index, siblingKeys.length));
  return generateKeyBetween(siblingKeys[i - 1] ?? null, siblingKeys[i] ?? null);
}

export function logActivity(
  tx: DbLike,
  ctx: ServiceContext,
  entry: { projectId: string | null; entity: string; entityId: string; action: string; diff?: unknown },
) {
  tx.insert(activity)
    .values({
      id: newId(),
      projectId: entry.projectId,
      entity: entry.entity,
      entityId: entry.entityId,
      action: entry.action,
      actor: ctx.actor,
      diff: entry.diff === undefined ? null : JSON.stringify(entry.diff),
      createdAt: nowIso(ctx),
    })
    .run();
}

/** Keeps the FTS index in step with an entity. */
export function indexSearch(
  tx: DbLike,
  entry: { entity: 'project' | 'item' | 'note'; entityId: string; projectId: string; title: string; body?: string | null },
) {
  removeSearch(tx, entry.entity, entry.entityId);
  tx.run(
    sql`insert into search (entity, entity_id, project_id, title, body) values (${entry.entity}, ${entry.entityId}, ${entry.projectId}, ${entry.title}, ${entry.body ?? ''})`,
  );
}

export function removeSearch(tx: DbLike, entity: string, entityId: string) {
  tx.run(sql`delete from search where entity = ${entity} and entity_id = ${entityId}`);
}

export function removeProjectSearch(tx: DbLike, projectId: string) {
  tx.run(sql`delete from search where project_id = ${projectId}`);
}

/** Returns only the keys of `patch` whose value is not undefined. */
export function definedOnly<T extends object>(patch: T): Partial<T> {
  return Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as Partial<T>;
}

export { and, eq };
