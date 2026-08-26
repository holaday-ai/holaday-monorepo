import { randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DATA_CATEGORY_IDS } from '../data-governance/types.js';
import {
  accountClosureEffects,
  accountClosureRequests,
  accountClosureSteps,
} from '../db/schema/account-closures.js';
import { apiKeys } from '../db/schema/api-keys.js';
import { notificationChannels } from '../db/schema/notifications.js';
import { plannedTasks } from '../db/schema/planned-tasks.js';
import { scheduledTasks } from '../db/schema/scheduled-tasks.js';
import { sessions } from '../db/schema/sessions.js';
import { taskEvents } from '../db/schema/task-events.js';
import { taskQuotas } from '../db/schema/task-quotas.js';
import { tasks } from '../db/schema/tasks.js';
import { users } from '../db/schema/users.js';
import {
  applyImmediateClosureEffects,
  restoreImmediateClosureEffects,
} from './immediate-effects.js';
import {
  claimClosureRequestForProcessing,
  freezeAccountForClosure,
  withdrawAccountClosureRequest,
} from './repository.js';

describe.sequential('account closure atomic freeze and exact immediate effects', () => {
  let cleanup: () => Promise<void> = async () => {};
  let db: typeof import('../db/client.js').db;

  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error('DATABASE_URL is required for integration tests');
    const { applyMigrations } = await import('../test/db-helper.js');
    await applyMigrations(databaseUrl);
    const client = await import('../db/client.js');
    db = client.db;
    cleanup = () => client.pool.end();
  });

  afterAll(async () => {
    await cleanup();
  });

  async function createUser(input?: {
    planExpiresAt?: Date;
    authVersion?: number;
  }): Promise<{ id: number; externalId: string }> {
    const suffix = randomBytes(8).toString('hex');
    const externalId = `usr_t4_${suffix}`;
    const [insert] = await db.insert(users).values({
      externalId,
      email: `t4-${suffix}@example.test`,
      passwordHash: 'not-a-real-password',
      authVersion: input?.authVersion ?? 3,
      plan: 'pro',
      planExpiresAt: input?.planExpiresAt ?? new Date('2027-01-01T00:00:00.000Z'),
    });
    return { id: Number(insert.insertId), externalId };
  }

  it('creates one request, freezes once, revokes credentials, and seeds exactly 13 steps', async () => {
    const user = await createUser({ authVersion: 8 });
    const now = new Date('2026-08-26T03:00:00.000Z');
    await db.insert(sessions).values({
      externalId: `sess_t4_${randomBytes(6).toString('hex')}`,
      userId: user.id,
      status: 'connected',
    });
    await db.insert(apiKeys).values({
      externalId: `ak_t4_${randomBytes(6).toString('hex')}`,
      userId: user.id,
      name: 'task4',
      keyPrefix: 'hd_live_t4',
      keyHash: randomBytes(32).toString('hex'),
    });

    const attempts = await Promise.allSettled([
      freezeAccountForClosure(db, {
        userId: user.id,
        requestExternalId: `acl_${randomBytes(10).toString('hex')}`,
        requestedAt: now,
        reasonCode: 'privacy',
      }),
      freezeAccountForClosure(db, {
        userId: user.id,
        requestExternalId: `acl_${randomBytes(10).toString('hex')}`,
        requestedAt: now,
        reasonCode: 'privacy',
      }),
    ]);

    expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter((attempt) => attempt.status === 'rejected')).toHaveLength(1);
    const [frozenUser] = await db
      .select({ status: users.status, authVersion: users.authVersion })
      .from(users)
      .where(eq(users.id, user.id));
    expect(frozenUser).toEqual({ status: 'closure_pending', authVersion: 9 });
    const requests = await db
      .select({ id: accountClosureRequests.id })
      .from(accountClosureRequests)
      .where(eq(accountClosureRequests.userId, user.id));
    expect(requests).toHaveLength(1);
    const request = requests[0];
    if (!request) throw new Error('expected one closure request');
    const steps = await db
      .select({ categoryId: accountClosureSteps.categoryId })
      .from(accountClosureSteps)
      .where(eq(accountClosureSteps.requestId, request.id));
    expect(DATA_CATEGORY_IDS).toHaveLength(13);
    expect(steps).toHaveLength(13);
    expect(steps.map((step) => step.categoryId).sort()).toEqual([...DATA_CATEGORY_IDS].sort());
    const [session] = await db
      .select({ status: sessions.status, disconnectedAt: sessions.disconnectedAt })
      .from(sessions)
      .where(eq(sessions.userId, user.id));
    expect(session?.status).toBe('disconnected');
    expect(session?.disconnectedAt).toBeInstanceOf(Date);
    const [key] = await db
      .select({ revokedAt: apiKeys.revokedAt })
      .from(apiKeys)
      .where(eq(apiKeys.userId, user.id));
    expect(key?.revokedAt).toBeInstanceOf(Date);
  });

  it('changes only live resources, records only actual changes, and restores exact reversible effects', async () => {
    const planExpiresAt = new Date('2027-02-03T04:05:06.000Z');
    const user = await createUser({ planExpiresAt });
    await db.insert(taskQuotas).values({
      userId: user.id,
      period: 'month',
      periodStart: new Date('2026-08-01T00:00:00.000Z'),
      periodEnd: new Date('2026-09-01T00:00:00.000Z'),
      tasksUsed: 7,
      opusUsed: 2,
      bonusTasks: 11,
      bonusOpus: 3,
    });
    const taskRows = [
      ['pending', 'pending'],
      ['executing', 'executing'],
      ['completed', 'completed'],
      ['cancelled', 'cancelled'],
    ] as const;
    for (const [label, status] of taskRows) {
      await db.insert(tasks).values({
        externalId: `tsk_${label}_${randomBytes(5).toString('hex')}`,
        userId: user.id,
        status,
        intent: label,
      });
    }
    const firstRunAt = new Date('2026-08-27T00:00:00.000Z');
    for (const [label, status] of [
      ['live', 'active'],
      ['manual', 'paused'],
    ] as const) {
      await db.insert(plannedTasks).values({
        externalId: `pln_${label}_${randomBytes(5).toString('hex')}`,
        userId: user.id,
        title: label,
        instruction: label,
        firstRunAt,
        nextRunAt: firstRunAt,
        status,
      });
      await db.insert(scheduledTasks).values({
        externalId: `sch_${label}_${randomBytes(5).toString('hex')}`,
        userId: user.id,
        intent: label,
        nextRunAt: firstRunAt,
        status,
      });
    }
    for (const enabled of [true, false]) {
      await db.insert(notificationChannels).values({
        externalId: `nch_${enabled ? 'on' : 'off'}_${randomBytes(5).toString('hex')}`,
        userId: user.id,
        platform: 'custom',
        webhookUrl: 'https://example.test/hook',
        enabled,
      });
    }

    const frozen = await freezeAccountForClosure(db, {
      userId: user.id,
      requestExternalId: `acl_${randomBytes(10).toString('hex')}`,
      requestedAt: new Date('2026-08-26T04:00:00.000Z'),
    });
    const summary = await applyImmediateClosureEffects(db, {
      requestId: frozen.requestId,
      userId: user.id,
      userExternalId: user.externalId,
    });

    expect(summary.cancelledTaskIds).toHaveLength(2);
    expect(summary.pausedPlannedTaskIds).toHaveLength(1);
    expect(summary.pausedScheduledTaskIds).toHaveLength(1);
    expect(summary.disabledNotificationChannelIds).toHaveLength(1);
    const effects = await db
      .select({
        resourceType: accountClosureEffects.resourceType,
        resourceId: accountClosureEffects.resourceId,
      })
      .from(accountClosureEffects)
      .where(eq(accountClosureEffects.requestId, frozen.requestId));
    expect(effects).toHaveLength(5);
    expect(effects.map((effect) => effect.resourceType).sort()).toEqual([
      'notification_channel',
      'planned_task',
      'scheduled_task',
      'task',
      'task',
    ]);
    const retrySummary = await applyImmediateClosureEffects(db, {
      requestId: frozen.requestId,
      userId: user.id,
      userExternalId: user.externalId,
    });
    expect(retrySummary.cancelledTaskIds).toHaveLength(2);
    expect(retrySummary.pausedPlannedTaskIds).toEqual([]);
    expect(retrySummary.pausedScheduledTaskIds).toEqual([]);
    expect(retrySummary.disabledNotificationChannelIds).toEqual([]);
    const effectsAfterRetry = await db
      .select({ id: accountClosureEffects.id })
      .from(accountClosureEffects)
      .where(eq(accountClosureEffects.requestId, frozen.requestId));
    expect(effectsAfterRetry).toHaveLength(5);
    const cancellationEvents = await db
      .select({ type: taskEvents.type })
      .from(taskEvents)
      .where(eq(taskEvents.type, 'task.cancelled'));
    expect(cancellationEvents).toHaveLength(2);

    const changedPlanEffect = effects.find((effect) => effect.resourceType === 'planned_task');
    if (!changedPlanEffect) throw new Error('expected a planned-task effect');
    const [changedPlan] = await db
      .select({ id: plannedTasks.id })
      .from(plannedTasks)
      .where(eq(plannedTasks.externalId, changedPlanEffect.resourceId));
    if (!changedPlan) throw new Error('expected a paused planned task');
    await db
      .update(plannedTasks)
      .set({ status: 'archived' })
      .where(eq(plannedTasks.id, changedPlan.id));

    await withdrawAccountClosureRequest(db, {
      requestId: frozen.requestId,
      userId: user.id,
      now: new Date('2026-08-27T04:00:00.000Z'),
    });
    await restoreImmediateClosureEffects(db, { requestId: frozen.requestId, userId: user.id });

    const taskStates = await db
      .select({ status: tasks.status })
      .from(tasks)
      .where(eq(tasks.userId, user.id));
    expect(taskStates.filter((task) => task.status === 'cancelled')).toHaveLength(3);
    expect(taskStates.filter((task) => task.status === 'completed')).toHaveLength(1);
    const plannedStates = await db
      .select({ status: plannedTasks.status })
      .from(plannedTasks)
      .where(eq(plannedTasks.userId, user.id));
    expect(plannedStates.map((row) => row.status).sort()).toEqual(['archived', 'paused']);
    const scheduledStates = await db
      .select({ status: scheduledTasks.status })
      .from(scheduledTasks)
      .where(eq(scheduledTasks.userId, user.id));
    expect(scheduledStates.map((row) => row.status).sort()).toEqual(['active', 'paused']);
    const channels = await db
      .select({ enabled: notificationChannels.enabled })
      .from(notificationChannels)
      .where(eq(notificationChannels.userId, user.id));
    expect(channels.map((row) => row.enabled).sort()).toEqual([false, true]);
    const [restoredUser] = await db
      .select({ status: users.status, planExpiresAt: users.planExpiresAt })
      .from(users)
      .where(eq(users.id, user.id));
    expect(restoredUser).toEqual({ status: 'active', planExpiresAt });
    const [quota] = await db
      .select({ tasksUsed: taskQuotas.tasksUsed, bonusTasks: taskQuotas.bonusTasks })
      .from(taskQuotas)
      .where(eq(taskQuotas.userId, user.id));
    expect(quota).toEqual({ tasksUsed: 7, bonusTasks: 11 });
    const unrestored = await db
      .select({ restoredAt: accountClosureEffects.restoredAt })
      .from(accountClosureEffects)
      .where(
        and(
          eq(accountClosureEffects.requestId, frozen.requestId),
          eq(accountClosureEffects.resourceType, 'planned_task'),
        ),
      );
    expect(unrestored[0]?.restoredAt).toBeNull();
  });

  it('lets only withdrawal or processing win and never restores after processing wins', async () => {
    const user = await createUser();
    const frozen = await freezeAccountForClosure(db, {
      userId: user.id,
      requestExternalId: `acl_${randomBytes(10).toString('hex')}`,
      requestedAt: new Date('2026-08-01T00:00:00.000Z'),
    });
    await db.insert(plannedTasks).values({
      externalId: `pln_race_${randomBytes(5).toString('hex')}`,
      userId: user.id,
      title: 'race',
      instruction: 'race',
      firstRunAt: new Date('2026-08-09T00:00:00.000Z'),
      nextRunAt: new Date('2026-08-09T00:00:00.000Z'),
      status: 'active',
    });
    await applyImmediateClosureEffects(db, {
      requestId: frozen.requestId,
      userId: user.id,
      userExternalId: user.externalId,
    });

    const claimed = await claimClosureRequestForProcessing(db, {
      requestId: frozen.requestId,
      userId: user.id,
      now: frozen.graceEndsAt,
    });
    expect(claimed).toBe(true);
    await expect(
      withdrawAccountClosureRequest(db, {
        requestId: frozen.requestId,
        userId: user.id,
        now: new Date(frozen.graceEndsAt.getTime() - 1),
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        code: 'DEADLINE_PASSED_OR_PROCESSING',
      }),
    );
    await restoreImmediateClosureEffects(db, { requestId: frozen.requestId, userId: user.id });
    const [plan] = await db
      .select({ status: plannedTasks.status })
      .from(plannedTasks)
      .where(eq(plannedTasks.userId, user.id));
    expect(plan?.status).toBe('paused');
    const [effect] = await db
      .select({ restoredAt: accountClosureEffects.restoredAt })
      .from(accountClosureEffects)
      .where(eq(accountClosureEffects.requestId, frozen.requestId));
    expect(effect?.restoredAt).toBeNull();
  });
});
