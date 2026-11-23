import { setServerReachable } from './lib/connection.ts';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Fetches and records whether the server answered. */
async function send(path: string, init: RequestInit): Promise<Response> {
  try {
    const res = await fetch(path, init);
    setServerReachable(true);
    return res;
  } catch {
    setServerReachable(false);
    throw new ApiError(0, 'You’re offline, so this can’t be saved or loaded right now.');
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await send(path, {
    method,
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: body === undefined ? (method === 'GET' || method === 'DELETE' ? undefined : '{}') : JSON.stringify(body),
  });
  return parse<T>(res);
}

/** Sends a multipart form; the browser sets the content type and boundary. */
async function upload<T>(path: string, form: FormData): Promise<T> {
  const res = await send(path, { method: 'POST', credentials: 'same-origin', headers: { accept: 'application/json' }, body: form });
  return parse<T>(res);
}

async function parse<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => ({}))) as { error?: string; issues?: { path: string; message: string }[] };
  if (!res.ok) {
    const detail = data.issues?.[0] ? `: ${data.issues[0].path || 'input'} – ${data.issues[0].message}` : '';
    throw new ApiError(res.status, (data.error ?? `Request failed (${res.status})`) + detail);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  delete: (path: string) => request<void>('DELETE', path),
  upload,
};

export interface AuthState {
  passwordSet: boolean;
  authenticated: boolean;
  minPasswordLength: number;
  hasPasskeys: boolean;
  /** Addresses passkeys work at; empty if the server has no HTTPS domain configured. */
  passkeyOrigins: string[];
}
