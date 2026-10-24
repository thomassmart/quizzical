import { randomUUID } from './uuid';

export type AuthRole = 'host' | 'team' | 'wallboard';

const DEVICE_KEY = 'quizzical_device';
const LEGACY_TOKEN_KEY = 'quizzical_token';

function tokenKey(role: AuthRole) {
  return `quizzical_${role}_token`;
}

export function getToken(role: AuthRole): string | null {
  const scoped = localStorage.getItem(tokenKey(role));
  if (scoped) return scoped;
  // One-time migration from the old single-token key
  const legacy = localStorage.getItem(LEGACY_TOKEN_KEY);
  if (legacy) {
    localStorage.removeItem(LEGACY_TOKEN_KEY);
  }
  return null;
}

export function setToken(role: AuthRole, token: string) {
  localStorage.setItem(tokenKey(role), token);
  localStorage.removeItem(LEGACY_TOKEN_KEY);
}

export function clearToken(role?: AuthRole) {
  if (role) {
    localStorage.removeItem(tokenKey(role));
    return;
  }
  localStorage.removeItem(tokenKey('host'));
  localStorage.removeItem(tokenKey('team'));
  localStorage.removeItem(tokenKey('wallboard'));
  localStorage.removeItem(LEGACY_TOKEN_KEY);
}

/** Read eventId from a JWT payload without verifying (client gate only). */
export function tokenEventId(token: string | null | undefined): string | null {
  if (!token) return null;
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
    const payload = JSON.parse(json) as { eventId?: unknown };
    return typeof payload.eventId === 'string' ? payload.eventId : null;
  } catch {
    return null;
  }
}

export function getDeviceId() {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = randomUUID();
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

function inferRole(path: string): AuthRole {
  if (path.startsWith('/api/play') || path.startsWith('/api/auth/team')) {
    return 'team';
  }
  if (path.startsWith('/api/wall') || path.startsWith('/api/auth/wallboard')) {
    return 'wallboard';
  }
  return 'host';
}

export async function api<T>(
  path: string,
  opts: RequestInit & { auth?: boolean | AuthRole } = {},
): Promise<T> {
  const headers = new Headers(opts.headers);
  if (
    !headers.has('Content-Type') &&
    opts.body &&
    !(opts.body instanceof FormData)
  ) {
    headers.set('Content-Type', 'application/json');
  }

  if (opts.auth !== false) {
    const role = typeof opts.auth === 'string' ? opts.auth : inferRole(path);
    const token = getToken(role);
    if (token) headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(path, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const body = data as { error?: unknown; message?: unknown };
    const message =
      typeof body?.error === 'string' && body.error !== 'Internal Server Error'
        ? body.error
        : typeof body?.message === 'string'
          ? body.message
          : typeof body?.error === 'string'
            ? body.error
            : res.statusText;
    throw new Error(message || `Request failed (${res.status})`);
  }
  return data as T;
}

export function wsUrl(token: string, eventId?: string) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const params = new URLSearchParams({ token });
  if (eventId) params.set('eventId', eventId);
  return `${proto}://${location.host}/ws?${params}`;
}
