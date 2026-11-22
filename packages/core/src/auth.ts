import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { promisify } from 'node:util';
import { eq, lt } from 'drizzle-orm';
import type { Db } from './db.ts';
import { sessions } from './schema.ts';
import { getSetting, setSetting } from './settings.ts';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: ScryptOptions) => Promise<Buffer>;

const PASSWORD_KEY = 'auth.password_hash';
export const MIN_PASSWORD_LENGTH = 10;
export const SESSION_TTL_DAYS = 90;

const SCRYPT = { N: 2 ** 15, r: 8, p: 1, keyLen: 64 } as const;

/** Hashes a password with scrypt. Format: scrypt$N$r$p$saltB64$hashB64 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, SCRYPT.keyLen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
    maxmem: 128 * SCRYPT.N * SCRYPT.r * 2,
  });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), hash.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, n, r, p, saltB64, hashB64] = stored.split('$');
  if (algo !== 'scrypt' || !n || !r || !p || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const N = Number(n);
  const R = Number(r);
  const actual = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length, {
    N,
    r: R,
    p: Number(p),
    maxmem: 128 * N * R * 2,
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function hasPassword(db: Db): boolean {
  return getSetting(db, PASSWORD_KEY) !== undefined;
}

export class PasswordTooShortError extends Error {
  constructor() {
    super(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
}

export async function setPassword(db: Db, password: string): Promise<void> {
  if (password.length < MIN_PASSWORD_LENGTH) throw new PasswordTooShortError();
  setSetting(db, PASSWORD_KEY, await hashPassword(password));
}

export async function checkPassword(db: Db, password: string): Promise<boolean> {
  const stored = getSetting(db, PASSWORD_KEY);
  if (!stored) return false;
  return verifyPassword(password, stored);
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

const expiryFrom = (now: Date) => new Date(now.getTime() + SESSION_TTL_DAYS * 86_400_000).toISOString();

/** Creates a session and returns the raw token for the cookie. Only its hash is stored. */
export function createSession(db: Db, userAgent?: string, now = new Date()): string {
  const token = randomBytes(32).toString('base64url');
  db.insert(sessions)
    .values({ tokenHash: sha256(token), expiresAt: expiryFrom(now), userAgent, lastSeenAt: now.toISOString() })
    .run();
  return token;
}

/** Returns true if the token belongs to a live session, and extends it (sliding expiry). */
export function validateSession(db: Db, token: string | undefined, now = new Date()): boolean {
  if (!token) return false;
  const tokenHash = sha256(token);
  const row = db.select().from(sessions).where(eq(sessions.tokenHash, tokenHash)).get();
  if (!row) return false;
  if (row.expiresAt <= now.toISOString()) {
    db.delete(sessions).where(eq(sessions.tokenHash, tokenHash)).run();
    return false;
  }
  db.update(sessions)
    .set({ expiresAt: expiryFrom(now), lastSeenAt: now.toISOString() })
    .where(eq(sessions.tokenHash, tokenHash))
    .run();
  return true;
}

export function deleteSession(db: Db, token: string): void {
  db.delete(sessions).where(eq(sessions.tokenHash, sha256(token))).run();
}

export function deleteExpiredSessions(db: Db, now = new Date()): void {
  db.delete(sessions).where(lt(sessions.expiresAt, now.toISOString())).run();
}
