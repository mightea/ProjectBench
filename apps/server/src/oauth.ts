import { randomBytes } from 'node:crypto';
import {
  approveAuthorization,
  authorizationRedirect,
  checkAuthorizeRequest,
  deleteOAuthConnection,
  exchangeAuthorizationCode,
  fetchPublicJson,
  listOAuthConnections,
  NotFoundError,
  OAUTH_SCOPE,
  OAUTH_SCOPES_SUPPORTED,
  OAuthError,
  refreshOAuthToken,
  registerOAuthClient,
  revokeOAuthToken,
  type AuthorizationRequest,
  type ClientMetadataFetcher,
  type Db,
  type OAuthIssuer,
  type ServiceContext,
} from '@projectbench/core';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { z } from 'zod';
import { FailureLimiter } from './rate-limit.ts';

const PENDING_TTL_MS = 10 * 60_000;
const MAX_PENDING = 128;
const MAX_BODY_BYTES = 16 * 1024;
const REGISTRATIONS_PER_HOUR = 30;
const METADATA_FETCHES_PER_HOUR = 60;

/** Requests waiting for the owner's decision. A restart only means connecting again. */
export class PendingAuthorizations {
  private readonly open = new Map<string, { request: AuthorizationRequest; expiresAt: number }>();

  add(request: AuthorizationRequest, now = Date.now()): string {
    for (const [id, entry] of this.open) if (entry.expiresAt <= now) this.open.delete(id);
    while (this.open.size >= MAX_PENDING) this.open.delete(this.open.keys().next().value!);
    const id = randomBytes(24).toString('base64url');
    this.open.set(id, { request, expiresAt: now + PENDING_TTL_MS });
    return id;
  }

  get(id: string, now = Date.now()): AuthorizationRequest | undefined {
    const entry = this.open.get(id);
    return entry && entry.expiresAt > now ? entry.request : undefined;
  }

  take(id: string, now = Date.now()): AuthorizationRequest | undefined {
    const request = this.get(id, now);
    this.open.delete(id);
    return request;
  }
}

export const protectedResourceUrl = (issuer: OAuthIssuer) => `${issuer.issuer}/.well-known/oauth-protected-resource/mcp`;

/** The challenge that sends an MCP client to discovery. */
export const mcpChallenge = (issuer: OAuthIssuer | undefined, tokenSent: boolean) => {
  const error = tokenSent ? 'error="invalid_token", ' : '';
  return issuer ? `Bearer ${error}resource_metadata="${protectedResourceUrl(issuer)}", scope="${OAUTH_SCOPE}"` : 'Bearer';
};

function oauthFailure(c: Context, err: unknown) {
  c.header('Cache-Control', 'no-store');
  if (err instanceof OAuthError) {
    return c.json({ error: err.code, error_description: err.message }, err.status);
  }
  console.error(err);
  return c.json({ error: 'server_error', error_description: 'Internal error' }, 500);
}

async function formBody(c: Context): Promise<URLSearchParams> {
  if (!c.req.header('content-type')?.toLowerCase().startsWith('application/x-www-form-urlencoded')) {
    throw new OAuthError('invalid_request', 'Use application/x-www-form-urlencoded');
  }
  return new URLSearchParams(await c.req.text());
}

export interface OAuthDeps {
  db: Db;
  issuer: OAuthIssuer;
  pending: PendingAuthorizations;
  clientKey: (c: Context) => string;
  fetchClientMetadata?: ClientMetadataFetcher;
}

const limitBody = bodyLimit({ maxSize: MAX_BODY_BYTES, onError: (c) => c.json({ error: 'invalid_request', error_description: 'Request too large' }, 413) });

/** Discovery and the OAuth endpoints. None of them use the session cookie. */
export function oauthRoutes({ db, issuer, pending, clientKey, fetchClientMetadata = fetchPublicJson }: OAuthDeps) {
  const ctx: ServiceContext = { db, actor: 'app' };
  const registrations = new FailureLimiter(REGISTRATIONS_PER_HOUR, 60 * 60_000);
  const metadataFetches = new FailureLimiter(METADATA_FETCHES_PER_HOUR, 60 * 60_000);
  const routes = new Hono();
  routes.onError((err, c) => oauthFailure(c, err));

  // Browser-based MCP clients call these directly. No credentials are involved.
  const open = cors({ origin: '*', allowMethods: ['GET', 'POST', 'OPTIONS'], allowHeaders: ['content-type', 'mcp-protocol-version'], maxAge: 86_400 });
  for (const path of ['/.well-known/*', '/oauth/token', '/oauth/register', '/oauth/revoke']) routes.use(path, open);

  const protectedResource = (c: Context) =>
    c.json({
      resource: issuer.resource,
      authorization_servers: [issuer.issuer],
      scopes_supported: [OAUTH_SCOPE],
      bearer_methods_supported: ['header'],
      resource_name: 'ProjectBench',
    });
  routes.get('/.well-known/oauth-protected-resource/mcp', protectedResource);
  routes.get('/.well-known/oauth-protected-resource', protectedResource);

  routes.get('/.well-known/oauth-authorization-server', (c) =>
    c.json({
      issuer: issuer.issuer,
      authorization_endpoint: `${issuer.issuer}/oauth/authorize`,
      token_endpoint: `${issuer.issuer}/oauth/token`,
      registration_endpoint: `${issuer.issuer}/oauth/register`,
      revocation_endpoint: `${issuer.issuer}/oauth/revoke`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      revocation_endpoint_auth_methods_supported: ['none'],
      scopes_supported: OAUTH_SCOPES_SUPPORTED,
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true,
    }),
  );

  routes.post('/oauth/register', limitBody, async (c) => {
    c.header('Cache-Control', 'no-store');
    const key = clientKey(c);
    if (registrations.retryAfter(key) > 0) throw new OAuthError('temporarily_unavailable', 'Too many registrations', 503);
    registrations.fail(key);
    return c.json(registerOAuthClient(ctx, await c.req.json().catch(() => null)), 201);
  });

  routes.get('/oauth/authorize', async (c) => {
    c.header('Cache-Control', 'no-store');
    // This endpoint is public, so it must not become a way to make the server send requests.
    const key = clientKey(c);
    const limitedFetch = (url: string) => {
      if (metadataFetches.retryAfter(key) > 0) throw new Error('Too many metadata fetches');
      metadataFetches.fail(key);
      return fetchClientMetadata(url);
    };
    const check = await checkAuthorizeRequest(ctx, issuer, c.req.query(), async (url) => limitedFetch(url));
    if (check.ok) return c.redirect(`/authorize?request=${pending.add(check.request)}`, 302);
    if (check.redirectTo) return c.redirect(check.redirectTo, 302);
    return c.text(`This connection can’t be authorized: ${check.description}.`, 400);
  });

  routes.post('/oauth/token', limitBody, async (c) => {
    c.header('Cache-Control', 'no-store');
    c.header('Pragma', 'no-cache');
    const form = await formBody(c);
    const field = (name: string) => form.get(name) ?? undefined;
    const grant = field('grant_type');
    if (grant === 'authorization_code') {
      return c.json(
        exchangeAuthorizationCode(ctx, {
          code: field('code'),
          clientId: field('client_id'),
          redirectUri: field('redirect_uri'),
          codeVerifier: field('code_verifier'),
          resource: field('resource'),
        }),
      );
    }
    if (grant === 'refresh_token') {
      return c.json(
        refreshOAuthToken(ctx, {
          refreshToken: field('refresh_token'),
          clientId: field('client_id'),
          scope: field('scope'),
          resource: field('resource'),
        }),
      );
    }
    throw new OAuthError('unsupported_grant_type', 'Use authorization_code or refresh_token');
  });

  routes.post('/oauth/revoke', limitBody, async (c) => {
    const form = await formBody(c);
    revokeOAuthToken(ctx, form.get('token') ?? undefined, form.get('client_id') ?? undefined);
    return c.body(null, 200);
  });

  return routes;
}

const decisionBody = z.object({ approve: z.boolean() });

/** The consent screen and connected apps; these need the app session. */
export function oauthApiRoutes(db: Db, issuer: OAuthIssuer | undefined, pending: PendingAuthorizations) {
  const ctx: ServiceContext = { db, actor: 'app' };
  const routes = new Hono();
  routes.onError((err, c) => {
    if (err instanceof NotFoundError) return c.json({ error: err.message }, 404);
    console.error(err);
    return c.json({ error: 'Internal error' }, 500);
  });

  routes.get('/connections', (c) => c.json({ endpoint: issuer?.resource ?? null, connections: listOAuthConnections(ctx) }));
  routes.delete('/connections/:id', (c) => {
    deleteOAuthConnection(ctx, c.req.param('id'));
    return c.body(null, 204);
  });

  routes.get('/requests/:id', (c) => {
    const request = pending.get(c.req.param('id'));
    if (!request) return c.json({ error: 'This request has expired. Start connecting again from the app.' }, 404);
    c.header('Cache-Control', 'no-store');
    return c.json({ clientName: request.clientName, redirectHost: request.redirectHost });
  });

  routes.post('/requests/:id', async (c) => {
    const parsed = decisionBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Invalid input' }, 400);
    const request = pending.take(c.req.param('id'));
    if (!request || !issuer) return c.json({ error: 'This request has expired. Start connecting again from the app.' }, 404);
    c.header('Cache-Control', 'no-store');
    const redirectTo = parsed.data.approve
      ? approveAuthorization(ctx, issuer, request)
      : authorizationRedirect(request.redirectUri, issuer, { error: 'access_denied', error_description: 'The request was declined', state: request.state });
    return c.json({ redirectTo });
  });

  return routes;
}
