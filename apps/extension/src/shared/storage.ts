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

export async function getAccessToken(): Promise<string | null> {
  const out = await chrome.storage.local.get(TOKEN_KEY);
  return (out[TOKEN_KEY] as string | undefined) ?? null;
}

export async function setAccessToken(token: string): Promise<void> {
  await chrome.storage.local.set({ [TOKEN_KEY]: token });
}

export async function clearAccessToken(): Promise<void> {
  await chrome.storage.local.remove(TOKEN_KEY);
}

export async function getStoredUser(): Promise<StoredUser | null> {
  const out = await chrome.storage.local.get(USER_KEY);
  return (out[USER_KEY] as StoredUser | undefined) ?? null;
}

export async function setStoredUser(user: StoredUser): Promise<void> {
  await chrome.storage.local.set({ [USER_KEY]: user });
}
