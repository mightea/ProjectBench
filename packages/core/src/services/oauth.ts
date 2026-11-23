import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, count, desc, eq, inArray, isNull, lt, notInArray } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db.ts';
import { NotFoundError } from '../errors.ts';
import { fetchPublicJson } from '../fetch-url.ts';
import { newId } from '../ids.ts';
import { oauthClients, oauthCodes, oauthGrants, oauthTokens } from '../schema.ts';
import type { OAuthConnection } from '../schemas.ts';
import { logActivity, type ServiceContext } from './context.ts';

export const OAUTH_SCOPE = 'mcp';
export const OAUTH_SCOPES_SUPPORTED = [OAUTH_SCOPE, 'offline_access'];

const ACCESS_TTL_S = 60 * 60;
const REFRESH_TTL_MS = 90 * 86_400_000;
const CODE_TTL_MS = 60_000;
const CIMD_TTL_MS = 60 * 60_000;
const UNUSED_CLIENT_TTL_MS = 86_400_000;
const LAST_USED_RESOLUTION_MS = 60_000;
/** Two parallel refreshes are normal; only a later replay looks like a stolen token. */
const REFRESH_REUSE_LEEWAY_MS = 30_000;
const MAX_CLIENTS = 1000;

const ACCESS_PREFIX = 'pba_';
const REFRESH_PREFIX = 'pbr_';
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

export class OAuthError extends Error {
  constructor(
    public readonly code: string,
    description: string,
    public readonly status: 400 | 401 | 503 = 400,
  ) {
    super(description);
    this.name = 'OAuthError';
  }
}

export interface OAuthIssuer {
  issuer: string;
  /** The canonical MCP endpoint, which tokens are bound to. */
  resource: string;
}

/** OAuth needs HTTPS, or localhost for development. Returns undefined for any other address. */
export function oauthIssuerFor(publicUrl: string | undefined): OAuthIssuer | undefined {
  if (!publicUrl) return undefined;
  try {
    const url = new URL(publicUrl);
    if (url.protocol !== 'https:' && url.hostname !== 'localhost') return undefined;
    return { issuer: url.origin, resource: `${url.origin}/mcp` };
  } catch {
    return undefined;
  }
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const secret = (prefix = '') => prefix + randomBytes(32).toString('base64url');
const iso = (ms: number) => new Date(ms).toISOString();

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/** Redirects go to HTTPS or to an app on this computer, never carrying a fragment or credentials. */
export function isValidRedirectUri(value: string): boolean {
  const url = parseUrl(value);
  if (!url || url.hash || value.includes('#') || url.username || url.password) return false;
  return url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK.has(url.hostname));
}

/** Exact match, except that native apps on loopback pick a free port at run time (RFC 8252). */
export function redirectUriMatches(registered: string, requested: string): boolean {
  if (registered === requested) return true;
  const a = parseUrl(registered);
  const b = parseUrl(requested);
  if (!a || !b || a.protocol !== 'http:' || b.protocol !== 'http:' || !LOOPBACK.has(a.hostname)) return false;
  return a.hostname === b.hostname && a.pathname === b.pathname && a.search === b.search && !b.hash && !b.username && !b.password;
}

// --- Clients ------------------------------------------------------------------

const registrationSchema = z.object({
  redirect_uris: z.array(z.string().max(2048)).min(1).max(10),
  client_name: z.string().trim().min(1).max(100).optional(),
  grant_types: z.array(z.string().max(100)).max(10).optional(),
  response_types: z.array(z.string().max(100)).max(10).optional(),
});

/** Dynamic client registration (RFC 7591). Every client is public and proves itself with PKCE. */
export function registerOAuthClient(ctx: ServiceContext, input: unknown, now = new Date()) {
  const parsed = registrationSchema.safeParse(input);
  if (!parsed.success) throw new OAuthError('invalid_client_metadata', 'The client metadata is not valid');
  const { redirect_uris: redirectUris, client_name: clientName, grant_types: grants, response_types: responses } = parsed.data;
  if (!redirectUris.every(isValidRedirectUri)) throw new OAuthError('invalid_redirect_uri', 'Redirect URIs must use HTTPS or a loopback address');
  if (grants && (!grants.includes('authorization_code') || grants.some((g) => g !== 'authorization_code' && g !== 'refresh_token'))) {
    throw new OAuthError('invalid_client_metadata', 'Only authorization_code and refresh_token are supported');
  }
  if (responses && (responses.length !== 1 || responses[0] !== 'code')) {
    throw new OAuthError('invalid_client_metadata', 'Only the code response type is supported');
  }

  pruneOAuth(ctx.db, now);
  if ((ctx.db.select({ n: count() }).from(oauthClients).get()?.n ?? 0) >= MAX_CLIENTS) {
    throw new OAuthError('temporarily_unavailable', 'Too many registered clients', 503);
  }
  const id = newId();
  const name = clientName ?? new URL(redirectUris[0]!).hostname;
  ctx.db.transaction((tx) => {
    tx.insert(oauthClients).values({ id, name, redirectUris: JSON.stringify(redirectUris), kind: 'dcr', createdAt: now.toISOString() }).run();
    logActivity(tx, ctx, { projectId: null, entity: 'oauth_client', entityId: id, action: 'create', diff: { name } });
  });
  return {
    client_id: id,
    client_id_issued_at: Math.floor(now.getTime() / 1000),
    client_name: name,
    redirect_uris: redirectUris,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  };
}

const metadataSchema = z.object({
  client_id: z.string(),
  client_name: z.string().trim().min(1).max(100),
  redirect_uris: z.array(z.string().max(2048)).min(1).max(10),
  token_endpoint_auth_method: z.literal('none').optional(),
});

export type ClientMetadataFetcher = (url: string) => Promise<unknown>;
export { fetchPublicJson };

function isMetadataUrl(clientId: string): boolean {
  const url = parseUrl(clientId);
  return !!url && url.protocol === 'https:' && url.pathname !== '/' && url.href === clientId && !url.hash && !url.search && !url.username && !url.password;
}

/** Finds a registered client, or loads one from its metadata document (CIMD). */
async function resolveClient(ctx: ServiceContext, clientId: string, fetchMetadata: ClientMetadataFetcher, now: Date) {
  const row = ctx.db.select().from(oauthClients).where(eq(oauthClients.id, clientId)).get();
  if (!isMetadataUrl(clientId)) return row?.kind === 'dcr' ? row : undefined;
  if (row?.kind === 'cimd' && row.fetchedAt && now.getTime() - Date.parse(row.fetchedAt) < CIMD_TTL_MS) return row;

  let document: z.infer<typeof metadataSchema>;
  try {
    document = metadataSchema.parse(await fetchMetadata(clientId));
  } catch {
    return undefined;
  }
  if (document.client_id !== clientId || !document.redirect_uris.every(isValidRedirectUri)) return undefined;
  const values = { name: document.client_name, redirectUris: JSON.stringify(document.redirect_uris), kind: 'cimd' as const, fetchedAt: now.toISOString() };
  ctx.db
    .insert(oauthClients)
    .values({ id: clientId, ...values, createdAt: now.toISOString() })
    .onConflictDoUpdate({ target: oauthClients.id, set: values })
    .run();
  return ctx.db.select().from(oauthClients).where(eq(oauthClients.id, clientId)).get();
}

// --- Authorization ------------------------------------------------------------

export interface AuthorizationRequest {
  clientId: string;
  clientName: string;
  redirectUri: string;
  redirectHost: string;
  codeChallenge: string;
  scope: string;
  resource: string;
  state?: string;
}

export type AuthorizeCheck =
  | { ok: true; request: AuthorizationRequest }
  /** Without a trusted redirect the error must be shown here, never sent to the given address. */
  | { ok: false; error: string; description: string; redirectTo?: string };

/** The address to send the browser back to, with the issuer so clients can detect mix-ups (RFC 9207). */
export function authorizationRedirect(redirectUri: string, issuer: OAuthIssuer, params: Record<string, string | undefined>): string {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) if (value !== undefined) url.searchParams.set(key, value);
  url.searchParams.set('iss', issuer.issuer);
  return url.href;
}

export async function checkAuthorizeRequest(
  ctx: ServiceContext,
  issuer: OAuthIssuer,
  query: Record<string, string | undefined>,
  fetchMetadata: ClientMetadataFetcher = fetchPublicJson,
  now = new Date(),
): Promise<AuthorizeCheck> {
  const { client_id: clientId, redirect_uri: redirectUri, state } = query;
  if (!clientId || clientId.length > 2048) return { ok: false, error: 'invalid_request', description: 'client_id is missing' };
  const client = await resolveClient(ctx, clientId, fetchMetadata, now);
  if (!client) return { ok: false, error: 'invalid_client', description: 'This app is not registered, or its metadata could not be verified' };
  const registered = JSON.parse(client.redirectUris) as string[];
  if (!redirectUri || !registered.some((r) => redirectUriMatches(r, redirectUri))) {
    return { ok: false, error: 'invalid_request', description: 'redirect_uri does not match this app' };
  }

  const fail = (error: string, description: string): AuthorizeCheck => ({
    ok: false,
    error,
    description,
    redirectTo: authorizationRedirect(redirectUri, issuer, { error, error_description: description, state }),
  });
  if (query.response_type !== 'code') return fail('unsupported_response_type', 'Only the code response type is supported');
  if (query.code_challenge_method !== 'S256') return fail('invalid_request', 'PKCE with S256 is required');
  if (!query.code_challenge || !/^[A-Za-z0-9_-]{43}$/.test(query.code_challenge)) return fail('invalid_request', 'code_challenge is not valid');
  if (query.resource !== undefined && query.resource !== issuer.resource) return fail('invalid_target', 'This server only issues tokens for its MCP endpoint');
  const scopes = query.scope?.split(' ').filter(Boolean) ?? [];
  if (scopes.some((s) => !OAUTH_SCOPES_SUPPORTED.includes(s))) return fail('invalid_scope', 'Unknown scope');

  return {
    ok: true,
    request: {
      clientId: client.id,
      clientName: client.name,
      redirectUri,
      redirectHost: new URL(redirectUri).host,
      codeChallenge: query.code_challenge,
      scope: OAUTH_SCOPE,
      resource: issuer.resource,
      state,
    },
  };
}

/** Called after the owner approved the request. Returns the redirect carrying the code. */
export function approveAuthorization(ctx: ServiceContext, issuer: OAuthIssuer, request: AuthorizationRequest, now = new Date()): string {
  const code = secret();
  ctx.db
    .insert(oauthCodes)
    .values({
      codeHash: sha256(code),
      clientId: request.clientId,
      redirectUri: request.redirectUri,
      codeChallenge: request.codeChallenge,
      scope: request.scope,
      resource: request.resource,
      expiresAt: iso(now.getTime() + CODE_TTL_MS),
    })
    .run();
  return authorizationRedirect(request.redirectUri, issuer, { code, state: request.state });
}

// --- Tokens -------------------------------------------------------------------

export interface OAuthTokenResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
  scope: string;
}

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

function issueTokens(tx: Tx, grantId: string, scope: string, now: Date): OAuthTokenResponse {
  const access = secret(ACCESS_PREFIX);
  const refresh = secret(REFRESH_PREFIX);
  tx.insert(oauthTokens)
    .values([
      { tokenHash: sha256(access), grantId, kind: 'access', expiresAt: iso(now.getTime() + ACCESS_TTL_S * 1000) },
      { tokenHash: sha256(refresh), grantId, kind: 'refresh', expiresAt: iso(now.getTime() + REFRESH_TTL_MS) },
    ])
    .run();
  return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL_S, refresh_token: refresh, scope };
}

function endGrant(ctx: ServiceContext, grantId: string, action: string) {
  ctx.db.transaction((tx) => {
    const grant = tx.select().from(oauthGrants).where(eq(oauthGrants.id, grantId)).get();
    if (!grant) return;
    tx.delete(oauthGrants).where(eq(oauthGrants.id, grantId)).run();
    logActivity(tx, ctx, { projectId: null, entity: 'oauth_grant', entityId: grantId, action, diff: { clientId: grant.clientId } });
  });
}

function pkceMatches(verifier: string, challenge: string): boolean {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return false;
  const actual = Buffer.from(createHash('sha256').update(verifier).digest('base64url'));
  const expected = Buffer.from(challenge);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

const invalidGrant = (description = 'The code or token is not valid') => new OAuthError('invalid_grant', description);

export function exchangeAuthorizationCode(
  ctx: ServiceContext,
  input: { code?: string; clientId?: string; redirectUri?: string; codeVerifier?: string; resource?: string },
  now = new Date(),
): OAuthTokenResponse {
  const { code, clientId, redirectUri, codeVerifier, resource } = input;
  if (!code || !clientId || !redirectUri || !codeVerifier) throw new OAuthError('invalid_request', 'code, client_id, redirect_uri and code_verifier are required');
  const codeHash = sha256(code);
  const row = ctx.db.select().from(oauthCodes).where(eq(oauthCodes.codeHash, codeHash)).get();
  if (!row) throw invalidGrant();
  if (row.consumedAt) {
    // A code used twice may have been intercepted, so what it created is ended too.
    if (row.grantId) endGrant(ctx, row.grantId, 'revoke_code_replay');
    throw invalidGrant();
  }
  // Spent before the checks, so a wrong verifier can't be retried against the same code.
  ctx.db.update(oauthCodes).set({ consumedAt: now.toISOString() }).where(eq(oauthCodes.codeHash, codeHash)).run();
  if (row.expiresAt <= now.toISOString() || row.clientId !== clientId || row.redirectUri !== redirectUri) throw invalidGrant();
  if (resource !== undefined && resource !== row.resource) throw new OAuthError('invalid_target', 'The resource does not match the authorization');
  if (!pkceMatches(codeVerifier, row.codeChallenge)) throw invalidGrant();

  const grantId = newId();
  return ctx.db.transaction((tx) => {
    tx.insert(oauthGrants)
      .values({ id: grantId, clientId, scope: row.scope, resource: row.resource, createdAt: now.toISOString(), lastUsedAt: now.toISOString() })
      .run();
    tx.update(oauthCodes).set({ grantId }).where(eq(oauthCodes.codeHash, codeHash)).run();
    logActivity(tx, ctx, { projectId: null, entity: 'oauth_grant', entityId: grantId, action: 'create', diff: { clientId } });
    return issueTokens(tx, grantId, row.scope, now);
  });
}

export function refreshOAuthToken(
  ctx: ServiceContext,
  input: { refreshToken?: string; clientId?: string; scope?: string; resource?: string },
  now = new Date(),
): OAuthTokenResponse {
  const { refreshToken, clientId, scope, resource } = input;
  if (!refreshToken || !clientId) throw new OAuthError('invalid_request', 'refresh_token and client_id are required');
  const tokenHash = sha256(refreshToken);
  const row = ctx.db
    .select({ token: oauthTokens, grant: oauthGrants })
    .from(oauthTokens)
    .innerJoin(oauthGrants, eq(oauthTokens.grantId, oauthGrants.id))
    .where(and(eq(oauthTokens.tokenHash, tokenHash), eq(oauthTokens.kind, 'refresh')))
    .get();
  if (!row || row.grant.clientId !== clientId || row.token.expiresAt <= now.toISOString()) throw invalidGrant();
  if (row.token.rotatedAt) {
    if (now.getTime() - Date.parse(row.token.rotatedAt) > REFRESH_REUSE_LEEWAY_MS) endGrant(ctx, row.grant.id, 'revoke_token_replay');
    throw invalidGrant();
  }
  if (resource !== undefined && resource !== row.grant.resource) throw new OAuthError('invalid_target', 'The resource does not match the authorization');
  const requested = scope?.split(' ').filter(Boolean) ?? [];
  if (requested.some((s) => !OAUTH_SCOPES_SUPPORTED.includes(s))) throw new OAuthError('invalid_scope', 'Unknown scope');

  return ctx.db.transaction((tx) => {
    tx.update(oauthTokens).set({ rotatedAt: now.toISOString() }).where(eq(oauthTokens.tokenHash, tokenHash)).run();
    tx.update(oauthGrants).set({ lastUsedAt: now.toISOString() }).where(eq(oauthGrants.id, row.grant.id)).run();
    return issueTokens(tx, row.grant.id, row.grant.scope, now);
  });
}

/** True for a live access token that was issued for exactly this resource. */
export function validateOAuthAccessToken(db: Db, token: string | undefined, resource: string, now = new Date()): boolean {
  if (!token?.startsWith(ACCESS_PREFIX)) return false;
  const row = db
    .select({ token: oauthTokens, grant: oauthGrants })
    .from(oauthTokens)
    .innerJoin(oauthGrants, eq(oauthTokens.grantId, oauthGrants.id))
    .where(and(eq(oauthTokens.tokenHash, sha256(token)), eq(oauthTokens.kind, 'access')))
    .get();
  if (!row || row.token.expiresAt <= now.toISOString() || row.grant.resource !== resource) return false;
  const last = row.grant.lastUsedAt ? Date.parse(row.grant.lastUsedAt) : 0;
  if (now.getTime() - last >= LAST_USED_RESOLUTION_MS) {
    db.update(oauthGrants).set({ lastUsedAt: now.toISOString() }).where(eq(oauthGrants.id, row.grant.id)).run();
  }
  return true;
}

/** RFC 7009: unknown tokens are not an error. A token only ends the connection of its own client. */
export function revokeOAuthToken(ctx: ServiceContext, token: string | undefined, clientId: string | undefined): void {
  if (!token || !clientId) return;
  const row = ctx.db
    .select({ grantId: oauthGrants.id, clientId: oauthGrants.clientId })
    .from(oauthTokens)
    .innerJoin(oauthGrants, eq(oauthTokens.grantId, oauthGrants.id))
    .where(eq(oauthTokens.tokenHash, sha256(token)))
    .get();
  if (row?.clientId === clientId) endGrant(ctx, row.grantId, 'revoke');
}

// --- Connections --------------------------------------------------------------

export function listOAuthConnections(ctx: ServiceContext): OAuthConnection[] {
  return ctx.db
    .select({ grant: oauthGrants, client: oauthClients })
    .from(oauthGrants)
    .innerJoin(oauthClients, eq(oauthGrants.clientId, oauthClients.id))
    .orderBy(desc(oauthGrants.createdAt), desc(oauthGrants.id))
    .all()
    .map(({ grant, client }) => ({
      id: grant.id,
      name: client.name,
      redirectHost: new URL((JSON.parse(client.redirectUris) as string[])[0]!).host,
      createdAt: grant.createdAt,
      lastUsedAt: grant.lastUsedAt,
    }));
}

export function deleteOAuthConnection(ctx: ServiceContext, id: string): void {
  if (!ctx.db.select({ id: oauthGrants.id }).from(oauthGrants).where(eq(oauthGrants.id, id)).get()) throw new NotFoundError('Connection', id);
  endGrant(ctx, id, 'revoke');
}

/** Removes expired codes and tokens, connections without a live token, and clients never used. */
export function pruneOAuth(db: Db, now = new Date()): void {
  const stamp = now.toISOString();
  db.transaction((tx) => {
    tx.delete(oauthCodes).where(lt(oauthCodes.expiresAt, iso(now.getTime() - CODE_TTL_MS))).run();
    tx.delete(oauthTokens).where(lt(oauthTokens.expiresAt, stamp)).run();
    const live = tx.selectDistinct({ id: oauthTokens.grantId }).from(oauthTokens).where(and(eq(oauthTokens.kind, 'refresh'), isNull(oauthTokens.rotatedAt)));
    tx.delete(oauthGrants).where(notInArray(oauthGrants.id, live)).run();
    const used = tx.selectDistinct({ id: oauthGrants.clientId }).from(oauthGrants);
    const pending = tx.selectDistinct({ id: oauthCodes.clientId }).from(oauthCodes);
    const stale = tx
      .select({ id: oauthClients.id })
      .from(oauthClients)
      .where(and(lt(oauthClients.createdAt, iso(now.getTime() - UNUSED_CLIENT_TTL_MS)), notInArray(oauthClients.id, used), notInArray(oauthClients.id, pending)))
      .all()
      .map((c) => c.id);
    if (stale.length) tx.delete(oauthClients).where(inArray(oauthClients.id, stale)).run();
  });
}
