import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';
import { openDb, relyingPartyFor } from '@projectbench/core';
import { isoCBOR } from '@simplewebauthn/server/helpers';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from './app.ts';
import { ChallengeStore } from './passkeys.ts';
import { FailureLimiter } from './rate-limit.ts';

const ORIGIN = 'https://bench.example.com';
const RP_ID = 'bench.example.com';
const PASSWORD = 'workbench-2026';

const b64 = (data: Uint8Array) => Buffer.from(data).toString('base64url');
const sha256 = (data: Uint8Array | string) => createHash('sha256').update(data).digest();
const uint32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
};

/** A software authenticator that produces real ES256 signatures. */
class Authenticator {
  readonly credentialId = randomBytes(32);
  private readonly privateKey: KeyObject;
  private readonly publicJwk: { x: string; y: string };
  counter = 0;

  constructor() {
    const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    this.privateKey = pair.privateKey;
    this.publicJwk = pair.publicKey.export({ format: 'jwk' }) as { x: string; y: string };
  }

  private clientData(type: string, challenge: string, origin: string) {
    return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
  }

  register(challenge: string, origin = ORIGIN) {
    const cose = new Map<number, number | Uint8Array>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, Buffer.from(this.publicJwk.x, 'base64url')],
      [-3, Buffer.from(this.publicJwk.y, 'base64url')],
    ]);
    const lengthPrefix = Buffer.from([0, this.credentialId.length]);
    const authData = Buffer.concat([
      sha256(RP_ID),
      Buffer.from([0x45]), // user present, user verified, credential data included
      uint32(this.counter),
      Buffer.alloc(16),
      lengthPrefix,
      this.credentialId,
      isoCBOR.encode(cose as never),
    ]);
    const attestationObject = isoCBOR.encode(
      new Map<string, unknown>([
        ['fmt', 'none'],
        ['attStmt', new Map()],
        ['authData', new Uint8Array(authData)],
      ]) as never,
    );
    return {
      id: b64(this.credentialId),
      rawId: b64(this.credentialId),
      type: 'public-key',
      clientExtensionResults: {},
      response: {
        clientDataJSON: b64(this.clientData('webauthn.create', challenge, origin)),
        attestationObject: b64(attestationObject),
        transports: ['internal'],
      },
    };
  }

  login(challenge: string, { origin = ORIGIN, counter = ++this.counter } = {}) {
    const authData = Buffer.concat([sha256(RP_ID), Buffer.from([0x05]), uint32(counter)]);
    const clientData = this.clientData('webauthn.get', challenge, origin);
    const signature = sign('sha256', Buffer.concat([authData, sha256(clientData)]), this.privateKey);
    return {
      id: b64(this.credentialId),
      rawId: b64(this.credentialId),
      type: 'public-key',
      clientExtensionResults: {},
      response: { clientDataJSON: b64(clientData), authenticatorData: b64(authData), signature: b64(signature) },
    };
  }
}

let close: (() => void) | undefined;
afterEach(() => close?.());

const post = (body: unknown, cookie = '') => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', cookie },
  body: JSON.stringify(body),
});

const cookies = (res: Response) =>
  res.headers
    .getSetCookie()
    .filter((c) => !/Max-Age=0/i.test(c))
    .map((c) => c.split(';')[0])
    .join('; ');

async function setup(limiter?: FailureLimiter, publicUrl = ORIGIN) {
  const handle = openDb({ filename: ':memory:' });
  close = handle.close;
  const app = createApp({ db: handle.db, config: { secureCookies: true, webDist: '/nonexistent', publicUrl }, limiter });
  const session = cookies(await app.request('/api/auth/setup', post({ password: PASSWORD })));
  return { app, session };
}

type App = Awaited<ReturnType<typeof setup>>['app'];

async function addKey(app: App, session: string, key = new Authenticator()) {
  const options = await app.request('/api/passkeys/options', post({ password: PASSWORD }, session));
  const { challenge } = (await options.json()) as { challenge: string };
  const res = await app.request('/api/passkeys', post({ name: 'Phone', response: key.register(challenge) }, `${session}; ${cookies(options)}`));
  expect(res.status).toBe(201);
  return key;
}

async function loginOptions(app: App) {
  const res = await app.request('/api/auth/passkey/options', post({}));
  expect(res.status).toBe(200);
  return { challenge: ((await res.json()) as { challenge: string }).challenge, cookie: cookies(res) };
}

describe('passkeys', () => {
  it('registers a passkey and signs in with it', async () => {
    const { app, session } = await setup();
    const key = await addKey(app, session);

    const state = (await (await app.request('/api/auth/state')).json()) as { hasPasskeys: boolean; passkeyOrigins: string[] };
    expect(state).toMatchObject({ hasPasskeys: true, passkeyOrigins: [ORIGIN] });

    const { challenge, cookie } = await loginOptions(app);
    const res = await app.request('/api/auth/passkey/verify', post({ response: key.login(challenge) }, cookie));
    expect(res.status).toBe(200);
    const signedIn = cookies(res);
    expect((await app.request('/api/session', { headers: { cookie: signedIn } })).status).toBe(200);

    const [stored] = (await (await app.request('/api/passkeys', { headers: { cookie: signedIn } })).json()) as { name: string; lastUsedAt: string | null; publicKey?: string }[];
    expect(stored).toMatchObject({ name: 'Phone' });
    expect(stored!.lastUsedAt).not.toBeNull();
    expect(stored!.publicKey).toBeUndefined();
  });

  it('needs a session and the password to add one', async () => {
    const { app, session } = await setup();
    expect((await app.request('/api/passkeys/options', post({ password: PASSWORD }))).status).toBe(401);
    expect((await app.request('/api/passkeys/options', post({ password: 'wrong-password' }, session))).status).toBe(403);
    expect((await app.request('/api/passkeys', post({ name: 'Phone', response: new Authenticator().register('x') }, session))).status).toBe(400);
  });

  it('rejects a reused challenge', async () => {
    const { app, session } = await setup();
    const key = await addKey(app, session);
    const { challenge, cookie } = await loginOptions(app);
    const response = key.login(challenge);
    expect((await app.request('/api/auth/passkey/verify', post({ response }, cookie))).status).toBe(200);
    expect((await app.request('/api/auth/passkey/verify', post({ response }, cookie))).status).toBe(401);
  });

  it('rejects another origin, an unknown key and a replayed counter', async () => {
    const { app, session } = await setup();
    const key = await addKey(app, session);

    let opts = await loginOptions(app);
    const phished = key.login(opts.challenge, { origin: 'https://bench.example.org' });
    expect((await app.request('/api/auth/passkey/verify', post({ response: phished }, opts.cookie))).status).toBe(401);

    opts = await loginOptions(app);
    const stranger = new Authenticator().login(opts.challenge);
    expect((await app.request('/api/auth/passkey/verify', post({ response: stranger }, opts.cookie))).status).toBe(401);

    opts = await loginOptions(app);
    expect((await app.request('/api/auth/passkey/verify', post({ response: key.login(opts.challenge, { counter: 10 }) }, opts.cookie))).status).toBe(200);
    opts = await loginOptions(app);
    expect((await app.request('/api/auth/passkey/verify', post({ response: key.login(opts.challenge, { counter: 5 }) }, opts.cookie))).status).toBe(401);
  });

  it('stops accepting a removed passkey', async () => {
    const { app, session } = await setup();
    const key = await addKey(app, session);
    const [stored] = (await (await app.request('/api/passkeys', { headers: { cookie: session } })).json()) as { id: string }[];
    expect((await app.request(`/api/passkeys/${stored!.id}`, { method: 'DELETE', headers: { cookie: session, 'content-type': 'application/json' } })).status).toBe(204);
    const { challenge, cookie } = await loginOptions(app);
    expect((await app.request('/api/auth/passkey/verify', post({ response: key.login(challenge) }, cookie))).status).toBe(401);
  });

  it('counts failed passkey sign-ins towards the login limit', async () => {
    const { app, session } = await setup(new FailureLimiter(2, 60_000));
    await addKey(app, session);
    for (let i = 0; i < 2; i++) {
      const { challenge, cookie } = await loginOptions(app);
      await app.request('/api/auth/passkey/verify', post({ response: new Authenticator().login(challenge) }, cookie));
    }
    expect((await app.request('/api/auth/passkey/options', post({}))).status).toBe(429);
  });

  it('is off without an HTTPS domain', async () => {
    const { app } = await setup(undefined, 'http://truenas.example.com:8787');
    expect(await (await app.request('/api/auth/state')).json()).toMatchObject({ passkeyOrigins: [] });
    expect((await app.request('/api/auth/passkey/options', post({}))).status).toBe(409);
  });

  it('derives the relying party from the public address', () => {
    expect(relyingPartyFor('https://bench.example.com:8443/')).toEqual({ id: RP_ID, name: 'ProjectBench', origins: ['https://bench.example.com:8443'] });
    expect(relyingPartyFor('http://localhost:8787')?.origins).toEqual(['http://localhost:8787', 'http://localhost:5173']);
    expect(relyingPartyFor('https://192.168.1.10')).toBeUndefined();
    expect(relyingPartyFor('http://bench.example.com')).toBeUndefined();
    expect(relyingPartyFor(undefined)).toBeUndefined();
  });

  it('uses a challenge once and only for its purpose', () => {
    const store = new ChallengeStore();
    const id = store.issue('abc', 'login', 0);
    expect(store.take(id, 'register', 1)).toBeUndefined();
    const again = store.issue('abc', 'login', 0);
    expect(store.take(again, 'login', 1)).toBe('abc');
    expect(store.take(again, 'login', 1)).toBeUndefined();
    const stale = store.issue('abc', 'login', 0);
    expect(store.take(stale, 'login', 5 * 60_000)).toBeUndefined();
  });
});
