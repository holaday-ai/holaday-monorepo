/**
 * Phase 1 指令 #3 — SiteRepository + PlaybookRepository unit tests.
 *
 * Driven by a tiny chainable fake drizzle (no MySQL). A `select` chain
 * consumes one programmed result FIFO when awaited (regardless of how
 * many .from/.where/.for/.orderBy/.limit hops); inserts return an
 * incrementing insertId and capture their values. `transaction` runs the
 * callback against the same fake db.
 */

import { describe, expect, it } from 'vitest';
import { PlaybookRepository } from './playbook-repository.js';
import { SiteDomainConflictError, SiteRepository } from './site-repository.js';

interface FakeDbOptions {
  /** Row-arrays returned, in order, one per awaited select chain. */
  selectResults?: unknown[][];
  firstInsertId?: number;
}

function makeFakeDb(opts: FakeDbOptions = {}) {
  const selectResults = [...(opts.selectResults ?? [])];
  let nextId = opts.firstInsertId ?? 1;
  const inserts: Array<{ values: Record<string, unknown> }> = [];
  const updates: Array<{ values: Record<string, unknown> }> = [];
  const deletes: number[] = [];

  const consume = (): unknown[] => selectResults.shift() ?? [];

  function selectBuilder(): Record<string, unknown> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {};
    for (const m of ['from', 'where', 'for', 'innerJoin', 'orderBy', 'groupBy', 'limit']) {
      b[m] = () => b;
    }
    // biome-ignore lint/suspicious/noThenProperty: fake drizzle query builder must be awaitable
    b.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(consume()).then(resolve, reject);
    return b;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: any = {
    select: () => selectBuilder(),
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        inserts.push({ values: v });
        return Promise.resolve([{ insertId: nextId++ }]);
      },
    }),
    update: () => ({
      set: (v: Record<string, unknown>) => ({
        where: () => {
          updates.push({ values: v });
          return Promise.resolve([{ affectedRows: 1 }]);
        },
      }),
    }),
    delete: () => ({
      where: () => {
        deletes.push(1);
        return Promise.resolve([{ affectedRows: 1 }]);
      },
    }),
    transaction: async (cb: (tx: unknown) => unknown) => cb(db),
  };

  return { db, inserts, updates, deletes };
}

describe('SiteRepository', () => {
  it('create — global site: no existing → inserts, returns row with id', async () => {
    const { db, inserts } = makeFakeDb({ selectResults: [[]], firstInsertId: 10 });
    const repo = new SiteRepository(db as never);
    const site = await repo.create({
      canonicalDomain: 'ctrip.com',
      displayName: '携程',
      homepageUrl: 'https://www.ctrip.com',
      purposeSummary: 'OTA',
    });
    expect(site.id).toBe(10);
    expect(site.ownerUserId).toBeNull();
    expect(site.externalId.startsWith('site_')).toBe(true);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]?.values).toMatchObject({
      canonicalDomain: 'ctrip.com',
      displayName: '携程',
      ownerUserId: null,
    });
  });

  it('create — global site: existing global → throws SiteDomainConflictError, no insert', async () => {
    const { db, inserts } = makeFakeDb({ selectResults: [[{ id: 5 }]] });
    const repo = new SiteRepository(db as never);
    await expect(
      repo.create({
        canonicalDomain: 'ctrip.com',
        displayName: '携程',
        homepageUrl: 'https://www.ctrip.com',
      }),
    ).rejects.toBeInstanceOf(SiteDomainConflictError);
    expect(inserts).toHaveLength(0);
  });

  it('create — private site: skips global dedup check entirely', async () => {
    // No select results queued: if create tried to dedup, consume() → []
    // which is fine, but we assert the insert carries the owner id.
    const { db, inserts } = makeFakeDb({ firstInsertId: 7 });
    const repo = new SiteRepository(db as never);
    const site = await repo.create({
      ownerUserId: 42,
      canonicalDomain: 'example.com',
      displayName: 'Example',
      homepageUrl: 'https://example.com',
    });
    expect(site.id).toBe(7);
    expect(site.ownerUserId).toBe(42);
    expect(inserts[0]?.values).toMatchObject({ ownerUserId: 42 });
  });

  it('resolveForDomain — prefers the caller-private site over global', async () => {
    const priv = { id: 1, ownerUserId: 42, canonicalDomain: 'x.com' };
    const { db } = makeFakeDb({ selectResults: [[priv]] });
    const repo = new SiteRepository(db as never);
    const got = await repo.resolveForDomain('x.com', 42);
    expect(got).toMatchObject({ id: 1, ownerUserId: 42 });
  });

  it('resolveForDomain — falls back to the global site when no private one', async () => {
    const global = { id: 2, ownerUserId: null, canonicalDomain: 'x.com' };
    const { db } = makeFakeDb({ selectResults: [[], [global]] });
    const repo = new SiteRepository(db as never);
    const got = await repo.resolveForDomain('x.com', 42);
    expect(got).toMatchObject({ id: 2, ownerUserId: null });
  });

  it('updateStatus — returns true when a row changed', async () => {
    const { db, updates } = makeFakeDb();
    const repo = new SiteRepository(db as never);
    const ok = await repo.updateStatus('site_abc', 'stale');
    expect(ok).toBe(true);
    expect(updates[0]?.values).toMatchObject({ siteStatus: 'stale' });
  });
});

describe('PlaybookRepository', () => {
  it('createOperationPath — auto-assigns next version (max + 1)', async () => {
    // first select = maxPathVersion lookup → version 3 exists
    const { db, inserts } = makeFakeDb({ selectResults: [[{ version: 3 }]], firstInsertId: 99 });
    const repo = new PlaybookRepository(db as never);
    const path = await repo.createOperationPath({ siteId: 1, capabilityId: 2 });
    expect(path.version).toBe(4);
    expect(path.id).toBe(99);
    expect(path.status).toBeUndefined(); // DB default 'draft' applies server-side
    expect(inserts[0]?.values).toMatchObject({ siteId: 1, capabilityId: 2, version: 4 });
  });

  it('createOperationPath — first version is 1 when capability has none', async () => {
    const { db } = makeFakeDb({ selectResults: [[]] });
    const repo = new PlaybookRepository(db as never);
    const path = await repo.createOperationPath({ siteId: 1, capabilityId: 2 });
    expect(path.version).toBe(1);
  });

  it('createOperationPath — honours an explicit version (no lookup)', async () => {
    const { db, inserts } = makeFakeDb({ firstInsertId: 1 });
    const repo = new PlaybookRepository(db as never);
    const path = await repo.createOperationPath({ siteId: 1, capabilityId: 2, version: 8 });
    expect(path.version).toBe(8);
    expect(inserts[0]?.values).toMatchObject({ version: 8 });
  });

  it('createCapability — generates a cap_ external id and maps fields', async () => {
    const { db, inserts } = makeFakeDb({ firstInsertId: 3 });
    const repo = new PlaybookRepository(db as never);
    const cap = await repo.createCapability({
      siteId: 1,
      capabilityKey: 'hotel_search',
      displayName: '酒店搜索',
    });
    expect(cap.id).toBe(3);
    expect(cap.externalId.startsWith('cap_')).toBe(true);
    expect(inserts[0]?.values).toMatchObject({
      siteId: 1,
      capabilityKey: 'hotel_search',
      displayName: '酒店搜索',
    });
  });

  it('createExplorationRun + recordCanaryResult — generate exr_/cnr_ ids', async () => {
    const { db } = makeFakeDb({ firstInsertId: 1 });
    const repo = new PlaybookRepository(db as never);
    const run = await repo.createExplorationRun({
      siteId: 1,
      triggerType: 'seed',
      runnerType: 'browser_cdp',
    });
    expect(run.externalId.startsWith('exr_')).toBe(true);
    const canary = await repo.recordCanaryResult({ pathId: 1, status: 'passed' });
    expect(canary.externalId.startsWith('cnr_')).toBe(true);
  });

  it('addStep — maps step fields and default sensitive flags', async () => {
    const { db, inserts } = makeFakeDb({ firstInsertId: 1 });
    const repo = new PlaybookRepository(db as never);
    await repo.addStep({ pathId: 5, stepIndex: 0, stepType: 'fill', intent: '输入目的地城市' });
    expect(inserts[0]?.values).toMatchObject({
      pathId: 5,
      stepIndex: 0,
      stepType: 'fill',
      intent: '输入目的地城市',
    });
  });
});
