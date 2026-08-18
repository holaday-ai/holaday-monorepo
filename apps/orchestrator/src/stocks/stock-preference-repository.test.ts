import { describe, expect, it } from 'vitest';
import { emptyManualStockPreferences } from './stock-preference-profile.js';
import {
  clearStockPreferenceProfile,
  loadStockPreferenceProfile,
  recordStockScreeningPreference,
  updateStockPreferenceControls,
} from './stock-preference-repository.js';

function tableName(table: unknown): string {
  return (table as Record<symbol, string>)[Symbol.for('drizzle:Name')] ?? '';
}

function fakeDb(seed: {
  profile?: Record<string, unknown> | null;
  signals?: Array<Record<string, unknown>>;
  watchlist?: Array<Record<string, unknown>>;
} = {}) {
  let profile = seed.profile ?? null;
  const signals = [...(seed.signals ?? [])];
  const watchlist = [...(seed.watchlist ?? [])];
  const inserts: Array<{ table: string; value: Record<string, unknown> }> = [];
  let deletedSignals = 0;

  const db = {
    select() {
      return {
        from(table: unknown) {
          const name = tableName(table);
          return {
            where() {
              const rows = name === 'stock_preference_profiles'
                ? (profile ? [profile] : [])
                : name === 'stock_preference_signals'
                  ? [...signals]
                  : name === 'watchlists'
                    ? [...watchlist]
                    : [];
              return {
                limit: async () => rows.slice(0, 1),
                orderBy: async () => rows,
              };
            },
          };
        },
      };
    },
    insert(table: unknown) {
      const name = tableName(table);
      return {
        values(value: Record<string, unknown>) {
          if (name === 'stock_preference_signals') {
            if (signals.some((item) => item.dedupeHash === value.dedupeHash)) {
              const error = new Error('duplicate') as Error & { code: string };
              error.code = 'ER_DUP_ENTRY';
              throw error;
            }
            signals.push(value);
            inserts.push({ table: name, value });
            return Promise.resolve({ affectedRows: 1 });
          }
          return {
            async onDuplicateKeyUpdate({ set }: { set: Record<string, unknown> }) {
              profile = profile ? { ...profile, ...set } : { ...value };
              inserts.push({ table: name, value });
              return { affectedRows: 1 };
            },
          };
        },
      };
    },
    delete(table: unknown) {
      const name = tableName(table);
      return {
        async where() {
          if (name === 'stock_preference_signals') {
            deletedSignals += signals.length;
            signals.splice(0);
          }
          return { affectedRows: deletedSignals };
        },
      };
    },
    async transaction<T>(callback: (tx: unknown) => Promise<T>): Promise<T> {
      return callback(db);
    },
  };

  return {
    db,
    signals,
    watchlist,
    inserts,
    get profile() { return profile; },
    get deletedSignals() { return deletedSignals; },
  };
}

describe('stock preference repository', () => {
  it('loads profile controls, canonical signals, and post-clear watchlist evidence', async () => {
    const manual = emptyManualStockPreferences();
    manual.industries = ['半导体'];
    const store = fakeDb({
      profile: { enabled: true, manualPreferencesJson: manual, clearedAt: null },
      signals: [{
        kind: 'screening_run',
        dataAsOf: '2026-08-17',
        occurredAt: new Date('2026-08-17T00:00:00Z'),
        payloadJson: {
          snapshotId: 'stkshot_0123456789abcdef01234567',
          criteria: [{ field: 'pe_ttm', operator: 'lte', value: 30 }],
        },
      }],
      watchlist: [{ symbol: '600519', market: 'A', createdAt: new Date('2026-08-10T00:00:00Z') }],
    });

    const result = await loadStockPreferenceProfile({
      db: store.db as never,
      userId: 7,
      now: new Date('2026-08-18T00:00:00Z'),
    });

    expect(result.state).toBe('ready');
    expect(result.manualPreferences.industries).toEqual(['半导体']);
    expect(result.sample).toEqual({ screeningRuns: 1, watchlistStocks: 1, manualDimensions: 1 });
  });

  it('records only canonical criteria and deduplicates the same successful screening', async () => {
    const store = fakeDb();
    const input = {
      db: store.db as never,
      userId: 7,
      snapshotId: 'stkshot_0123456789abcdef01234567',
      dataAsOf: '2026-08-17',
      occurredAt: new Date('2026-08-18T00:00:00Z'),
      criteria: [{
        id: 'client-id',
        field: 'pe_ttm' as const,
        operator: 'lte' as const,
        value: 30,
        unit: null,
        label: '立即买入',
        sourceField: 'raw prompt must not persist',
        status: 'ready' as const,
      }],
    };

    await expect(recordStockScreeningPreference(input)).resolves.toEqual({ recorded: true });
    await expect(recordStockScreeningPreference(input)).resolves.toEqual({ recorded: false });
    expect(store.signals).toHaveLength(1);
    expect(store.signals[0]?.dedupeHash).toMatch(/^[a-f0-9]{64}$/);
    expect(store.signals[0]?.payloadJson).toEqual({
      snapshotId: input.snapshotId,
      criteria: [{ field: 'pe_ttm', operator: 'lte', value: 30 }],
    });
    expect(JSON.stringify(store.signals[0])).not.toMatch(/立即买入|raw prompt|client-id/);
  });

  it('upserts bounded manual controls without changing the clear cutoff', async () => {
    const clearedAt = new Date('2026-08-01T00:00:00Z');
    const store = fakeDb({
      profile: { enabled: true, manualPreferencesJson: emptyManualStockPreferences(), clearedAt },
    });
    const manual = emptyManualStockPreferences();
    manual.holdingPeriods = ['中长期'];

    await updateStockPreferenceControls({
      db: store.db as never,
      userId: 7,
      enabled: false,
      manualPreferences: manual,
    });

    expect(store.profile).toMatchObject({
      enabled: false,
      manualPreferencesJson: manual,
      clearedAt,
    });
  });

  it('clears signals and advances the cutoff without deleting watchlist rows', async () => {
    const store = fakeDb({
      profile: { enabled: false, manualPreferencesJson: { industries: ['医药'] }, clearedAt: null },
      signals: [{ dedupeHash: 'a'.repeat(64) }],
      watchlist: [{ symbol: '600519', market: 'A', createdAt: new Date('2026-08-01T00:00:00Z') }],
    });
    const now = new Date('2026-08-18T00:00:00Z');

    await clearStockPreferenceProfile({ db: store.db as never, userId: 7, now });

    expect(store.deletedSignals).toBe(1);
    expect(store.watchlist).toHaveLength(1);
    expect(store.profile).toMatchObject({
      enabled: false,
      manualPreferencesJson: emptyManualStockPreferences(),
      clearedAt: now,
    });
  });
});
