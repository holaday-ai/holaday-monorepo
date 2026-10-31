import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { newExternalId } from '@holaday/shared-types';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db, pool } from '../../db/client.js';
import { quotaRefunds } from '../../db/schema/quota-refunds.js';
import { tasks } from '../../db/schema/tasks.js';
import { users } from '../../db/schema/users.js';
import {
  refundTaskOnce,
  sweepPlatformFailureRefunds,
} from '../../quota/platform-failure-refunds.js';
import { QuotaService } from '../../quota/quota-service.js';
import { applyMigrations } from '../../test/db-helper.js';
import { TaskRepository } from '../task-repository.js';

describe('video confirmation billing and rejected retry budget (real MySQL)', () => {
  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error('Dedicated test database required');
    await applyMigrations(databaseUrl);
  });
  afterAll(async () => {
    await pool.end();
  });
  async function actor() {
    const externalId = newExternalId('user');
    await db
      .insert(users)
      .values({ externalId, email: `${externalId}@example.test`, passwordHash: '', plan: 'pro' });
    const [row] = await db.select().from(users).where(eq(users.externalId, externalId));
    if (!row) throw new Error('Fixture user was not created');
    return row;
  }
  async function confirm(
    userId: number,
    isBypass = false,
    rejectRetryLimit = 3,
    intent = 'same video',
  ) {
    const quote = newExternalId('task');
    const generated = newExternalId('task');
    await db.insert(tasks).values({
      externalId: quote,
      userId,
      intent,
      status: 'awaiting_user',
      awaitingKind: 'video_quote',
      result: { metadata: { lane: 'video_creation_confirm' } },
    });
    const result = await new TaskRepository(db).consumeVideoConfirmAndInsertGeneration({
      quoteTaskExternalId: quote,
      generationTaskExternalId: generated,
      userId,
      planId: 'pro',
      isBypass,
      intent,
      executionMetadata: {
        lane: 'video_creation',
        visualMode: 'video',
        videoOptions: { model: 'veo_fast' },
      },
      rejectRetryLimit,
    });
    return { result, quote, generated };
  }
  async function reject(taskId: string) {
    await new TaskRepository(db).persistVisionOutcome(taskId, {
      status: 'failed',
      reason: 'quality rejected',
      errorCode: 'MEDIA_VIDEO_QUALITY_REJECTED',
      tickCount: 1,
      verificationPassed: false,
    });
  }
  it('normalizes internal/full-width spaces and case before enforcing the same request budget', async () => {
    const user = await actor();
    const initial = await confirm(user.id, true, 1, '猫举爪 ABC');
    await reject(initial.generated);
    expect((await confirm(user.id, true, 1, '  猫　举 爪　ａｂｃ  ')).result.kind).toBe(
      'reject_retry_limit',
    );
  });
  it('strips zero-width and other invisible format characters before enforcing the budget', async () => {
    const user = await actor();
    const initial = await confirm(user.id, true, 1, '猫举爪 ABC');
    await reject(initial.generated);
    for (const variant of [
      '猫\u200b举爪 ABC',
      '\ufeff猫举\u2060爪 A\u200dBC',
      '猫\u00ad举爪\u200f ABC',
    ])
      expect((await confirm(user.id, true, 1, variant)).result.kind).toBe('reject_retry_limit');
  });
  it('reserves the last attempt under the owner lock for two concurrent confirmations', async () => {
    const user = await actor();
    for (let i = 0; i < 2; i++) {
      const prior = await confirm(user.id, false, 3);
      await reject(prior.generated);
      await refundTaskOnce(
        db,
        new QuotaService(db),
        prior.generated,
        'MEDIA_VIDEO_QUALITY_REJECTED',
      );
    }
    const quota = new QuotaService(db);
    const before = await quota.snapshot(user.id, 'pro');
    const runs = await Promise.all([confirm(user.id), confirm(user.id)]);
    expect(runs.map((run) => run.result.kind).sort()).toEqual(['created', 'reject_retry_limit']);
    expect((await quota.snapshot(user.id, 'pro')).tasksRemaining).toBe(before.tasksRemaining - 1);
    const denied = runs.find((run) => run.result.kind === 'reject_retry_limit');
    if (!denied) throw new Error('Expected one denied confirmation');
    expect(
      await db.select().from(tasks).where(eq(tasks.externalId, denied.generated)),
    ).toHaveLength(0);
    const [quote] = await db.select().from(tasks).where(eq(tasks.externalId, denied.quote));
    expect(quote?.status).toBe('awaiting_user');
  });
  it('reads a legacy fingerprint with normalized intent without rewriting the old record', async () => {
    const user = await actor();
    const legacyIntent = '猫举爪 ABC';
    const retryKey = createHash('sha256')
      .update(
        JSON.stringify([
          legacyIntent,
          {
            videoOptions: { model: 'veo_fast' },
            visualMode: 'video',
          },
        ]),
      )
      .digest('hex');
    const old = newExternalId('task');
    const result = { metadata: { videoRetryKey: retryKey } };
    await db.insert(tasks).values({
      externalId: old,
      userId: user.id,
      intent: legacyIntent,
      status: 'failed',
      errorCode: 'MEDIA_VIDEO_QUALITY_REJECTED',
      result,
    });
    expect((await confirm(user.id, true, 1, ' 猫 举 爪　ａｂｃ ')).result.kind).toBe(
      'reject_retry_limit',
    );
    const [unchanged] = await db.select().from(tasks).where(eq(tasks.externalId, old));
    expect(unchanged?.result).toEqual(result);
  });
  it('confirmation writes the real charge, quality rejection refunds quota once, duplicate rejection/sweep do not credit twice', async () => {
    const user = await actor();
    const quota = new QuotaService(db);
    const before = await quota.snapshot(user.id, 'pro');
    const run = await confirm(user.id);
    expect(run.result.kind).toBe('created');
    const [charge] = await db
      .select()
      .from(quotaRefunds)
      .where(eq(quotaRefunds.taskExternalId, run.generated));
    expect(charge).toMatchObject({ userId: user.id, plan: 'pro', isOpus: false, refundedAt: null });
    expect((await quota.snapshot(user.id, 'pro')).tasksRemaining).toBe(before.tasksRemaining - 1);
    await reject(run.generated);
    expect(await refundTaskOnce(db, quota, run.generated, 'MEDIA_VIDEO_QUALITY_REJECTED')).toBe(
      true,
    );
    await reject(run.generated);
    expect(await refundTaskOnce(db, quota, run.generated, 'MEDIA_VIDEO_QUALITY_REJECTED')).toBe(
      false,
    );
    expect(await sweepPlatformFailureRefunds(db, quota)).toBe(0);
    expect((await quota.snapshot(user.id, 'pro')).tasksRemaining).toBe(before.tasksRemaining);
    const [refunded] = await db
      .select()
      .from(quotaRefunds)
      .where(eq(quotaRefunds.taskExternalId, run.generated));
    expect(refunded?.refundedAt).toBeInstanceOf(Date);
  });
  it('a ledger insert failure rolls back quota, quote claim and generated task', async () => {
    const user = await actor();
    const quota = new QuotaService(db);
    const before = await quota.snapshot(user.id, 'pro');
    await pool.query(
      "CREATE TRIGGER pr246_charge_fail BEFORE INSERT ON quota_refunds FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='fixture ledger failure'",
    );
    try {
      await expect(confirm(user.id)).rejects.toThrow('fixture ledger failure');
    } finally {
      await pool.query('DROP TRIGGER pr246_charge_fail');
    }
    expect((await quota.snapshot(user.id, 'pro')).tasksRemaining).toBe(before.tasksRemaining);
    const rows = await db.select().from(tasks).where(eq(tasks.userId, user.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('awaiting_user');
  });
  it('bypass confirmation has no refundable charge', async () => {
    const user = await actor();
    const run = await confirm(user.id, true);
    expect(run.result.kind).toBe('created');
    expect(
      await db.select().from(quotaRefunds).where(eq(quotaRefunds.taskExternalId, run.generated)),
    ).toHaveLength(0);
  });
  it('the default rejection budget stops the next confirmation before debit and a new request remains available', async () => {
    const user = await actor();
    const quota = new QuotaService(db);
    for (let i = 0; i < 3; i++) {
      const run = await confirm(user.id);
      expect(run.result).toMatchObject({ kind: 'created', priorQualityRejects: i });
      await reject(run.generated);
    }
    const before = await quota.snapshot(user.id, 'pro');
    const run = await confirm(user.id);
    expect(run.result.kind).toBe('reject_retry_limit');
    expect((await quota.snapshot(user.id, 'pro')).tasksRemaining).toBe(before.tasksRemaining);
    expect(await db.select().from(tasks).where(eq(tasks.externalId, run.generated))).toHaveLength(
      0,
    );
    const [quote] = await db.select().from(tasks).where(eq(tasks.externalId, run.quote));
    expect(quote?.status).toBe('awaiting_user');
    expect((await confirm(user.id, false, 3, 'different request')).result.kind).toBe('created');
  });
  it('a configured rejection budget applies to bypass users too', async () => {
    const user = await actor();
    const run = await confirm(user.id, true, 1);
    await reject(run.generated);
    expect((await confirm(user.id, true, 1)).result.kind).toBe('reject_retry_limit');
  });
  it('successful delivery resets consecutive failures, and another owner has an independent budget', async () => {
    const user = await actor();
    const rejected = await confirm(user.id, false, 2);
    await reject(rejected.generated);
    const delivered = await confirm(user.id, false, 2);
    await new TaskRepository(db).persistVisionOutcome(delivered.generated, {
      status: 'completed',
      summary: 'delivered',
      tickCount: 1,
    });
    const later = await confirm(user.id, false, 2);
    await reject(later.generated);
    expect((await confirm(user.id, false, 2)).result.kind).toBe('created');
    const other = await actor();
    expect((await confirm(other.id, false, 1)).result.kind).toBe('created');
  });
  it('migration 0066 is repeatable and preserves an operator setting', async () => {
    const migration = await readFile(
      new URL('../../../drizzle/0066_model_price_catalog.sql', import.meta.url),
      'utf8',
    );
    const [originalRows] = await pool.query(
      "SELECT value FROM model_catalog_settings WHERE id='model_pricing'",
    );
    const original = (originalRows as Array<{ value: unknown }>)[0]?.value;
    try {
      await pool.query(migration);
      await pool.query(migration);
      await pool.query(
        "UPDATE model_catalog_settings SET value=JSON_OBJECT('fixture','operator') WHERE id='model_pricing'",
      );
      await pool.query(migration);
      const [rows] = await pool.query(
        "SELECT JSON_UNQUOTE(JSON_EXTRACT(value,'$.fixture')) AS marker FROM model_catalog_settings WHERE id='model_pricing'",
      );
      expect((rows as Array<{ marker: string }>)[0]?.marker).toBe('operator');
    } finally {
      await pool.query("UPDATE model_catalog_settings SET value=? WHERE id='model_pricing'", [
        typeof original === 'string' ? original : JSON.stringify(original),
      ]);
    }
  });
});
