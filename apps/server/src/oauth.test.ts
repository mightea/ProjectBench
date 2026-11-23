import { createHash, randomBytes } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import {
  exchangeAuthorizationCode,
  fetchPublicJson,
  isValidRedirectUri,
  oauthIssuerFor,
  openDb,
  pruneOAuth,
  redirectUriMatches,
  refreshOAuthToken,
  schema,
  validateOAuthAccessToken,
  type Db,
} from '@projectbench/core';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from './app.ts';

const ORIGIN = 'https://bench.example.com';
const RESOURCE = `${ORIGIN}/mcp`;
const CALLBACK = 'https://claude.ai/api/mcp/auth_callback';
const CIMD_URL = 'https://client.example.org/oauth/metadata.json';

let close: (() => void) | undefined;
afterEach(() => close?.());

const pkce = () => {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
};

const form = (body: Record<string, string>) => ({
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(body).toString(),
});
const json = (body: unknown, cookie = '') => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', cookie },
  body: JSON.stringify(body),
});

async function setup(publicUrl = ORIGIN, metadata: unknown = undefined) {
  const handle = openDb({ filename: ':memory:' });
  close = handle.close;
  const app = createApp({
    db: handle.db,
    config: { secureCookies: false, webDist: '/nonexistent', publicUrl },
    fetchClientMetadata: async () => {
      if (metadata === undefined) throw new Error('unreachable');
      return metadata;
    },
  });
  const res = await app.request('/api/auth/setup', json({ password: 'workbench-2026' }));
  const session = res.headers.getSetCookie()[0]!.split(';')[0]!;
  return { app, db: handle.db, session };
}

type App = Awaited<ReturnType<typeof setup>>['app'];

async function register(app: App, redirect = CALLBACK) {
  const res = await app.request('/oauth/register', json({ client_name: 'Claude', redirect_uris: [redirect], token_endpoint_auth_method: 'none' }));
  expect(res.status).toBe(201);
  return ((await res.json()) as { client_id: string }).client_id;
}

const authorizeUrl = (clientId: string, challenge: string, extra: Record<string, string> = {}) =>
  `/oauth/authorize?${new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: CALLBACK,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    resource: RESOURCE,
    scope: 'mcp offline_access',
    state: 'xyz',
    ...extra,
  })}`;

async function approve(app: App, session: string, url: string, decision = true) {
  const start = await app.request(url);
  expect(start.status).toBe(302);
  const id = new URL(start.headers.get('location')!, ORIGIN).searchParams.get('request')!;
  const res = await app.request(`/api/oauth/requests/${id}`, json({ approve: decision }, session));
  expect(res.status).toBe(200);
  return new URL(((await res.json()) as { redirectTo: string }).redirectTo);
}

async function connect(app: App, session: string) {
  const clientId = await register(app);
  const { verifier, challenge } = pkce();
  const code = (await approve(app, session, authorizeUrl(clientId, challenge))).searchParams.get('code')!;
  const res = await app.request('/oauth/token', form({ grant_type: 'authorization_code', code, client_id: clientId, redirect_uri: CALLBACK, code_verifier: verifier, resource: RESOURCE }));
  expect(res.status).toBe(200);
  return { clientId, code, verifier, tokens: (await res.json()) as { access_token: string; refresh_token: string; expires_in: number } };
}

const mcp = (app: App, token?: string) =>
  app.request('/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });

describe('OAuth discovery', () => {
  it('points an unauthenticated client at the metadata', async () => {
    const { app } = await setup();
    const res = await mcp(app);
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBe(`Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp", scope="mcp"`);

    for (const path of ['/.well-known/oauth-protected-resource/mcp', '/.well-known/oauth-protected-resource']) {
      expect(await (await app.request(path)).json()).toMatchObject({ resource: RESOURCE, authorization_servers: [ORIGIN] });
    }
    expect(await (await app.request('/.well-known/oauth-authorization-server')).json()).toMatchObject({
      issuer: ORIGIN,
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      client_id_metadata_document_supported: true,
    });
  });

  it('is off without an HTTPS address', async () => {
    const { app } = await setup('http://truenas.example.com:8787');
    expect((await mcp(app)).headers.get('www-authenticate')).toBe('Bearer');
    expect((await app.request('/.well-known/oauth-authorization-server')).status).toBe(404);
    expect((await app.request('/oauth/register', json({ redirect_uris: [CALLBACK] }))).status).toBe(404);
    expect(oauthIssuerFor('http://localhost:8787')?.resource).toBe('http://localhost:8787/mcp');
  });
});

describe('OAuth flow', () => {
  it('works end to end with the MCP SDK client', async () => {
    const { app, session } = await setup('http://localhost:8787');
    const appFetch = ((input: string | URL | Request, init?: RequestInit) => app.fetch(new Request(input, init))) as typeof fetch;
    let information: OAuthClientInformationMixed | undefined;
    let saved: OAuthTokens | undefined;
    let verifier = '';
    let authorizeAt: URL | undefined;
    const provider: OAuthClientProvider = {
      redirectUrl: 'http://localhost:3118/callback',
      clientMetadata: { client_name: 'SDK test', redirect_uris: ['http://localhost:3118/callback'], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] } as OAuthClientMetadata,
      clientInformation: () => information,
      saveClientInformation: (info) => void (information = info),
      tokens: () => saved,
      saveTokens: (tokens) => void (saved = tokens),
      redirectToAuthorization: (url) => void (authorizeAt = url),
      saveCodeVerifier: (v) => void (verifier = v),
      codeVerifier: () => verifier,
    };
    const url = new URL('http://localhost:8787/mcp');
    const first = new StreamableHTTPClientTransport(url, { authProvider: provider, fetch: appFetch });
    await expect(new Client({ name: 'test', version: '1.0.0' }).connect(first)).rejects.toThrow();
    expect(authorizeAt).toBeDefined();

    const back = await approve(app, session, authorizeAt!.pathname + authorizeAt!.search);
    await first.finishAuth(back.searchParams.get('code')!);
    expect(saved?.refresh_token).toBeTruthy();

    const client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(url, { authProvider: provider, fetch: appFetch }));
    expect((await client.listTools()).tools.some((t) => t.name === 'list_projects')).toBe(true);
    await client.close();
  });

  it('issues working tokens, returns state and the issuer', async () => {
    const { app, session } = await setup();
    const clientId = await register(app);
    const { challenge } = pkce();
    const back = await approve(app, session, authorizeUrl(clientId, challenge));
    expect(back.origin + back.pathname).toBe(CALLBACK);
    expect(back.searchParams.get('state')).toBe('xyz');
    expect(back.searchParams.get('iss')).toBe(ORIGIN);

    const { app: other, session: otherSession } = await setup();
    const { tokens } = await connect(other, otherSession);
    expect(tokens.expires_in).toBe(3600);
    expect((await mcp(other, tokens.access_token)).status).toBe(200);
    expect((await mcp(other, tokens.refresh_token)).status).toBe(401);
  });

  it('sends a declined request back with access_denied', async () => {
    const { app, session } = await setup();
    const back = await approve(app, session, authorizeUrl(await register(app), pkce().challenge), false);
    expect(back.searchParams.get('error')).toBe('access_denied');
    expect(back.searchParams.get('code')).toBeNull();
  });

  it('needs a session to approve', async () => {
    const { app } = await setup();
    const start = await app.request(authorizeUrl(await register(app), pkce().challenge));
    const id = new URL(start.headers.get('location')!, ORIGIN).searchParams.get('request')!;
    expect((await app.request(`/api/oauth/requests/${id}`, json({ approve: true }))).status).toBe(401);
    expect((await app.request(`/api/oauth/requests/${id}`)).status).toBe(401);
  });

  it('never redirects to an address the client did not register', async () => {
    const { app } = await setup();
    const clientId = await register(app);
    const res = await app.request(authorizeUrl(clientId, pkce().challenge, { redirect_uri: 'https://evil.example/cb' }));
    expect(res.status).toBe(400);
    expect(res.headers.get('location')).toBeNull();
    expect((await app.request(authorizeUrl('unknown', pkce().challenge))).status).toBe(400);
  });

  it('requires PKCE and the right resource', async () => {
    const { app } = await setup();
    const clientId = await register(app);
    for (const [extra, error] of [
      [{ code_challenge_method: 'plain' }, 'invalid_request'],
      [{ resource: 'https://other.example/mcp' }, 'invalid_target'],
      [{ scope: 'admin' }, 'invalid_scope'],
    ] as const) {
      const res = await app.request(authorizeUrl(clientId, pkce().challenge, extra));
      expect(new URL(res.headers.get('location')!).searchParams.get('error')).toBe(error);
    }
  });

  it('rejects a wrong verifier and burns the code', async () => {
    const { app, session } = await setup();
    const clientId = await register(app);
    const { verifier, challenge } = pkce();
    const code = (await approve(app, session, authorizeUrl(clientId, challenge))).searchParams.get('code')!;
    const request = (code_verifier: string) => app.request('/oauth/token', form({ grant_type: 'authorization_code', code, client_id: clientId, redirect_uri: CALLBACK, code_verifier }));
    const wrong = await request(pkce().verifier);
    expect(wrong.status).toBe(400);
    expect(await wrong.json()).toMatchObject({ error: 'invalid_grant' });
    expect((await request(verifier)).status).toBe(400);
  });

  it('ends the connection when a code is replayed', async () => {
    const { app, session } = await setup();
    const { clientId, code, verifier, tokens } = await connect(app, session);
    const replay = await app.request('/oauth/token', form({ grant_type: 'authorization_code', code, client_id: clientId, redirect_uri: CALLBACK, code_verifier: verifier }));
    expect(replay.status).toBe(400);
    expect((await mcp(app, tokens.access_token)).status).toBe(401);
  });

  it('rotates refresh tokens', async () => {
    const { app, session } = await setup();
    const { clientId, tokens } = await connect(app, session);
    const res = await app.request('/oauth/token', form({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: clientId }));
    expect(res.status).toBe(200);
    const next = (await res.json()) as { access_token: string; refresh_token: string };
    expect(next.refresh_token).not.toBe(tokens.refresh_token);
    expect((await mcp(app, next.access_token)).status).toBe(200);

    // A parallel retry fails without ending the connection.
    const retry = await app.request('/oauth/token', form({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: clientId }));
    expect(await retry.json()).toMatchObject({ error: 'invalid_grant' });
    expect((await mcp(app, next.access_token)).status).toBe(200);
  });

  it('ends the connection when an old refresh token comes back later', async () => {
    const { app, db, session } = await setup();
    const { clientId, tokens } = await connect(app, session);
    const ctx = { db, actor: 'app' as const };
    const t0 = new Date();
    const next = refreshOAuthToken(ctx, { refreshToken: tokens.refresh_token, clientId }, t0);
    expect(() => refreshOAuthToken(ctx, { refreshToken: tokens.refresh_token, clientId }, new Date(t0.getTime() + 60_000))).toThrow();
    expect(validateOAuthAccessToken(db, next.access_token, RESOURCE, t0)).toBe(false);
  });

  it('expires access tokens and binds them to the resource', async () => {
    const { app, db, session } = await setup();
    const { tokens } = await connect(app, session);
    expect(validateOAuthAccessToken(db, tokens.access_token, RESOURCE)).toBe(true);
    expect(validateOAuthAccessToken(db, tokens.access_token, 'https://other.example/mcp')).toBe(false);
    expect(validateOAuthAccessToken(db, tokens.access_token, RESOURCE, new Date(Date.now() + 2 * 3_600_000))).toBe(false);
  });

  it('does not exchange an expired code', async () => {
    const { app, db, session } = await setup();
    const clientId = await register(app);
    const { verifier, challenge } = pkce();
    const code = (await approve(app, session, authorizeUrl(clientId, challenge))).searchParams.get('code')!;
    expect(() =>
      exchangeAuthorizationCode({ db, actor: 'app' }, { code, clientId, redirectUri: CALLBACK, codeVerifier: verifier }, new Date(Date.now() + 120_000)),
    ).toThrow();
  });

  it('revokes through the endpoint, only for the own client', async () => {
    const { app, session } = await setup();
    const { clientId, tokens } = await connect(app, session);
    await app.request('/oauth/revoke', form({ token: tokens.refresh_token, client_id: 'someone-else' }));
    expect((await mcp(app, tokens.access_token)).status).toBe(200);
    expect((await app.request('/oauth/revoke', form({ token: tokens.refresh_token, client_id: clientId }))).status).toBe(200);
    expect((await mcp(app, tokens.access_token)).status).toBe(401);
  });

  it('lists connected apps and disconnects them', async () => {
    const { app, session } = await setup();
    const { tokens } = await connect(app, session);
    expect((await app.request('/api/oauth/connections')).status).toBe(401);
    const list = (await (await app.request('/api/oauth/connections', { headers: { cookie: session } })).json()) as { endpoint: string; connections: { id: string; name: string; redirectHost: string }[] };
    expect(list.endpoint).toBe(RESOURCE);
    expect(list.connections[0]).toMatchObject({ name: 'Claude', redirectHost: 'claude.ai' });
    const res = await app.request(`/api/oauth/connections/${list.connections[0]!.id}`, { method: 'DELETE', headers: { cookie: session, 'content-type': 'application/json' } });
    expect(res.status).toBe(204);
    expect((await mcp(app, tokens.access_token)).status).toBe(401);
  });

  it('keeps live connections when pruning', async () => {
    const { app, db, session } = await setup();
    const { tokens } = await connect(app, session);
    pruneOAuth(db as Db);
    expect((await mcp(app, tokens.access_token)).status).toBe(200);
    pruneOAuth(db as Db, new Date(Date.now() + 100 * 86_400_000));
    expect(db.select().from(schema.oauthGrants).all()).toHaveLength(0);
    expect(db.select().from(schema.oauthClients).all()).toHaveLength(0);
  });
});

describe('client metadata documents', () => {
  const document = { client_id: CIMD_URL, client_name: 'Metadata client', redirect_uris: [CALLBACK], token_endpoint_auth_method: 'none' };

  it('accepts a matching document', async () => {
    const { app, session } = await setup(ORIGIN, document);
    const back = await approve(app, session, authorizeUrl(CIMD_URL, pkce().challenge));
    expect(back.searchParams.get('code')).toBeTruthy();
  });

  it('rejects a document for another client id or redirect', async () => {
    const mismatched = await setup(ORIGIN, { ...document, client_id: 'https://evil.example/client.json' });
    expect((await mismatched.app.request(authorizeUrl(CIMD_URL, pkce().challenge))).status).toBe(400);
    close?.();
    const other = await setup(ORIGIN, { ...document, redirect_uris: ['https://evil.example/cb'] });
    expect((await other.app.request(authorizeUrl(CIMD_URL, pkce().challenge))).status).toBe(400);
  });

  it('fails closed when the document can’t be fetched', async () => {
    const { app } = await setup();
    expect((await app.request(authorizeUrl(CIMD_URL, pkce().challenge))).status).toBe(400);
  });
});

describe('redirect rules', () => {
  it('allows only HTTPS and loopback', () => {
    expect(isValidRedirectUri(CALLBACK)).toBe(true);
    expect(isValidRedirectUri('http://localhost:3118/callback')).toBe(true);
    expect(isValidRedirectUri('http://example.com/callback')).toBe(false);
    expect(isValidRedirectUri('https://example.com/cb#frag')).toBe(false);
    expect(isValidRedirectUri('javascript:alert(1)')).toBe(false);
  });

  it('ignores the port on loopback only', () => {
    expect(redirectUriMatches('http://localhost/callback', 'http://localhost:3118/callback')).toBe(true);
    expect(redirectUriMatches('http://127.0.0.1/callback', 'http://127.0.0.1:9/callback')).toBe(true);
    expect(redirectUriMatches('http://localhost/callback', 'http://localhost:3118/other')).toBe(false);
    expect(redirectUriMatches('http://localhost/callback', 'http://127.0.0.1:3118/callback')).toBe(false);
    expect(redirectUriMatches('https://app.example/cb', 'https://app.example:8443/cb')).toBe(false);
  });
});

describe('client metadata fetching', () => {
  it('refuses local and non-HTTPS addresses', async () => {
    for (const url of ['https://127.0.0.1/client.json', 'https://localhost/client.json', 'https://192.168.1.2/client.json', 'http://example.com/client.json']) {
      await expect(fetchPublicJson(url)).rejects.toThrow('not a public web address');
    }
  });

  it('limits fetches from one address', async () => {
    const handle = openDb({ filename: ':memory:' });
    close = handle.close;
    let fetches = 0;
    const app = createApp({
      db: handle.db,
      config: { secureCookies: false, webDist: '/nonexistent', publicUrl: ORIGIN },
      fetchClientMetadata: async () => {
        fetches += 1;
        throw new Error('unreachable');
      },
    });
    for (let i = 0; i < 70; i++) await app.request(authorizeUrl(CIMD_URL, pkce().challenge));
    expect(fetches).toBe(60);
  });
});
