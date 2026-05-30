/**
 * Thin promise wrapper over chrome.storage.local for Phase 0.
 * Persists the JWT issued by the orchestrator and basic user metadata.
 */

const TOKEN_KEY = 'holaday.access_token';
const USER_KEY = 'holaday.user';

export interface StoredUser {
  externalId: string;
  email: string;
  plan: string;
  displayName?: string | null;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function normalizeAccessToken(value: unknown): string | null {
  if (!nonEmptyString(value)) return null;
  const token = value.trim();
  return token === 'undefined' || token === 'null' ? null : token;
}

export function normalizeStoredUser(value: unknown): StoredUser | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<Record<keyof StoredUser, unknown>>;
  if (!nonEmptyString(raw.externalId) || !nonEmptyString(raw.email) || !nonEmptyString(raw.plan)) {
    return null;
  }
  return {
    externalId: raw.externalId,
    email: raw.email,
    plan: raw.plan,
    ...(typeof raw.displayName === 'string' || raw.displayName === null
      ? { displayName: raw.displayName }
      : {}),
  };
}

export async function getAccessToken(): Promise<string | null> {
  const out = await chrome.storage.local.get(TOKEN_KEY);
  return normalizeAccessToken(out[TOKEN_KEY]);
}

export async function setAccessToken(token: string): Promise<void> {
  const normalized = normalizeAccessToken(token);
  if (!normalized) {
    await clearAccessToken();
    return;
  }
  await chrome.storage.local.set({ [TOKEN_KEY]: normalized });
}

export async function clearAccessToken(): Promise<void> {
  await chrome.storage.local.remove(TOKEN_KEY);
}

export async function getStoredUser(): Promise<StoredUser | null> {
  const out = await chrome.storage.local.get(USER_KEY);
  return normalizeStoredUser(out[USER_KEY]);
}

export async function setStoredUser(user: StoredUser): Promise<void> {
  await chrome.storage.local.set({ [USER_KEY]: user });
}

export async function clearStoredUser(): Promise<void> {
  await chrome.storage.local.remove(USER_KEY);
}
