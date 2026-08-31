import { newExternalId } from '@holaday/shared-types';
import { drizzle } from 'drizzle-orm/mysql2';
import mysql, { type Pool, type ResultSetHeader, type RowDataPacket } from 'mysql2/promise';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { DB } from '../db/client.js';
import * as schema from '../db/schema/index.js';
import {
  type AppealRepository,
  type AppealTransaction,
  DrizzleAppealRepository,
  TeamTaskAppealService,
} from './team-task-appeal-service.js';
import { DrizzleReviewRepository, TeamTaskReviewService } from './team-task-review-service.js';

const LOCK_WAIT_TIMEOUT_SECONDS = 5;
const TEST_TIMEOUT_MS = 15_000;
const NOW = '2026-08-31T03:00:00.000Z';
const REVIEWED_AT = '2026-08-30T03:00:00.000Z';
const DUE_AT = '2026-09-02T03:00:00.000Z';
const HOUR_MS = 60 * 60 * 1_000;

type IntegrationTarget = {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
};
type Person = { id: number; externalId: string };
type Fixture = {
  organizationId: number;
  projectId: number;
  creator: Person;
  responsible: Person;
  approver: Person;
  arbitrator: Person;
  workItemId: number;
  workItemExternalId: string;
  contractId: number;
  contractExternalId: string;
  submissionId: number;
  submissionExternalId: string;
  reviewId: number;
  reviewExternalId: string;
};
type CountRow = RowDataPacket & { count: number };
type StateRow = RowDataPacket & { status: string; version: number; revisionRound: number };

function parseIntegrationTarget(): IntegrationTarget | null {
  const rawUrl = process.env.MYSQL_URL;
  if (!rawUrl) return null;
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('MYSQL_URL must be a valid MySQL URL');
  }
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
    !/task9/i.test(database) ||
    !/test/i.test(database)
  ) {
    throw new Error('MYSQL_URL must target the isolated loopback Task 9 test database');
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

class FailingAppealEventRepository implements AppealRepository {
  constructor(private readonly delegate: DrizzleAppealRepository) {}

  transaction<T>(work: (transaction: AppealTransaction) => Promise<T>): Promise<T> {
    return this.delegate.transaction((transaction) => {
      const faulted = new Proxy(transaction, {
        get(targetTransaction, property) {
          if (property === 'appendEvent') {
            return async () => {
              throw new Error('forced Task 9 event persistence failure');
            };
          }
          const value = Reflect.get(targetTransaction, property, targetTransaction);
          return typeof value === 'function' ? value.bind(targetTransaction) : value;
        },
      }) as AppealTransaction;
      return work(faulted);
    });
  }
}

integrationDescribe('Task 9 real-MySQL appeal and review-return boundaries', () => {
  let pool: Pool;
  let db: DB;
  let fixture: Fixture | null = null;

  function appealService(
    input: {
      now?: string;
      repository?: AppealRepository;
      reviewSlaMs?: number;
    } = {},
  ) {
    return new TeamTaskAppealService(input.repository ?? new DrizzleAppealRepository(db), {
      now: () => input.now ?? NOW,
      isLifecycleEnabled: () => true,
      appealWindowMs: 7 * 24 * HOUR_MS,
      reviewSlaMs: input.reviewSlaMs ?? 24 * HOUR_MS,
      appealSlaMs: 24 * HOUR_MS,
    });
  }

  function reviewService(now = NOW) {
    return new TeamTaskReviewService(new DrizzleReviewRepository(db), {
      now: () => now,
      isLifecycleEnabled: () => true,
    });
  }

  async function createPerson(label: string): Promise<Person> {
    const externalId = newExternalId('user');
    const id = await insertRow(
      pool,
      'INSERT INTO users (external_id, email, password_hash) VALUES (?, ?, ?)',
      [externalId, `${label}-${externalId}@task9.integration.test`, 'integration-test-only'],
    );
    return { id, externalId };
  }

  async function createFixture(
    input: {
      status?: 'revision_requested' | 'submitted';
      version?: number;
      revisionRound?: number;
      reviewDecision?: 'request_revision' | 'accepted';
      reviewedAt?: string;
    } = {},
  ): Promise<Fixture> {
    const creator = await createPerson('creator');
    const responsible = await createPerson('responsible');
    const approver = await createPerson('approver');
    const arbitrator = await createPerson('arbitrator');
    const organizationId = await insertRow(
      pool,
      'INSERT INTO organizations (external_id, name, owner_user_id, status, team_projects_enabled) VALUES (?, ?, ?, ?, ?)',
      [newExternalId('organization'), 'Task 9 isolated integration', creator.id, 'active', true],
    );
    for (const [person, role] of [
      [creator, 'owner'],
      [responsible, 'member'],
      [approver, 'manager'],
      [arbitrator, 'member'],
    ] as const) {
      await insertRow(
        pool,
        'INSERT INTO organization_members (external_id, organization_id, user_id, role, status) VALUES (?, ?, ?, ?, ?)',
        [newExternalId('organizationMember'), organizationId, person.id, role, 'active'],
      );
    }
    const projectId = await insertRow(
      pool,
      'INSERT INTO projects (external_id, user_id, organization_id, name) VALUES (?, ?, ?, ?)',
      [newExternalId('project'), creator.id, organizationId, 'Task 9 integration project'],
    );
    for (const [person, role] of [
      [creator, 'lead'],
      [responsible, 'member'],
      [approver, 'member'],
      [arbitrator, 'member'],
    ] as const) {
      await insertRow(
        pool,
        'INSERT INTO project_members (external_id, project_id, user_id, role, status) VALUES (?, ?, ?, ?, ?)',
        [newExternalId('projectMember'), projectId, person.id, role, 'active'],
      );
    }
    const workItemExternalId = newExternalId('teamWorkItem');
    const workItemId = await insertRow(
      pool,
      'INSERT INTO team_work_items (external_id, organization_id, project_id, created_by_user_id, title, assignment_mode, status, version, due_at, revision_round) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        workItemExternalId,
        organizationId,
        projectId,
        creator.id,
        'Task 9 transaction fixture',
        'assigned',
        input.status ?? 'revision_requested',
        input.version ?? 5,
        new Date(DUE_AT),
        input.revisionRound ?? 1,
      ],
    );
    await insertRow(
      pool,
      'INSERT INTO team_work_item_assignments (external_id, organization_id, project_id, work_item_id, user_id, role, status, offered_by_user_id, responded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        newExternalId('teamWorkItemAssignment'),
        organizationId,
        projectId,
        workItemId,
        responsible.id,
        'responsible',
        'accepted',
        creator.id,
        new Date(REVIEWED_AT),
      ],
    );
    const contractExternalId = newExternalId('acceptanceContractVersion');
    const contractId = await insertRow(
      pool,
      'INSERT INTO acceptance_contract_versions (external_id, organization_id, project_id, work_item_id, version, objective, deliverables_json, criteria_json, required_evidence_types_json, approver_user_id, arbitrator_user_id, due_at, max_revision_rounds, created_by_user_id, confirmed_by_user_id, confirmed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        contractExternalId,
        organizationId,
        projectId,
        workItemId,
        1,
        'Prove appeal and return-review transaction behavior',
        JSON.stringify(['artifact']),
        JSON.stringify([{ id: 'criterion-1', description: 'Evidence is complete' }]),
        JSON.stringify(['artifact']),
        approver.id,
        arbitrator.id,
        new Date(DUE_AT),
        2,
        creator.id,
        responsible.id,
        new Date(REVIEWED_AT),
      ],
    );
    await pool.execute('UPDATE team_work_items SET current_contract_version_id = ? WHERE id = ?', [
      contractId,
      workItemId,
    ]);
    const submissionExternalId = newExternalId('teamSubmission');
    const submissionId = await insertRow(
      pool,
      'INSERT INTO team_work_item_submissions (external_id, organization_id, project_id, work_item_id, contract_version_id, submitted_by_user_id, submission_version, summary, deliverables_json, submitted_on_time, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        submissionExternalId,
        organizationId,
        projectId,
        workItemId,
        contractId,
        responsible.id,
        1,
        'Submission for Task 9 integration',
        JSON.stringify(['artifact']),
        true,
        new Date('2026-08-29T03:00:00.000Z'),
      ],
    );
    const reviewExternalId = newExternalId('teamReview');
    const reviewId = await insertRow(
      pool,
      'INSERT INTO team_work_item_reviews (external_id, organization_id, project_id, work_item_id, submission_id, contract_version_id, reviewer_user_id, review_attempt, decision, failed_criterion_ids_json, evidence_refs_json, revision_instructions_json, rationale, new_due_at, reviewed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        reviewExternalId,
        organizationId,
        projectId,
        workItemId,
        submissionId,
        contractId,
        approver.id,
        1,
        input.reviewDecision ?? 'request_revision',
        JSON.stringify(['criterion-1']),
        JSON.stringify([{ kind: 'evidence', reference: 'artifact://initial' }]),
        JSON.stringify(['Address criterion 1']),
        'Initial review rationale',
        new Date(DUE_AT),
        new Date(input.reviewedAt ?? REVIEWED_AT),
      ],
    );
    fixture = {
      organizationId,
      projectId,
      creator,
      responsible,
      approver,
      arbitrator,
      workItemId,
      workItemExternalId,
      contractId,
      contractExternalId,
      submissionId,
      submissionExternalId,
      reviewId,
      reviewExternalId,
    };
    return fixture;
  }

  async function cleanupFixture(): Promise<void> {
    if (!fixture) return;
    const current = fixture;
    await pool.execute(
      'UPDATE team_work_items SET current_contract_version_id = NULL WHERE organization_id = ?',
      [current.organizationId],
    );
    for (const table of [
      'team_work_item_events',
      'team_arbitration_decisions',
      'team_work_item_appeals',
      'team_work_item_reviews',
      'team_work_item_submissions',
      'team_task_review_delegations',
      'acceptance_contract_versions',
      'team_work_item_assignments',
      'team_project_planning_events',
      'team_work_items',
    ]) {
      await pool.execute(`DELETE FROM ${table} WHERE organization_id = ?`, [
        current.organizationId,
      ]);
    }
    await pool.execute('DELETE FROM project_members WHERE project_id = ?', [current.projectId]);
    await pool.execute('DELETE FROM projects WHERE id = ?', [current.projectId]);
    await pool.execute('DELETE FROM organization_members WHERE organization_id = ?', [
      current.organizationId,
    ]);
    await pool.execute('DELETE FROM organizations WHERE id = ?', [current.organizationId]);
    await pool.execute('DELETE FROM users WHERE id IN (?, ?, ?, ?)', [
      current.creator.id,
      current.responsible.id,
      current.approver.id,
      current.arbitrator.id,
    ]);
    fixture = null;
  }

  async function count(table: string, organizationId: number): Promise<number> {
    const allowed = new Set([
      'team_work_item_events',
      'team_work_item_appeals',
      'team_arbitration_decisions',
      'team_work_item_reviews',
    ]);
    if (!allowed.has(table)) throw new Error('unapproved aggregate assertion table');
    const [rows] = await pool.execute<CountRow[]>(
      `SELECT COUNT(*) AS count FROM ${table} WHERE organization_id = ?`,
      [organizationId],
    );
    return rows[0]?.count ?? 0;
  }

  async function state(workItemId: number): Promise<StateRow> {
    const [rows] = await pool.execute<StateRow[]>(
      'SELECT status, version, revision_round AS revisionRound FROM team_work_items WHERE id = ?',
      [workItemId],
    );
    const row = rows[0];
    if (!row) throw new Error('Task 9 fixture work item disappeared');
    return row;
  }

  function appealInput(current: Fixture, key: string, input: Record<string, unknown> = {}) {
    return {
      actorId: current.responsible.externalId,
      workItemId: current.workItemExternalId,
      submissionId: current.submissionExternalId,
      reviewId: current.reviewExternalId,
      expectedVersion: 5,
      idempotencyKey: key,
      disputeType: 'criterion_application',
      grounds: 'The agreed criterion was applied outside its documented scope.',
      ...input,
    };
  }

  function decisionInput(
    current: Fixture,
    appealId: string,
    key: string,
    input: Record<string, unknown> = {},
  ) {
    return {
      actorId: current.arbitrator.externalId,
      workItemId: current.workItemExternalId,
      submissionId: current.submissionExternalId,
      reviewId: current.reviewExternalId,
      appealId,
      expectedVersion: 6,
      idempotencyKey: key,
      decision: 'return_for_review',
      criterionIds: ['criterion-1'],
      evidenceReferences: [{ kind: 'evidence', reference: 'artifact://arbitration' }],
      rationale: 'Return the same immutable submission for an independent second review.',
      ...input,
    };
  }

  beforeAll(async () => {
    if (!target) throw new Error('unreachable skipped Task 9 integration suite');
    pool = mysql.createPool({
      ...target,
      connectionLimit: 12,
      timezone: 'Z',
      dateStrings: false,
      supportBigNumbers: true,
      bigNumberStrings: false,
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
    const [columnRows] = await pool.execute<Array<RowDataPacket & { count: number }>>(
      "SELECT COUNT(*) AS count FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'team_work_item_reviews' AND column_name = 'review_attempt'",
    );
    expect(columnRows[0]?.count).toBe(1);
    db = drizzle(pool, { schema, mode: 'default', casing: 'snake_case' }) as unknown as DB;
  });

  afterEach(async () => {
    await cleanupFixture();
  });

  afterAll(async () => {
    if (pool) await pool.end();
  });

  it(
    'replays same-key appeal and decision while distinct keys have one winner',
    async () => {
      const current = await createFixture();
      const subject = appealService();
      const sameAppeal = appealInput(current, 'task9-appeal-same');
      const [appealFirst, appealReplay] = await Promise.all([
        subject.appeal(sameAppeal),
        subject.appeal(sameAppeal),
      ]);
      expect(appealReplay).toEqual(appealFirst);
      expect(await count('team_work_item_appeals', current.organizationId)).toBe(1);
      expect(await count('team_work_item_events', current.organizationId)).toBe(1);

      if (appealFirst.command !== 'appeal') throw new Error('expected appeal receipt');
      const sameDecision = decisionInput(current, appealFirst.appealId, 'task9-decision-same');
      const [decisionFirst, decisionReplay] = await Promise.all([
        subject.decideAppeal(sameDecision),
        subject.decideAppeal(sameDecision),
      ]);
      expect(decisionReplay).toEqual(decisionFirst);
      expect(await count('team_arbitration_decisions', current.organizationId)).toBe(1);
      expect(await count('team_work_item_events', current.organizationId)).toBe(2);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'permits only one distinct-key appeal and one distinct-key decision at a version',
    async () => {
      const current = await createFixture();
      const subject = appealService();
      const appealOutcomes = await Promise.allSettled([
        subject.appeal(appealInput(current, 'task9-appeal-race-a')),
        subject.appeal(appealInput(current, 'task9-appeal-race-b')),
      ]);
      expect(appealOutcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
      const appealLoser = appealOutcomes.find((outcome) => outcome.status === 'rejected');
      if (appealLoser?.status === 'rejected') {
        expect(errorCode(appealLoser.reason)).toBe('VERSION_CONFLICT');
      }
      const appealWinner = appealOutcomes.find((outcome) => outcome.status === 'fulfilled');
      if (appealWinner?.status !== 'fulfilled' || appealWinner.value.command !== 'appeal') {
        throw new Error('missing appeal race winner');
      }

      const decisionOutcomes = await Promise.allSettled([
        subject.decideAppeal(
          decisionInput(current, appealWinner.value.appealId, 'task9-decision-race-a'),
        ),
        subject.decideAppeal(
          decisionInput(current, appealWinner.value.appealId, 'task9-decision-race-b'),
        ),
      ]);
      expect(decisionOutcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
      const decisionLoser = decisionOutcomes.find((outcome) => outcome.status === 'rejected');
      if (decisionLoser?.status === 'rejected') {
        expect(['VERSION_CONFLICT', 'CONFLICT']).toContain(errorCode(decisionLoser.reason));
      }
      expect(await count('team_work_item_appeals', current.organizationId)).toBe(1);
      expect(await count('team_arbitration_decisions', current.organizationId)).toBe(1);
      expect(await count('team_work_item_events', current.organizationId)).toBe(2);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'allows at most one unresolved appeal across two submissions on one work item',
    async () => {
      const current = await createFixture();
      const secondSubmissionExternalId = newExternalId('teamSubmission');
      const secondSubmissionId = await insertRow(
        pool,
        'INSERT INTO team_work_item_submissions (external_id, organization_id, project_id, work_item_id, contract_version_id, submitted_by_user_id, submission_version, summary, deliverables_json, submitted_on_time, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          secondSubmissionExternalId,
          current.organizationId,
          current.projectId,
          current.workItemId,
          current.contractId,
          current.responsible.id,
          2,
          'Second potential appeal submission',
          JSON.stringify(['artifact-2']),
          true,
          new Date('2026-08-29T04:00:00.000Z'),
        ],
      );
      const secondReviewExternalId = newExternalId('teamReview');
      await insertRow(
        pool,
        'INSERT INTO team_work_item_reviews (external_id, organization_id, project_id, work_item_id, submission_id, contract_version_id, reviewer_user_id, review_attempt, decision, failed_criterion_ids_json, evidence_refs_json, revision_instructions_json, rationale, new_due_at, reviewed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          secondReviewExternalId,
          current.organizationId,
          current.projectId,
          current.workItemId,
          secondSubmissionId,
          current.contractId,
          current.approver.id,
          1,
          'request_revision',
          JSON.stringify(['criterion-1']),
          JSON.stringify([{ kind: 'evidence', reference: 'artifact://second' }]),
          JSON.stringify(['Address criterion 1']),
          'Second review rationale',
          new Date(DUE_AT),
          new Date(REVIEWED_AT),
        ],
      );
      const subject = appealService();
      const outcomes = await Promise.allSettled([
        subject.appeal(appealInput(current, 'task9-overlay-a')),
        subject.appeal(
          appealInput(current, 'task9-overlay-b', {
            submissionId: secondSubmissionExternalId,
            reviewId: secondReviewExternalId,
          }),
        ),
      ]);

      expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
      expect(await count('team_work_item_appeals', current.organizationId)).toBe(1);
      const [rows] = await pool.execute<CountRow[]>(
        "SELECT COUNT(*) AS count FROM team_work_item_appeals WHERE organization_id = ? AND status IN ('appeal_open', 'appeal_reviewing')",
        [current.organizationId],
      );
      expect(rows[0]?.count).toBe(1);
    },
    TEST_TIMEOUT_MS,
  );

  it('creates review attempt 2 after return_for_review without changing revisionRound', async () => {
    const current = await createFixture();
    const task9 = appealService();
    const opened = await task9.appeal(appealInput(current, 'task9-return-open'));
    if (opened.command !== 'appeal') throw new Error('expected appeal receipt');
    const returned = await task9.decideAppeal(
      decisionInput(current, opened.appealId, 'task9-return-decision'),
    );
    expect(returned).toMatchObject({ state: 'submitted', revisionRound: 1, version: 7 });

    const attempt2 = await reviewService().review({
      actorId: current.approver.externalId,
      workItemId: current.workItemExternalId,
      submissionId: current.submissionExternalId,
      expectedVersion: 7,
      idempotencyKey: 'task9-review-attempt-2',
      decision: 'accepted',
      rationale: 'Independent returned review accepted.',
    });
    expect(attempt2).toMatchObject({ reviewAttempt: 2, revisionRound: 1, version: 8 });
    expect(await state(current.workItemId)).toMatchObject({
      status: 'accepted',
      version: 8,
      revisionRound: 1,
    });
    const [attemptRows] = await pool.execute<Array<RowDataPacket & { reviewAttempt: number }>>(
      'SELECT review_attempt AS reviewAttempt FROM team_work_item_reviews WHERE submission_id = ? ORDER BY review_attempt',
      [current.submissionId],
    );
    expect(attemptRows.map((row) => row.reviewAttempt)).toEqual([1, 2]);
    await expect(
      reviewService().review({
        actorId: current.approver.externalId,
        workItemId: current.workItemExternalId,
        submissionId: current.submissionExternalId,
        expectedVersion: 8,
        idempotencyKey: 'task9-review-attempt-3-without-return',
        decision: 'accepted',
        rationale: 'A third attempt has no return authorization.',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await count('team_work_item_reviews', current.organizationId)).toBe(2);
  });

  it('rejects a repeated review when no immutable return authorization exists', async () => {
    const current = await createFixture({ status: 'submitted' });
    await expect(
      reviewService().review({
        actorId: current.approver.externalId,
        workItemId: current.workItemExternalId,
        submissionId: current.submissionExternalId,
        expectedVersion: 5,
        idempotencyKey: 'task9-review-no-return-authorization',
        decision: 'accepted',
        rationale: 'This repeat is not authorized.',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await count('team_work_item_reviews', current.organizationId)).toBe(1);
    expect(await state(current.workItemId)).toMatchObject({ status: 'submitted', version: 5 });
  });

  it('allows review attempts 1 and 2 but rejects duplicate attempt and wrong lineage', async () => {
    const current = await createFixture();
    const insertReview = (externalId: string, workItemId: number, attempt: number) =>
      pool.execute(
        'INSERT INTO team_work_item_reviews (external_id, organization_id, project_id, work_item_id, submission_id, contract_version_id, reviewer_user_id, review_attempt, decision, reviewed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          externalId,
          current.organizationId,
          current.projectId,
          workItemId,
          current.submissionId,
          current.contractId,
          current.approver.id,
          attempt,
          'accepted',
          new Date(NOW),
        ],
      );
    await expect(
      insertReview(newExternalId('teamReview'), current.workItemId, 2),
    ).resolves.toBeDefined();
    await expect(
      insertReview(newExternalId('teamReview'), current.workItemId, 2),
    ).rejects.toMatchObject({ code: 'ER_DUP_ENTRY' });
    const foreignWorkItemId = await insertRow(
      pool,
      'INSERT INTO team_work_items (external_id, organization_id, project_id, created_by_user_id, title, assignment_mode, status, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [
        newExternalId('teamWorkItem'),
        current.organizationId,
        current.projectId,
        current.creator.id,
        'Foreign lineage work item',
        'assigned',
        'submitted',
        1,
      ],
    );
    await expect(
      insertReview(newExternalId('teamReview'), foreignWorkItemId, 3),
    ).rejects.toMatchObject({ code: 'ER_NO_REFERENCED_ROW_2' });
    const [rows] = await pool.execute<Array<RowDataPacket & { reviewAttempt: number }>>(
      'SELECT review_attempt AS reviewAttempt FROM team_work_item_reviews WHERE submission_id = ? ORDER BY review_attempt',
      [current.submissionId],
    );
    expect(rows.map((row) => row.reviewAttempt)).toEqual([1, 2]);
  });

  it('rolls back appeal and decision writes when event persistence fails', async () => {
    const current = await createFixture();
    const faulted = appealService({
      repository: new FailingAppealEventRepository(new DrizzleAppealRepository(db)),
    });
    await expect(faulted.appeal(appealInput(current, 'task9-faulted-appeal'))).rejects.toThrow(
      'forced Task 9 event persistence failure',
    );
    expect(await count('team_work_item_appeals', current.organizationId)).toBe(0);
    expect(await count('team_work_item_events', current.organizationId)).toBe(0);
    expect(await state(current.workItemId)).toMatchObject({
      status: 'revision_requested',
      version: 5,
      revisionRound: 1,
    });

    const opened = await appealService().appeal(appealInput(current, 'task9-normal-appeal'));
    if (opened.command !== 'appeal') throw new Error('expected appeal receipt');
    await expect(
      faulted.decideAppeal(decisionInput(current, opened.appealId, 'task9-faulted-decision')),
    ).rejects.toThrow('forced Task 9 event persistence failure');
    expect(await count('team_work_item_appeals', current.organizationId)).toBe(1);
    expect(await count('team_arbitration_decisions', current.organizationId)).toBe(0);
    expect(await count('team_work_item_events', current.organizationId)).toBe(1);
    expect(await state(current.workItemId)).toMatchObject({
      status: 'revision_requested',
      version: 6,
      revisionRound: 1,
    });
    const [appealRows] = await pool.execute<Array<RowDataPacket & { status: string }>>(
      'SELECT status FROM team_work_item_appeals WHERE organization_id = ?',
      [current.organizationId],
    );
    expect(appealRows.map((row) => row.status)).toEqual(['appeal_open']);
  });

  it('executes returned-review SLA SQL and stops reminding after attempt 2 exists', async () => {
    const current = await createFixture({ reviewedAt: '2026-08-28T03:00:00.000Z' });
    const task9 = appealService({ now: '2026-08-29T03:00:00.000Z' });
    const opened = await task9.appeal(appealInput(current, 'task9-sla-open'));
    if (opened.command !== 'appeal') throw new Error('expected appeal receipt');
    await task9.decideAppeal(decisionInput(current, opened.appealId, 'task9-sla-return'));

    const slaService = appealService({ reviewSlaMs: 24 * HOUR_MS });
    const overdue = await slaService.listOverdueNotifications({ now: NOW, limit: 10 });
    expect(overdue).toHaveLength(1);
    expect(overdue[0]).toMatchObject({
      delivery: 'in_app_only',
      type: 'team_review_overdue',
      organizationId: current.organizationId,
      projectId: current.projectId,
    });
    await insertRow(
      pool,
      'INSERT INTO team_work_item_reviews (external_id, organization_id, project_id, work_item_id, submission_id, contract_version_id, reviewer_user_id, review_attempt, decision, reviewed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        newExternalId('teamReview'),
        current.organizationId,
        current.projectId,
        current.workItemId,
        current.submissionId,
        current.contractId,
        current.approver.id,
        2,
        'accepted',
        new Date('2026-08-30T03:00:00.000Z'),
      ],
    );
    expect(await slaService.listOverdueNotifications({ now: NOW, limit: 10 })).toEqual([]);
  });
});
