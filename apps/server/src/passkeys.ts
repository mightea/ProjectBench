import { randomBytes } from 'node:crypto';
import {
  checkPassword,
  deletePasskey,
  InvalidOperationError,
  listPasskeys,
  NotFoundError,
  passkeyCreateSchema,
  passkeyLoginOptions,
  passkeyRegistrationOptions,
  registerPasskey,
  verifyPasskeyLogin,
  type Db,
  type RelyingParty,
  type ServiceContext,
} from '@projectbench/core';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { z, ZodError } from 'zod';
import type { FailureLimiter } from './rate-limit.ts';

const CHALLENGE_COOKIE = 'pb_passkey';
const CHALLENGE_TTL_MS = 5 * 60_000;
const MAX_CHALLENGES = 64;
const MAX_BODY_BYTES = 64 * 1024;

type Purpose = 'login' | 'register';

/** Open WebAuthn challenges. Each can be used once; a restart only means trying again. */
export class ChallengeStore {
  private readonly open = new Map<string, { challenge: string; purpose: Purpose; expiresAt: number }>();

  issue(challenge: string, purpose: Purpose, now = Date.now()): string {
    for (const [id, entry] of this.open) if (entry.expiresAt <= now) this.open.delete(id);
    // The login challenge is public, so the store must not grow without bound.
    while (this.open.size >= MAX_CHALLENGES) this.open.delete(this.open.keys().next().value!);
    const id = randomBytes(24).toString('base64url');
    this.open.set(id, { challenge, purpose, expiresAt: now + CHALLENGE_TTL_MS });
    return id;
  }

  take(id: string | undefined, purpose: Purpose, now = Date.now()): string | undefined {
    if (!id) return undefined;
    const entry = this.open.get(id);
    this.open.delete(id);
    return entry && entry.purpose === purpose && entry.expiresAt > now ? entry.challenge : undefined;
  }
}

const credentialSchema = z.looseObject({
  id: z.string().min(1).max(2048),
  rawId: z.string().min(1).max(2048),
  type: z.literal('public-key'),
  response: z.looseObject({}),
});
const loginBody = z.object({ response: credentialSchema });
const registerBody = passkeyCreateSchema.extend({ response: credentialSchema });
const passwordBody = z.object({ password: z.string().min(1).max(512) });

const UNAVAILABLE = 'Passkeys need a domain on HTTPS, set as PUBLIC_URL';

export interface PasskeyDeps {
  db: Db;
  rp: RelyingParty | undefined;
  limiter: FailureLimiter;
  challenges: ChallengeStore;
  secureCookies: boolean;
  clientKey: (c: Context) => string;
  startSession: (c: Context) => void;
}

function helpers({ challenges, secureCookies, limiter, clientKey }: PasskeyDeps) {
  return {
    remember: (c: Context, challenge: string, purpose: Purpose) => {
      c.header('Cache-Control', 'no-store');
      setCookie(c, CHALLENGE_COOKIE, challenges.issue(challenge, purpose), {
        httpOnly: true,
        sameSite: 'Strict',
        secure: secureCookies,
        path: '/api',
        maxAge: CHALLENGE_TTL_MS / 1000,
      });
    },
    recall: (c: Context, purpose: Purpose) => {
      const challenge = challenges.take(getCookie(c, CHALLENGE_COOKIE), purpose);
      deleteCookie(c, CHALLENGE_COOKIE, { path: '/api' });
      return challenge;
    },
    blocked: (c: Context) => {
      const wait = limiter.retryAfter(clientKey(c));
      if (wait <= 0) return null;
      c.header('Retry-After', String(Math.ceil(wait / 1000)));
      return c.json({ error: 'Too many attempts. Try again later.' }, 429);
    },
  };
}

const limitBody = bodyLimit({ maxSize: MAX_BODY_BYTES, onError: (c) => c.json({ error: 'Request too large' }, 413) });

/** Signing in with a passkey; public. */
export function passkeyLoginRoutes(deps: PasskeyDeps) {
  const { db, rp, limiter, clientKey, startSession } = deps;
  const { remember, recall, blocked } = helpers(deps);
  const routes = new Hono();

  routes.post('/options', async (c) => {
    if (!rp) return c.json({ error: UNAVAILABLE }, 409);
    const limited = blocked(c);
    if (limited) return limited;
    const options = await passkeyLoginOptions(rp);
    remember(c, options.challenge, 'login');
    return c.json(options);
  });

  routes.post('/verify', limitBody, async (c) => {
    if (!rp) return c.json({ error: UNAVAILABLE }, 409);
    const limited = blocked(c);
    if (limited) return limited;
    const challenge = recall(c, 'login');
    const parsed = loginBody.safeParse(await c.req.json().catch(() => null));
    const key = clientKey(c);
    if (!challenge || !parsed.success || !(await verifyPasskeyLogin(db, rp, parsed.data.response as never, challenge))) {
      limiter.fail(key);
      return c.json({ error: 'That passkey wasn’t accepted' }, 401);
    }
    limiter.reset(key);
    startSession(c);
    return c.json({ ok: true });
  });

  return routes;
}

/** Managing passkeys; needs a session. Adding one also needs the password. */
export function passkeyRoutes(deps: PasskeyDeps) {
  const { db, rp, limiter, clientKey } = deps;
  const { remember, recall, blocked } = helpers(deps);
  const ctx: ServiceContext = { db, actor: 'app' };
  const routes = new Hono();

  routes.onError((err, c) => {
    if (err instanceof NotFoundError) return c.json({ error: err.message }, 404);
    if (err instanceof InvalidOperationError) return c.json({ error: err.message }, 409);
    if (err instanceof ZodError) return c.json({ error: 'Invalid input' }, 400);
    console.error(err);
    return c.json({ error: 'Internal error' }, 500);
  });

  routes.get('/', (c) => c.json(listPasskeys(ctx)));

  routes.post('/options', limitBody, async (c) => {
    if (!rp) return c.json({ error: UNAVAILABLE }, 409);
    const limited = blocked(c);
    if (limited) return limited;
    const parsed = passwordBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Password is required' }, 400);
    const key = clientKey(c);
    // 403, not 401: the session is fine and the app must not sign out.
    if (!(await checkPassword(db, parsed.data.password))) {
      limiter.fail(key);
      return c.json({ error: 'Wrong password' }, 403);
    }
    limiter.reset(key);
    const options = await passkeyRegistrationOptions(ctx, rp);
    remember(c, options.challenge, 'register');
    return c.json(options);
  });

  routes.post('/', limitBody, async (c) => {
    if (!rp) return c.json({ error: UNAVAILABLE }, 409);
    const challenge = recall(c, 'register');
    if (!challenge) return c.json({ error: 'That took too long. Try again.' }, 400);
    const { name, response } = registerBody.parse(await c.req.json().catch(() => null));
    const created = await registerPasskey(ctx, rp, { name }, response as never, challenge);
    if (!created) return c.json({ error: 'The passkey couldn’t be verified' }, 400);
    return c.json(created, 201);
  });

  routes.delete('/:id', (c) => {
    deletePasskey(ctx, c.req.param('id'));
    return c.body(null, 204);
  });

  return routes;
}
