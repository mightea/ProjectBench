import { createHash, randomBytes } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import type { Db } from '../db.ts';
import { NotFoundError } from '../errors.ts';
import { newId } from '../ids.ts';
import { apiTokens } from '../schema.ts';
import { apiTokenCreateSchema, type ApiToken, type ApiTokenCreate, type ApiTokenCreated } from '../schemas.ts';
import { logActivity, nowIso, type ServiceContext } from './context.ts';

const TOKEN_PREFIX = 'pb_';
const VISIBLE_CHARS = 11;
/** Avoids a database write on every MCP request. */
const LAST_USED_RESOLUTION_MS = 60_000;

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

const toToken = (row: typeof apiTokens.$inferSelect): ApiToken => ({
  id: row.id,
  name: row.name,
  prefix: row.prefix,
  createdAt: row.createdAt,
  lastUsedAt: row.lastUsedAt,
  revokedAt: row.revokedAt,
});

/** Creates a token. The raw value is only available in this return value. */
export function createApiToken(ctx: ServiceContext, input: ApiTokenCreate): ApiTokenCreated {
  const { name } = apiTokenCreateSchema.parse(input);
  const token = TOKEN_PREFIX + randomBytes(32).toString('base64url');
  const id = newId();
  const now = nowIso(ctx);
  ctx.db.transaction((tx) => {
    tx.insert(apiTokens)
      .values({ id, name, tokenHash: sha256(token), prefix: token.slice(0, VISIBLE_CHARS), createdAt: now })
      .run();
    logActivity(tx, ctx, { projectId: null, entity: 'token', entityId: id, action: 'create', diff: { name } });
  });
  return { id, name, prefix: token.slice(0, VISIBLE_CHARS), createdAt: now, lastUsedAt: null, revokedAt: null, token };
}

export function listApiTokens(ctx: ServiceContext): ApiToken[] {
  return ctx.db.select().from(apiTokens).orderBy(desc(apiTokens.createdAt), desc(apiTokens.id)).all().map(toToken);
}

export function revokeApiToken(ctx: ServiceContext, id: string): ApiToken {
  const now = nowIso(ctx);
  ctx.db.transaction((tx) => {
    const current = tx.select().from(apiTokens).where(eq(apiTokens.id, id)).get();
    if (!current) throw new NotFoundError('Token', id);
    if (current.revokedAt) return;
    tx.update(apiTokens).set({ revokedAt: now }).where(eq(apiTokens.id, id)).run();
    logActivity(tx, ctx, { projectId: null, entity: 'token', entityId: id, action: 'revoke', diff: { name: current.name } });
  });
  return toToken(ctx.db.select().from(apiTokens).where(eq(apiTokens.id, id)).get()!);
}

/** Returns true for a live token and records when it was last used. */
export function validateApiToken(db: Db, token: string | undefined, now = new Date()): boolean {
  if (!token?.startsWith(TOKEN_PREFIX)) return false;
  const row = db.select().from(apiTokens).where(eq(apiTokens.tokenHash, sha256(token))).get();
  if (!row || row.revokedAt) return false;
  const last = row.lastUsedAt ? Date.parse(row.lastUsedAt) : 0;
  if (now.getTime() - last >= LAST_USED_RESOLUTION_MS) {
    db.update(apiTokens).set({ lastUsedAt: now.toISOString() }).where(eq(apiTokens.id, row.id)).run();
  }
  return true;
}
