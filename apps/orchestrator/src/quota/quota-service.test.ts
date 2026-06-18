/**
 * Phase 14 audit follow-up — pool/concurrency refactor.
 * Pins the per-plan concurrency limits + the upgrade-pitch error
 * copy so a future drift in PLAN_CATALOGUE surfaces here.
 */

import { PLAN_CATALOGUE } from '@holaday/shared-types';
import { describe, expect, it } from 'vitest';
import {
  QuotaService,
  concurrencyExhaustedMessage,
  getConcurrencyLimit,
} from './quota-service.js';

describe('getConcurrencyLimit — Phase 14 limits', () => {
  it('free → 1', () => {
    expect(getConcurrencyLimit('free')).toBe(1);
  });
  it('basic → 3', () => {
    expect(getConcurrencyLimit('basic')).toBe(3);
  });
  it('pro → 5', () => {
    expect(getConcurrencyLimit('pro')).toBe(5);
  });
});

describe('concurrencyExhaustedMessage — upgrade-pitch copy', () => {
  it('free copy mentions both basic and pro upgrade paths', () => {
    const msg = concurrencyExhaustedMessage('free');
    expect(msg).toContain('免费版');
    expect(msg).toContain('1');
    expect(msg).toContain('基础版');
    expect(msg).toContain('3');
    expect(msg).toContain('专业版');
    expect(msg).toContain('5');
  });

  it('basic copy mentions only pro upgrade (no down-pitch)', () => {
    const msg = concurrencyExhaustedMessage('basic');
    expect(msg).toContain('基础版');
    expect(msg).toContain('3');
    expect(msg).toContain('专业版');
    expect(msg).toContain('5');
    expect(msg).not.toContain('免费版');
  });

  it('pro copy is a true ceiling — no upsell', () => {
    const msg = concurrencyExhaustedMessage('pro');
    expect(msg).toContain('专业版');
    expect(msg).toContain('5');
    expect(msg).not.toContain('升级');
  });

  it('numbers are sourced from PLAN_CATALOGUE — drift would fail above', () => {
    // Sanity: the numbers asserted above must equal the catalogue;
    // if someone bumps a plan's concurrency without rechecking the
    // copy, this test surfaces the discrepancy.
    expect(concurrencyExhaustedMessage('free')).toContain(
      String(getConcurrencyLimit('free')),
    );
    expect(concurrencyExhaustedMessage('basic')).toContain(
      String(getConcurrencyLimit('basic')),
    );
    expect(concurrencyExhaustedMessage('pro')).toContain(
      String(getConcurrencyLimit('pro')),
    );
  });
});

/**
 * Regression for the drizzle-array affectedRows bug.
 *
 * `db.update(...)` resolves to `[ResultSetHeader, fields]` — the count
 * is `result[0].affectedRows`. The old inline top-level read got
 * `undefined ?? 0 = 0`, so EVERY metered burn fell through to the limit
 * error even though the UPDATE had already incremented the counter
 * (universal "额度已用完" 429). The fake db below returns the REAL array
 * envelope so these tests exercise the HIT path the bug broke.
 */
interface FakeQuotaRow {
  id: number;
  period: string;
  periodStart: Date;
  periodEnd: Date;
  tasksUsed: number;
  opusUsed: number;
  bonusTasks: number;
  bonusOpus: number;
}

const PRO_LIMITS = {
  // biome-ignore lint/style/noNonNullAssertion: pro defines an opus sub-quota
  tasksLimit: PLAN_CATALOGUE.pro.tasks.count,
  opusLimit: PLAN_CATALOGUE.pro.tasks.opus as number,
};

function makeQuotaDb(init: Partial<FakeQuotaRow>): {
  svc: QuotaService;
  row: FakeQuotaRow;
} {
  const row: FakeQuotaRow = {
    id: 1,
    period: 'month',
    periodStart: new Date('2026-06-01T00:00:00.000Z'),
    periodEnd: new Date('2026-07-01T00:00:00.000Z'),
    tasksUsed: 0,
    opusUsed: 0,
    bonusTasks: 0,
    bonusOpus: 0,
    ...init,
  };
  // Models the four conditional UPDATEs in tryConsume by the field name
  // in the SET clause, applying the same WHERE semantics the SQL carries
  // (bonus pools: `> 0` decrement; regular pools: `< limit` increment),
  // and returns the REAL mysql2/drizzle envelope `[header, fields]`.
  const fakeDb = {
    insert() {
      return {
        values() {
          return {
            onDuplicateKeyUpdate() {
              return Promise.resolve([{ affectedRows: 1 }, null]);
            },
          };
        },
      };
    },
    select() {
      return {
        from() {
          return {
            where() {
              return { limit: () => Promise.resolve([row]) };
            },
          };
        },
      };
    },
    update() {
      return {
        set(setObj: Record<string, unknown>) {
          const field = Object.keys(setObj)[0];
          return {
            where() {
              let affected = 0;
              if (field === 'bonusTasks') {
                if (row.bonusTasks > 0) {
                  row.bonusTasks -= 1;
                  affected = 1;
                }
              } else if (field === 'tasksUsed') {
                if (row.tasksUsed < PRO_LIMITS.tasksLimit) {
                  row.tasksUsed += 1;
                  affected = 1;
                }
              } else if (field === 'bonusOpus') {
                if (row.bonusOpus > 0) {
                  row.bonusOpus -= 1;
                  affected = 1;
                }
              } else if (field === 'opusUsed') {
                if (row.opusUsed < PRO_LIMITS.opusLimit) {
                  row.opusUsed += 1;
                  affected = 1;
                }
              }
              return Promise.resolve([{ affectedRows: affected }, null]);
            },
          };
        },
      };
    },
  };
  const svc = new QuotaService(
    fakeDb as unknown as ConstructorParameters<typeof QuotaService>[0],
  );
  return { svc, row };
}

describe('tryConsume — drizzle array-envelope affectedRows (regression)', () => {
  it('regular: 149/150 under limit → ok AND counter increments to 150', async () => {
    const { svc, row } = makeQuotaDb({ tasksUsed: 149 });
    const res = await svc.tryConsume(1, 'pro', false);
    expect(res).toEqual({ ok: true }); // HIT path — pre-fix this wrongly returned monthly_limit
    expect(row.tasksUsed).toBe(150);
  });

  it('regular: 150/150 at limit → monthly_limit, counter unchanged', async () => {
    const { svc, row } = makeQuotaDb({ tasksUsed: 150 });
    const res = await svc.tryConsume(1, 'pro', false);
    expect(res).toEqual({ ok: false, reason: 'monthly_limit' });
    expect(row.tasksUsed).toBe(150);
  });

  it('regular: bonusTasks burned before the regular pool', async () => {
    const { svc, row } = makeQuotaDb({ tasksUsed: 149, bonusTasks: 2 });
    const res = await svc.tryConsume(1, 'pro', false);
    expect(res).toEqual({ ok: true });
    expect(row.bonusTasks).toBe(1); // bonus burned first
    expect(row.tasksUsed).toBe(149); // regular untouched
  });

  it('opus: 10/15 under sub-limit → ok AND opusUsed increments to 11', async () => {
    const { svc, row } = makeQuotaDb({ opusUsed: 10 });
    const res = await svc.tryConsume(1, 'pro', true);
    expect(res).toEqual({ ok: true });
    expect(row.opusUsed).toBe(11);
  });

  it('opus: 15/15 at sub-limit → opus_limit', async () => {
    const { svc } = makeQuotaDb({ opusUsed: 15 });
    const res = await svc.tryConsume(1, 'pro', true);
    expect(res).toEqual({ ok: false, reason: 'opus_limit' });
  });

  it('opus: bonusOpus burned before the regular opus pool', async () => {
    const { svc, row } = makeQuotaDb({ opusUsed: 10, bonusOpus: 1 });
    const res = await svc.tryConsume(1, 'pro', true);
    expect(res).toEqual({ ok: true });
    expect(row.bonusOpus).toBe(0); // opus bonus burned first
    expect(row.opusUsed).toBe(10); // regular opus untouched
  });
});
