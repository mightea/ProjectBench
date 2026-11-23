import type { Passkey } from '@projectbench/core/schemas';
import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
  WebAuthnError,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';
import { api, type AuthState } from '../api.ts';

/** A passkey is bound to one address, so this must be the address the server is configured for. */
export const passkeysUsable = (auth: AuthState) => auth.passkeyOrigins.includes(window.location.origin) && browserSupportsWebAuthn();

/** Runs the device prompt. Returns null if the person dismissed it. */
async function prompt<T>(run: () => Promise<T>): Promise<T | null> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof Error && (err.name === 'NotAllowedError' || err.name === 'AbortError')) return null;
    if (err instanceof WebAuthnError && err.code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED') {
      throw new Error('This device already has a passkey for ProjectBench.');
    }
    throw new Error('Your device couldn’t use a passkey here.');
  }
}

/** Returns false if the prompt was dismissed. */
export async function signInWithPasskey(): Promise<boolean> {
  const optionsJSON = await api.post<PublicKeyCredentialRequestOptionsJSON>('/api/auth/passkey/options');
  const response = await prompt(() => startAuthentication({ optionsJSON }));
  if (!response) return false;
  await api.post('/api/auth/passkey/verify', { response });
  return true;
}

/** Returns null if the prompt was dismissed. */
export async function addPasskey(name: string, password: string): Promise<Passkey | null> {
  const optionsJSON = await api.post<PublicKeyCredentialCreationOptionsJSON>('/api/passkeys/options', { password });
  const response = await prompt(() => startRegistration({ optionsJSON }));
  if (!response) return null;
  return api.post<Passkey>('/api/passkeys', { name, response });
}
