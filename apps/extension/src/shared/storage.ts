/**
 * Thin promise wrapper over chrome.storage.local for Phase 0.
 * Persists the JWT issued by the orchestrator and basic user metadata.
 */

import { withDeadline } from './deadline.js';

const TOKEN_KEY = 'holaday.access_token';
const USER_KEY = 'holaday.user';
const STORAGE_READ_TIMEOUT_MS = 1_500;
const STORAGE_WRITE_TIMEOUT_MS = 1_500;

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
  const lower = token.toLowerCase();
  return lower === 'undefined' || lower === 'null' ? null : token;
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
  try {
    const out = await withDeadline(
      chrome.storage.local.get(TOKEN_KEY),
      STORAGE_READ_TIMEOUT_MS,
      'storage_token_read_timeout',
    );
    return normalizeAccessToken(out[TOKEN_KEY]);
  } catch {
    return null;
  }
}

export async function setAccessToken(token: string): Promise<void> {
  const normalized = normalizeAccessToken(token);
  if (!normalized) {
    await clearAccessToken();
    return;
  }
  await withDeadline(
    chrome.storage.local.set({ [TOKEN_KEY]: normalized }),
    STORAGE_WRITE_TIMEOUT_MS,
    'storage_token_write_timeout',
  );
}

export async function clearAccessToken(): Promise<void> {
  await withDeadline(
    chrome.storage.local.remove(TOKEN_KEY),
    STORAGE_WRITE_TIMEOUT_MS,
    'storage_token_remove_timeout',
  );
}

export async function getStoredUser(): Promise<StoredUser | null> {
  try {
    const out = await withDeadline(
      chrome.storage.local.get(USER_KEY),
      STORAGE_READ_TIMEOUT_MS,
      'storage_user_read_timeout',
    );
    return normalizeStoredUser(out[USER_KEY]);
  } catch {
    return null;
  }
}

export async function setStoredUser(user: StoredUser): Promise<void> {
  await withDeadline(
    chrome.storage.local.set({ [USER_KEY]: user }),
    STORAGE_WRITE_TIMEOUT_MS,
    'storage_user_write_timeout',
  );
}

export async function clearStoredUser(): Promise<void> {
  await withDeadline(
    chrome.storage.local.remove(USER_KEY),
    STORAGE_WRITE_TIMEOUT_MS,
    'storage_user_remove_timeout',
  );
}
