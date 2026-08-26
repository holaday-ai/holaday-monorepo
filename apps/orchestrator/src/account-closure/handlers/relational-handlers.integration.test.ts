import { randomBytes } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiKeys } from '../../db/schema/api-keys.js';
import {
  energyDailyMetrics,
  energyDailyVisitors,
  energyEventReceipts,
} from '../../db/schema/energy-analytics.js';
import { executionMemory } from '../../db/schema/execution-memory.js';
import { executionStats } from '../../db/schema/execution-stats.js';
import { notificationChannels, notifications } from '../../db/schema/notifications.js';
import { pendingCookies } from '../../db/schema/pending-cookies.js';
import { plannedTasks } from '../../db/schema/planned-tasks.js';
import { sessions } from '../../db/schema/sessions.js';
import { stockDashboardSnapshots } from '../../db/schema/stock-dashboard-snapshots.js';
import {
  stockPreferenceProfiles,
  stockPreferenceSignals,
} from '../../db/schema/stock-preferences.js';
import { stockRiskMonitors } from '../../db/schema/stock-risk-monitors.js';
import { taskEvents } from '../../db/schema/task-events.js';
import { taskSteps } from '../../db/schema/task-steps.js';
import { tasks } from '../../db/schema/tasks.js';
import { userMfaRecoveryCodes } from '../../db/schema/user-mfa-recovery-codes.js';
import { userProfiles } from '../../db/schema/user-profiles.js';
import { userSiteStats } from '../../db/schema/user-site-stats.js';
import { users } from '../../db/schema/users.js';
import { verificationCodes } from '../../db/schema/verification-codes.js';
import { watchlists } from '../../db/schema/watchlists.js';
import type { StorageProvider } from '../../files/storage-provider.js';
import type {
  AccountClosureHandler,
  ClosureCheckpoint,
  ClosureHandlerContext,
  ClosureHandlerResult,
} from '../handler-contract.js';
import { getAccountClosureHandler } from '../handler-registry.js';

describe.sequential('account closure relational handlers', () => {
  let cleanup: () => Promise<void> = async () => {};
  let db: typeof import('../../db/client.js').db;
  let target: { id: number; externalId: string; email: string };
  let other: { id: number; externalId: string; email: string };

  const storage = {
    pathFor: () => '',
    put: async () => ({ storagePath: '' }),
    putFile: async () => ({ storagePath: '' }),
    get: async () => null,
    delete: async () => undefined,
    getSignedUrl: async () => null,
    getSignedPutUrl: async () => null,
    stat: async () => null,
  } satisfies StorageProvider;
  const logger = pino({ enabled: false });

  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL ?? '';
    if (!databaseUrl) throw new Error('DATABASE_URL is required for integration tests');
    const { applyMigrations } = await import('../../test/db-helper.js');
    await applyMigrations(databaseUrl);
    const client = await import('../../db/client.js');
    db = client.db;
    cleanup = () => client.pool.end();

    target = await createUser('target');
    other = await createUser('other');
    await seedAccountSecurity(target, 101);
    await seedAccountSecurity(other, 1);
    await seedTaskExecution(target, 101);
    await seedTaskExecution(other, 1);
    await seedCrossTaskMemory(target, 101);
    await seedCrossTaskMemory(other, 1);
    await seedStockProfile(target, 101);
    await seedStockProfile(other, 1);
    await seedNotifications(target, 101);
    await seedNotifications(other, 1);
    await seedSiteStats(target, 205);
    await seedSiteStats(other, 1);
    await seedCookies(target);
    await seedCookies(other);
    await seedAnonymousAnalytics();
  });

  afterAll(async () => {
    await cleanup();
  });

  it('pages deterministically at 100 rows, resumes from a saved numeric checkpoint, and is idempotent', async () => {
    const handler = getAccountClosureHandler('extension_site_stats');
    const first = await handler.run(context(null));
    expect(first).toEqual({
      kind: 'continue',
      checkpoint: { processedCount: 100 },
      processed: 100,
    });
    if (first.kind !== 'continue') throw new Error('expected first page to continue');
    assertNumericCheckpoint(first.checkpoint);
    expect(await ownedCount('user_site_stats', target.id)).toBe(105);

    // A new handler lookup simulates a process restart after the worker saved the page checkpoint.
    const second = await getAccountClosureHandler('extension_site_stats').run(
      context(first.checkpoint),
    );
    expect(second).toEqual({
      kind: 'continue',
      checkpoint: { processedCount: 200 },
      processed: 200,
    });
    if (second.kind !== 'continue') throw new Error('expected second page to continue');
    const third = await handler.run(context(second.checkpoint));
    expect(third).toEqual({ kind: 'complete', processed: 205, retention: 'deleted' });
    expect(await ownedCount('user_site_stats', target.id)).toBe(0);
    expect(await ownedCount('user_site_stats', other.id)).toBe(1);

    await expect(handler.run(context(null))).resolves.toEqual({
      kind: 'complete',
      processed: 0,
      retention: 'not_present',
    });
  });

  it('deletes every existing relational category child-first without touching the other account or users', async () => {
    const categories = [
      'account_security',
      'cross_task_memory',
      'stock_preference_profile',
      'external_notifications',
      'extension_login_cookies',
      'task_execution',
    ] as const;
    for (const categoryId of categories) {
      const result = await runToCompletion(getAccountClosureHandler(categoryId));
      expect(result.retention).toBe('deleted');
      expect(result.processed).toBeGreaterThan(0);
    }

    expect(await ownedCount('sessions', target.id)).toBe(0);
    expect(await ownedCount('sessions', other.id)).toBe(1);
    expect(await ownedCount('execution_memory', target.id)).toBe(0);
    expect(await ownedCount('execution_memory', other.id)).toBe(1);
    expect(await ownedCount('watchlists', target.id)).toBe(0);
    expect(await ownedCount('watchlists', other.id)).toBe(1);
    expect(await ownedCount('notifications', target.id)).toBe(0);
    expect(await ownedCount('notifications', other.id)).toBe(1);
    expect(await ownedCount('pending_cookies', target.id)).toBe(0);
    expect(await ownedCount('pending_cookies', other.id)).toBe(1);
    expect(await ownedCount('tasks', target.id)).toBe(0);
    expect(await ownedCount('tasks', other.id)).toBe(1);
    expect(await userExists(target.id)).toBe(true);
    expect(await userExists(other.id)).toBe(true);

    for (const categoryId of categories) {
      await expect(getAccountClosureHandler(categoryId).run(context(null))).resolves.toEqual({
        kind: 'complete',
        processed: 0,
        retention: 'not_present',
      });
    }
  });

  it('uses explicit capability probes for non-persisted categories and preserves anonymous aggregates', async () => {
    for (const categoryId of [
      'energy_astrology_profile',
      'feedback_support',
      'analytics_logs',
    ] as const) {
      await expect(getAccountClosureHandler(categoryId).run(context(null))).resolves.toEqual({
        kind: 'complete',
        processed: 0,
        retention: 'not_present',
      });
    }

    expect(await tableCount('energy_daily_metrics')).toBe(1);
    expect(await tableCount('energy_daily_visitors')).toBe(1);
    expect(await tableCount('energy_event_receipts')).toBe(1);
  });

  function context(checkpoint: ClosureCheckpoint): ClosureHandlerContext {
    return {
      db,
      logger,
      storage,
      request: {
        id: 501,
        externalId: 'acl_relational_test',
        userId: target.id,
        userExternalId: target.externalId,
      },
      checkpoint,
      pageSize: 100,
    };
  }

  async function runToCompletion(
    handler: AccountClosureHandler,
  ): Promise<Extract<ClosureHandlerResult, { kind: 'complete' }>> {
    let checkpoint: ClosureCheckpoint = null;
    let previousProcessed = 0;
    for (let invocation = 0; invocation < 20; invocation += 1) {
      const result = await handler.run(context(checkpoint));
      expect(result.processed - previousProcessed).toBeGreaterThanOrEqual(0);
      expect(result.processed - previousProcessed).toBeLessThanOrEqual(100);
      if (result.kind === 'complete') return result;
      assertNumericCheckpoint(result.checkpoint);
      checkpoint = result.checkpoint;
      previousProcessed = result.processed;
    }
    throw new Error('handler did not converge within bounded test invocations');
  }

  async function createUser(label: string) {
    const suffix = randomBytes(6).toString('hex');
    const externalId = `usr_t6_${label}_${suffix}`;
    const email = `t6-${label}-${suffix}@example.test`;
    const [result] = await db.insert(users).values({
      externalId,
      email,
      passwordHash: 'not-a-real-password',
      status: 'closure_processing',
      authVersion: 3,
    });
    return { id: Number(result.insertId), externalId, email };
  }

  async function seedAccountSecurity(user: typeof target, rows: number) {
    await db.insert(sessions).values(
      Array.from({ length: rows }, (_, index) => ({
        externalId: `sess_t6_${user.id}_${index}`,
        userId: user.id,
        status: 'disconnected',
      })),
    );
    await db.insert(apiKeys).values({
      externalId: `ak_t6_${user.id}`,
      userId: user.id,
      name: 'task6',
      keyPrefix: `hd_t6_${user.id}`,
      keyHash: `${user.id}`.padStart(64, 'a'),
      revokedAt: new Date('2026-08-26T00:00:00.000Z'),
    });
    await db.insert(userMfaRecoveryCodes).values({
      userId: user.id,
      codeHash: `${user.id}`.padStart(64, 'b'),
    });
    await db.insert(verificationCodes).values({
      externalId: `vc_t6_${user.id}`,
      email: user.email,
      codeHash: 'not-a-real-code-hash',
      purpose: 'account_closure',
      expiresAt: new Date('2026-08-27T00:00:00.000Z'),
    });
    await db.insert(userProfiles).values({
      externalId: `profile_t6_${user.id}`,
      userId: user.id,
      occupationRaw: 'test-only',
    });
  }

  async function seedTaskExecution(user: typeof target, rows: number) {
    await db.insert(tasks).values(
      Array.from({ length: rows }, (_, index) => ({
        externalId: `tsk_t6_${user.id}_${index}`,
        userId: user.id,
        status: 'cancelled',
        intent: `synthetic task ${index}`,
      })),
    );
    const ownedTasks = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(eq(tasks.userId, user.id));
    const firstTaskId = ownedTasks[0]?.id;
    if (!firstTaskId) throw new Error('expected seeded task');
    await db.insert(taskSteps).values({
      externalId: `step_t6_${user.id}`,
      taskId: firstTaskId,
      seq: 0,
      kind: 'test',
    });
    await db.insert(taskEvents).values({
      externalId: `evt_t6_${user.id}`,
      taskId: firstTaskId,
      type: 'test',
    });
  }

  async function seedCrossTaskMemory(user: typeof target, rows: number) {
    await db.insert(executionMemory).values(
      Array.from({ length: rows }, (_, index) => ({
        externalId: `mem_t6_${user.id}_${index}`,
        userId: user.id,
        category: 'preference',
        keyName: `key-${index}`,
        value: `value-${index}`,
      })),
    );
    await db.insert(executionStats).values({
      userId: user.id,
      laneUsed: 'test',
      success: true,
    });
  }

  async function seedStockProfile(user: typeof target, rows: number) {
    await db.insert(watchlists).values(
      Array.from({ length: rows }, (_, index) => ({
        externalId: `watch_t6_${user.id}_${index}`,
        userId: user.id,
        symbol: `${index}`.padStart(6, '0'),
      })),
    );
    await db.insert(stockPreferenceProfiles).values({
      userId: user.id,
      manualPreferencesJson: { horizon: 'test' },
    });
    await db.insert(stockPreferenceSignals).values({
      userId: user.id,
      kind: 'screening',
      dedupeHash: `${user.id}`.padStart(64, 'c'),
      payloadJson: { value: 'test' },
      occurredAt: new Date('2026-08-26T00:00:00.000Z'),
    });
    await db.insert(stockDashboardSnapshots).values({
      userId: user.id,
      cacheKeyHash: `${user.id}`.padStart(64, 'd'),
      snapshotJson: { value: 'test' },
    });
    const [plan] = await db.insert(plannedTasks).values({
      externalId: `plan_t6_${user.id}`,
      userId: user.id,
      title: 'test plan',
      instruction: 'test instruction',
      firstRunAt: new Date('2026-08-26T00:00:00.000Z'),
    });
    await db.insert(stockRiskMonitors).values({
      externalId: `monitor_t6_${user.id}`,
      userId: user.id,
      plannedTaskId: Number(plan.insertId),
      symbol: `T${user.id}`,
      name: 'test',
      market: 'A',
      riskKeysJson: [],
      lastSignalsJson: [],
      lastUnavailableChecksJson: [],
    });
  }

  async function seedNotifications(user: typeof target, rows: number) {
    await db.insert(notifications).values(
      Array.from({ length: rows }, (_, index) => ({
        externalId: `notice_t6_${user.id}_${index}`,
        userId: user.id,
        type: 'test',
        title: `title-${index}`,
        message: `message-${index}`,
      })),
    );
    await db.insert(notificationChannels).values({
      externalId: `channel_t6_${user.id}`,
      userId: user.id,
      platform: 'custom',
      webhookUrl: 'https://example.test/hook',
    });
  }

  async function seedSiteStats(user: typeof target, rows: number) {
    await db.insert(userSiteStats).values(
      Array.from({ length: rows }, (_, index) => ({
        userId: user.id,
        domain: `${index}.example.test`,
        visitCount: 1,
      })),
    );
  }

  async function seedCookies(user: typeof target) {
    await db.insert(pendingCookies).values({
      userId: user.id,
      cookiesJson: '[]',
      cookieCount: 0,
    });
  }

  async function seedAnonymousAnalytics() {
    const expiresAt = new Date('2026-09-26T00:00:00.000Z');
    await db.insert(energyDailyMetrics).values({
      metricDate: '2026-08-26',
      bucketHash: 'a'.repeat(64),
      eventType: 'energy_home_viewed',
      expiresAt,
    });
    await db.insert(energyDailyVisitors).values({
      activityDate: '2026-08-26',
      visitorHash: 'b'.repeat(64),
      expiresAt,
    });
    await db.insert(energyEventReceipts).values({
      eventId: '00000000-0000-4000-8000-000000000006',
      expiresAt,
    });
  }

  async function ownedCount(tableName: string, userId: number): Promise<number> {
    const result = await db.execute(
      sql`SELECT COUNT(*) AS value FROM ${sql.identifier(tableName)} WHERE user_id = ${userId}`,
    );
    return resultCount(result);
  }

  async function userExists(userId: number): Promise<boolean> {
    const result = await db.execute(sql`SELECT COUNT(*) AS value FROM users WHERE id = ${userId}`);
    return resultCount(result) === 1;
  }

  async function tableCount(tableName: string): Promise<number> {
    const result = await db.execute(
      sql`SELECT COUNT(*) AS value FROM ${sql.identifier(tableName)}`,
    );
    return resultCount(result);
  }
});

function assertNumericCheckpoint(checkpoint: NonNullable<ClosureCheckpoint>) {
  expect(Object.keys(checkpoint).sort()).toEqual(['processedCount']);
  for (const value of Object.values(checkpoint)) {
    expect(Number.isSafeInteger(value)).toBe(true);
  }
}

function resultCount(result: unknown): number {
  const rows = Array.isArray(result) ? result[0] : null;
  const row = Array.isArray(rows)
    ? (rows[0] as { value?: number | string } | undefined)
    : undefined;
  return Number(row?.value ?? 0);
}
