import { TRPCError } from '@trpc/server';
import { describe, expect, it, vi } from 'vitest';
import {
  buildStockPreferenceProfile,
  emptyManualStockPreferences,
} from '../../stocks/stock-preference-profile.js';
import {
  clearPreferenceProfileForUser,
  getPreferenceProfileForUser,
  stockPreferenceProcedures,
  updatePreferenceProfileForUser,
  updateStockPreferenceProfileInputSchema,
  withStockScreeningPreferenceRecording,
} from './stocks-preferences.js';
import { stocksRouter } from './stocks.js';

function userDb(rows: Array<{ id: number }>) {
  const chain = {
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(async () => rows),
  };
  chain.from.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  return { select: vi.fn(() => chain) };
}

const manual = emptyManualStockPreferences();

function profileView(state: 'ready' | 'empty') {
  const preferences = emptyManualStockPreferences();
  if (state === 'ready') preferences.industries = ['科技'];
  return buildStockPreferenceProfile({
    now: new Date('2026-08-18T00:00:00Z'),
    enabled: true,
    manualPreferences: preferences,
    signals: [],
    watchlist: [],
  });
}

describe('stock preference procedures', () => {
  it('exposes all profile controls on the stocks router', () => {
    const caller = stocksRouter.createCaller({ userId: 'usr_test', db: {}, logger: {} } as never);
    expect(caller.preferenceProfile).toBeTypeOf('function');
    expect(caller.updatePreferenceProfile).toBeTypeOf('function');
    expect(caller.clearPreferenceProfile).toBeTypeOf('function');
    expect(Object.keys(stockPreferenceProcedures)).toEqual([
      'preferenceProfile',
      'updatePreferenceProfile',
      'clearPreferenceProfile',
    ]);
  });

  it('bounds manual values and rejects unknown enum choices', () => {
    expect(updateStockPreferenceProfileInputSchema.safeParse({
      enabled: true,
      manualPreferences: { ...manual, industries: Array.from({ length: 9 }, (_, i) => `行业${i}`) },
    }).success).toBe(false);
    expect(updateStockPreferenceProfileInputSchema.safeParse({
      enabled: true,
      manualPreferences: { ...manual, marketCaps: ['超微盘'] },
    }).success).toBe(false);
  });

  it('rejects an unknown caller before loading profile data', async () => {
    const load = vi.fn();
    await expect(getPreferenceProfileForUser({
      db: userDb([]) as never,
      userExternalId: 'usr_unknown',
      load,
    })).rejects.toBeInstanceOf(TRPCError);
    expect(load).not.toHaveBeenCalled();
  });

  it('updates bounded controls and logs only metadata', async () => {
    const update = vi.fn(async () => undefined);
    const load = vi.fn(async () => profileView('ready'));
    const logger = { info: vi.fn(), warn: vi.fn() };
    const next = emptyManualStockPreferences();
    next.industries = ['半导体'];

    await expect(updatePreferenceProfileForUser({
      db: userDb([{ id: 7 }]) as never,
      userExternalId: 'usr_test',
      input: { enabled: true, manualPreferences: next },
      update,
      load,
      logger,
    })).resolves.toMatchObject({ state: 'ready' });

    expect(update).toHaveBeenCalledWith(expect.objectContaining({ userId: 7, enabled: true }));
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain('半导体');
  });

  it('clears profile evidence then returns the new view', async () => {
    const clear = vi.fn(async () => undefined);
    const load = vi.fn(async () => profileView('empty'));
    await expect(clearPreferenceProfileForUser({
      db: userDb([{ id: 7 }]) as never,
      userExternalId: 'usr_test',
      clear,
      load,
    })).resolves.toMatchObject({ state: 'empty' });
    expect(clear).toHaveBeenCalledWith(expect.objectContaining({ userId: 7 }));
  });

  it('records only after success and never fails screening when profile storage fails', async () => {
    const result = { snapshotId: 'stkshot_0123456789abcdef01234567', zeroResult: true };
    const run = vi.fn(async () => result);
    const record = vi.fn(async () => { throw new Error('database unavailable'); });
    const logger = { info: vi.fn(), warn: vi.fn() };

    await expect(withStockScreeningPreferenceRecording({
      run,
      record,
      logger,
      logContext: { userId: 7, snapshotId: result.snapshotId, criterionCount: 1 },
    })).resolves.toBe(result);
    expect(run).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('database unavailable');

    const failedRecord = vi.fn();
    await expect(withStockScreeningPreferenceRecording({
      run: vi.fn(async () => { throw new Error('screening failed'); }),
      record: failedRecord,
      logger,
      logContext: { userId: 7, snapshotId: result.snapshotId, criterionCount: 1 },
    })).rejects.toThrow('screening failed');
    expect(failedRecord).not.toHaveBeenCalled();
  });
});
