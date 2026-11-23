import { isIP } from 'node:net';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransport,
  type RegistrationResponseJSON,
  type WebAuthnCredential,
} from '@simplewebauthn/server';
import { isoBase64URL } from '@simplewebauthn/server/helpers';
import { desc, eq } from 'drizzle-orm';
import type { Db } from '../db.ts';
import { InvalidOperationError, NotFoundError } from '../errors.ts';
import { newId } from '../ids.ts';
import { passkeys } from '../schema.ts';
import { passkeyCreateSchema, type Passkey, type PasskeyCreate } from '../schemas.ts';
import { logActivity, nowIso, type ServiceContext } from './context.ts';

/** The one account of this single-user app. A stable id lets devices recognise their own passkey. */
const USER_ID = new TextEncoder().encode('projectbench-owner');
const USER_NAME = 'ProjectBench';
const VITE_DEV_ORIGIN = 'http://localhost:5173';

export interface RelyingParty {
  id: string;
  name: string;
  origins: string[];
}

/** Passkeys need a domain name on HTTPS, or localhost. Returns undefined for any other address. */
export function relyingPartyFor(publicUrl: string | undefined): RelyingParty | undefined {
  if (!publicUrl) return undefined;
  let url: URL;
  try {
    url = new URL(publicUrl);
  } catch {
    return undefined;
  }
  const host = url.hostname;
  if (isIP(host.replace(/^\[|\]$/g, ''))) return undefined;
  const local = host === 'localhost';
  if (url.protocol !== 'https:' && !local) return undefined;
  return { id: host, name: 'ProjectBench', origins: local ? [...new Set([url.origin, VITE_DEV_ORIGIN])] : [url.origin] };
}

const toPasskey = (row: typeof passkeys.$inferSelect): Passkey => ({
  id: row.id,
  name: row.name,
  backedUp: row.backedUp,
  createdAt: row.createdAt,
  lastUsedAt: row.lastUsedAt,
});

const toCredential = (row: typeof passkeys.$inferSelect): WebAuthnCredential => ({
  id: row.credentialId,
  publicKey: isoBase64URL.toBuffer(row.publicKey),
  counter: row.counter,
  transports: row.transports ? (JSON.parse(row.transports) as AuthenticatorTransport[]) : undefined,
});

export function listPasskeys(ctx: ServiceContext): Passkey[] {
  return ctx.db.select().from(passkeys).orderBy(desc(passkeys.createdAt), desc(passkeys.id)).all().map(toPasskey);
}

export function hasPasskeys(db: Db): boolean {
  return db.select({ id: passkeys.id }).from(passkeys).limit(1).get() !== undefined;
}

export function passkeyRegistrationOptions(ctx: ServiceContext, rp: RelyingParty) {
  const existing = ctx.db.select().from(passkeys).all().map(toCredential);
  return generateRegistrationOptions({
    rpName: rp.name,
    rpID: rp.id,
    userID: USER_ID,
    userName: USER_NAME,
    attestationType: 'none',
    excludeCredentials: existing.map((c) => ({ id: c.id, transports: c.transports })),
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
  });
}

/** Verifies a new credential and stores it. Returns null if the browser's response doesn't check out. */
export async function registerPasskey(
  ctx: ServiceContext,
  rp: RelyingParty,
  input: PasskeyCreate,
  response: RegistrationResponseJSON,
  expectedChallenge: string,
): Promise<Passkey | null> {
  const { name } = passkeyCreateSchema.parse(input);
  let result: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
  try {
    result = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: rp.origins,
      expectedRPID: rp.id,
      requireUserVerification: true,
    });
  } catch {
    return null;
  }
  if (!result.verified) return null;

  const { credential, credentialBackedUp } = result.registrationInfo;
  const id = newId();
  const now = nowIso(ctx);
  ctx.db.transaction((tx) => {
    if (tx.select({ id: passkeys.id }).from(passkeys).where(eq(passkeys.credentialId, credential.id)).get()) {
      throw new InvalidOperationError('This passkey is already added');
    }
    tx.insert(passkeys)
      .values({
        id,
        name,
        credentialId: credential.id,
        publicKey: isoBase64URL.fromBuffer(credential.publicKey),
        counter: credential.counter,
        transports: credential.transports ? JSON.stringify(credential.transports) : null,
        backedUp: credentialBackedUp,
        createdAt: now,
      })
      .run();
    logActivity(tx, ctx, { projectId: null, entity: 'passkey', entityId: id, action: 'create', diff: { name } });
  });
  return toPasskey(ctx.db.select().from(passkeys).where(eq(passkeys.id, id)).get()!);
}

export function deletePasskey(ctx: ServiceContext, id: string): void {
  ctx.db.transaction((tx) => {
    const current = tx.select().from(passkeys).where(eq(passkeys.id, id)).get();
    if (!current) throw new NotFoundError('Passkey', id);
    tx.delete(passkeys).where(eq(passkeys.id, id)).run();
    logActivity(tx, ctx, { projectId: null, entity: 'passkey', entityId: id, action: 'delete', diff: { name: current.name } });
  });
}

/** No credential list: the device offers the passkeys it holds for this site. */
export function passkeyLoginOptions(rp: RelyingParty) {
  return generateAuthenticationOptions({ rpID: rp.id, userVerification: 'required' });
}

/** Returns true if the response proves possession of a stored passkey. */
export async function verifyPasskeyLogin(
  db: Db,
  rp: RelyingParty,
  response: AuthenticationResponseJSON,
  expectedChallenge: string,
  now = new Date(),
): Promise<boolean> {
  const row = db.select().from(passkeys).where(eq(passkeys.credentialId, response.id)).get();
  if (!row) return false;
  let result: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
  try {
    result = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: rp.origins,
      expectedRPID: rp.id,
      credential: toCredential(row),
      requireUserVerification: true,
    });
  } catch {
    return false;
  }
  if (!result.verified) return false;
  db.update(passkeys)
    .set({
      counter: result.authenticationInfo.newCounter,
      backedUp: result.authenticationInfo.credentialBackedUp,
      lastUsedAt: now.toISOString(),
    })
    .where(eq(passkeys.id, row.id))
    .run();
  return true;
}
