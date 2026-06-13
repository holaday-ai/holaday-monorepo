/**
 * Phase 1 指令 #3 — EvidenceArtifactRepository + ClaimRepository unit
 * tests. Same tiny chainable fake drizzle as the playbook repo tests.
 */

import { describe, expect, it } from 'vitest';
import { ClaimRepository } from './claim-repository.js';
import { EvidenceArtifactRepository } from './evidence-artifact-repository.js';
import { taskEvidenceKey } from './r2-keys.js';

interface FakeDbOptions {
  selectResults?: unknown[][];
  firstInsertId?: number;
}

function makeFakeDb(opts: FakeDbOptions = {}) {
  const selectResults = [...(opts.selectResults ?? [])];
  let nextId = opts.firstInsertId ?? 1;
  const inserts: Array<{ values: Record<string, unknown> }> = [];
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
    delete: () => ({
      where: () => {
        deletes.push(1);
        return Promise.resolve([{ affectedRows: 1 }]);
      },
    }),
  };

  return { db, inserts, deletes };
}

describe('EvidenceArtifactRepository', () => {
  it('create — maps required fields, R2 pointer, and generates an art_ id', async () => {
    const { db, inserts } = makeFakeDb({ firstInsertId: 50 });
    const repo = new EvidenceArtifactRepository(db as never);
    const r2Key = taskEvidenceKey({
      taskExternalId: 'tsk_1',
      artifactExternalId: 'art_x',
      filename: 'final.png',
    });
    const captured = new Date('2026-06-11T10:21:00.000Z');
    const art = await repo.create({
      taskId: 1,
      artifactKind: 'final_screenshot',
      purpose: 'task_evidence',
      r2Bucket: 'holaday-files-prod',
      r2Key,
      contentType: 'image/png',
      sizeBytes: 16384,
      sha256: 'a'.repeat(64),
      capturedAt: captured,
      collectorLane: 'browser_cdp',
      sourceUrl: 'https://notion.com/pricing',
    });
    expect(art.id).toBe(50);
    expect(art.externalId.startsWith('art_')).toBe(true);
    expect(inserts[0]?.values).toMatchObject({
      taskId: 1,
      artifactKind: 'final_screenshot',
      purpose: 'task_evidence',
      r2Bucket: 'holaday-files-prod',
      r2Key: 'tasks/tsk_1/evidence/art_x/final.png',
      sizeBytes: 16384,
      collectorLane: 'browser_cdp',
    });
  });

  it('getGroundedUrlsForTask — dedupes source + final urls', async () => {
    const rows = [
      { sourceUrl: 'https://a.com', finalUrl: 'https://a.com/final' },
      { sourceUrl: 'https://a.com', finalUrl: null },
      { sourceUrl: null, finalUrl: 'https://b.com' },
    ];
    const { db } = makeFakeDb({ selectResults: [rows] });
    const repo = new EvidenceArtifactRepository(db as never);
    const urls = await repo.getGroundedUrlsForTask(1);
    expect(urls.sort()).toEqual(['https://a.com', 'https://a.com/final', 'https://b.com'].sort());
  });

  it('listByTask — returns the programmed rows', async () => {
    const rows = [{ id: 1, taskId: 9, purpose: 'task_evidence' }];
    const { db } = makeFakeDb({ selectResults: [rows] });
    const repo = new EvidenceArtifactRepository(db as never);
    const got = await repo.listByTask(9, 'task_evidence');
    expect(got).toHaveLength(1);
  });

  it('listExpired — returns expired rows for the reaper', async () => {
    const rows = [{ id: 1, retentionPolicy: 'task_30d' }];
    const { db } = makeFakeDb({ selectResults: [rows] });
    const repo = new EvidenceArtifactRepository(db as never);
    const got = await repo.listExpired(new Date('2026-06-11T00:00:00.000Z'));
    expect(got).toHaveLength(1);
  });

  it('deleteByExternalId — returns true when a row was removed', async () => {
    const { db, deletes } = makeFakeDb();
    const repo = new EvidenceArtifactRepository(db as never);
    const ok = await repo.deleteByExternalId('art_gone');
    expect(ok).toBe(true);
    expect(deletes).toHaveLength(1);
  });
});

describe('ClaimRepository', () => {
  it('createClaim — generates a clm_ id and maps the structured value', async () => {
    const { db, inserts } = makeFakeDb({ firstInsertId: 7 });
    const repo = new ClaimRepository(db as never);
    const claim = await repo.createClaim({
      taskId: 1,
      claimType: 'price',
      subject: '杭州马可波罗假日酒店',
      predicate: 'has_price',
      objectJson: { price: 321, currency: 'CNY', unit: 'night' },
      confidence: '0.9200',
    });
    expect(claim.id).toBe(7);
    expect(claim.externalId.startsWith('clm_')).toBe(true);
    expect(inserts[0]?.values).toMatchObject({
      claimType: 'price',
      subject: '杭州马可波罗假日酒店',
      predicate: 'has_price',
    });
  });

  it('linkEvidence — maps claim/artifact ids and support type', async () => {
    const { db, inserts } = makeFakeDb({ firstInsertId: 1 });
    const repo = new ClaimRepository(db as never);
    await repo.linkEvidence({ claimId: 7, artifactId: 50, supportType: 'supports' });
    expect(inserts[0]?.values).toMatchObject({
      claimId: 7,
      artifactId: 50,
      supportType: 'supports',
    });
  });

  it('getEvidenceForClaim — returns joined {link, artifact} rows', async () => {
    const joined = [{ link: { id: 1, claimId: 7 }, artifact: { id: 50, externalId: 'art_x' } }];
    const { db } = makeFakeDb({ selectResults: [joined] });
    const repo = new ClaimRepository(db as never);
    const got = await repo.getEvidenceForClaim(7);
    expect(got).toHaveLength(1);
    expect(got[0]?.artifact.externalId).toBe('art_x');
  });
});
