import { afterEach, describe, expect, it } from 'vitest';
import {
  checkPassword,
  createSession,
  deleteSession,
  hashPassword,
  hasPassword,
  PasswordTooShortError,
  SESSION_TTL_DAYS,
  setPassword,
  validateSession,
  verifyPassword,
} from './auth.ts';
import { openDb } from './db.ts';

let close: (() => void) | undefined;
afterEach(() => close?.());

function setup() {
  const handle = openDb({ filename: ':memory:' });
  close = handle.close;
  return handle.db;
}

describe('passwords', () => {
  it('hashes and verifies', async () => {
    const hash = await hashPassword('correct horse battery');
    expect(hash.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('correct horse battery', hash)).toBe(true);
    expect(await verifyPassword('wrong password!', hash)).toBe(false);
    expect(await verifyPassword('anything', 'garbage')).toBe(false);
  });

  it('stores the password in settings', async () => {
    const db = setup();
    expect(hasPassword(db)).toBe(false);
    expect(await checkPassword(db, 'whatever-123')).toBe(false);
    await setPassword(db, 'workbench-2026');
    expect(hasPassword(db)).toBe(true);
    expect(await checkPassword(db, 'workbench-2026')).toBe(true);
    expect(await checkPassword(db, 'workbench-2025')).toBe(false);
  });

  it('rejects short passwords', async () => {
    const db = setup();
    await expect(setPassword(db, 'short')).rejects.toBeInstanceOf(PasswordTooShortError);
  });
});

describe('sessions', () => {
  it('creates, validates and deletes a session', () => {
    const db = setup();
    const token = createSession(db, 'test');
    expect(validateSession(db, token)).toBe(true);
    expect(validateSession(db, token + 'x')).toBe(false);
    expect(validateSession(db, undefined)).toBe(false);
    deleteSession(db, token);
    expect(validateSession(db, token)).toBe(false);
  });

  it('expires after the TTL without use', () => {
    const db = setup();
    const start = new Date('2026-01-01T00:00:00Z');
    const token = createSession(db, 'test', start);
    const later = new Date(start.getTime() + (SESSION_TTL_DAYS + 1) * 86_400_000);
    expect(validateSession(db, token, later)).toBe(false);
  });

  it('slides the expiry on use', () => {
    const db = setup();
    const start = new Date('2026-01-01T00:00:00Z');
    const token = createSession(db, 'test', start);
    const mid = new Date(start.getTime() + 60 * 86_400_000);
    expect(validateSession(db, token, mid)).toBe(true);
    const afterOriginalExpiry = new Date(start.getTime() + (SESSION_TTL_DAYS + 10) * 86_400_000);
    expect(validateSession(db, token, afterOriginalExpiry)).toBe(true);
  });
});
