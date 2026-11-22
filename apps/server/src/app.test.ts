import { openDb } from '@projectbench/core';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp, SESSION_COOKIE } from './app.ts';
import { FailureLimiter } from './rate-limit.ts';

let close: (() => void) | undefined;
afterEach(() => close?.());

function setup(limiter?: FailureLimiter) {
  const handle = openDb({ filename: ':memory:' });
  close = handle.close;
  const app = createApp({ db: handle.db, config: { secureCookies: false, webDist: '/nonexistent' }, limiter });
  return { app, db: handle.db };
}

const json = (body: unknown) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

const cookieFrom = (res: Response) => {
  const header = res.headers.get('set-cookie') ?? '';
  const match = header.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
  return match ? `${SESSION_COOKIE}=${match[1]}` : '';
};

describe('server', () => {
  it('answers the health check without a session', async () => {
    const { app } = setup();
    const res = await app.request('/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'ok' });
  });

  it('protects API routes', async () => {
    const { app } = setup();
    expect((await app.request('/api/session')).status).toBe(401);
  });

  it('runs the first-time setup once and signs in', async () => {
    const { app } = setup();
    expect(await (await app.request('/api/auth/state')).json()).toMatchObject({ passwordSet: false, authenticated: false });

    expect((await app.request('/api/auth/setup', json({ password: 'short' }))).status).toBe(400);

    const res = await app.request('/api/auth/setup', json({ password: 'workbench-2026' }));
    expect(res.status).toBe(200);
    const cookie = cookieFrom(res);
    expect(cookie).not.toBe('');
    expect(res.headers.get('set-cookie')).toMatch(/HttpOnly/i);
    expect(res.headers.get('set-cookie')).toMatch(/SameSite=Lax/i);

    expect((await app.request('/api/session', { headers: { cookie } })).status).toBe(200);
    expect((await app.request('/api/auth/setup', json({ password: 'another-password' }))).status).toBe(409);
  });

  it('logs in and out', async () => {
    const { app } = setup();
    await app.request('/api/auth/setup', json({ password: 'workbench-2026' }));

    expect((await app.request('/api/auth/login', json({ password: 'nope-nope-nope' }))).status).toBe(401);

    const login = await app.request('/api/auth/login', json({ password: 'workbench-2026' }));
    expect(login.status).toBe(200);
    const cookie = cookieFrom(login);

    const state = await (await app.request('/api/auth/state', { headers: { cookie } })).json();
    expect(state).toMatchObject({ passwordSet: true, authenticated: true });

    await app.request('/api/auth/logout', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: '{}' });
    expect((await app.request('/api/session', { headers: { cookie } })).status).toBe(401);
  });

  it('blocks repeated failed logins', async () => {
    const { app } = setup(new FailureLimiter(3, 60_000));
    await app.request('/api/auth/setup', json({ password: 'workbench-2026' }));
    for (let i = 0; i < 3; i++) {
      expect((await app.request('/api/auth/login', json({ password: 'wrong-password' }))).status).toBe(401);
    }
    const blocked = await app.request('/api/auth/login', json({ password: 'workbench-2026' }));
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('retry-after')).toBeTruthy();
  });

  it('returns 404 JSON for unknown API routes when signed in', async () => {
    const { app } = setup();
    const res = await app.request('/api/auth/setup', json({ password: 'workbench-2026' }));
    const cookie = cookieFrom(res);
    expect((await app.request('/api/nope', { headers: { cookie } })).status).toBe(404);
  });
});

describe('csrf', () => {
  it('rejects form posts from another site', async () => {
    const { app } = setup();
    const res = await app.request('http://localhost/api/auth/setup', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://evil.example' },
      body: 'password=workbench-2026',
    });
    expect(res.status).toBe(403);
  });
});
