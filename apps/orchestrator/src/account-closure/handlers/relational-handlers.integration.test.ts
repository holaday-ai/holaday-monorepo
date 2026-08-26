import { randomBytes } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiKeys } from '../../db/schema/api-keys.js';
import { batchTaskItems, batchTasks } from '../../db/schema/batch-tasks.js';
import { canaryResults } from '../../db/schema/canary-results.js';
import { claimEvidenceLinks } from '../../db/schema/claim-evidence-links.js';
import { claims } from '../../db/schema/claims.js';
import {
  energyDailyMetrics,
  energyDailyVisitors,
  energyEventReceipts,
} from '../../db/schema/energy-analytics.js';
import { evidenceArtifacts } from '../../db/schema/evidence-artifacts.js';
import { executionMemory } from '../../db/schema/execution-memory.js';
import { executionStats } from '../../db/schema/execution-stats.js';
import { explorationRuns } from '../../db/schema/exploration-runs.js';
import { notificationChannels, notifications } from '../../db/schema/notifications.js';
import { operationPathSteps } from '../../db/schema/operation-path-steps.js';
import { operationPaths } from '../../db/schema/operation-paths.js';
import { pendingCookies } from '../../db/schema/pending-cookies.js';
import {
  plannedTaskItems,
  plannedTaskOccurrenceOverrides,
  plannedTaskRunItems,
  plannedTaskRuns,
  plannedTasks,
} from '../../db/schema/planned-tasks.js';
import { projects } from '../../db/schema/projects.js';
import { scheduledTasks } from '../../db/schema/scheduled-tasks.js';
import { sessions } from '../../db/schema/sessions.js';
import { siteCapabilities } from '../../db/schema/site-capabilities.js';
import { sites } from '../../db/schema/sites.js';
import { stockDashboardSnapshots } from '../../db/schema/stock-dashboard-snapshots.js';
import {
  stockPreferenceProfiles,
  stockPreferenceSignals,
} from '../../db/schema/stock-preferences.js';
import { stockRiskMonitors } from '../../db/schema/stock-risk-monitors.js';
import { taskActionCaptures } from '../../db/schema/task-action-captures.js';
import { taskEvents } from '../../db/schema/task-events.js';
import { taskFiles } from '../../db/schema/task-files.js';
import { taskSteps } from '../../db/schema/task-steps.js';
import { tasks } from '../../db/schema/tasks.js';
import { userMfaRecoveryCodes } from '../../db/schema/user-mfa-recovery-codes.js';
import { userProfiles } from '../../db/schema/user-profiles.js';
import { userSiteStats } from '../../db/schema/user-site-stats.js';
import { users } from '../../db/schema/users.js';
import { verificationCodes } from '../../db/schema/verification-codes.js';
import { watchlists } from '../../db/schema/watchlists.js';
import { webhookIdempotency } from '../../db/schema/webhook-idempotency.js';
import type { StorageProvider } from '../../files/storage-provider.js';
import type {
  AccountClosureHandler,
  ClosureCheckpoint,
  ClosureHandlerContext,
  ClosureHandlerResult,
} from '../handler-contract.js';
import { accountSecurityClosureHandler } from './account-security.js';
import { analyticsLogsClosureHandler } from './analytics-logs.js';
import { crossTaskMemoryClosureHandler } from './cross-task-memory.js';
import { energyAstrologyProfileClosureHandler } from './energy-astrology-profile.js';
import { extensionLoginCookiesClosureHandler } from './extension-login-cookies.js';
import { extensionSiteStatsClosureHandler } from './extension-site-stats.js';
import { externalNotificationsClosureHandler } from './external-notifications.js';
import { feedbackSupportClosureHandler } from './feedback-support.js';
import { mediaAssetsClosureHandler } from './media-assets.js';
import { stockPreferenceProfileClosureHandler } from './stock-preference-profile.js';
import { taskExecutionClosureHandler } from './task-execution.js';

const PRODUCTION_HANDLERS = {
  account_security: accountSecurityClosureHandler,
  task_execution: taskExecutionClosureHandler,
  cross_task_memory: crossTaskMemoryClosureHandler,
  energy_astrology_profile: energyAstrologyProfileClosureHandler,
  stock_preference_profile: stockPreferenceProfileClosureHandler,
  feedback_support: feedbackSupportClosureHandler,
  external_notifications: externalNotificationsClosureHandler,
  extension_site_stats: extensionSiteStatsClosureHandler,
  extension_login_cookies: extensionLoginCookiesClosureHandler,
  media_assets: mediaAssetsClosureHandler,
  analytics_logs: analyticsLogsClosureHandler,
} as const;

function productionHandler(categoryId: keyof typeof PRODUCTION_HANDLERS): AccountClosureHandler {
  return PRODUCTION_HANDLERS[categoryId];
}

interface RowRef {
  id: number;
  tableName: string;
}

interface TaskGraphFixture {
  blockerRows: RowRef[];
  deletedRows: RowRef[];
  preservedRows: RowRef[];
  sourceTaskExternalId: string;
}

describe.sequential('account closure relational handlers', () => {
  let cleanup: () => Promise<void> = async () => {};
  let db: typeof import('../../db/client.js').db;
  let target: { id: number; externalId: string; email: string };
  let other: { id: number; externalId: string; email: string };
  let targetTaskGraph: TaskGraphFixture;
  let otherTaskGraph: TaskGraphFixture;

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
    targetTaskGraph = await seedTaskExecution(target, 101);
    otherTaskGraph = await seedTaskExecution(other, 1);
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
    const handler = productionHandler('extension_site_stats');
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
    const second = await productionHandler('extension_site_stats').run(context(first.checkpoint));
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

  it('fails closed before task cleanup while Task 7 objects or cross-category children remain', async () => {
    const handler = productionHandler('task_execution');

    const taskFilePage = await handler.run(context(null));
    expect(taskFilePage).toEqual({
      kind: 'continue',
      checkpoint: { processedCount: 1 },
      processed: 1,
    });
    if (taskFilePage.kind !== 'continue') throw new Error('expected task file page');

    // The task handler owns the non-media file but cannot cross its relational
    // preflight while the media-owned screenshot evidence remains.
    await expect(handler.run(context(taskFilePage.checkpoint))).rejects.toMatchObject({
      code: 'HANDLER_DEFERRED',
    });
    const mediaResult = await runToCompletion(productionHandler('media_assets'));
    expect(mediaResult.retention).toBe('deleted');
    for (const row of targetTaskGraph.blockerRows) {
      expect(await rowExists(row)).toBe(false);
    }

    // Stock monitors and notifications still own FK-bearing children. They
    // must finish under their own governed categories before task parents.
    await expect(handler.run(context(taskFilePage.checkpoint))).rejects.toMatchObject({
      code: 'HANDLER_DEFERRED',
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
      const result = await runToCompletion(productionHandler(categoryId));
      expect(result.retention).toBe('deleted');
      expect(result.processed).toBeGreaterThan(0);
    }

    for (const tableName of [
      'sessions',
      'api_keys',
      'user_mfa_recovery_codes',
      'webhook_idempotency',
      'user_profiles',
      'execution_memory',
      'execution_stats',
      'stock_risk_monitors',
      'stock_preference_signals',
      'stock_preference_profiles',
      'stock_dashboard_snapshots',
      'watchlists',
      'notifications',
      'notification_channels',
      'pending_cookies',
      'batch_tasks',
      'planned_tasks',
      'scheduled_tasks',
      'tasks',
      'projects',
    ]) {
      expect(await ownedCount(tableName, target.id)).toBe(0);
      expect(await ownedCount(tableName, other.id)).toBeGreaterThan(0);
    }
    expect(await emailOwnedCount('verification_codes', target.email)).toBe(0);
    expect(await emailOwnedCount('verification_codes', other.email)).toBe(1);
    for (const row of targetTaskGraph.deletedRows) {
      expect(await rowExists(row), `target row survived: ${row.tableName}#${row.id}`).toBe(false);
    }
    for (const row of [
      ...targetTaskGraph.preservedRows,
      ...otherTaskGraph.blockerRows,
      ...otherTaskGraph.deletedRows,
      ...otherTaskGraph.preservedRows,
    ]) {
      expect(await rowExists(row), `other/shared row was deleted: ${row.tableName}#${row.id}`).toBe(
        true,
      );
    }
    expect(await pathMetadataSourceCount(targetTaskGraph.sourceTaskExternalId)).toBe(0);
    expect(await userExists(target.id)).toBe(true);
    expect(await userExists(other.id)).toBe(true);

    for (const categoryId of categories) {
      await expect(productionHandler(categoryId).run(context(null))).resolves.toEqual({
        kind: 'complete',
        processed: 0,
        retention: 'not_present',
      });
    }
  });

  it('pages feedback cases, deletes ordinary rows, minimizes reviewed holds, and isolates another user', async () => {
    const previousGate = process.env.ACCOUNT_CLOSURE_LEGACY_FEEDBACK_SANITIZED;
    Reflect.deleteProperty(process.env, 'ACCOUNT_CLOSURE_LEGACY_FEEDBACK_SANITIZED');
    await seedFeedbackCases();
    const handler = productionHandler('feedback_support');

    try {
      await expect(handler.run(context(null))).rejects.toMatchObject({
        code: 'EXTERNAL_RETENTION_REQUIRED',
      });
      expect(await feedbackOwnedCount(target.id)).toBe(205);

      process.env.ACCOUNT_CLOSURE_LEGACY_FEEDBACK_SANITIZED = 'true';
      const first = await handler.run(context(null));
      expect(first).toEqual({
        kind: 'continue',
        checkpoint: { processedCount: 100 },
        processed: 100,
      });
      if (first.kind !== 'continue') throw new Error('expected first feedback page');
      const second = await handler.run(context(first.checkpoint));
      expect(second).toEqual({
        kind: 'continue',
        checkpoint: { processedCount: 200 },
        processed: 200,
      });
      if (second.kind !== 'continue') throw new Error('expected second feedback page');
      await expect(handler.run(context(second.checkpoint))).resolves.toEqual({
        kind: 'complete',
        processed: 205,
        retention: 'restricted',
      });

      expect(await feedbackOwnedCount(target.id)).toBe(0);
      expect(await feedbackOwnedCount(other.id)).toBe(1);
      expect(await minimizedFeedbackHoldCount(501)).toBe(2);
      await expect(handler.run(context(null))).resolves.toEqual({
        kind: 'complete',
        processed: 0,
        retention: 'restricted',
      });
    } finally {
      restoreProcessEnv('ACCOUNT_CLOSURE_LEGACY_FEEDBACK_SANITIZED', previousGate);
    }
  });

  it('enforces mutually exclusive active and restricted feedback case states', async () => {
    await expect(
      db.execute(sql`
        INSERT INTO feedback_cases
          (external_id, user_id, closure_request_id, message, hold_reason, restricted_at)
        VALUES
          ('fbc_invalid_restricted', NULL, 501, 'raw content survived', 'legal_hold', NOW(3))
      `),
    ).rejects.toThrow();
    await expect(
      db.execute(sql`
        INSERT INTO feedback_cases (external_id, user_id, message)
        VALUES ('fbc_invalid_active', NULL, 'orphaned active content')
      `),
    ).rejects.toThrow();
  });

  it('keeps browser-only astrology separate and closes analytics only after legacy sanitation', async () => {
    await expect(productionHandler('energy_astrology_profile').run(context(null))).resolves.toEqual(
      { kind: 'complete', processed: 0, retention: 'not_present' },
    );

    const previousGate = process.env.ACCOUNT_CLOSURE_LEGACY_ANALYTICS_LOGS_SANITIZED;
    Reflect.deleteProperty(process.env, 'ACCOUNT_CLOSURE_LEGACY_ANALYTICS_LOGS_SANITIZED');
    try {
      await expect(productionHandler('analytics_logs').run(context(null))).rejects.toMatchObject({
        code: 'EXTERNAL_RETENTION_REQUIRED',
      });
      process.env.ACCOUNT_CLOSURE_LEGACY_ANALYTICS_LOGS_SANITIZED = 'true';
      await expect(productionHandler('analytics_logs').run(context(null))).resolves.toEqual({
        kind: 'complete',
        processed: 0,
        retention: 'restricted',
      });
    } finally {
      restoreProcessEnv('ACCOUNT_CLOSURE_LEGACY_ANALYTICS_LOGS_SANITIZED', previousGate);
    }

    expect(await tableCount('energy_daily_metrics')).toBe(1);
    expect(await tableCount('energy_daily_visitors')).toBe(1);
    expect(await tableCount('energy_event_receipts')).toBe(1);
  });

  it('fails closed when a governed analytics column definition drifts', async () => {
    const previousGate = process.env.ACCOUNT_CLOSURE_LEGACY_ANALYTICS_LOGS_SANITIZED;
    process.env.ACCOUNT_CLOSURE_LEGACY_ANALYTICS_LOGS_SANITIZED = 'true';
    let analyticsDefinitionChanged = false;
    try {
      await db.execute(sql`ALTER TABLE energy_daily_visitors MODIFY visitor_hash VARCHAR(64) NULL`);
      analyticsDefinitionChanged = true;
      await expect(productionHandler('analytics_logs').run(context(null))).rejects.toMatchObject({
        code: 'CAPABILITY_CHANGED',
      });
    } finally {
      if (analyticsDefinitionChanged) {
        await db.execute(
          sql`ALTER TABLE energy_daily_visitors MODIFY visitor_hash CHAR(64) NOT NULL`,
        );
      }
      restoreProcessEnv('ACCOUNT_CLOSURE_LEGACY_ANALYTICS_LOGS_SANITIZED', previousGate);
    }
  });

  it('fails closed when governed relational capabilities appear and restores the test schema', async () => {
    const analyticsBefore = await anonymousAnalyticsState();
    process.env.ACCOUNT_CLOSURE_LEGACY_FEEDBACK_SANITIZED = 'true';
    process.env.ACCOUNT_CLOSURE_LEGACY_ANALYTICS_LOGS_SANITIZED = 'true';

    try {
      await db.execute(sql`
        CREATE TABLE feedback_support_cases_task6 (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          user_id BIGINT UNSIGNED NULL,
          PRIMARY KEY (id)
        ) ENGINE=InnoDB
      `);
      await expect(productionHandler('feedback_support').run(context(null))).rejects.toMatchObject({
        code: 'CAPABILITY_CHANGED',
      });
    } finally {
      await db.execute(sql`DROP TABLE IF EXISTS feedback_support_cases_task6`);
    }

    let feedbackColumnAdded = false;
    try {
      await db.execute(
        sql`ALTER TABLE feedback_cases ADD COLUMN future_user_id BIGINT UNSIGNED NULL`,
      );
      feedbackColumnAdded = true;
      await expect(productionHandler('feedback_support').run(context(null))).rejects.toMatchObject({
        code: 'CAPABILITY_CHANGED',
      });
    } finally {
      if (feedbackColumnAdded) {
        await db.execute(sql`ALTER TABLE feedback_cases DROP COLUMN future_user_id`);
      }
    }

    try {
      await db.execute(sql`
        CREATE TABLE energy_astrology_profiles (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          user_id BIGINT UNSIGNED NULL,
          PRIMARY KEY (id)
        ) ENGINE=InnoDB
      `);
      await expect(
        productionHandler('energy_astrology_profile').run(context(null)),
      ).rejects.toMatchObject({ code: 'CAPABILITY_CHANGED' });
    } finally {
      await db.execute(sql`DROP TABLE IF EXISTS energy_astrology_profiles`);
    }

    let analyticsColumnAdded = false;
    try {
      await db.execute(
        sql`ALTER TABLE energy_daily_metrics ADD COLUMN future_user_id BIGINT UNSIGNED NULL`,
      );
      analyticsColumnAdded = true;
      await expect(productionHandler('analytics_logs').run(context(null))).rejects.toMatchObject({
        code: 'CAPABILITY_CHANGED',
      });
    } finally {
      if (analyticsColumnAdded) {
        await db.execute(sql`ALTER TABLE energy_daily_metrics DROP COLUMN future_user_id`);
      }
    }

    let analyticsTableAdded = false;
    try {
      await db.execute(sql`
        CREATE TABLE energy_account_analytics (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          user_id BIGINT UNSIGNED NULL,
          PRIMARY KEY (id)
        ) ENGINE=InnoDB
      `);
      analyticsTableAdded = true;
      await expect(productionHandler('analytics_logs').run(context(null))).rejects.toMatchObject({
        code: 'CAPABILITY_CHANGED',
      });
    } finally {
      if (analyticsTableAdded) {
        await db.execute(sql`DROP TABLE energy_account_analytics`);
      }
    }

    expect(await temporaryCapabilityResidueCount()).toBe(0);
    expect(await anonymousAnalyticsState()).toEqual(analyticsBefore);
    await expect(productionHandler('energy_astrology_profile').run(context(null))).resolves.toEqual(
      { kind: 'complete', processed: 0, retention: 'not_present' },
    );
    process.env.ACCOUNT_CLOSURE_LEGACY_FEEDBACK_SANITIZED = 'true';
    process.env.ACCOUNT_CLOSURE_LEGACY_ANALYTICS_LOGS_SANITIZED = 'true';
    await expect(productionHandler('feedback_support').run(context(null))).resolves.toEqual({
      kind: 'complete',
      processed: 0,
      retention: 'restricted',
    });
    await expect(productionHandler('analytics_logs').run(context(null))).resolves.toEqual({
      kind: 'complete',
      processed: 0,
      retention: 'restricted',
    });
    Reflect.deleteProperty(process.env, 'ACCOUNT_CLOSURE_LEGACY_FEEDBACK_SANITIZED');
    Reflect.deleteProperty(process.env, 'ACCOUNT_CLOSURE_LEGACY_ANALYTICS_LOGS_SANITIZED');
  });

  function context(checkpoint: ClosureCheckpoint): ClosureHandlerContext {
    return {
      db,
      logger,
      storage,
      signal: new AbortController().signal,
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
    await db.insert(webhookIdempotency).values({
      userId: user.id,
      idempotencyKey: `task6-${user.id}`,
      requestHash: `${user.id}`.padStart(64, '9'),
      taskId: `tsk_webhook_${user.id}`,
      responseJson: { private: `response-${user.id}` },
      expiresAt: new Date('2026-08-27T00:00:00.000Z'),
    });
  }

  async function seedTaskExecution(user: typeof target, rows: number): Promise<TaskGraphFixture> {
    const deletedRows: RowRef[] = [];
    const preservedRows: RowRef[] = [];
    const blockerRows: RowRef[] = [];
    const suffix = `t6_${user.id}`;

    const [projectInsert] = await db.insert(projects).values({
      externalId: `prj_${suffix}`,
      userId: user.id,
      name: 'Task 6 private project',
    });
    const projectId = Number(projectInsert.insertId);
    deletedRows.push({ tableName: 'projects', id: projectId });

    const sourceTaskExternalId = `tsk_${suffix}_0`;
    await db.insert(tasks).values(
      Array.from({ length: rows }, (_, index) => ({
        externalId: `tsk_${suffix}_${index}`,
        userId: user.id,
        projectId: index === 0 ? projectId : null,
        status: 'cancelled',
        intent:
          index === 0
            ? `full private source intent for account ${user.id}`
            : `synthetic task ${index}`,
      })),
    );
    const ownedTasks = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(eq(tasks.userId, user.id));
    const firstTaskId = ownedTasks[0]?.id;
    if (!firstTaskId) throw new Error('expected seeded task');
    deletedRows.push({ tableName: 'tasks', id: firstTaskId });

    const [stepInsert] = await db.insert(taskSteps).values({
      externalId: `step_${suffix}`,
      taskId: firstTaskId,
      seq: 0,
      kind: 'test',
    });
    deletedRows.push({ tableName: 'task_steps', id: Number(stepInsert.insertId) });
    const [eventInsert] = await db.insert(taskEvents).values({
      externalId: `evt_${suffix}`,
      taskId: firstTaskId,
      type: 'test',
    });
    deletedRows.push({ tableName: 'task_events', id: Number(eventInsert.insertId) });
    const [captureInsert] = await db.insert(taskActionCaptures).values({
      externalId: `cap_${suffix}`,
      taskId: firstTaskId,
      actionIndex: 0,
      stepType: 'click',
      visibleText: 'private visible task content',
    });
    deletedRows.push({
      tableName: 'task_action_captures',
      id: Number(captureInsert.insertId),
    });

    const [claimArtifactInsert] = await db.insert(evidenceArtifacts).values({
      externalId: `art_claim_${suffix}`,
      ownerUserId: null,
      artifactKind: 'html_snapshot',
      purpose: 'test_fixture',
      r2Bucket: 'task6-test',
      r2Key: `claim/${suffix}`,
      contentType: 'text/html',
      sizeBytes: 1,
      sha256: `${user.id}`.padStart(64, 'e'),
      capturedAt: new Date('2026-08-26T00:00:00.000Z'),
      collectorLane: 'test',
    });
    const claimArtifactId = Number(claimArtifactInsert.insertId);
    preservedRows.push({ tableName: 'evidence_artifacts', id: claimArtifactId });
    const [taskClaimInsert] = await db.insert(claims).values({
      externalId: `clm_task_${suffix}`,
      taskId: firstTaskId,
      claimType: 'test',
      subject: 'private subject',
      predicate: 'contains',
      objectText: 'private object',
    });
    const taskClaimId = Number(taskClaimInsert.insertId);
    deletedRows.push({ tableName: 'claims', id: taskClaimId });
    const [taskClaimLinkInsert] = await db.insert(claimEvidenceLinks).values({
      claimId: taskClaimId,
      artifactId: claimArtifactId,
      quotedExcerpt: 'private quoted evidence',
    });
    deletedRows.push({
      tableName: 'claim_evidence_links',
      id: Number(taskClaimLinkInsert.insertId),
    });

    const [globalSiteInsert] = await db.insert(sites).values({
      externalId: `site_global_${suffix}`,
      ownerUserId: null,
      canonicalDomain: `global-${user.id}.example.test`,
      displayName: 'Shared site',
      homepageUrl: `https://global-${user.id}.example.test/`,
    });
    const globalSiteId = Number(globalSiteInsert.insertId);
    preservedRows.push({ tableName: 'sites', id: globalSiteId });
    await db
      .update(evidenceArtifacts)
      .set({ siteId: globalSiteId, retentionPolicy: 'manual_hold' })
      .where(eq(evidenceArtifacts.id, claimArtifactId));
    const [globalCapabilityInsert] = await db.insert(siteCapabilities).values({
      externalId: `scap_global_${suffix}`,
      siteId: globalSiteId,
      capabilityKey: 'test',
      displayName: 'Shared capability',
    });
    const globalCapabilityId = Number(globalCapabilityInsert.insertId);
    preservedRows.push({ tableName: 'site_capabilities', id: globalCapabilityId });
    const [taskPathInsert] = await db.insert(operationPaths).values({
      externalId: `path_task_${suffix}`,
      siteId: globalSiteId,
      capabilityId: globalCapabilityId,
      version: 1,
      sourceTaskId: firstTaskId,
      metadataJson: {
        sourceTaskId: firstTaskId,
        sourceTaskExternalId,
        sourceTaskIntent: `full private source intent for account ${user.id}`,
      },
    });
    const taskPathId = Number(taskPathInsert.insertId);
    deletedRows.push({ tableName: 'operation_paths', id: taskPathId });
    const [taskPathStepInsert] = await db.insert(operationPathSteps).values({
      pathId: taskPathId,
      stepIndex: 0,
      stepType: 'click',
      intent: 'private derived step',
    });
    deletedRows.push({
      tableName: 'operation_path_steps',
      id: Number(taskPathStepInsert.insertId),
    });
    const [taskPathCanaryInsert] = await db.insert(canaryResults).values({
      externalId: `canary_task_path_${suffix}`,
      pathId: taskPathId,
      status: 'passed',
      evidenceSummaryJson: { private: 'task-derived canary evidence' },
    });
    deletedRows.push({ tableName: 'canary_results', id: Number(taskPathCanaryInsert.insertId) });

    const [sharedPathInsert] = await db.insert(operationPaths).values({
      externalId: `path_shared_${suffix}`,
      siteId: globalSiteId,
      capabilityId: globalCapabilityId,
      version: 2,
      metadataJson: { shared: true },
    });
    const sharedPathId = Number(sharedPathInsert.insertId);
    preservedRows.push({ tableName: 'operation_paths', id: sharedPathId });
    const [taskCanaryInsert] = await db.insert(canaryResults).values({
      externalId: `canary_task_${suffix}`,
      pathId: sharedPathId,
      taskId: firstTaskId,
      status: 'passed',
    });
    deletedRows.push({ tableName: 'canary_results', id: Number(taskCanaryInsert.insertId) });

    const [privateSiteInsert] = await db.insert(sites).values({
      externalId: `site_private_${suffix}`,
      ownerUserId: user.id,
      canonicalDomain: `private-${user.id}.example.test`,
      displayName: 'Private site',
      homepageUrl: `https://private-${user.id}.example.test/`,
      metadataJson: { private: `site metadata ${user.id}` },
    });
    const privateSiteId = Number(privateSiteInsert.insertId);
    deletedRows.push({ tableName: 'sites', id: privateSiteId });
    const [privateCapabilityInsert] = await db.insert(siteCapabilities).values({
      externalId: `scap_private_${suffix}`,
      siteId: privateSiteId,
      capabilityKey: 'private-test',
      displayName: 'Private capability',
      description: 'private capability description',
    });
    const privateCapabilityId = Number(privateCapabilityInsert.insertId);
    deletedRows.push({ tableName: 'site_capabilities', id: privateCapabilityId });
    const [privatePathInsert] = await db.insert(operationPaths).values({
      externalId: `path_private_${suffix}`,
      siteId: privateSiteId,
      capabilityId: privateCapabilityId,
      version: 1,
      metadataJson: { private: `path metadata ${user.id}` },
    });
    const privatePathId = Number(privatePathInsert.insertId);
    deletedRows.push({ tableName: 'operation_paths', id: privatePathId });
    const [privatePathStepInsert] = await db.insert(operationPathSteps).values({
      pathId: privatePathId,
      stepIndex: 0,
      stepType: 'type',
      intent: 'private site step content',
    });
    const privatePathStepId = Number(privatePathStepInsert.insertId);
    deletedRows.push({ tableName: 'operation_path_steps', id: privatePathStepId });
    const [privateExplorationInsert] = await db.insert(explorationRuns).values({
      externalId: `explore_private_${suffix}`,
      siteId: privateSiteId,
      triggerType: 'manual',
      runnerType: 'test',
      summary: 'private exploration summary',
    });
    const privateExplorationId = Number(privateExplorationInsert.insertId);
    deletedRows.push({ tableName: 'exploration_runs', id: privateExplorationId });
    const [privatePathCanaryInsert] = await db.insert(canaryResults).values({
      externalId: `canary_private_path_${suffix}`,
      pathId: privatePathId,
      status: 'failed',
      failureType: 'private-test',
    });
    deletedRows.push({
      tableName: 'canary_results',
      id: Number(privatePathCanaryInsert.insertId),
    });
    const [privateExplorationCanaryInsert] = await db.insert(canaryResults).values({
      externalId: `canary_private_explore_${suffix}`,
      pathId: sharedPathId,
      explorationRunId: privateExplorationId,
      status: 'passed',
    });
    deletedRows.push({
      tableName: 'canary_results',
      id: Number(privateExplorationCanaryInsert.insertId),
    });

    const [siteClaimInsert] = await db.insert(claims).values({
      externalId: `clm_site_${suffix}`,
      siteId: privateSiteId,
      claimType: 'test',
      subject: 'private site subject',
      predicate: 'contains',
      objectText: 'private site object',
    });
    const siteClaimId = Number(siteClaimInsert.insertId);
    deletedRows.push({ tableName: 'claims', id: siteClaimId });
    const [siteClaimLinkInsert] = await db.insert(claimEvidenceLinks).values({
      claimId: siteClaimId,
      artifactId: claimArtifactId,
      supportType: 'site-supports',
    });
    deletedRows.push({
      tableName: 'claim_evidence_links',
      id: Number(siteClaimLinkInsert.insertId),
    });
    const [capabilityClaimInsert] = await db.insert(claims).values({
      externalId: `clm_cap_${suffix}`,
      capabilityId: privateCapabilityId,
      claimType: 'test',
      subject: 'private capability subject',
      predicate: 'contains',
      objectText: 'private capability object',
    });
    const capabilityClaimId = Number(capabilityClaimInsert.insertId);
    deletedRows.push({ tableName: 'claims', id: capabilityClaimId });
    const [capabilityClaimLinkInsert] = await db.insert(claimEvidenceLinks).values({
      claimId: capabilityClaimId,
      artifactId: claimArtifactId,
      supportType: 'cap-supports',
    });
    deletedRows.push({
      tableName: 'claim_evidence_links',
      id: Number(capabilityClaimLinkInsert.insertId),
    });

    const [blockerArtifactInsert] = await db.insert(evidenceArtifacts).values({
      externalId: `art_block_${suffix}`,
      ownerUserId: user.id,
      siteId: privateSiteId,
      taskId: firstTaskId,
      explorationRunId: privateExplorationId,
      artifactKind: 'screenshot',
      purpose: 'task_30d',
      r2Bucket: 'task6-test',
      r2Key: `blocker/${suffix}`,
      contentType: 'image/png',
      sizeBytes: 1,
      sha256: `${user.id}`.padStart(64, 'f'),
      capturedAt: new Date('2026-08-26T00:00:00.000Z'),
      collectorLane: 'test',
    });
    const blockerArtifactId = Number(blockerArtifactInsert.insertId);
    blockerRows.push({ tableName: 'evidence_artifacts', id: blockerArtifactId });
    await db
      .update(operationPathSteps)
      .set({ screenshotAnchorId: blockerArtifactId })
      .where(eq(operationPathSteps.id, privatePathStepId));
    const [blockerFileInsert] = await db.insert(taskFiles).values({
      externalId: `file_block_${suffix}`,
      userId: user.id,
      taskId: firstTaskId,
      kind: 'input',
      filename: 'private.txt',
      mimetype: 'text/plain',
      sizeBytes: 1,
      storagePath: `task6/${suffix}/private.txt`,
    });
    blockerRows.push({ tableName: 'task_files', id: Number(blockerFileInsert.insertId) });

    const [batchInsert] = await db.insert(batchTasks).values({
      externalId: `batch_${suffix}`,
      userId: user.id,
      name: 'private batch',
      status: 'cancelled',
    });
    const batchId = Number(batchInsert.insertId);
    deletedRows.push({ tableName: 'batch_tasks', id: batchId });
    const [batchItemInsert] = await db.insert(batchTaskItems).values({
      externalId: `batch_item_${suffix}`,
      batchId,
      seq: 0,
      prompt: 'private batch prompt',
      status: 'cancelled',
      taskId: firstTaskId,
    });
    deletedRows.push({ tableName: 'batch_task_items', id: Number(batchItemInsert.insertId) });

    const [planInsert] = await db.insert(plannedTasks).values({
      externalId: `plan_exec_${suffix}`,
      userId: user.id,
      title: 'private plan',
      instruction: 'private planned instruction',
      firstRunAt: new Date('2026-08-26T00:00:00.000Z'),
      status: 'paused',
    });
    const planId = Number(planInsert.insertId);
    deletedRows.push({ tableName: 'planned_tasks', id: planId });
    const [planItemInsert] = await db.insert(plannedTaskItems).values({
      externalId: `plan_item_${suffix}`,
      plannedTaskId: planId,
      seq: 0,
      instruction: 'private planned item',
    });
    const planItemId = Number(planItemInsert.insertId);
    deletedRows.push({ tableName: 'planned_task_items', id: planItemId });
    const [overrideInsert] = await db.insert(plannedTaskOccurrenceOverrides).values({
      externalId: `plan_override_${suffix}`,
      plannedTaskId: planId,
      originalScheduledFor: new Date('2026-08-26T01:00:00.000Z'),
      action: 'skip',
    });
    deletedRows.push({
      tableName: 'planned_task_occurrence_overrides',
      id: Number(overrideInsert.insertId),
    });
    const [planRunInsert] = await db.insert(plannedTaskRuns).values({
      externalId: `plan_run_${suffix}`,
      plannedTaskId: planId,
      title: 'private run',
      scheduledFor: new Date('2026-08-26T01:00:00.000Z'),
      seriesScheduledFor: new Date('2026-08-26T01:00:00.000Z'),
      status: 'cancelled',
      taskId: firstTaskId,
      batchTaskId: batchId,
    });
    const planRunId = Number(planRunInsert.insertId);
    deletedRows.push({ tableName: 'planned_task_runs', id: planRunId });
    const [planRunItemInsert] = await db.insert(plannedTaskRunItems).values({
      externalId: `plan_run_item_${suffix}`,
      plannedTaskRunId: planRunId,
      plannedTaskItemId: planItemId,
      seq: 0,
      instruction: 'private run item',
      status: 'cancelled',
      taskId: firstTaskId,
    });
    deletedRows.push({
      tableName: 'planned_task_run_items',
      id: Number(planRunItemInsert.insertId),
    });

    const [scheduledInsert] = await db.insert(scheduledTasks).values({
      externalId: `scheduled_${suffix}`,
      userId: user.id,
      intent: 'private scheduled intent',
      nextRunAt: new Date('2026-08-27T00:00:00.000Z'),
      lastTaskId: firstTaskId,
      status: 'paused',
    });
    deletedRows.push({ tableName: 'scheduled_tasks', id: Number(scheduledInsert.insertId) });

    return { blockerRows, deletedRows, preservedRows, sourceTaskExternalId };
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

  async function seedFeedbackCases() {
    await db.execute(sql`
      INSERT INTO account_closure_requests
        (id, external_id, user_id, active_user_id, status, requested_at, grace_ends_at)
      VALUES
        (501, 'acl_relational_test', ${target.id}, ${target.id}, 'processing',
         '2026-08-26 00:00:00.000', '2026-09-02 00:00:00.000')
    `);
    const rows = Array.from({ length: 205 }, (_, index) => {
      const holdReason = index === 50 ? 'legal_hold' : index === 150 ? 'active_dispute' : null;
      return sql`(${`fbc_target_${index}`}, ${target.id}, ${`private message ${index}`}, ${`context ${index}`}, ${`ua ${index}`}, ${holdReason})`;
    });
    await db.execute(sql`
      INSERT INTO feedback_cases
        (external_id, user_id, message, context, user_agent, hold_reason)
      VALUES ${sql.join(rows, sql`, `)}
    `);
    await db.execute(sql`
      INSERT INTO feedback_cases
        (external_id, user_id, message, context, user_agent, hold_reason)
      VALUES ('fbc_other', ${other.id}, 'other private message', 'other context', 'other ua', NULL)
    `);
  }

  async function feedbackOwnedCount(userId: number): Promise<number> {
    const result = await db.execute(
      sql`SELECT COUNT(*) AS value FROM feedback_cases WHERE user_id = ${userId}`,
    );
    return resultCount(result);
  }

  async function minimizedFeedbackHoldCount(requestId: number): Promise<number> {
    const result = await db.execute(sql`
      SELECT COUNT(*) AS value
      FROM feedback_cases
      WHERE closure_request_id = ${requestId}
        AND user_id IS NULL
        AND message IS NULL
        AND context IS NULL
        AND user_agent IS NULL
        AND hold_reason IN ('legal_hold', 'active_dispute')
    `);
    return resultCount(result);
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

  async function emailOwnedCount(tableName: string, email: string): Promise<number> {
    const result = await db.execute(
      sql`SELECT COUNT(*) AS value FROM ${sql.identifier(tableName)} WHERE email = ${email}`,
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

  async function anonymousAnalyticsState() {
    return {
      metrics: await db.select().from(energyDailyMetrics),
      visitors: await db.select().from(energyDailyVisitors),
      receipts: await db.select().from(energyEventReceipts),
    };
  }

  async function temporaryCapabilityResidueCount(): Promise<number> {
    const result = await db.execute(sql`
      SELECT
        (
          SELECT COUNT(*)
          FROM information_schema.tables
          WHERE table_schema = DATABASE()
            AND table_name IN ('feedback_support_cases_task6', 'energy_astrology_profiles')
        ) + (
          SELECT COUNT(*)
          FROM information_schema.columns
          WHERE table_schema = DATABASE()
            AND table_name = 'energy_daily_metrics'
            AND column_name = 'future_user_id'
        ) + (
          SELECT COUNT(*)
          FROM information_schema.tables
          WHERE table_schema = DATABASE()
            AND table_name = 'energy_account_analytics'
        ) AS value
    `);
    return resultCount(result);
  }

  async function pathMetadataSourceCount(sourceTaskExternalId: string): Promise<number> {
    const result = await db.execute(sql`
      SELECT COUNT(*) AS value
      FROM operation_paths
      WHERE JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.sourceTaskExternalId')) = ${sourceTaskExternalId}
    `);
    return resultCount(result);
  }

  async function rowExists(row: RowRef): Promise<boolean> {
    const result = await db.execute(
      sql`SELECT COUNT(*) AS value FROM ${sql.identifier(row.tableName)} WHERE id = ${row.id}`,
    );
    return resultCount(result) === 1;
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

function restoreProcessEnv(name: string, value: string | undefined): void {
  if (value === undefined) Reflect.deleteProperty(process.env, name);
  else process.env[name] = value;
}
