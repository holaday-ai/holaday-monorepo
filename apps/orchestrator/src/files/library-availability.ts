import path from 'node:path';
import type { StorageProvider } from './storage-provider.js';

export type LibraryAvailability = 'available' | 'unavailable' | 'unknown';
type Row = { storagePath: string; status: string; expiresAt: Date | null };
type Evidence = { value: LibraryAvailability; expiresAt: number };

// Evidence is advisory only. Downloads/previews still perform their own read checks.
// Scope by provider AND database owner, never by an untrusted path's usr_ segment.
const providers = new WeakMap<
  StorageProvider,
  {
    cache: Map<string, Evidence>;
    pending: Map<string, Promise<LibraryAvailability>>;
  }
>();
const CACHE_TTL_MS = 60_000;
const MAX_CACHE_ENTRIES = 1_000;
const MAX_CONCURRENT_CHECKS = 5;
const LIST_CHECK_BUDGET_MS = 500;

export async function libraryAvailability(
  storage: StorageProvider,
  rows: Row[],
  ownerExternalId: string,
): Promise<LibraryAvailability[]> {
  const state: NonNullable<ReturnType<typeof providers.get>> = providers.get(storage) ?? {
    cache: new Map(),
    pending: new Map(),
  };
  providers.set(storage, state);
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<'unknown'>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve('unknown');
    }, LIST_CHECK_BUDGET_MS);
  });
  const now = Date.now();
  try {
    async function resolve(row: Row): Promise<LibraryAvailability> {
      if (row.status !== 'active' || (row.expiresAt !== null && row.expiresAt.getTime() <= now)) {
        return 'unavailable' as const;
      }
      // Current object keys must not add R2 round trips to the metadata listing.
      // Only old absolute disk handles need compatibility evidence before an action.
      if (!path.isAbsolute(row.storagePath)) return 'unknown' as const;
      const key = JSON.stringify([ownerExternalId, row.storagePath]);
      const cached = state.cache.get(key);
      if (cached && cached.expiresAt > now) return cached.value;
      state.cache.delete(key);
      let check = state.pending.get(key);
      if (!check) {
        // No queue: a slow provider cannot retain an unbounded batch of work.
        // Pending requests keep their slots even if the caller's budget expires.
        if (state.pending.size >= MAX_CONCURRENT_CHECKS) return 'unknown' as const;
        check = Promise.resolve()
          .then(() =>
            storage.stat(row.storagePath, {
              signal: controller.signal,
              ownerExternalId,
            }),
          )
          .then(
            (meta) => {
              const value = meta ? ('available' as const) : ('unavailable' as const);
              if (!controller.signal.aborted) {
                if (state.cache.size >= MAX_CACHE_ENTRIES) {
                  const oldest = state.cache.keys().next().value;
                  if (oldest !== undefined) state.cache.delete(oldest);
                }
                state.cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
              }
              return value;
            },
            () => 'unknown' as const,
          )
          .finally(() => {
            state.pending.delete(key);
          });
        state.pending.set(key, check);
      }
      return Promise.race([check, deadline]);
    }
    const result: LibraryAvailability[] = rows.map((row) =>
      row.status !== 'active' || (row.expiresAt !== null && row.expiresAt.getTime() <= now)
        ? 'unavailable'
        : 'unknown',
    );
    let cursor = 0;
    await Promise.all(
      Array.from({ length: Math.min(MAX_CONCURRENT_CHECKS, rows.length) }, async () => {
        while (cursor < rows.length && !controller.signal.aborted) {
          const index = cursor++;
          // biome-ignore lint/style/noNonNullAssertion: Cursor is bounded by this immutable database page.
          result[index] = await resolve(rows[index]!);
        }
      }),
    );
    return result;
  } finally {
    clearTimeout(timer);
  }
}
