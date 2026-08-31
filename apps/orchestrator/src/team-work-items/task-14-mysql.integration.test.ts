import { newExternalId } from '@holaday/shared-types';
import { drizzle } from 'drizzle-orm/mysql2';
import mysql, { type Pool, type ResultSetHeader, type RowDataPacket } from 'mysql2/promise';
import type { Logger } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { env as appEnv } from '../config/env.js';
import type { DB } from '../db/client.js';
import * as schema from '../db/schema/index.js';
import { FileService } from '../files/file-service.js';
import type { StorageProvider } from '../files/storage-provider.js';
import { projectsRouter } from '../trpc/routers/projects.js';
import { tasksRouter } from '../trpc/routers/tasks.js';
import type { AcceptanceContractInput } from './acceptance-contract.js';
import {
  type AppealReceipt,
  DrizzleAppealRepository,
  TeamTaskAppealService,
} from './team-task-appeal-service.js';
import {
  DrizzlePlanningRepository,
  TeamTaskPlanningService,
} from './team-task-planning-service.js';
import { DrizzleTeamTaskQueryRepository, TeamTaskQueryService } from './team-task-query-service.js';
import {
  DrizzleReviewRepository,
  type ReviewReceipt,
  TeamTaskReviewService,
} from './team-task-review-service.js';
import { DrizzleTeamTaskRepository, TeamTaskService } from './team-task-service.js';

const LOCK_WAIT_TIMEOUT_SECONDS = 5;
const TEST_TIMEOUT_MS = 30_000;
const NOW = '2026-08-31T03:00:00.000Z';
const DUE_AT = '2026-09-03T03:00:00.000Z';

type IntegrationTarget = {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
};

type Person = {
  id: number;
  externalId: string;
  organizationMemberId: string;
  projectMemberId: string;
};

type Tenant = {
  organizationId: number;
  organizationExternalId: string;
  projectId: number;
  projectExternalId: string;
  lead: Person;
  firstMember: Person;
  secondMember: Person;
  approver: Person;
  arbitrator: Person;
};

type CountRow = RowDataPacket & { count: number };
type LockWaitRow = RowDataPacket & {
  waitingThreadId: number;
  blockingThreadId: number;
};
type WorkItemStateRow = RowDataPacket & {
  status: string;
  version: number;
  currentContractVersionId: number | null;
};

type ActiveWorkItem = {
  externalId: string;
  internalId: number;
  contractExternalId: string;
  contractInternalId: number;
  assignmentExternalId: string;
  version: number;
};

function parseIntegrationTarget(): IntegrationTarget | null {
  const rawUrl = process.env.MYSQL_URL;
  if (!rawUrl) return null;
  const parsed = new URL(rawUrl);
  const database = parsed.pathname.slice(1);
  const port = Number(parsed.port);
  if (
    parsed.protocol !== 'mysql:' ||
    parsed.hostname !== '127.0.0.1' ||
    !Number.isSafeInteger(port) ||
    port < 1 ||
    port === 3306 ||
    !parsed.username ||
    !parsed.password ||
    !/task14/i.test(database) ||
    !/test/i.test(database)
  ) {
    throw new Error('MYSQL_URL must target the isolated loopback Task 14 test database');
  }
  return {
    host: parsed.hostname,
    port,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database,
  };
}

const target = parseIntegrationTarget();
const integrationDescribe = target ? describe.sequential : describe.skip;

function errorCode(error: unknown): unknown {
  return error && typeof error === 'object' && 'code' in error
    ? (error as { code?: unknown }).code
    : undefined;
}

async function insertRow(pool: Pool, sql: string, values: readonly unknown[]): Promise<number> {
  const [result] = await pool.execute<ResultSetHeader>(sql, [...values]);
  expect(result.affectedRows).toBe(1);
  expect(result.insertId).toBeGreaterThan(0);
  return result.insertId;
}

function assertSubmissionReceipt(
  receipt: ReviewReceipt,
): asserts receipt is Extract<ReviewReceipt, { command: 'submit' | 'resubmit' }> {
  expect(['submit', 'resubmit']).toContain(receipt.command);
}

function assertReviewReceipt(
  receipt: ReviewReceipt,
): asserts receipt is Extract<
  ReviewReceipt,
  { command: 'accept_submission' | 'request_revision' }
> {
  expect(['accept_submission', 'request_revision']).toContain(receipt.command);
}

function assertAppealReceipt(
  receipt: AppealReceipt,
): asserts receipt is Extract<AppealReceipt, { appealId: string }> {
  expect('appealId' in receipt).toBe(true);
}

integrationDescribe('Task 14 real-MySQL lifecycle races', () => {
  let pool: Pool;
  let db: DB;
  const logger = {
    info() {},
    warn() {},
    error() {},
    debug() {},
    child() {
      return this;
    },
  } as unknown as Logger;

  function taskService() {
    return new TeamTaskService(new DrizzleTeamTaskRepository(db), {
      now: () => NOW,
      isLifecycleEnabled: () => true,
      newId: (kind) => newExternalId(kind),
    });
  }

  function planningService() {
    return new TeamTaskPlanningService(new DrizzlePlanningRepository(db), {
      now: () => NOW,
      isLifecycleEnabled: () => true,
      maxTraversalNodes: 500,
      maxTraversalEdges: 2_000,
      newId: (kind) => newExternalId(kind),
    });
  }

  function reviewService() {
    return new TeamTaskReviewService(new DrizzleReviewRepository(db), {
      now: () => NOW,
      isLifecycleEnabled: () => true,
      newId: (kind) => newExternalId(kind),
    });
  }

  function reviewServiceWithReviewId(reviewId: string) {
    return new TeamTaskReviewService(new DrizzleReviewRepository(db), {
      now: () => NOW,
      isLifecycleEnabled: () => true,
      newId: (kind) => (kind === 'teamReview' ? reviewId : newExternalId(kind)),
    });
  }

  function queryService() {
    return new TeamTaskQueryService(new DrizzleTeamTaskQueryRepository(db), {
      isLifecycleEnabled: () => true,
    });
  }

  function appealService() {
    return new TeamTaskAppealService(new DrizzleAppealRepository(db), {
      now: () => NOW,
      isLifecycleEnabled: () => true,
      appealWindowMs: 7 * 24 * 60 * 60 * 1_000,
      reviewSlaMs: 24 * 60 * 60 * 1_000,
      appealSlaMs: 24 * 60 * 60 * 1_000,
      newId: (kind) => newExternalId(kind),
    });
  }

  async function createUser(label: string): Promise<{ id: number; externalId: string }> {
    const externalId = newExternalId('user');
    const id = await insertRow(
      pool,
      'INSERT INTO users (external_id, email, password_hash) VALUES (?, ?, ?)',
      [externalId, `${label}-${externalId}@task14.integration.test`, 'integration-test-only'],
    );
    return { id, externalId };
  }

  async function createTenant(label: string): Promise<Tenant> {
    const rawPeople = await Promise.all([
      createUser(`${label}-lead`),
      createUser(`${label}-first`),
      createUser(`${label}-second`),
      createUser(`${label}-approver`),
      createUser(`${label}-arbitrator`),
    ]);
    const [leadRaw, firstRaw, secondRaw, approverRaw, arbitratorRaw] = rawPeople;
    if (!leadRaw || !firstRaw || !secondRaw || !approverRaw || !arbitratorRaw) {
      throw new Error('Task 14 tenant fixture is incomplete');
    }
    const organizationExternalId = newExternalId('organization');
    const organizationId = await insertRow(
      pool,
      'INSERT INTO organizations (external_id, name, owner_user_id, status, team_projects_enabled) VALUES (?, ?, ?, ?, ?)',
      [organizationExternalId, `Task 14 ${label}`, leadRaw.id, 'active', true],
    );
    const projectExternalId = newExternalId('project');
    const projectId = await insertRow(
      pool,
      'INSERT INTO projects (external_id, user_id, organization_id, name) VALUES (?, ?, ?, ?)',
      [projectExternalId, leadRaw.id, organizationId, `Task 14 ${label} project`],
    );

    async function attach(
      raw: { id: number; externalId: string },
      organizationRole: 'owner' | 'manager' | 'member',
      projectRole: 'lead' | 'member',
    ): Promise<Person> {
      const organizationMemberId = newExternalId('organizationMember');
      await insertRow(
        pool,
        'INSERT INTO organization_members (external_id, organization_id, user_id, role, status) VALUES (?, ?, ?, ?, ?)',
        [organizationMemberId, organizationId, raw.id, organizationRole, 'active'],
      );
      const projectMemberId = newExternalId('projectMember');
      await insertRow(
        pool,
        'INSERT INTO project_members (external_id, project_id, user_id, role, status) VALUES (?, ?, ?, ?, ?)',
        [projectMemberId, projectId, raw.id, projectRole, 'active'],
      );
      return { ...raw, organizationMemberId, projectMemberId };
    }

    const [lead, firstMember, secondMember, approver, arbitrator] = await Promise.all([
      attach(leadRaw, 'owner', 'lead'),
      attach(firstRaw, 'member', 'member'),
      attach(secondRaw, 'member', 'member'),
      attach(approverRaw, 'manager', 'lead'),
      attach(arbitratorRaw, 'member', 'member'),
    ]);
    return {
      organizationId,
      organizationExternalId,
      projectId,
      projectExternalId,
      lead,
      firstMember,
      secondMember,
      approver,
      arbitrator,
    };
  }

  function contract(tenant: Tenant): AcceptanceContractInput {
    return {
      objective: '完成可核验的 Task 14 交付',
      deliverables: ['Task 14 report'],
      criteria: [{ id: 'criterion-1', description: '提供一份可核验的结果' }],
      requiredEvidenceTypes: [{ type: 'report' }],
      approverId: tenant.approver.organizationMemberId,
      arbitratorId: tenant.arbitrator.organizationMemberId,
      dueAt: DUE_AT,
      maxRevisionRounds: 2,
    };
  }

  async function count(
    table: string,
    organizationId: number,
    extraWhere = '',
    extraValues: readonly unknown[] = [],
  ): Promise<number> {
    const [rows] = await pool.execute<CountRow[]>(
      `SELECT COUNT(*) AS count FROM ${table} WHERE organization_id = ? ${extraWhere}`,
      [organizationId, ...extraValues],
    );
    return Number(rows[0]?.count ?? 0);
  }

  async function workItemState(workItemExternalId: string): Promise<WorkItemStateRow> {
    const [rows] = await pool.execute<WorkItemStateRow[]>(
      'SELECT status, version, current_contract_version_id AS currentContractVersionId FROM team_work_items WHERE external_id = ?',
      [workItemExternalId],
    );
    const row = rows[0];
    if (!row) throw new Error('Task 14 work item fixture vanished');
    return row;
  }

  async function connectionId(connection: mysql.Connection): Promise<number> {
    const [rows] = await connection.query<Array<RowDataPacket & { threadId: number }>>(
      'SELECT CONNECTION_ID() AS threadId',
    );
    const threadId = Number(rows[0]?.threadId);
    if (!Number.isSafeInteger(threadId) || threadId < 1) {
      throw new Error('Task 14 MySQL connection id is unavailable');
    }
    return threadId;
  }

  async function waitForLockWaiter(input: {
    blockingThreadIds: readonly number[];
    excludeWaitingThreadIds?: readonly number[];
  }): Promise<number> {
    const deadline = Date.now() + 5_000;
    const excluded = new Set(input.excludeWaitingThreadIds ?? []);
    while (Date.now() < deadline) {
      const [rows] = await pool.execute<LockWaitRow[]>(
        `SELECT requesting.PROCESSLIST_ID AS waitingThreadId,
                blocking.PROCESSLIST_ID AS blockingThreadId
           FROM performance_schema.data_lock_waits AS waits
           INNER JOIN performance_schema.threads AS requesting
             ON requesting.THREAD_ID = waits.REQUESTING_THREAD_ID
           INNER JOIN performance_schema.threads AS blocking
             ON blocking.THREAD_ID = waits.BLOCKING_THREAD_ID`,
      );
      const match = rows.find(
        (row) =>
          input.blockingThreadIds.includes(Number(row.blockingThreadId)) &&
          !excluded.has(Number(row.waitingThreadId)),
      );
      if (match) return Number(match.waitingThreadId);
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('expected Task 14 MySQL row-lock wait was not observed');
  }

  async function createActiveWorkItem(tenant: Tenant, label: string): Promise<ActiveWorkItem> {
    const tasks = taskService();
    const draft = await tasks.createDraft({
      actorExternalId: tenant.lead.externalId,
      projectExternalId: tenant.projectExternalId,
      title: `Task 14 ${label}`,
      description: null,
      assignmentMode: 'direct',
      expectedVersion: 0,
      idempotencyKey: `task14-${label}-draft`,
    });
    const published = await tasks.publish({
      actorExternalId: tenant.lead.externalId,
      workItemExternalId: draft.workItemId,
      contract: contract(tenant),
      expectedVersion: 1,
      idempotencyKey: `task14-${label}-publish`,
    });
    const offered = await tasks.offerAssignment({
      actorExternalId: tenant.lead.externalId,
      workItemExternalId: draft.workItemId,
      targetMemberExternalId: tenant.firstMember.organizationMemberId,
      role: 'responsible',
      expectedVersion: 2,
      idempotencyKey: `task14-${label}-offer`,
    });
    if (!offered.assignmentId) throw new Error('Task 14 assignment fixture is incomplete');
    await tasks.respondToAssignment({
      actorExternalId: tenant.firstMember.externalId,
      workItemExternalId: draft.workItemId,
      assignmentExternalId: offered.assignmentId,
      response: 'accept',
      expectedVersion: 3,
      idempotencyKey: `task14-${label}-accept`,
    });
    const started = await planningService().start({
      actorExternalId: tenant.firstMember.externalId,
      workItemExternalId: draft.workItemId,
      expectedVersion: 4,
      idempotencyKey: `task14-${label}-start`,
    });
    const [rows] = await pool.execute<Array<RowDataPacket & { id: number; contractId: number }>>(
      'SELECT id, current_contract_version_id AS contractId FROM team_work_items WHERE external_id = ?',
      [draft.workItemId],
    );
    const row = rows[0];
    if (!row?.contractId || !published.contractVersionId) {
      throw new Error('Task 14 active work item fixture is incomplete');
    }
    return {
      externalId: draft.workItemId,
      internalId: row.id,
      contractExternalId: published.contractVersionId,
      contractInternalId: row.contractId,
      assignmentExternalId: offered.assignmentId,
      version: started.version,
    };
  }

  beforeAll(async () => {
    if (!target) return;
    pool = mysql.createPool({
      ...target,
      connectionLimit: 12,
      multipleStatements: false,
      connectTimeout: 5_000,
    });
    pool.on('connection', (connection) => {
      connection.query(`SET SESSION innodb_lock_wait_timeout = ${LOCK_WAIT_TIMEOUT_SECONDS}`);
    });
    const [databaseRows] = await pool.query<Array<RowDataPacket & { databaseName: string }>>(
      'SELECT DATABASE() AS databaseName',
    );
    expect(databaseRows[0]?.databaseName).toBe(target.database);
    db = drizzle(pool, { schema, mode: 'default', casing: 'snake_case' }) as unknown as DB;
  });

  afterAll(async () => {
    if (pool) await pool.end();
  });

  it(
    'gives one real first-come claimant the canonical assignment without an orphan',
    async () => {
      const tenant = await createTenant('first-come');
      const service = taskService();
      const draft = await service.createDraft({
        actorExternalId: tenant.lead.externalId,
        projectExternalId: tenant.projectExternalId,
        title: 'First come race',
        description: null,
        assignmentMode: 'first_come',
        expectedVersion: 0,
        idempotencyKey: 'task14-first-come-draft',
      });
      const published = await service.publish({
        actorExternalId: tenant.lead.externalId,
        workItemExternalId: draft.workItemId,
        contract: contract(tenant),
        expectedVersion: 1,
        idempotencyKey: 'task14-first-come-publish',
      });
      expect(published).toMatchObject({ state: 'claimable', version: 2 });

      const outcomes = await Promise.allSettled([
        service.claim({
          actorExternalId: tenant.firstMember.externalId,
          workItemExternalId: draft.workItemId,
          memberExternalId: tenant.firstMember.organizationMemberId,
          expectedVersion: 2,
          idempotencyKey: 'task14-first-come-a',
        }),
        service.claim({
          actorExternalId: tenant.secondMember.externalId,
          workItemExternalId: draft.workItemId,
          memberExternalId: tenant.secondMember.organizationMemberId,
          expectedVersion: 2,
          idempotencyKey: 'task14-first-come-b',
        }),
      ]);

      expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
      const loser = outcomes.find((outcome) => outcome.status === 'rejected');
      if (loser?.status !== 'rejected') throw new Error('missing first-come loser');
      expect(errorCode(loser.reason)).toBe('CONFLICT');
      expect(await workItemState(draft.workItemId)).toMatchObject({
        status: 'accepted_by_member',
        version: 3,
      });
      expect(
        await count(
          'team_work_item_assignments',
          tenant.organizationId,
          "AND role = 'responsible' AND status = 'accepted'",
        ),
      ).toBe(1);
      expect(
        await count(
          'team_work_item_events',
          tenant.organizationId,
          "AND event_type = 'task_claimed'",
        ),
      ).toBe(1);
      const [orphanRows] = await pool.execute<CountRow[]>(
        'SELECT COUNT(*) AS count FROM team_work_item_assignments a LEFT JOIN team_work_items w ON w.id = a.work_item_id AND w.organization_id = a.organization_id AND w.project_id = a.project_id WHERE a.organization_id = ? AND w.id IS NULL',
        [tenant.organizationId],
      );
      expect(Number(orphanRows[0]?.count ?? 0)).toBe(0);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'replays concurrent duplicate publish as one contract and one receipt event',
    async () => {
      const tenant = await createTenant('publish-replay');
      const service = taskService();
      const draft = await service.createDraft({
        actorExternalId: tenant.lead.externalId,
        projectExternalId: tenant.projectExternalId,
        title: 'Publish replay',
        description: null,
        assignmentMode: 'direct',
        expectedVersion: 0,
        idempotencyKey: 'task14-publish-draft',
      });
      const input = {
        actorExternalId: tenant.lead.externalId,
        workItemExternalId: draft.workItemId,
        contract: contract(tenant),
        expectedVersion: 1,
        idempotencyKey: 'task14-publish-same-key',
      } as const;

      const [first, replay] = await Promise.all([service.publish(input), service.publish(input)]);

      expect(replay).toEqual(first);
      expect(await workItemState(draft.workItemId)).toMatchObject({ status: 'ready', version: 2 });
      expect(await count('acceptance_contract_versions', tenant.organizationId)).toBe(1);
      expect(
        await count(
          'team_work_item_events',
          tenant.organizationId,
          "AND event_type = 'task_published'",
        ),
      ).toBe(1);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'replays concurrent duplicate submission without an orphan submission',
    async () => {
      const tenant = await createTenant('submit-replay');
      const workItem = await createActiveWorkItem(tenant, 'submit-replay');
      const service = reviewService();
      const input = {
        actorId: tenant.firstMember.externalId,
        workItemId: workItem.externalId,
        expectedVersion: workItem.version,
        idempotencyKey: 'task14-submit-same-key',
        summary: 'Task 14 concurrent submission result',
        deliverables: ['Task 14 report'],
      } as const;

      const [first, replay] = await Promise.all([service.submit(input), service.submit(input)]);

      expect(replay).toEqual(first);
      expect(first).toMatchObject({ command: 'submit', state: 'submitted', version: 6 });
      expect(await count('team_work_item_submissions', tenant.organizationId)).toBe(1);
      expect(
        await count(
          'team_work_item_events',
          tenant.organizationId,
          "AND event_type = 'task_submitted'",
        ),
      ).toBe(1);
      const [orphanRows] = await pool.execute<CountRow[]>(
        'SELECT COUNT(*) AS count FROM team_work_item_submissions s LEFT JOIN team_work_items w ON w.id = s.work_item_id AND w.organization_id = s.organization_id AND w.project_id = s.project_id LEFT JOIN acceptance_contract_versions c ON c.id = s.contract_version_id AND c.work_item_id = s.work_item_id AND c.organization_id = s.organization_id AND c.project_id = s.project_id WHERE s.organization_id = ? AND (w.id IS NULL OR c.id IS NULL)',
        [tenant.organizationId],
      );
      expect(Number(orphanRows[0]?.count ?? 0)).toBe(0);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'replays concurrent duplicate accepted review as one canonical review',
    async () => {
      const tenant = await createTenant('review-replay');
      const workItem = await createActiveWorkItem(tenant, 'review-replay');
      const service = reviewService();
      const submission = await service.submit({
        actorId: tenant.firstMember.externalId,
        workItemId: workItem.externalId,
        expectedVersion: workItem.version,
        idempotencyKey: 'task14-review-submit',
        summary: 'Task 14 review submission',
        deliverables: ['Task 14 report'],
      });
      assertSubmissionReceipt(submission);
      const input = {
        actorId: tenant.approver.externalId,
        workItemId: workItem.externalId,
        submissionId: submission.submissionId,
        expectedVersion: submission.version,
        idempotencyKey: 'task14-review-same-key',
        decision: 'accepted',
        rationale: 'The required result and evidence are present.',
      } as const;

      const [first, replay] = await Promise.all([service.review(input), service.review(input)]);

      expect(replay).toEqual(first);
      expect(first).toMatchObject({ command: 'accept_submission', state: 'accepted', version: 7 });
      expect(await count('team_work_item_reviews', tenant.organizationId)).toBe(1);
      expect(
        await count(
          'team_work_item_events',
          tenant.organizationId,
          "AND event_type = 'submission_accepted'",
        ),
      ).toBe(1);
      const [orphanRows] = await pool.execute<CountRow[]>(
        'SELECT COUNT(*) AS count FROM team_work_item_reviews r LEFT JOIN team_work_items w ON w.id = r.work_item_id AND w.organization_id = r.organization_id AND w.project_id = r.project_id LEFT JOIN team_work_item_submissions s ON s.id = r.submission_id AND s.work_item_id = r.work_item_id AND s.organization_id = r.organization_id AND s.project_id = r.project_id WHERE r.organization_id = ? AND (w.id IS NULL OR s.id IS NULL)',
        [tenant.organizationId],
      );
      expect(Number(orphanRows[0]?.count ?? 0)).toBe(0);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'serializes a request-revision review before an appeal started during its commit',
    async () => {
      const tenant = await createTenant('review-appeal-race');
      const workItem = await createActiveWorkItem(tenant, 'review-appeal-race');
      const reviews = reviewService();
      const submission = await reviews.submit({
        actorId: tenant.firstMember.externalId,
        workItemId: workItem.externalId,
        expectedVersion: workItem.version,
        idempotencyKey: 'task14-race-submit',
        summary: 'Task 14 initial result',
        deliverables: ['Task 14 report'],
      });
      assertSubmissionReceipt(submission);
      const reviewId = newExternalId('teamReview');
      const blocker = await mysql.createConnection(target as IntegrationTarget);
      let reviewOutcome: PromiseSettledResult<ReviewReceipt> | undefined;
      let appealOutcome: PromiseSettledResult<AppealReceipt> | undefined;
      try {
        await blocker.beginTransaction();
        await blocker.execute('SELECT id FROM team_work_items WHERE id = ? FOR UPDATE', [
          workItem.internalId,
        ]);
        const blockerThreadId = await connectionId(blocker);
        const reviewPromise = reviewServiceWithReviewId(reviewId).review({
          actorId: tenant.approver.externalId,
          workItemId: workItem.externalId,
          submissionId: submission.submissionId,
          expectedVersion: submission.version,
          idempotencyKey: 'task14-race-review',
          decision: 'request_revision',
          rationale: 'Criterion one needs a clearer artifact.',
          failedCriterionIds: ['criterion-1'],
          evidenceReferences: [{ kind: 'evidence', reference: 'artifact://task14/first' }],
          revisionInstructions: ['Attach the revised Task 14 report.'],
          newDeadline: '2026-09-04T03:00:00.000Z',
        });
        const reviewThreadId = await waitForLockWaiter({ blockingThreadIds: [blockerThreadId] });
        const appealPromise = appealService().appeal({
          actorId: tenant.firstMember.externalId,
          workItemId: workItem.externalId,
          submissionId: submission.submissionId,
          reviewId,
          expectedVersion: submission.version + 1,
          idempotencyKey: 'task14-race-appeal',
          disputeType: 'criterion_application',
          grounds: 'The review applied criterion one incorrectly.',
        });
        await waitForLockWaiter({
          blockingThreadIds: [blockerThreadId, reviewThreadId],
          excludeWaitingThreadIds: [reviewThreadId],
        });
        await blocker.commit();
        [reviewOutcome, appealOutcome] = await Promise.allSettled([reviewPromise, appealPromise]);
      } finally {
        await blocker.rollback().catch(() => undefined);
        await blocker.end();
      }

      expect(reviewOutcome?.status).toBe('fulfilled');
      expect(appealOutcome?.status).toBe('fulfilled');
      expect(await workItemState(workItem.externalId)).toMatchObject({
        status: 'revision_requested',
        version: submission.version + 2,
      });
      expect(await count('team_work_item_reviews', tenant.organizationId)).toBe(1);
      expect(await count('team_work_item_appeals', tenant.organizationId)).toBe(1);
      expect(
        await count(
          'team_work_item_events',
          tenant.organizationId,
          "AND event_type IN ('submission_revision_requested', 'task_appealed')",
        ),
      ).toBe(2);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'replays concurrent duplicate arbitration as one decision and event',
    async () => {
      const tenant = await createTenant('arbitration-replay');
      const workItem = await createActiveWorkItem(tenant, 'arbitration-replay');
      const reviews = reviewService();
      const submission = await reviews.submit({
        actorId: tenant.firstMember.externalId,
        workItemId: workItem.externalId,
        expectedVersion: workItem.version,
        idempotencyKey: 'task14-arbitration-submit',
        summary: 'Task 14 arbitration submission',
        deliverables: ['Task 14 report'],
      });
      assertSubmissionReceipt(submission);
      const review = await reviews.review({
        actorId: tenant.approver.externalId,
        workItemId: workItem.externalId,
        submissionId: submission.submissionId,
        expectedVersion: submission.version,
        idempotencyKey: 'task14-arbitration-review',
        decision: 'request_revision',
        rationale: 'Criterion one requires arbitration.',
        failedCriterionIds: ['criterion-1'],
        evidenceReferences: [{ kind: 'evidence', reference: 'artifact://task14/review' }],
        revisionInstructions: ['Provide a neutral ruling.'],
        newDeadline: '2026-09-04T03:00:00.000Z',
      });
      assertReviewReceipt(review);
      const appeals = appealService();
      const appeal = await appeals.appeal({
        actorId: tenant.firstMember.externalId,
        workItemId: workItem.externalId,
        submissionId: submission.submissionId,
        reviewId: review.reviewId,
        expectedVersion: review.version,
        idempotencyKey: 'task14-arbitration-appeal',
        disputeType: 'criterion_application',
        grounds: 'The submission evidence directly satisfies criterion one.',
      });
      assertAppealReceipt(appeal);
      const input = {
        actorId: tenant.arbitrator.externalId,
        workItemId: workItem.externalId,
        submissionId: submission.submissionId,
        reviewId: review.reviewId,
        appealId: appeal.appealId,
        expectedVersion: appeal.version,
        idempotencyKey: 'task14-arbitration-same-key',
        decision: 'accept_submission',
        criterionIds: ['criterion-1'],
        evidenceReferences: [{ kind: 'evidence', reference: 'artifact://task14/ruling' }],
        rationale: 'The immutable evidence proves the criterion without revision.',
      } as const;

      const [first, replay] = await Promise.all([
        appeals.decideAppeal(input),
        appeals.decideAppeal(input),
      ]);

      expect(replay).toEqual(first);
      expect(first).toMatchObject({
        state: 'accepted',
        version: 9,
        appealStatus: 'appeal_resolved',
      });
      expect(await count('team_arbitration_decisions', tenant.organizationId)).toBe(1);
      expect(
        await count(
          'team_work_item_events',
          tenant.organizationId,
          "AND event_type = 'appeal_decided'",
        ),
      ).toBe(1);
      const [orphanRows] = await pool.execute<CountRow[]>(
        'SELECT COUNT(*) AS count FROM team_arbitration_decisions d LEFT JOIN team_work_item_appeals a ON a.id = d.appeal_id AND a.work_item_id = d.work_item_id AND a.organization_id = d.organization_id AND a.project_id = d.project_id LEFT JOIN team_work_items w ON w.id = d.work_item_id AND w.organization_id = d.organization_id AND w.project_id = d.project_id WHERE d.organization_id = ? AND (a.id IS NULL OR w.id IS NULL)',
        [tenant.organizationId],
      );
      expect(Number(orphanRows[0]?.count ?? 0)).toBe(0);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'allows one contract decision and rejects the competing and stale confirmations',
    async () => {
      const tenant = await createTenant('contract-race');
      const workItem = await createActiveWorkItem(tenant, 'contract-race');
      const planning = planningService();
      const pending = await planning.createContractVersion({
        actorExternalId: tenant.lead.externalId,
        workItemExternalId: workItem.externalId,
        contract: { ...contract(tenant), objective: 'Task 14 revised objective' },
        versionNote: 'Task 14 concurrency change',
        expectedVersion: workItem.version,
        idempotencyKey: 'task14-contract-create',
      });

      const outcomes = await Promise.allSettled([
        planning.confirmContractVersion({
          actorExternalId: tenant.firstMember.externalId,
          workItemExternalId: workItem.externalId,
          contractVersionExternalId: pending.contractVersionId,
          expectedVersion: pending.version,
          idempotencyKey: 'task14-contract-confirm',
        }),
        planning.rejectContractVersion({
          actorExternalId: tenant.firstMember.externalId,
          workItemExternalId: workItem.externalId,
          contractVersionExternalId: pending.contractVersionId,
          rejectionReason: 'The revised objective needs another edit.',
          expectedVersion: pending.version,
          idempotencyKey: 'task14-contract-reject',
        }),
      ]);
      expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
      const loser = outcomes.find((outcome) => outcome.status === 'rejected');
      if (loser?.status !== 'rejected') throw new Error('missing contract decision loser');
      expect(['CONFLICT', 'VERSION_CONFLICT']).toContain(errorCode(loser.reason));
      await expect(
        planning.confirmContractVersion({
          actorExternalId: tenant.firstMember.externalId,
          workItemExternalId: workItem.externalId,
          contractVersionExternalId: pending.contractVersionId,
          expectedVersion: pending.version,
          idempotencyKey: 'task14-contract-stale-confirm',
        }),
      ).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
      expect((await workItemState(workItem.externalId)).version).toBe(7);
      expect(
        await count(
          'team_work_item_events',
          tenant.organizationId,
          "AND event_type IN ('contract_version_confirmed', 'contract_version_rejected')",
        ),
      ).toBe(1);
      const [orphanRows] = await pool.execute<CountRow[]>(
        'SELECT COUNT(*) AS count FROM acceptance_contract_versions c LEFT JOIN team_work_items w ON w.id = c.work_item_id AND w.organization_id = c.organization_id AND w.project_id = c.project_id WHERE c.organization_id = ? AND w.id IS NULL',
        [tenant.organizationId],
      );
      expect(Number(orphanRows[0]?.count ?? 0)).toBe(0);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'rejects every substituted cross-tenant public resource identifier',
    async () => {
      const first = await createTenant('cross-tenant-a');
      const second = await createTenant('cross-tenant-b');
      const tasks = taskService();
      const planning = planningService();

      await expect(
        tasks.createDraft({
          actorExternalId: first.lead.externalId,
          projectExternalId: second.projectExternalId,
          title: 'Cross tenant project substitution',
          description: null,
          assignmentMode: 'direct',
          expectedVersion: 0,
          idempotencyKey: 'task14-cross-project',
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });

      const firstDraft = await tasks.createDraft({
        actorExternalId: first.lead.externalId,
        projectExternalId: first.projectExternalId,
        title: 'Cross tenant primary draft',
        description: null,
        assignmentMode: 'direct',
        expectedVersion: 0,
        idempotencyKey: 'task14-cross-first-draft',
      });
      const secondDraft = await tasks.createDraft({
        actorExternalId: second.lead.externalId,
        projectExternalId: second.projectExternalId,
        title: 'Cross tenant foreign draft',
        description: null,
        assignmentMode: 'direct',
        expectedVersion: 0,
        idempotencyKey: 'task14-cross-second-draft',
      });

      await expect(
        queryService().get({
          actorId: first.lead.externalId,
          projectId: first.projectExternalId,
          workItemId: secondDraft.workItemId,
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(
        planning.addDependency({
          actorExternalId: first.lead.externalId,
          workItemExternalId: firstDraft.workItemId,
          dependsOnWorkItemExternalId: secondDraft.workItemId,
          expectedVersion: 1,
          idempotencyKey: 'task14-cross-dependency',
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });

      const foreignMilestone = await planning.createMilestone({
        actorExternalId: second.lead.externalId,
        projectExternalId: second.projectExternalId,
        title: 'Foreign milestone',
        description: null,
        dueAt: null,
        sortOrder: 0,
        expectedVersion: 0,
        idempotencyKey: 'task14-cross-foreign-milestone',
      });
      await expect(
        planning.assignMilestone({
          actorExternalId: first.lead.externalId,
          workItemExternalId: firstDraft.workItemId,
          milestoneExternalId: foreignMilestone.milestoneId,
          expectedVersion: 1,
          idempotencyKey: 'task14-cross-milestone',
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });

      await expect(
        tasks.publish({
          actorExternalId: first.lead.externalId,
          workItemExternalId: firstDraft.workItemId,
          contract: {
            ...contract(first),
            approverId: second.approver.organizationMemberId,
          },
          expectedVersion: 1,
          idempotencyKey: 'task14-cross-contract-approver',
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(
        tasks.publish({
          actorExternalId: first.lead.externalId,
          workItemExternalId: firstDraft.workItemId,
          contract: {
            ...contract(first),
            arbitratorId: second.arbitrator.organizationMemberId,
          },
          expectedVersion: 1,
          idempotencyKey: 'task14-cross-contract-arbitrator',
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(await workItemState(firstDraft.workItemId)).toMatchObject({
        status: 'draft',
        version: 1,
        currentContractVersionId: null,
      });
      expect(await count('acceptance_contract_versions', first.organizationId)).toBe(0);

      const firstPublished = await tasks.publish({
        actorExternalId: first.lead.externalId,
        workItemExternalId: firstDraft.workItemId,
        contract: contract(first),
        expectedVersion: 1,
        idempotencyKey: 'task14-cross-first-publish',
      });
      const secondPublished = await tasks.publish({
        actorExternalId: second.lead.externalId,
        workItemExternalId: secondDraft.workItemId,
        contract: contract(second),
        expectedVersion: 1,
        idempotencyKey: 'task14-cross-second-publish',
      });
      expect(firstPublished.version).toBe(2);
      expect(secondPublished.version).toBe(2);
      await expect(
        tasks.offerAssignment({
          actorExternalId: first.lead.externalId,
          workItemExternalId: firstDraft.workItemId,
          targetMemberExternalId: second.firstMember.organizationMemberId,
          role: 'responsible',
          expectedVersion: 2,
          idempotencyKey: 'task14-cross-member',
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });

      const firstOffer = await tasks.offerAssignment({
        actorExternalId: first.lead.externalId,
        workItemExternalId: firstDraft.workItemId,
        targetMemberExternalId: first.firstMember.organizationMemberId,
        role: 'responsible',
        expectedVersion: 2,
        idempotencyKey: 'task14-cross-first-offer',
      });
      const secondOffer = await tasks.offerAssignment({
        actorExternalId: second.lead.externalId,
        workItemExternalId: secondDraft.workItemId,
        targetMemberExternalId: second.firstMember.organizationMemberId,
        role: 'responsible',
        expectedVersion: 2,
        idempotencyKey: 'task14-cross-second-offer',
      });
      if (!firstOffer.assignmentId || !secondOffer.assignmentId) throw new Error('missing offers');
      await expect(
        tasks.respondToAssignment({
          actorExternalId: first.firstMember.externalId,
          workItemExternalId: firstDraft.workItemId,
          assignmentExternalId: secondOffer.assignmentId,
          response: 'accept',
          expectedVersion: 3,
          idempotencyKey: 'task14-cross-assignment',
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });

      await tasks.respondToAssignment({
        actorExternalId: first.firstMember.externalId,
        workItemExternalId: firstDraft.workItemId,
        assignmentExternalId: firstOffer.assignmentId,
        response: 'accept',
        expectedVersion: 3,
        idempotencyKey: 'task14-cross-first-accept',
      });
      await tasks.respondToAssignment({
        actorExternalId: second.firstMember.externalId,
        workItemExternalId: secondDraft.workItemId,
        assignmentExternalId: secondOffer.assignmentId,
        response: 'accept',
        expectedVersion: 3,
        idempotencyKey: 'task14-cross-second-accept',
      });
      await planning.start({
        actorExternalId: first.firstMember.externalId,
        workItemExternalId: firstDraft.workItemId,
        expectedVersion: 4,
        idempotencyKey: 'task14-cross-first-start',
      });
      await planning.start({
        actorExternalId: second.firstMember.externalId,
        workItemExternalId: secondDraft.workItemId,
        expectedVersion: 4,
        idempotencyKey: 'task14-cross-second-start',
      });

      const firstPending = await planning.createContractVersion({
        actorExternalId: first.lead.externalId,
        workItemExternalId: firstDraft.workItemId,
        contract: { ...contract(first), objective: 'First pending contract' },
        versionNote: 'First tenant revision',
        expectedVersion: 5,
        idempotencyKey: 'task14-cross-first-contract',
      });
      const secondPending = await planning.createContractVersion({
        actorExternalId: second.lead.externalId,
        workItemExternalId: secondDraft.workItemId,
        contract: { ...contract(second), objective: 'Second pending contract' },
        versionNote: 'Second tenant revision',
        expectedVersion: 5,
        idempotencyKey: 'task14-cross-second-contract',
      });
      await expect(
        planning.confirmContractVersion({
          actorExternalId: first.firstMember.externalId,
          workItemExternalId: firstDraft.workItemId,
          contractVersionExternalId: secondPending.contractVersionId,
          expectedVersion: firstPending.version,
          idempotencyKey: 'task14-cross-contract',
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await planning.confirmContractVersion({
        actorExternalId: first.firstMember.externalId,
        workItemExternalId: firstDraft.workItemId,
        contractVersionExternalId: firstPending.contractVersionId,
        expectedVersion: firstPending.version,
        idempotencyKey: 'task14-cross-first-contract-confirm',
      });
      await planning.confirmContractVersion({
        actorExternalId: second.firstMember.externalId,
        workItemExternalId: secondDraft.workItemId,
        contractVersionExternalId: secondPending.contractVersionId,
        expectedVersion: secondPending.version,
        idempotencyKey: 'task14-cross-second-contract-confirm',
      });

      const reviews = reviewService();
      const firstSubmission = await reviews.submit({
        actorId: first.firstMember.externalId,
        workItemId: firstDraft.workItemId,
        expectedVersion: 7,
        idempotencyKey: 'task14-cross-first-submit',
        summary: 'First tenant submission',
        deliverables: ['Task 14 report'],
      });
      const secondSubmission = await reviews.submit({
        actorId: second.firstMember.externalId,
        workItemId: secondDraft.workItemId,
        expectedVersion: 7,
        idempotencyKey: 'task14-cross-second-submit',
        summary: 'Second tenant submission',
        deliverables: ['Task 14 report'],
      });
      assertSubmissionReceipt(firstSubmission);
      assertSubmissionReceipt(secondSubmission);
      await expect(
        reviews.review({
          actorId: first.approver.externalId,
          workItemId: firstDraft.workItemId,
          submissionId: secondSubmission.submissionId,
          expectedVersion: firstSubmission.version,
          idempotencyKey: 'task14-cross-submission',
          decision: 'accepted',
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });

      const firstReview = await reviews.review({
        actorId: first.approver.externalId,
        workItemId: firstDraft.workItemId,
        submissionId: firstSubmission.submissionId,
        expectedVersion: firstSubmission.version,
        idempotencyKey: 'task14-cross-first-review',
        decision: 'request_revision',
        rationale: 'First tenant revision required.',
        failedCriterionIds: ['criterion-1'],
        evidenceReferences: [{ kind: 'evidence', reference: 'artifact://task14/cross-first' }],
        revisionInstructions: ['Revise the first report.'],
        newDeadline: '2026-09-04T03:00:00.000Z',
      });
      const secondReview = await reviews.review({
        actorId: second.approver.externalId,
        workItemId: secondDraft.workItemId,
        submissionId: secondSubmission.submissionId,
        expectedVersion: secondSubmission.version,
        idempotencyKey: 'task14-cross-second-review',
        decision: 'request_revision',
        rationale: 'Second tenant revision required.',
        failedCriterionIds: ['criterion-1'],
        evidenceReferences: [{ kind: 'evidence', reference: 'artifact://task14/cross-second' }],
        revisionInstructions: ['Revise the second report.'],
        newDeadline: '2026-09-04T03:00:00.000Z',
      });
      assertReviewReceipt(firstReview);
      assertReviewReceipt(secondReview);
      await expect(
        appealService().appeal({
          actorId: first.firstMember.externalId,
          workItemId: firstDraft.workItemId,
          submissionId: firstSubmission.submissionId,
          reviewId: secondReview.reviewId,
          expectedVersion: firstReview.version,
          idempotencyKey: 'task14-cross-review',
          disputeType: 'fact',
          grounds: 'A foreign review must never be accepted.',
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });

      const firstAppeal = await appealService().appeal({
        actorId: first.firstMember.externalId,
        workItemId: firstDraft.workItemId,
        submissionId: firstSubmission.submissionId,
        reviewId: firstReview.reviewId,
        expectedVersion: firstReview.version,
        idempotencyKey: 'task14-cross-first-appeal',
        disputeType: 'fact',
        grounds: 'First tenant appeal fixture.',
      });
      const secondAppeal = await appealService().appeal({
        actorId: second.firstMember.externalId,
        workItemId: secondDraft.workItemId,
        submissionId: secondSubmission.submissionId,
        reviewId: secondReview.reviewId,
        expectedVersion: secondReview.version,
        idempotencyKey: 'task14-cross-second-appeal',
        disputeType: 'fact',
        grounds: 'Second tenant appeal fixture.',
      });
      assertAppealReceipt(firstAppeal);
      assertAppealReceipt(secondAppeal);
      await expect(
        appealService().decideAppeal({
          actorId: first.arbitrator.externalId,
          workItemId: firstDraft.workItemId,
          submissionId: firstSubmission.submissionId,
          reviewId: firstReview.reviewId,
          appealId: secondAppeal.appealId,
          expectedVersion: firstAppeal.version,
          idempotencyKey: 'task14-cross-appeal',
          decision: 'uphold_review',
          criterionIds: ['criterion-1'],
          evidenceReferences: [{ kind: 'evidence', reference: 'artifact://task14/cross-ruling' }],
          rationale: 'A foreign appeal must never be accepted.',
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'rejects inactive access both on read and when inactivity commits during a mutation',
    async () => {
      const tenant = await createTenant('inactive-boundary');
      await pool.execute(
        "UPDATE project_members SET status = 'inactive' WHERE external_id = ? AND project_id = ?",
        [tenant.lead.projectMemberId, tenant.projectId],
      );
      await expect(
        queryService().list({
          actorId: tenant.lead.externalId,
          projectId: tenant.projectExternalId,
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await pool.execute(
        "UPDATE project_members SET status = 'active' WHERE external_id = ? AND project_id = ?",
        [tenant.lead.projectMemberId, tenant.projectId],
      );

      const blocker = await mysql.createConnection(target as IntegrationTarget);
      try {
        await blocker.beginTransaction();
        await blocker.execute(
          "UPDATE project_members SET status = 'inactive' WHERE external_id = ? AND project_id = ?",
          [tenant.lead.projectMemberId, tenant.projectId],
        );
        const blockerThreadId = await connectionId(blocker);
        const attempted = taskService()
          .createDraft({
            actorExternalId: tenant.lead.externalId,
            projectExternalId: tenant.projectExternalId,
            title: 'Must not survive inactive commit',
            description: null,
            assignmentMode: 'direct',
            expectedVersion: 0,
            idempotencyKey: 'task14-inactive-commit-draft',
          })
          .then(
            (value) => ({ value, error: null }),
            (error: unknown) => ({ value: null, error }),
          );
        await waitForLockWaiter({ blockingThreadIds: [blockerThreadId] });
        await blocker.commit();
        const outcome = await attempted;
        expect(outcome.value).toBeNull();
        expect(errorCode(outcome.error)).toBe('NOT_FOUND');
        expect(
          await count(
            'team_work_item_events',
            tenant.organizationId,
            "AND idempotency_key = 'task14-inactive-commit-draft'",
          ),
        ).toBe(0);
        expect(
          await count(
            'team_work_items',
            tenant.organizationId,
            "AND title = 'Must not survive inactive commit'",
          ),
        ).toBe(0);
      } finally {
        await blocker.rollback().catch(() => undefined);
        await blocker.end();
        await pool.execute(
          "UPDATE project_members SET status = 'active' WHERE external_id = ? AND project_id = ?",
          [tenant.lead.projectMemberId, tenant.projectId],
        );
      }
    },
    TEST_TIMEOUT_MS,
  );

  it.each([
    ['gate off', false],
    ['gate on', true],
  ] as const)(
    'preserves personal project, task move, and file-library behavior with lifecycle %s',
    async (label, lifecycleEnabled) => {
      const mutableEnv = appEnv as typeof appEnv & { TEAM_TASK_LIFECYCLE_ENABLED: boolean };
      const previousLifecycleValue = mutableEnv.TEAM_TASK_LIFECYCLE_ENABLED;
      mutableEnv.TEAM_TASK_LIFECYCLE_ENABLED = lifecycleEnabled;
      try {
        const user = await createUser(`legacy-${label.replace(' ', '-')}`);
        const projectCaller = projectsRouter.createCaller({
          db,
          userId: user.externalId,
          logger,
        } as never);
        const taskCaller = tasksRouter.createCaller({
          db,
          userId: user.externalId,
          logger,
          taskOrigin: 'user',
        } as never);

        const created = await projectCaller.create({
          name: `Legacy project ${label}`,
          description: 'Task 14 legacy regression',
        });
        expect((await projectCaller.list()).map((project) => project.projectId)).toContain(
          created.projectId,
        );
        await expect(
          projectCaller.rename({ projectId: created.projectId, name: `Renamed ${label}` }),
        ).resolves.toMatchObject({ ok: true, name: `Renamed ${label}` });

        const taskExternalId = newExternalId('task');
        const taskId = await insertRow(
          pool,
          "INSERT INTO tasks (external_id, user_id, status, origin, intent) VALUES (?, ?, 'completed', 'user', ?)",
          [taskExternalId, user.id, `Task 14 legacy ${label}`],
        );
        await expect(
          taskCaller.moveToProject({ taskId: taskExternalId, projectId: created.projectId }),
        ).resolves.toEqual({ ok: true, taskId: taskExternalId, projectId: created.projectId });

        const fileExternalId = newExternalId('file');
        await insertRow(
          pool,
          "INSERT INTO task_files (external_id, user_id, task_id, kind, filename, mimetype, size_bytes, storage_path, status, expires_at) VALUES (?, ?, ?, 'output', 'task14.txt', 'text/plain', 16, ?, 'active', ?)",
          [
            fileExternalId,
            user.id,
            taskId,
            `task14/${fileExternalId}/task14.txt`,
            new Date('2026-09-30T03:00:00.000Z'),
          ],
        );
        const storage = {
          async stat() {
            return { sizeBytes: 16, contentType: 'text/plain' };
          },
        } as unknown as StorageProvider;
        await expect(
          new FileService(db, logger, storage).saveOutputToLibraryForUser(fileExternalId, user.id),
        ).resolves.toBe(true);
        const [fileRows] = await pool.execute<
          Array<RowDataPacket & { kind: string; expiresAt: Date | null }>
        >('SELECT kind, expires_at AS expiresAt FROM task_files WHERE external_id = ?', [
          fileExternalId,
        ]);
        expect(fileRows[0]).toMatchObject({ kind: 'input', expiresAt: null });

        await expect(projectCaller.delete({ projectId: created.projectId })).resolves.toEqual({
          ok: true,
          projectId: created.projectId,
        });
        const [taskRows] = await pool.execute<Array<RowDataPacket & { projectId: number | null }>>(
          'SELECT project_id AS projectId FROM tasks WHERE external_id = ?',
          [taskExternalId],
        );
        expect(taskRows[0]?.projectId).toBeNull();
        expect((await projectCaller.list()).map((project) => project.projectId)).not.toContain(
          created.projectId,
        );
      } finally {
        mutableEnv.TEAM_TASK_LIFECYCLE_ENABLED = previousLifecycleValue;
      }
    },
    TEST_TIMEOUT_MS,
  );
});
