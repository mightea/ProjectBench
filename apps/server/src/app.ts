import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import { getConnInfo } from '@hono/node-server/conninfo';
import {
  checkPassword,
  createSession,
  deleteSession,
  FileStore,
  hasPasskeys,
  hasPassword,
  MAX_UPLOAD_BYTES,
  MIN_PASSWORD_LENGTH,
  oauthIssuerFor,
  relyingPartyFor,
  SESSION_TTL_DAYS,
  setPassword,
  validateApiToken,
  validateOAuthAccessToken,
  validateSession,
  type ClientMetadataFetcher,
  type Db,
} from '@projectbench/core';
import { sql } from 'drizzle-orm';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { csrf } from 'hono/csrf';
import { secureHeaders } from 'hono/secure-headers';
import { z } from 'zod';
import { VERSION, type Config } from './config.ts';
import { fileRoutes } from './files.ts';
import { handleMcpRequest } from './mcp.ts';
import { mcpChallenge, oauthApiRoutes, oauthRoutes, PendingAuthorizations } from './oauth.ts';
import { ChallengeStore, passkeyLoginRoutes, passkeyRoutes, type PasskeyDeps } from './passkeys.ts';
import { FailureLimiter } from './rate-limit.ts';
import { apiRoutes } from './routes.ts';
import { uploadLinks, uploadRoutes, UploadTickets } from './uploads.ts';

export const SESSION_COOKIE = 'pb_session';

const passwordBody = z.object({ password: z.string().min(1).max(512) });

export interface AppDeps {
  db: Db;
  config: Pick<Config, 'secureCookies' | 'webDist'> & Partial<Pick<Config, 'filesDir' | 'publicUrl'>>;
  limiter?: FailureLimiter;
  /** Replaces the network fetch of OAuth client metadata in tests. */
  fetchClientMetadata?: ClientMetadataFetcher;
}

export function createApp({ db, config, limiter = new FailureLimiter(), fetchClientMetadata }: AppDeps) {
  const app = new Hono();
  const files = config.filesDir ? new FileStore(config.filesDir) : undefined;
  const publicOrigin = config.publicUrl ? new URL(config.publicUrl).origin : undefined;

  app.use(secureHeaders({ contentSecurityPolicy: undefined }));
  // Uploads are multipart forms, which this checks. Behind a TLS proxy the server sees plain http,
  // so the browser's origin is compared by host, or with the configured public address.
  app.use(
    '/api/*',
    csrf({
      origin: (origin, c) => {
        if (origin === publicOrigin) return true;
        try {
          return new URL(origin).host === c.req.header('host');
        } catch {
          return false;
        }
      },
    }),
  );

  const clientKey = (c: Context) => {
    const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
    if (forwarded) return forwarded;
    try {
      return getConnInfo(c).remote.address ?? 'unknown';
    } catch {
      return 'unknown';
    }
  };

  const startSession = (c: Context) => {
    const token = createSession(db, c.req.header('user-agent'));
    setCookie(c, SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'Lax',
      secure: config.secureCookies,
      path: '/',
      maxAge: SESSION_TTL_DAYS * 86_400,
    });
  };

  const isAuthenticated = (c: Context) => validateSession(db, getCookie(c, SESSION_COOKIE));

  const rp = relyingPartyFor(config.publicUrl);
  const passkeyDeps: PasskeyDeps = {
    db,
    rp,
    limiter,
    challenges: new ChallengeStore(),
    secureCookies: config.secureCookies,
    clientKey,
    startSession,
  };
  const oauth = oauthIssuerFor(config.publicUrl);
  const pendingAuthorizations = new PendingAuthorizations();
  const uploadTickets = new UploadTickets();

  // --- Public endpoints -----------------------------------------------------

  app.get('/api/health', (c) => {
    db.run(sql`select 1`);
    return c.json({ status: 'ok', version: VERSION });
  });

  app.get('/api/auth/state', (c) =>
    c.json({
      passwordSet: hasPassword(db),
      authenticated: isAuthenticated(c),
      minPasswordLength: MIN_PASSWORD_LENGTH,
      hasPasskeys: hasPasskeys(db),
      passkeyOrigins: rp?.origins ?? [],
    }),
  );

  app.post('/api/auth/setup', async (c) => {
    if (hasPassword(db)) return c.json({ error: 'Password is already set' }, 409);
    const parsed = passwordBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Password is required' }, 400);
    if (parsed.data.password.length < MIN_PASSWORD_LENGTH) {
      return c.json({ error: `Use at least ${MIN_PASSWORD_LENGTH} characters` }, 400);
    }
    await setPassword(db, parsed.data.password);
    startSession(c);
    return c.json({ ok: true });
  });

  app.post('/api/auth/login', async (c) => {
    const key = clientKey(c);
    const wait = limiter.retryAfter(key);
    if (wait > 0) {
      c.header('Retry-After', String(Math.ceil(wait / 1000)));
      return c.json({ error: 'Too many attempts. Try again later.' }, 429);
    }
    const parsed = passwordBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Password is required' }, 400);
    if (!(await checkPassword(db, parsed.data.password))) {
      limiter.fail(key);
      return c.json({ error: 'Wrong password' }, 401);
    }
    limiter.reset(key);
    startSession(c);
    return c.json({ ok: true });
  });

  app.route('/api/auth/passkey', passkeyLoginRoutes(passkeyDeps));

  app.post('/api/auth/logout', (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) deleteSession(db, token);
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.json({ ok: true });
  });

  // --- Everything else under /api needs a session ---------------------------

  app.use('/api/*', async (c, next) => {
    if (!isAuthenticated(c)) return c.json({ error: 'Not signed in' }, 401);
    await next();
  });

  app.get('/api/session', (c) => c.json({ authenticated: true }));
  app.route('/api/passkeys', passkeyRoutes(passkeyDeps));
  app.route('/api/oauth', oauthApiRoutes(db, oauth, pendingAuthorizations));
  app.route('/api', apiRoutes(db, files));

  app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404));

  // --- Uploaded files: same session as the app --------------------------------

  app.use('/files/*', async (c, next) => {
    if (!isAuthenticated(c)) return c.json({ error: 'Not signed in' }, 401);
    await next();
  });
  app.route('/files', fileRoutes({ db, actor: 'app', files }));
  app.all('/files/*', (c) => c.json({ error: 'Not found' }, 404));

  // --- OAuth for MCP clients; only with an HTTPS public address -----------------

  if (oauth) {
    app.route('/', oauthRoutes({ db, issuer: oauth, pending: pendingAuthorizations, clientKey, fetchClientMetadata }));
  }
  app.all('/.well-known/*', (c) => c.json({ error: 'Not found' }, 404));
  app.all('/oauth/*', (c) => c.json({ error: 'Not found' }, 404));

  // --- MCP: bearer token only, session cookies are not accepted ----------------

  app.use('/mcp', async (c, next) => {
    const [scheme, token] = c.req.header('authorization')?.split(' ') ?? [];
    const bearer = scheme?.toLowerCase() === 'bearer' ? token : undefined;
    if (!validateApiToken(db, bearer) && !(oauth && validateOAuthAccessToken(db, bearer, oauth.resource))) {
      c.header('WWW-Authenticate', mcpChallenge(oauth, !!bearer));
      return c.json({ error: 'Invalid or missing token' }, 401);
    }
    await next();
  });
  app.post(
    '/mcp',
    // add_attachment can carry a 50 MB file as base64.
    bodyLimit({ maxSize: Math.ceil((MAX_UPLOAD_BYTES * 4) / 3) + 1024 * 1024, onError: (c) => c.json({ error: 'Request too large' }, 413) }),
    // Upload links point back at the public address, or else at the one the client used.
    (c) => handleMcpRequest(db, c.req.raw, files, uploadLinks(uploadTickets, publicOrigin ?? new URL(c.req.url).origin)),
  );
  // One-time links from start_upload: the ticket in the path is the credential.
  if (files) app.route('/mcp/upload', uploadRoutes({ db, actor: 'mcp', files }, uploadTickets));
  // Stateless server: no event stream to open and no session to end.
  app.all('/mcp', (c) => {
    c.header('Allow', 'POST');
    return c.json({ error: 'Method not allowed' }, 405);
  });

  // --- The PWA ----------------------------------------------------------------

  const indexFile = join(config.webDist, 'index.html');
  if (existsSync(indexFile)) {
    app.use('/assets/*', async (c, next) => {
      await next();
      if (c.res.ok) c.header('Cache-Control', 'public, max-age=31536000, immutable');
    });
    app.use('/*', serveStatic({ root: config.webDist }));
    // Client-side routes fall back to index.html.
    app.get('*', (c) => {
      c.header('Cache-Control', 'no-cache');
      return c.html(readFileSync(indexFile, 'utf8'));
    });
  } else {
    app.get('/', (c) =>
      c.text('ProjectBench API is running. Build the web app (pnpm build) or use the Vite dev server on port 5173.'),
    );
  }

  return app;
}
