import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import { getConnInfo } from '@hono/node-server/conninfo';
import {
  checkPassword,
  createSession,
  deleteSession,
  hasPassword,
  MIN_PASSWORD_LENGTH,
  SESSION_TTL_DAYS,
  setPassword,
  validateSession,
  type Db,
} from '@projectbench/core';
import { sql } from 'drizzle-orm';
import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { csrf } from 'hono/csrf';
import { secureHeaders } from 'hono/secure-headers';
import { z } from 'zod';
import { VERSION, type Config } from './config.ts';
import { FailureLimiter } from './rate-limit.ts';

export const SESSION_COOKIE = 'pb_session';

const passwordBody = z.object({ password: z.string().min(1).max(512) });

export interface AppDeps {
  db: Db;
  config: Pick<Config, 'secureCookies' | 'webDist'>;
  limiter?: FailureLimiter;
}

export function createApp({ db, config, limiter = new FailureLimiter() }: AppDeps) {
  const app = new Hono();

  app.use(secureHeaders({ contentSecurityPolicy: undefined }));
  app.use('/api/*', csrf());

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

  // --- Public endpoints -----------------------------------------------------

  app.get('/api/health', (c) => {
    db.run(sql`select 1`);
    return c.json({ status: 'ok', version: VERSION });
  });

  app.get('/api/auth/state', (c) =>
    c.json({ passwordSet: hasPassword(db), authenticated: isAuthenticated(c), minPasswordLength: MIN_PASSWORD_LENGTH }),
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

  app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404));

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
