/**
 * Phase 1 #3 Pack B — Evidence Ledger write path + delete routing +
 * retention reaper + LedgerRepository read API. Driven by a table-aware
 * chainable fake drizzle (no MySQL) + a fake StorageProvider.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  EvidenceLedger,
  _resetLedgerRegistryForTest,
  getOrCreateLedger,
} from '../execution/evidence-ledger.js';
import { reloadFeatureFlagsForTest, setFeatureFlagsForTest } from '../execution/feature-flags.js';
import type { StorageProvider } from '../files/storage-provider.js';
import { routeTaskEvidenceOnDelete } from './evidence-deletion-service.js';
import { LedgerRepository } from './ledger-repository.js';
import {
  DEFAULT_LEDGER_RETENTION_DAYS,
  ledgerRetentionDays,
  writeLedgerToDb,
  writeLedgerToDbUnchecked,
} from './ledger-write-service.js';
import { runRetentionReaper } from './retention-reaper.js';

const DRIZZLE_NAME = Symbol.for('drizzle:Name');

interface FakeDbOptions {
  selectResults?: unknown[][];
  firstInsertId?: number;
}

function makeFakeDb(opts: FakeDbOptions = {}) {
  const sel = [...(opts.selectResults ?? [])];
  let nextId = opts.firstInsertId ?? 1;
  const inserts: Array<{ table: string; values: Record<string, unknown> }> = [];
  const updates: Array<{ table: string; values: Record<string, unknown> }> = [];
  const deletes: Array<{ table: string }> = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tname = (t: any): string => t?.[DRIZZLE_NAME] ?? '';
  const consume = (): unknown[] => sel.shift() ?? [];

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    insert: (t: any) => ({
      values: (v: Record<string, unknown>) => {
        inserts.push({ table: tname(t), values: v });
        return Promise.resolve([{ insertId: nextId++ }]);
      },
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    update: (t: any) => ({
      set: (v: Record<string, unknown>) => ({
        where: () => {
          updates.push({ table: tname(t), values: v });
          return Promise.resolve([{ affectedRows: 1 }]);
        },
      }),
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete: (t: any) => ({
      where: () => {
        deletes.push({ table: tname(t) });
        return Promise.resolve([{ affectedRows: 1 }]);
      },
    }),
  };
  const count = (arr: Array<{ table: string }>, table: string) =>
    arr.filter((x) => x.table === table).length;
  return { db, inserts, updates, deletes, count };
}

function makeFakeStorage(opts: { failOn?: string } = {}) {
  const puts: Array<Record<string, unknown>> = [];
  const deletes: string[] = [];
  const storage: StorageProvider = {
    async put(input) {
      puts.push(input as unknown as Record<string, unknown>);
      return { storagePath: `bucket/${input.fileExternalId}/${input.filename}` };
    },
    async get() {
      return null;
    },
    async delete(path) {
      if (opts.failOn && path === opts.failOn) throw new Error('R2 boom');
      deletes.push(path);
    },
    async getSignedUrl() {
      return null;
    },
    async getSignedPutUrl() {
      return null;
    },
    async stat() {
      return null;
    },
  };
  return { storage, puts, deletes };
}

beforeEach(() => {
  _resetLedgerRegistryForTest();
  reloadFeatureFlagsForTest();
});
afterEach(() => {
  _resetLedgerRegistryForTest();
  reloadFeatureFlagsForTest();
});

describe('ledger-write-service', () => {
  function seededLedger(taskId: string): EvidenceLedger {
    const l = new EvidenceLedger(taskId);
    l.add({
      fact: '用户想查酒店',
      sourceType: 'user_input',
      sourceDetail: 'intent',
      confidence: 'observed',
    });
    l.add({
      fact: 'navigated to https://ctrip.com/hotels result count 12',
      sourceType: 'browser_state',
      sourceDetail: 'nav',
      confidence: 'observed',
    });
    return l;
  }

  it('writeLedgerToDbUnchecked — writes 1 artifact + answer claim + 1 source claim + 2 links', async () => {
    const ledger = seededLedger('tsk_1');
    const { db, inserts, count } = makeFakeDb({
      selectResults: [[{ id: 5, userId: 9, intent: '查携程酒店' }]],
      firstInsertId: 100,
    });
    const { storage, puts } = makeFakeStorage();
    const res = await writeLedgerToDbUnchecked(
      {
        taskExternalId: 'tsk_1',
        verification: { passed: true },
        db: db as never,
        storage,
        now: new Date('2026-06-12T00:00:00.000Z'),
      },
      ledger,
    );
    expect(res).not.toBeNull();
    expect(res?.artifactExternalId.startsWith('art_')).toBe(true);
    expect(res?.answerClaimExternalId.startsWith('clm_')).toBe(true);
    expect(res?.sourceClaimCount).toBe(1); // one grounded URL
    // one bundle uploaded to storage
    expect(puts).toHaveLength(1);
    expect(puts[0]?.filename).toBe('evidence-ledger.json');
    // DB writes
    expect(count(inserts, 'evidence_artifacts')).toBe(1);
    expect(count(inserts, 'claims')).toBe(2); // answer + 1 source
    expect(count(inserts, 'claim_evidence_links')).toBe(2);
    // artifact carries task_evidence retention + the right task/owner
    const art = inserts.find((i) => i.table === 'evidence_artifacts')?.values;
    expect(art).toMatchObject({
      taskId: 5,
      ownerUserId: 9,
      purpose: 'task_evidence',
      retentionPolicy: 'task_30d',
      artifactKind: 'raw_response',
    });
    expect(art?.expiresAt).toBeInstanceOf(Date);
    // answer claim carries the verifier verdict
    const answer = inserts.find((i) => i.table === 'claims')?.values;
    expect(answer).toMatchObject({ claimType: 'answer', verificationStatus: 'supported' });
  });

  it('writeLedgerToDbUnchecked — returns null when task row not found', async () => {
    const ledger = seededLedger('tsk_missing');
    const { db, inserts } = makeFakeDb({ selectResults: [[]] });
    const { storage } = makeFakeStorage();
    const res = await writeLedgerToDbUnchecked(
      { taskExternalId: 'tsk_missing', verification: null, db: db as never, storage },
      ledger,
    );
    expect(res).toBeNull();
    expect(inserts).toHaveLength(0);
  });

  it('writeLedgerToDb — flag OFF is a no-op (no DB touch)', async () => {
    setFeatureFlagsForTest({ LEDGER_DB_WRITE: false });
    getOrCreateLedger('tsk_2').add({
      fact: 'x',
      sourceType: 'user_input',
      sourceDetail: 'd',
      confidence: 'observed',
    });
    const { db, inserts } = makeFakeDb({ selectResults: [[{ id: 1, userId: 1, intent: 'x' }]] });
    const { storage, puts } = makeFakeStorage();
    const res = await writeLedgerToDb({
      taskExternalId: 'tsk_2',
      verification: { passed: true },
      db: db as never,
      storage,
    });
    expect(res).toBeNull();
    expect(inserts).toHaveLength(0);
    expect(puts).toHaveLength(0);
  });

  it('writeLedgerToDb — flag ON + seeded ledger writes through', async () => {
    setFeatureFlagsForTest({ LEDGER_DB_WRITE: true });
    const l = getOrCreateLedger('tsk_3');
    l.add({
      fact: 'pulled https://a.com',
      sourceType: 'tool_result',
      sourceDetail: 'd',
      confidence: 'observed',
    });
    const { db, count, inserts } = makeFakeDb({
      selectResults: [[{ id: 7, userId: 2, intent: 'go' }]],
      firstInsertId: 1,
    });
    const { storage } = makeFakeStorage();
    const res = await writeLedgerToDb({
      taskExternalId: 'tsk_3',
      verification: { passed: false, failureLevel: 'fixable' },
      db: db as never,
      storage,
    });
    expect(res).not.toBeNull();
    expect(count(inserts, 'evidence_artifacts')).toBe(1);
    const answer = inserts.find((i) => i.table === 'claims')?.values;
    expect(answer).toMatchObject({ claimType: 'answer', verificationStatus: 'unsupported' });
  });
});

describe('evidence-deletion-service (§4.9 routing)', () => {
  it('task_evidence → delete row + R2; audit/manual_hold → scrub + retain', async () => {
    const rows = [
      {
        id: 1,
        r2Key: 'k1',
        purpose: 'task_evidence',
        retentionPolicy: 'task_30d',
        metadataJson: null,
      },
      {
        id: 2,
        r2Key: 'k2',
        purpose: 'task_evidence',
        retentionPolicy: 'manual_hold',
        metadataJson: null,
      },
      {
        id: 3,
        r2Key: 'k3',
        purpose: 'audit',
        retentionPolicy: 'audit_180d',
        metadataJson: { a: 1 },
      },
    ];
    const { db, updates, deletes, count } = makeFakeDb({ selectResults: [rows] });
    const { storage, deletes: r2deletes } = makeFakeStorage();
    const res = await routeTaskEvidenceOnDelete(db as never, 5, { storage });
    expect(res).toEqual({ deleted: 1, scrubbed: 2, r2Deleted: 1 });
    // only the task_evidence row's R2 object deleted
    expect(r2deletes).toEqual(['k1']);
    // one hard delete, two scrub-updates
    expect(count(deletes, 'evidence_artifacts')).toBe(1);
    expect(count(updates, 'evidence_artifacts')).toBe(2);
    // scrub nulls owner + task linkage and marks scrubbed
    const scrub = updates[0]?.values;
    expect(scrub).toMatchObject({ ownerUserId: null, taskId: null });
    expect((scrub?.metadataJson as Record<string, unknown>)?.scrubbed).toBe(true);
  });

  it('no artifacts → no-op, never resolves storage', async () => {
    const { db } = makeFakeDb({ selectResults: [[]] });
    const res = await routeTaskEvidenceOnDelete(db as never, 99, {});
    expect(res).toEqual({ deleted: 0, scrubbed: 0, r2Deleted: 0 });
  });
});

describe('retention-reaper', () => {
  it('deletes expired: R2 object then MySQL row', async () => {
    const expired = [
      { id: 1, externalId: 'art_1', r2Key: 'k1', metadataJson: null },
      { id: 2, externalId: 'art_2', r2Key: 'k2', metadataJson: null },
    ];
    const { db, deletes, count } = makeFakeDb({ selectResults: [expired] });
    const { storage, deletes: r2deletes } = makeFakeStorage();
    const res = await runRetentionReaper({
      db: db as never,
      storage,
      now: new Date('2026-06-12T00:00:00.000Z'),
    });
    expect(res).toEqual({ scanned: 2, deleted: 2, r2Deleted: 2, r2Failed: 0 });
    expect(r2deletes.sort()).toEqual(['k1', 'k2']);
    expect(count(deletes, 'evidence_artifacts')).toBe(2);
  });

  it('R2 delete failure keeps the row + records cleanup_error (retry next run)', async () => {
    const expired = [
      { id: 1, externalId: 'art_1', r2Key: 'good', metadataJson: null },
      { id: 2, externalId: 'art_2', r2Key: 'bad', metadataJson: { x: 1 } },
    ];
    const { db, deletes, updates, count } = makeFakeDb({ selectResults: [expired] });
    const { storage } = makeFakeStorage({ failOn: 'bad' });
    const res = await runRetentionReaper({ db: db as never, storage });
    expect(res.scanned).toBe(2);
    expect(res.deleted).toBe(1); // only the good one removed
    expect(res.r2Failed).toBe(1);
    expect(count(deletes, 'evidence_artifacts')).toBe(1);
    // the failed one got a cleanup_error recorded, row kept
    expect(count(updates, 'evidence_artifacts')).toBe(1);
    expect((updates[0]?.values.metadataJson as Record<string, unknown>)?.cleanup_error).toContain(
      'boom',
    );
  });

  it('no expired artifacts → no-op', async () => {
    const { db } = makeFakeDb({ selectResults: [[]] });
    const res = await runRetentionReaper({ db: db as never });
    expect(res).toEqual({ scanned: 0, deleted: 0, r2Deleted: 0, r2Failed: 0 });
  });
});

describe('LedgerRepository (read API skeleton)', () => {
  it('getGroundedUrls — union of artifact URLs + source-claim subjects', async () => {
    const repo = new LedgerRepository(
      makeFakeDb({
        selectResults: [
          [{ id: 5 }], // resolveTaskId
          [{ sourceUrl: 'https://a.com', finalUrl: 'https://a.com/x' }], // getGroundedUrlsForTask
          [
            { claimType: 'source', subject: 'https://b.com' },
            { claimType: 'answer', subject: '查酒店' },
          ], // getClaimsForTask
        ],
      }).db as never,
    );
    const urls = await repo.getGroundedUrls('tsk_1');
    expect(urls.sort()).toEqual(['https://a.com', 'https://a.com/x', 'https://b.com'].sort());
  });

  it('getClaimsForTask — returns [] for unknown task', async () => {
    const repo = new LedgerRepository(makeFakeDb({ selectResults: [[]] }).db as never);
    expect(await repo.getClaimsForTask('tsk_missing')).toEqual([]);
  });

  it('getEvidenceForClaim — resolves claim external id then joins', async () => {
    const repo = new LedgerRepository(
      makeFakeDb({
        selectResults: [
          [{ id: 7 }], // resolveClaimId
          [{ link: { id: 1, claimId: 7 }, artifact: { id: 50, externalId: 'art_x' } }], // join
        ],
      }).db as never,
    );
    const ev = await repo.getEvidenceForClaim('clm_abc');
    expect(ev).toHaveLength(1);
    expect(ev[0]?.artifact.externalId).toBe('art_x');
  });
});

describe('ledgerRetentionDays (LEDGER_RETENTION_DAYS env guard)', () => {
  const KEY = 'LEDGER_RETENTION_DAYS';
  const original = process.env[KEY];
  afterEach(() => {
    if (original === undefined) delete process.env[KEY];
    else process.env[KEY] = original;
  });

  it('defaults to 60 when unset', () => {
    delete process.env[KEY];
    expect(DEFAULT_LEDGER_RETENTION_DAYS).toBe(60);
    expect(ledgerRetentionDays()).toBe(60);
  });

  it('honours a valid positive override (90 → 90)', () => {
    process.env[KEY] = '90';
    expect(ledgerRetentionDays()).toBe(90);
  });

  it('falls back to 60 for garbage / non-positive / non-finite values', () => {
    for (const bad of ['', 'abc', '0', '-5', 'NaN', 'Infinity', '-Infinity']) {
      process.env[KEY] = bad;
      expect(ledgerRetentionDays()).toBe(60);
    }
  });
});
