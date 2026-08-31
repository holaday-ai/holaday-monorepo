import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/mysql2';
import type { DB } from '../db/client.js';
import { readAffectedRows } from '../db/mysql-result.js';
import * as schema from '../db/schema/index.js';
import { FileService } from '../files/file-service.js';
import { filesRouter } from '../trpc/routers/files.js';
import { projectsRouter } from '../trpc/routers/projects.js';
import { tasksRouter } from '../trpc/routers/tasks.js';
import { teamTasksRouter } from '../trpc/routers/team-tasks.js';
import {
  type LifecycleCanaryManifest,
  type LifecycleCanaryRole,
  type LifecycleCanaryScenario,
  parseLifecycleCanaryManifest,
} from './team-task-lifecycle-canary-runner.js';

export interface TeamTaskLifecycleProductionCanary {
  validateBoundary(manifest: LifecycleCanaryManifest): Promise<boolean>;
  smoke(
    manifest: LifecycleCanaryManifest,
  ): Promise<{ personalProjects: boolean; teamProjects: boolean; filePath: boolean }>;
  executeScenario(
    name: LifecycleCanaryScenario,
    manifest: LifecycleCanaryManifest,
  ): Promise<boolean>;
}

export interface TeamTaskLifecycleCanaryQueryPool {
  execute(sql: string, values?: unknown[]): Promise<unknown>;
  getConnection?: () => Promise<CanaryConnection>;
}

interface CanaryConnection {
  beginTransaction(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  execute(sql: string, values?: unknown[]): Promise<unknown>;
  query(sql: string, values?: unknown[]): Promise<unknown>;
  release(): void;
}

interface AdapterRuntime {
  validatePersistedBoundary(manifest: LifecycleCanaryManifest): Promise<boolean>;
  smoke(
    manifest: LifecycleCanaryManifest,
  ): Promise<{ personalProjects: boolean; teamProjects: boolean; filePath: boolean }>;
  scenarios: Record<
    LifecycleCanaryScenario,
    (manifest: LifecycleCanaryManifest) => Promise<boolean>
  >;
}

type UnknownRecord = Record<string, unknown>;

const BUSINESS_CODES = new Set([
  'BAD_REQUEST',
  'CONFLICT',
  'FORBIDDEN',
  'INVALID_INPUT',
  'NOT_FOUND',
  'PRECONDITION_FAILED',
  'VERSION_CONFLICT',
  'ARBITRATOR_REQUIRED',
]);

class CanaryAssertionError extends Error {
  readonly code = 'CANARY_ASSERTION_FAILED';

  constructor() {
    super('canary assertion failed');
  }
}

function record(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function businessCode(error: unknown): string | null {
  if (error instanceof CanaryAssertionError) return error.code;
  if (!record(error)) return null;
  const code = typeof error.code === 'string' ? error.code : null;
  return code && BUSINESS_CODES.has(code) ? code : null;
}

function assertion(condition: unknown): asserts condition {
  if (!condition) throw new CanaryAssertionError();
}

function textField(value: unknown, field: string): string {
  assertion(record(value) && typeof value[field] === 'string' && value[field].length > 0);
  return value[field];
}

function numberField(value: unknown, field: string): number {
  assertion(record(value) && Number.isSafeInteger(value[field]) && Number(value[field]) >= 0);
  return Number(value[field]);
}

function stateField(value: unknown): string {
  return textField(value, 'state');
}

function canonicalJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (!record(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalJsonValue(value[key])]),
  );
}

function sameReceipt(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalJsonValue(left)) === JSON.stringify(canonicalJsonValue(right));
}

function resultRows(value: unknown): UnknownRecord[] {
  if (!Array.isArray(value) || !Array.isArray(value[0])) return [];
  return value[0].filter(record);
}

function manifestShapeValid(manifest: LifecycleCanaryManifest): boolean {
  try {
    parseLifecycleCanaryManifest(manifest);
    return true;
  } catch {
    return false;
  }
}

function createAdapter(runtime: AdapterRuntime): TeamTaskLifecycleProductionCanary {
  return {
    async validateBoundary(manifest) {
      if (!manifestShapeValid(manifest)) return false;
      return runtime.validatePersistedBoundary(manifest);
    },
    async smoke(manifest) {
      if (!manifestShapeValid(manifest)) {
        return { personalProjects: false, teamProjects: false, filePath: false };
      }
      const result = await runtime.smoke(manifest);
      return {
        personalProjects: result.personalProjects === true,
        teamProjects: result.teamProjects === true,
        filePath: result.filePath === true,
      };
    },
    async executeScenario(name, manifest) {
      if (!manifestShapeValid(manifest)) return false;
      const scenario = runtime.scenarios[name];
      if (typeof scenario !== 'function') return false;
      try {
        return (await scenario(manifest)) === true;
      } catch (error) {
        if (businessCode(error)) return false;
        throw error;
      }
    },
  };
}

interface InactiveRaceOperations {
  makeInactiveAndHold(): Promise<void>;
  beginMutation(): Promise<unknown>;
  waitForBlockedMutation(): Promise<void>;
  commitInactive(): Promise<void>;
  rollbackInactive(): Promise<void>;
  restoreActive(): Promise<void>;
}

async function runInactiveCommitRace(operations: InactiveRaceOperations): Promise<boolean> {
  let transactionOpen = false;
  let mutationSettled = false;
  let mutation: Promise<{ ok: boolean; error: unknown }> | null = null;
  try {
    await operations.makeInactiveAndHold();
    transactionOpen = true;
    mutation = operations.beginMutation().then(
      () => ({ ok: true, error: null }),
      (error: unknown) => ({ ok: false, error }),
    );
    mutation.finally(() => {
      mutationSettled = true;
    });
    await operations.waitForBlockedMutation();
    const observed = !mutationSettled;
    await operations.commitInactive();
    transactionOpen = false;
    const outcome = await mutation;
    return observed && !outcome.ok && businessCode(outcome.error) === 'NOT_FOUND';
  } finally {
    if (transactionOpen) await operations.rollbackInactive();
    await mutation?.catch(() => undefined);
    await operations.restoreActive();
  }
}

interface InactiveLockTimeoutProbeOperations {
  makeInactiveAndHold(): Promise<void>;
  beginMutation(): Promise<unknown>;
  rollbackInactive(): Promise<void>;
  now?: () => number;
}

async function runInactiveLockTimeoutProbe(
  operations: InactiveLockTimeoutProbeOperations,
): Promise<boolean> {
  const now = operations.now ?? Date.now;
  let transactionOpen = false;
  try {
    await operations.makeInactiveAndHold();
    transactionOpen = true;
    const startedAt = now();
    const outcome = await operations.beginMutation().then(
      () => ({ ok: true, error: null }),
      (error: unknown) => ({ ok: false, error }),
    );
    const elapsedMs = now() - startedAt;
    return !outcome.ok && businessCode(outcome.error) === 'CONFLICT' && elapsedMs >= 750;
  } finally {
    if (transactionOpen) await operations.rollbackInactive();
  }
}

async function runAiBoundaryScenario(
  manifest: LifecycleCanaryManifest,
  recordContribution: () => Promise<boolean>,
): Promise<boolean> {
  if (!manifestShapeValid(manifest)) return false;
  return recordContribution();
}

function caller(db: DB, userId: string) {
  return teamTasksRouter.createCaller({ db, userId, logger: {} } as never);
}

function projectsCaller(db: DB, userId: string) {
  return projectsRouter.createCaller({ db, userId, logger: {} } as never);
}

function tasksCaller(db: DB, userId: string) {
  return tasksRouter.createCaller({ db, userId, logger: {} } as never);
}

function filesCaller(db: DB, userId: string) {
  return filesRouter.createCaller({ db, userId, logger: {} } as never);
}

function memberId(
  manifest: LifecycleCanaryManifest,
  role: LifecycleCanaryRole,
  organizationIndex: 0 | 1,
): string {
  return manifest.scopes[organizationIndex].actors[role].organizationMemberId;
}

function actorId(
  manifest: LifecycleCanaryManifest,
  role: LifecycleCanaryRole,
  organizationIndex: 0 | 1,
): string {
  return manifest.scopes[organizationIndex].actors[role].userId;
}

function projectId(manifest: LifecycleCanaryManifest, organizationIndex: 0 | 1): string {
  return manifest.scopes[organizationIndex].projectId;
}

function contract(
  manifest: LifecycleCanaryManifest,
  organizationIndex: 0 | 1,
  dueAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
) {
  return {
    objective: 'Synthetic canary objective',
    deliverables: ['Synthetic canary deliverable'],
    criteria: [{ id: 'criterion-1', description: 'Synthetic criterion with a bounded result' }],
    requiredEvidenceTypes: [{ type: 'synthetic', description: 'Synthetic canary evidence' }],
    approverId: memberId(manifest, 'creatorApprover', organizationIndex),
    arbitratorId: memberId(manifest, 'arbitrator', organizationIndex),
    dueAt,
    maxRevisionRounds: 2,
  };
}

function revisionInput() {
  return {
    decision: 'request_revision' as const,
    rationale: 'Synthetic criterion requires one bounded correction.',
    failedCriterionIds: ['criterion-1'],
    evidenceReferences: [{ kind: 'missing_evidence' as const, reference: 'synthetic-evidence' }],
    revisionInstructions: ['Provide the bounded synthetic correction.'],
    newDeadline: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
  };
}

async function expectedBusinessCode(
  operation: Promise<unknown>,
  expectedCode: string,
): Promise<boolean> {
  try {
    await operation;
    return false;
  } catch (error) {
    return businessCode(error) === expectedCode;
  }
}

interface ActiveFixture {
  workItemId: string;
  version: number;
}

async function activeFixture(
  db: DB,
  manifest: LifecycleCanaryManifest,
  organizationIndex: 0 | 1,
  label: string,
  dueAt?: string,
): Promise<ActiveFixture> {
  const creator = caller(db, actorId(manifest, 'creatorApprover', organizationIndex));
  const responsible = caller(db, actorId(manifest, 'claimantA', organizationIndex));
  const projectId = manifest.scopes[organizationIndex].projectId;
  const draft = await creator.createDraft({
    projectId,
    title: `Synthetic canary ${label}`,
    description: null,
    assignmentMode: 'direct',
    expectedVersion: 0,
    idempotencyKey: randomUUID(),
  });
  const workItemId = textField(draft, 'workItemId');
  const published = await creator.publish({
    projectId,
    workItemId,
    expectedVersion: numberField(draft, 'version'),
    idempotencyKey: randomUUID(),
    contract: contract(manifest, organizationIndex, dueAt),
  });
  const offered = await creator.assign({
    projectId,
    workItemId,
    expectedVersion: numberField(published, 'version'),
    idempotencyKey: randomUUID(),
    targetMemberId: memberId(manifest, 'claimantA', organizationIndex),
    role: 'responsible',
  });
  const accepted = await responsible.acceptAssignment({
    projectId,
    workItemId,
    assignmentId: textField(offered, 'assignmentId'),
    expectedVersion: numberField(offered, 'version'),
    idempotencyKey: randomUUID(),
  });
  const started = await responsible.start({
    projectId,
    workItemId,
    expectedVersion: numberField(accepted, 'version'),
    idempotencyKey: randomUUID(),
  });
  assertion(stateField(started) === 'in_progress');
  return { workItemId, version: numberField(started, 'version') };
}

async function revisionFixture(db: DB, manifest: LifecycleCanaryManifest, label: string) {
  const fixture = await activeFixture(db, manifest, 0, label);
  const projectId = manifest.scopes[0].projectId;
  const responsible = caller(db, actorId(manifest, 'claimantA', 0));
  const approver = caller(db, actorId(manifest, 'creatorApprover', 0));
  const submission = await responsible.submit({
    projectId,
    workItemId: fixture.workItemId,
    expectedVersion: fixture.version,
    idempotencyKey: randomUUID(),
    summary: 'Synthetic canary submission',
    deliverables: ['Synthetic canary deliverable'],
  });
  const review = await approver.review({
    projectId,
    workItemId: fixture.workItemId,
    submissionId: textField(submission, 'submissionId'),
    expectedVersion: numberField(submission, 'version'),
    idempotencyKey: randomUUID(),
    ...revisionInput(),
  });
  assertion(stateField(review) === 'revision_requested');
  return {
    projectId,
    workItemId: fixture.workItemId,
    submissionId: textField(submission, 'submissionId'),
    reviewId: textField(review, 'reviewId'),
    version: numberField(review, 'version'),
  };
}

interface SyntheticPersonalTaskFixture {
  taskId: string;
  originalProjectId: string | null;
}

async function findSyntheticPersonalTask(
  pool: TeamTaskLifecycleCanaryQueryPool,
  userId: string,
): Promise<SyntheticPersonalTaskFixture | null> {
  const rows = resultRows(
    await pool.execute(
      `SELECT t.external_id AS taskId, p.external_id AS originalProjectId
         FROM tasks t
         INNER JOIN users u ON u.id = t.user_id AND u.status = 'active'
         LEFT JOIN projects p ON p.id = t.project_id
        WHERE u.external_id = ?
          AND t.origin = 'user'
          AND (t.project_id IS NULL OR p.organization_id IS NULL)
          AND t.status IN ('completed', 'partial_success', 'failed', 'cancelled')
        ORDER BY t.id DESC
        LIMIT 1`,
      [userId],
    ),
  );
  const taskId = rows[0]?.taskId;
  const originalProjectId = rows[0]?.originalProjectId;
  if (typeof taskId !== 'string') return null;
  return {
    taskId,
    originalProjectId: typeof originalProjectId === 'string' ? originalProjectId : null,
  };
}

async function verifyPersonalWorkspaceRegression(
  db: DB,
  pool: TeamTaskLifecycleCanaryQueryPool,
  userId: string,
): Promise<boolean> {
  const projects = projectsCaller(db, userId);
  const tasks = tasksCaller(db, userId);
  const files = filesCaller(db, userId);
  const task = await findSyntheticPersonalTask(pool, userId);
  if (!task) return false;

  let createdProjectId: string | null = null;
  let taskMoved = false;
  let deleted = false;
  try {
    const before = await projects.list();
    if (!Array.isArray(before)) return false;
    const created = await projects.create({ name: 'Synthetic canary personal project' });
    createdProjectId = textField(created, 'projectId');
    const renamed = await projects.rename({
      projectId: createdProjectId,
      name: 'Synthetic canary personal project renamed',
    });
    if (!record(renamed) || renamed.ok !== true) return false;
    const afterRename = await projects.list();
    if (
      !Array.isArray(afterRename) ||
      !afterRename.some(
        (entry) =>
          record(entry) &&
          entry.projectId === createdProjectId &&
          entry.name === 'Synthetic canary personal project renamed',
      )
    ) {
      return false;
    }
    const moved = await tasks.moveToProject({ taskId: task.taskId, projectId: createdProjectId });
    if (!record(moved) || moved.projectId !== createdProjectId) return false;
    taskMoved = true;
    const restored = await tasks.moveToProject({
      taskId: task.taskId,
      projectId: task.originalProjectId,
    });
    if (!record(restored) || restored.projectId !== task.originalProjectId) return false;
    taskMoved = false;
    const listedFiles = await files.list({ type: 'all', limit: 1 });
    if (!record(listedFiles) || !Array.isArray(listedFiles.items)) return false;
    const removed = await projects.delete({ projectId: createdProjectId });
    if (!record(removed) || removed.ok !== true) return false;
    deleted = true;
    const afterDelete = await projects.list();
    return (
      Array.isArray(afterDelete) &&
      !afterDelete.some((entry) => record(entry) && entry.projectId === createdProjectId)
    );
  } finally {
    if (taskMoved) {
      await tasks.moveToProject({ taskId: task.taskId, projectId: task.originalProjectId });
    }
    if (createdProjectId && !deleted) {
      await projects.delete({ projectId: createdProjectId });
    }
  }
}

async function verifySyntheticFilePath(
  db: DB,
  pool: TeamTaskLifecycleCanaryQueryPool,
  userId: string,
): Promise<boolean> {
  const rows = resultRows(
    await pool.execute("SELECT id FROM users WHERE external_id = ? AND status = 'active' LIMIT 1", [
      userId,
    ]),
  );
  const userIdInternal = Number(rows[0]?.id);
  if (!Number.isSafeInteger(userIdInternal) || userIdInternal < 1) return false;
  const logger = {
    debug() {},
    info() {},
    warn() {},
    error() {},
  } as never;
  const fileService = new FileService(db, logger);
  const files = filesCaller(db, userId);
  let fileId: string | null = null;
  let deleted = false;
  try {
    const stored = await fileService.storeUpload({
      userIdInternal,
      userExternalId: userId,
      filename: 'synthetic-canary-file.txt',
      mimetype: 'text/plain',
      buffer: Buffer.from('synthetic canary file path\n', 'utf8'),
    });
    fileId = stored.externalId;
    const listed = await files.list({ type: 'documents', limit: 100 });
    const availability = await files.availability({ fileIds: [fileId] });
    const listedOnce =
      record(listed) &&
      Array.isArray(listed.items) &&
      listed.items.filter((item) => record(item) && item.fileId === fileId).length === 1;
    const readable =
      record(availability) &&
      Array.isArray(availability.items) &&
      availability.items.length === 1 &&
      record(availability.items[0]) &&
      availability.items[0].fileId === fileId &&
      availability.items[0].available === true;
    const removed = await files.delete({ fileId });
    deleted = record(removed) && removed.ok === true;
    return listedOnce && readable && deleted;
  } finally {
    if (fileId && !deleted) {
      await fileService.deleteForUser(fileId, userIdInternal).catch(() => undefined);
    }
  }
}

async function smokeWithRealRouters(
  db: DB,
  pool: TeamTaskLifecycleCanaryQueryPool,
  manifest: LifecycleCanaryManifest,
) {
  const userId = actorId(manifest, 'creatorApprover', 0);
  const actor = projectsCaller(db, userId);
  let personalProjects = false;
  let teamProjects = false;
  let filePath = false;
  try {
    personalProjects = await verifyPersonalWorkspaceRegression(db, pool, userId);
  } catch (error) {
    if (!businessCode(error)) throw error;
  }
  try {
    filePath = await verifySyntheticFilePath(db, pool, userId);
  } catch (error) {
    if (!businessCode(error)) throw error;
  }
  try {
    const checks = await Promise.all(
      manifest.scopes.map(async (scope) => {
        await actor.get({ projectId: scope.projectId });
        const members = await actor.members({ projectId: scope.projectId });
        return Array.isArray(members) && members.length === 4;
      }),
    );
    teamProjects = checks.every(Boolean);
  } catch (error) {
    if (!businessCode(error)) throw error;
  }
  return { personalProjects, teamProjects, filePath };
}

async function validatePersistedBoundary(
  pool: TeamTaskLifecycleCanaryQueryPool,
  manifest: LifecycleCanaryManifest,
) {
  const users = Object.values(manifest.scopes[0].actors).map((actor) => actor.userId);
  const organizations = manifest.scopes.map((scope) => scope.organizationId);
  const projects = manifest.scopes.map((scope) => scope.projectId);
  const summaryRows = resultRows(
    await pool.execute(
      `SELECT
         (SELECT COUNT(DISTINCT u.id) FROM users u
           WHERE u.status = 'active' AND u.external_id IN (?, ?, ?, ?)) AS activeUsers,
         (SELECT COUNT(DISTINCT u.id) FROM users u
           WHERE u.status = 'active'
             AND u.password_hash = ''
             AND u.email IS NULL
             AND u.google_id IS NULL
             AND u.phone IS NULL
             AND u.mfa_enabled = 0
             AND u.external_id IN (?, ?, ?, ?)) AS nonLoginUsers,
         (SELECT COUNT(DISTINCT o.id) FROM organizations o
           WHERE o.status = 'active' AND o.team_projects_enabled = 1
             AND o.external_id IN (?, ?)) AS activeOrganizations,
         (SELECT COUNT(DISTINCT p.id) FROM projects p
           INNER JOIN organizations o ON o.id = p.organization_id
           WHERE p.external_id IN (?, ?) AND o.external_id IN (?, ?)) AS boundedProjects,
         (SELECT COUNT(*) FROM organization_members om
           INNER JOIN users u ON u.id = om.user_id AND u.status = 'active'
           INNER JOIN organizations o ON o.id = om.organization_id
           WHERE om.status = 'active' AND u.external_id IN (?, ?, ?, ?)
             AND o.external_id NOT IN (?, ?)) AS outsideOrganizationMemberships,
         (SELECT COUNT(*) FROM project_members pm
           INNER JOIN users u ON u.id = pm.user_id AND u.status = 'active'
           INNER JOIN projects p ON p.id = pm.project_id
           WHERE pm.status = 'active' AND u.external_id IN (?, ?, ?, ?)
             AND p.external_id NOT IN (?, ?)) AS outsideProjectMemberships`,
      [
        ...users,
        ...users,
        ...organizations,
        ...projects,
        ...organizations,
        ...users,
        ...organizations,
        ...users,
        ...projects,
      ],
    ),
  );
  const mappingClauses: string[] = [];
  const mappingValues: string[] = [];
  for (const scope of manifest.scopes) {
    for (const role of ['creatorApprover', 'claimantA', 'claimantB', 'arbitrator'] as const) {
      const actor = scope.actors[role];
      mappingClauses.push(
        '(u.external_id = ? AND o.external_id = ? AND p.external_id = ? AND om.external_id = ? AND pm.external_id = ?)',
      );
      mappingValues.push(
        actor.userId,
        scope.organizationId,
        scope.projectId,
        actor.organizationMemberId,
        actor.projectMemberId,
      );
    }
  }
  const mappingRows = resultRows(
    await pool.execute(
      `SELECT COUNT(*) AS exactMappings
         FROM organization_members om
         INNER JOIN users u ON u.id = om.user_id AND u.status = 'active'
         INNER JOIN organizations o
           ON o.id = om.organization_id
          AND o.status = 'active'
          AND o.team_projects_enabled = 1
         INNER JOIN projects p ON p.organization_id = o.id
         INNER JOIN project_members pm
           ON pm.project_id = p.id
          AND pm.user_id = u.id
          AND pm.status = 'active'
        WHERE om.status = 'active'
          AND (${mappingClauses.join(' OR ')})`,
      mappingValues,
    ),
  );
  const row = summaryRows[0];
  return (
    Number(row?.activeUsers) === 4 &&
    Number(row?.nonLoginUsers) === 4 &&
    Number(row?.activeOrganizations) === 2 &&
    Number(row?.boundedProjects) === 2 &&
    Number(row?.outsideOrganizationMemberships) === 0 &&
    Number(row?.outsideProjectMemberships) === 0 &&
    Number(mappingRows[0]?.exactMappings) === 8
  );
}

async function noOrphanResponsibleAssignment(
  pool: TeamTaskLifecycleCanaryQueryPool,
  workItemId: string,
  winningAssignmentId: string,
) {
  const rows = resultRows(
    await pool.execute(
      `SELECT
         COUNT(a.id) AS assignmentCount,
         SUM(CASE WHEN a.role = 'responsible' THEN 1 ELSE 0 END) AS responsibleCount,
         SUM(CASE WHEN a.role = 'responsible' AND a.status = 'accepted' THEN 1 ELSE 0 END)
           AS acceptedResponsibleCount,
         SUM(CASE WHEN a.external_id = ? THEN 1 ELSE 0 END) AS winningReceiptCount,
         SUM(CASE WHEN w.id IS NULL THEN 1 ELSE 0 END) AS orphanCount
       FROM team_work_item_assignments a
       LEFT JOIN team_work_items w
         ON w.id = a.work_item_id
        AND w.organization_id = a.organization_id
        AND w.project_id = a.project_id
       WHERE a.work_item_id = (SELECT id FROM team_work_items WHERE external_id = ?)`,
      [winningAssignmentId, workItemId],
    ),
  );
  return (
    Number(rows[0]?.assignmentCount) === 1 &&
    Number(rows[0]?.responsibleCount) === 1 &&
    Number(rows[0]?.acceptedResponsibleCount) === 1 &&
    Number(rows[0]?.winningReceiptCount) === 1 &&
    Number(rows[0]?.orphanCount) === 0
  );
}

interface WorkItemInvariantCounts {
  reviews: number;
  events: number;
  appeals: number;
  decisions: number;
  aiContributions: number;
}

interface RejectedCreationCounts {
  workItems: number;
  events: number;
  planningEvents: number;
}

function rejectedCreationCountsUnchanged(
  before: RejectedCreationCounts,
  after: RejectedCreationCounts,
): boolean {
  return (
    before.workItems === after.workItems &&
    before.events === after.events &&
    before.planningEvents === after.planningEvents
  );
}

async function rejectedCreationInvariantCounts(
  pool: TeamTaskLifecycleCanaryQueryPool,
  projectExternalId: string,
  title: string,
  idempotencyKey: string,
): Promise<RejectedCreationCounts> {
  const rows = resultRows(
    await pool.execute(
      `SELECT
         (SELECT COUNT(*)
            FROM team_work_items w
            INNER JOIN projects p ON p.id = w.project_id
           WHERE p.external_id = ? AND w.title = ?) AS workItems,
         (SELECT COUNT(*)
            FROM team_work_item_events e
            INNER JOIN team_work_items w ON w.id = e.work_item_id
            INNER JOIN projects p ON p.id = w.project_id
           WHERE p.external_id = ? AND e.idempotency_key = ?) AS events,
         (SELECT COUNT(*)
            FROM team_project_planning_events pe
            INNER JOIN projects p ON p.id = pe.project_id
           WHERE p.external_id = ? AND pe.idempotency_key = ?) AS planningEvents`,
      [
        projectExternalId,
        title,
        projectExternalId,
        idempotencyKey,
        projectExternalId,
        idempotencyKey,
      ],
    ),
  );
  const row = rows[0];
  assertion(row);
  return {
    workItems: Number(row.workItems),
    events: Number(row.events),
    planningEvents: Number(row.planningEvents),
  };
}

async function workItemInvariantCounts(
  pool: TeamTaskLifecycleCanaryQueryPool,
  workItemId: string,
): Promise<WorkItemInvariantCounts> {
  const rows = resultRows(
    await pool.execute(
      `SELECT
         (SELECT COUNT(*) FROM team_work_item_reviews r WHERE r.work_item_id = w.id) AS reviews,
         (SELECT COUNT(*) FROM team_work_item_events e WHERE e.work_item_id = w.id) AS events,
         (SELECT COUNT(*) FROM team_work_item_appeals a WHERE a.work_item_id = w.id) AS appeals,
         (SELECT COUNT(*) FROM team_arbitration_decisions d WHERE d.work_item_id = w.id) AS decisions,
         (SELECT COUNT(*) FROM team_ai_contributions ai WHERE ai.work_item_id = w.id)
           AS aiContributions
       FROM team_work_items w
       WHERE w.external_id = ?`,
      [workItemId],
    ),
  );
  const row = rows[0];
  assertion(row);
  return {
    reviews: Number(row.reviews),
    events: Number(row.events),
    appeals: Number(row.appeals),
    decisions: Number(row.decisions),
    aiContributions: Number(row.aiContributions),
  };
}

async function validRevisionPersisted(
  pool: TeamTaskLifecycleCanaryQueryPool,
  reviewId: string,
): Promise<boolean> {
  const rows = resultRows(
    await pool.execute(
      `SELECT
         decision,
         JSON_LENGTH(failed_criterion_ids_json) AS failedCriteria,
         JSON_LENGTH(evidence_refs_json) AS evidenceReferences,
         JSON_LENGTH(revision_instructions_json) AS revisionInstructions,
         CASE WHEN new_due_at IS NULL THEN 0 ELSE 1 END AS hasNewDeadline
       FROM team_work_item_reviews
       WHERE external_id = ?`,
      [reviewId],
    ),
  );
  return (
    rows.length === 1 &&
    rows[0]?.decision === 'request_revision' &&
    Number(rows[0]?.failedCriteria) === 1 &&
    Number(rows[0]?.evidenceReferences) === 1 &&
    Number(rows[0]?.revisionInstructions) === 1 &&
    Number(rows[0]?.hasNewDeadline) === 1
  );
}

async function restoreSyntheticProjectMembership(
  pool: TeamTaskLifecycleCanaryQueryPool,
  actor: string,
  currentProjectId: string,
): Promise<void> {
  await pool.execute(
    `UPDATE project_members pm
       INNER JOIN users u ON u.id = pm.user_id
       INNER JOIN projects p ON p.id = pm.project_id
       SET pm.status = 'active'
     WHERE u.external_id = ? AND p.external_id = ? AND pm.status = 'inactive'`,
    [actor, currentProjectId],
  );
  const rows = resultRows(
    await pool.execute(
      `SELECT COUNT(*) AS activeMemberships
         FROM project_members pm
         INNER JOIN users u ON u.id = pm.user_id
         INNER JOIN projects p ON p.id = pm.project_id
        WHERE u.external_id = ? AND p.external_id = ? AND pm.status = 'active'`,
      [actor, currentProjectId],
    ),
  );
  if (Number(rows[0]?.activeMemberships) !== 1) {
    throw new Error('synthetic membership restoration failed');
  }
}

async function verifyInactiveReadBoundary(input: {
  db: DB;
  pool: TeamTaskLifecycleCanaryQueryPool;
  actor: string;
  currentProjectId: string;
  workItemId: string;
}): Promise<boolean> {
  let changed = false;
  try {
    const result = await input.pool.execute(
      `UPDATE project_members pm
         INNER JOIN users u ON u.id = pm.user_id
         INNER JOIN projects p ON p.id = pm.project_id
         SET pm.status = 'inactive'
       WHERE u.external_id = ? AND p.external_id = ? AND pm.status = 'active'`,
      [input.actor, input.currentProjectId],
    );
    assertion(readAffectedRows(result) === 1);
    changed = true;
    return await expectedBusinessCode(
      caller(input.db, input.actor).get({
        projectId: input.currentProjectId,
        workItemId: input.workItemId,
      }),
      'NOT_FOUND',
    );
  } finally {
    if (changed) {
      await restoreSyntheticProjectMembership(input.pool, input.actor, input.currentProjectId);
    }
  }
}

async function findSyntheticSupportTask(
  pool: TeamTaskLifecycleCanaryQueryPool,
  manifest: LifecycleCanaryManifest,
): Promise<string | null> {
  if (!manifestShapeValid(manifest)) return null;
  const rows = resultRows(
    await pool.execute(
      `SELECT t.external_id AS taskId
         FROM tasks t
         INNER JOIN llm_calls lc ON lc.task_id = t.id AND lc.status = 'ok'
         INNER JOIN users u ON u.id = t.user_id AND u.status = 'active'
         INNER JOIN projects p ON p.id = t.project_id
         INNER JOIN project_members pm
           ON pm.project_id = p.id AND pm.user_id = u.id AND pm.status = 'active'
         INNER JOIN organization_members om
           ON om.organization_id = p.organization_id
          AND om.user_id = u.id
          AND om.status = 'active'
        WHERE t.origin = 'user'
          AND t.status = 'completed'
          AND t.completed_at IS NOT NULL
          AND u.external_id = ?
          AND p.external_id = ?
          AND p.organization_id = (
            SELECT id FROM organizations WHERE external_id = ? AND status = 'active'
          )
        GROUP BY t.id, t.external_id
        ORDER BY t.id DESC
        LIMIT 1`,
      [
        actorId(manifest, 'claimantA', 0),
        projectId(manifest, 0),
        manifest.scopes[0].organizationId,
      ],
    ),
  );
  const value = rows[0]?.taskId;
  return typeof value === 'string' ? value : null;
}

function productionScenarios(
  db: DB,
  pool: TeamTaskLifecycleCanaryQueryPool,
): AdapterRuntime['scenarios'] {
  return {
    async directLifecycle(manifest) {
      const fixture = await activeFixture(db, manifest, 0, 'direct');
      const currentProjectId = projectId(manifest, 0);
      const responsible = caller(db, actorId(manifest, 'claimantA', 0));
      const approver = caller(db, actorId(manifest, 'creatorApprover', 0));
      const blocked = await responsible.block({
        projectId: currentProjectId,
        workItemId: fixture.workItemId,
        expectedVersion: fixture.version,
        idempotencyKey: randomUUID(),
        responsibleParty: 'Synthetic canary owner',
        nextAction: 'Resume the bounded synthetic flow',
        reviewAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        affectsDueDate: false,
      });
      assertion(
        stateField(blocked) === 'blocked' && numberField(blocked, 'version') > fixture.version,
      );
      const unblocked = await responsible.unblock({
        projectId: currentProjectId,
        workItemId: fixture.workItemId,
        expectedVersion: numberField(blocked, 'version'),
        idempotencyKey: randomUUID(),
      });
      assertion(
        stateField(unblocked) === 'in_progress' &&
          numberField(unblocked, 'version') > numberField(blocked, 'version'),
      );
      const submitted = await responsible.submit({
        projectId: currentProjectId,
        workItemId: fixture.workItemId,
        expectedVersion: numberField(unblocked, 'version'),
        idempotencyKey: randomUUID(),
        summary: 'Synthetic canary submission',
        deliverables: ['Synthetic canary deliverable'],
      });
      assertion(
        stateField(submitted) === 'submitted' &&
          numberField(submitted, 'version') > numberField(unblocked, 'version'),
      );
      const reviewed = await approver.review({
        projectId: currentProjectId,
        workItemId: fixture.workItemId,
        submissionId: textField(submitted, 'submissionId'),
        expectedVersion: numberField(submitted, 'version'),
        idempotencyKey: randomUUID(),
        decision: 'accepted',
        rationale: 'Synthetic acceptance criteria are satisfied.',
      });
      assertion(
        stateField(reviewed) === 'accepted' &&
          numberField(reviewed, 'version') > numberField(submitted, 'version'),
      );
      const closed = await approver.close({
        projectId: currentProjectId,
        workItemId: fixture.workItemId,
        expectedVersion: numberField(reviewed, 'version'),
        idempotencyKey: randomUUID(),
      });
      return (
        stateField(closed) === 'completed' &&
        numberField(closed, 'version') > numberField(reviewed, 'version')
      );
    },

    async firstComeRace(manifest) {
      const currentProjectId = projectId(manifest, 0);
      const creator = caller(db, actorId(manifest, 'creatorApprover', 0));
      const draft = await creator.createDraft({
        projectId: currentProjectId,
        title: 'Synthetic canary first come race',
        description: null,
        assignmentMode: 'first_come',
        expectedVersion: 0,
        idempotencyKey: randomUUID(),
      });
      const workItemId = textField(draft, 'workItemId');
      const published = await creator.publish({
        projectId: currentProjectId,
        workItemId,
        expectedVersion: numberField(draft, 'version'),
        idempotencyKey: randomUUID(),
        contract: contract(manifest, 0),
      });
      const version = numberField(published, 'version');
      const claims = await Promise.allSettled([
        caller(db, actorId(manifest, 'claimantA', 0)).claim({
          projectId: currentProjectId,
          workItemId,
          memberId: memberId(manifest, 'claimantA', 0),
          expectedVersion: version,
          idempotencyKey: randomUUID(),
        }),
        caller(db, actorId(manifest, 'claimantB', 0)).claim({
          projectId: currentProjectId,
          workItemId,
          memberId: memberId(manifest, 'claimantB', 0),
          expectedVersion: version,
          idempotencyKey: randomUUID(),
        }),
      ]);
      const fulfilled = claims.filter((result) => result.status === 'fulfilled');
      const rejected = claims.filter((result) => result.status === 'rejected');
      if (
        fulfilled.length !== 1 ||
        rejected.length !== 1 ||
        businessCode(rejected[0]?.reason) !== 'CONFLICT'
      ) {
        return false;
      }
      return noOrphanResponsibleAssignment(
        pool,
        workItemId,
        textField(fulfilled[0]?.value, 'assignmentId'),
      );
    },

    async validRevision(manifest) {
      const revised = await revisionFixture(db, manifest, 'valid revision');
      if (!(await validRevisionPersisted(pool, revised.reviewId))) return false;
      const resubmitted = await caller(db, actorId(manifest, 'claimantA', 0)).submit({
        projectId: revised.projectId,
        workItemId: revised.workItemId,
        expectedVersion: revised.version,
        idempotencyKey: randomUUID(),
        summary: 'Synthetic corrected submission',
        deliverables: ['Synthetic corrected deliverable'],
      });
      return stateField(resubmitted) === 'resubmitted';
    },

    async vagueRevisionRejected(manifest) {
      const fixture = await activeFixture(db, manifest, 0, 'vague revision');
      const currentProjectId = projectId(manifest, 0);
      const responsible = caller(db, actorId(manifest, 'claimantA', 0));
      const approver = caller(db, actorId(manifest, 'creatorApprover', 0));
      const submitted = await responsible.submit({
        projectId: currentProjectId,
        workItemId: fixture.workItemId,
        expectedVersion: fixture.version,
        idempotencyKey: randomUUID(),
        summary: 'Synthetic canary submission',
        deliverables: ['Synthetic canary deliverable'],
      });
      const before = await workItemInvariantCounts(pool, fixture.workItemId);
      const rejected = await expectedBusinessCode(
        approver.review({
          projectId: currentProjectId,
          workItemId: fixture.workItemId,
          submissionId: textField(submitted, 'submissionId'),
          expectedVersion: numberField(submitted, 'version'),
          idempotencyKey: randomUUID(),
          decision: 'request_revision',
          rationale: 'Not good enough',
        }),
        'BAD_REQUEST',
      );
      const detail = await approver.get({
        projectId: currentProjectId,
        workItemId: fixture.workItemId,
      });
      const after = await workItemInvariantCounts(pool, fixture.workItemId);
      return (
        rejected &&
        numberField(detail, 'version') === numberField(submitted, 'version') &&
        after.reviews === before.reviews &&
        after.events === before.events
      );
    },

    async revisionLimit(manifest) {
      const first = await revisionFixture(db, manifest, 'revision limit');
      const responsible = caller(db, actorId(manifest, 'claimantA', 0));
      const approver = caller(db, actorId(manifest, 'creatorApprover', 0));
      const secondSubmission = await responsible.submit({
        projectId: first.projectId,
        workItemId: first.workItemId,
        expectedVersion: first.version,
        idempotencyKey: randomUUID(),
        summary: 'Synthetic second submission',
        deliverables: ['Synthetic second deliverable'],
      });
      const secondReview = await approver.review({
        projectId: first.projectId,
        workItemId: first.workItemId,
        submissionId: textField(secondSubmission, 'submissionId'),
        expectedVersion: numberField(secondSubmission, 'version'),
        idempotencyKey: randomUUID(),
        ...revisionInput(),
      });
      const thirdSubmission = await responsible.submit({
        projectId: first.projectId,
        workItemId: first.workItemId,
        expectedVersion: numberField(secondReview, 'version'),
        idempotencyKey: randomUUID(),
        summary: 'Synthetic third submission',
        deliverables: ['Synthetic third deliverable'],
      });
      const rejected = await expectedBusinessCode(
        approver.review({
          projectId: first.projectId,
          workItemId: first.workItemId,
          submissionId: textField(thirdSubmission, 'submissionId'),
          expectedVersion: numberField(thirdSubmission, 'version'),
          idempotencyKey: randomUUID(),
          ...revisionInput(),
        }),
        'PRECONDITION_FAILED',
      );
      const detail = await approver.get({
        projectId: first.projectId,
        workItemId: first.workItemId,
      });
      if (!rejected || numberField(detail, 'revisionRound') !== 2) return false;
      const accepted = await approver.review({
        projectId: first.projectId,
        workItemId: first.workItemId,
        submissionId: textField(thirdSubmission, 'submissionId'),
        expectedVersion: numberField(thirdSubmission, 'version'),
        idempotencyKey: randomUUID(),
        decision: 'accepted',
        rationale: 'Synthetic final submission satisfies the bounded criteria.',
      });
      return stateField(accepted) === 'accepted' && numberField(accepted, 'revisionRound') === 2;
    },

    async appeal(manifest) {
      const revised = await revisionFixture(db, manifest, 'appeal');
      const responsible = caller(db, actorId(manifest, 'claimantA', 0));
      const key = randomUUID();
      const input = {
        projectId: revised.projectId,
        workItemId: revised.workItemId,
        submissionId: revised.submissionId,
        reviewId: revised.reviewId,
        expectedVersion: revised.version,
        idempotencyKey: key,
        disputeType: 'criterion_application' as const,
        grounds: 'Synthetic evidence satisfies the bounded criterion.',
      };
      const first = await responsible.appeal(input);
      const replay = await responsible.appeal(input);
      const secondRejected = await expectedBusinessCode(
        responsible.appeal({
          ...input,
          expectedVersion: numberField(first, 'version'),
          idempotencyKey: randomUUID(),
        }),
        'CONFLICT',
      );
      const counts = await workItemInvariantCounts(pool, revised.workItemId);
      return (
        sameReceipt(first, replay) &&
        stateField(first) === 'revision_requested' &&
        secondRejected &&
        counts.appeals === 1
      );
    },

    async independentArbitration(manifest) {
      const revised = await revisionFixture(db, manifest, 'arbitration');
      const responsible = caller(db, actorId(manifest, 'claimantA', 0));
      const opened = await responsible.appeal({
        projectId: revised.projectId,
        workItemId: revised.workItemId,
        submissionId: revised.submissionId,
        reviewId: revised.reviewId,
        expectedVersion: revised.version,
        idempotencyKey: randomUUID(),
        disputeType: 'criterion_application',
        grounds: 'Synthetic evidence satisfies the bounded criterion.',
      });
      const arbitrator = caller(db, actorId(manifest, 'arbitrator', 0));
      const input = {
        projectId: revised.projectId,
        workItemId: revised.workItemId,
        submissionId: revised.submissionId,
        reviewId: revised.reviewId,
        appealId: textField(opened, 'appealId'),
        expectedVersion: numberField(opened, 'version'),
        idempotencyKey: randomUUID(),
        decision: 'accept_submission' as const,
        criterionIds: ['criterion-1'],
        evidenceReferences: [{ kind: 'evidence' as const, reference: 'synthetic-evidence' }],
        rationale: 'Independent synthetic evidence satisfies the criterion.',
      };
      const responsibleRejected = await expectedBusinessCode(
        responsible.decideAppeal(input),
        'PRECONDITION_FAILED',
      );
      const approverRejected = await expectedBusinessCode(
        caller(db, actorId(manifest, 'creatorApprover', 0)).decideAppeal(input),
        'PRECONDITION_FAILED',
      );
      const decided = await arbitrator.decideAppeal(input);
      const replay = await arbitrator.decideAppeal(input);
      const distinctDecisionRejected = await expectedBusinessCode(
        arbitrator.decideAppeal({ ...input, idempotencyKey: randomUUID() }),
        'CONFLICT',
      );
      const counts = await workItemInvariantCounts(pool, revised.workItemId);
      return (
        responsibleRejected &&
        approverRejected &&
        sameReceipt(decided, replay) &&
        distinctDecisionRejected &&
        stateField(decided) === 'accepted' &&
        counts.appeals === 1 &&
        counts.decisions === 1
      );
    },

    async crossTenantHidden(manifest) {
      const creator = caller(db, actorId(manifest, 'creatorApprover', 0));
      const primaryProjectId = projectId(manifest, 0);
      const foreignProjectId = projectId(manifest, 1);
      const primary = await creator.createDraft({
        projectId: primaryProjectId,
        title: 'Synthetic primary tenant task',
        description: null,
        assignmentMode: 'direct',
        expectedVersion: 0,
        idempotencyKey: randomUUID(),
      });
      const foreign = await creator.createDraft({
        projectId: foreignProjectId,
        title: 'Synthetic foreign tenant task',
        description: null,
        assignmentMode: 'direct',
        expectedVersion: 0,
        idempotencyKey: randomUUID(),
      });
      const hiddenRead = await expectedBusinessCode(
        creator.get({ projectId: primaryProjectId, workItemId: textField(foreign, 'workItemId') }),
        'NOT_FOUND',
      );
      const hiddenDependency = await expectedBusinessCode(
        creator.addDependency({
          projectId: primaryProjectId,
          workItemId: textField(primary, 'workItemId'),
          dependsOnWorkItemId: textField(foreign, 'workItemId'),
          expectedVersion: numberField(primary, 'version'),
          idempotencyKey: randomUUID(),
        }),
        'NOT_FOUND',
      );
      const hiddenMember = await expectedBusinessCode(
        creator.publish({
          projectId: primaryProjectId,
          workItemId: textField(primary, 'workItemId'),
          expectedVersion: numberField(primary, 'version'),
          idempotencyKey: randomUUID(),
          contract: {
            ...contract(manifest, 0),
            approverId: memberId(manifest, 'creatorApprover', 1),
          },
        }),
        'NOT_FOUND',
      );
      return hiddenRead && hiddenDependency && hiddenMember;
    },

    async inactiveRejected(manifest) {
      const actor = actorId(manifest, 'creatorApprover', 0);
      const currentProjectId = projectId(manifest, 0);
      const readFixture = await activeFixture(db, manifest, 0, 'inactive read boundary');
      const readRejected = await verifyInactiveReadBoundary({
        db,
        pool,
        actor,
        currentProjectId,
        workItemId: readFixture.workItemId,
      });
      if (!readRejected) return false;
      const blockerConnection = await pool.getConnection?.();
      const mutationConnection = await pool.getConnection?.();
      if (!blockerConnection || !mutationConnection) {
        blockerConnection?.release();
        mutationConnection?.release();
        throw new Error('canary database connection unavailable');
      }
      const mutationDb = drizzle(mutationConnection as never, {
        schema,
        mode: 'default',
        casing: 'snake_case',
      }) as unknown as DB;
      let changed = false;
      try {
        await mutationConnection.query('SET SESSION innodb_lock_wait_timeout = 1');
        const makeInactiveAndHold = async () => {
          await blockerConnection.beginTransaction();
          const result = await blockerConnection.execute(
            `UPDATE project_members pm
               INNER JOIN users u ON u.id = pm.user_id
               INNER JOIN projects p ON p.id = pm.project_id
               SET pm.status = 'inactive'
             WHERE u.external_id = ? AND p.external_id = ? AND pm.status = 'active'`,
            [actor, currentProjectId],
          );
          assertion(readAffectedRows(result) === 1);
          changed = true;
        };
        const timeoutProbe = {
          title: `Synthetic inactive lock timeout probe ${randomUUID()}`,
          idempotencyKey: randomUUID(),
        };
        const beforeTimeout = await rejectedCreationInvariantCounts(
          pool,
          currentProjectId,
          timeoutProbe.title,
          timeoutProbe.idempotencyKey,
        );
        const exactLockWait = await runInactiveLockTimeoutProbe({
          makeInactiveAndHold,
          beginMutation: () =>
            caller(mutationDb, actor).createDraft({
              projectId: currentProjectId,
              title: timeoutProbe.title,
              description: null,
              assignmentMode: 'direct',
              expectedVersion: 0,
              idempotencyKey: timeoutProbe.idempotencyKey,
            }),
          rollbackInactive: () => blockerConnection.rollback(),
        });
        const afterTimeout = await rejectedCreationInvariantCounts(
          pool,
          currentProjectId,
          timeoutProbe.title,
          timeoutProbe.idempotencyKey,
        );
        if (!exactLockWait || !rejectedCreationCountsUnchanged(beforeTimeout, afterTimeout)) {
          return false;
        }
        const commitProbe = {
          title: `Synthetic inactive race task ${randomUUID()}`,
          idempotencyKey: randomUUID(),
        };
        const beforeCommit = await rejectedCreationInvariantCounts(
          pool,
          currentProjectId,
          commitProbe.title,
          commitProbe.idempotencyKey,
        );
        const result = await runInactiveCommitRace({
          makeInactiveAndHold,
          beginMutation: () =>
            caller(mutationDb, actor).createDraft({
              projectId: currentProjectId,
              title: commitProbe.title,
              description: null,
              assignmentMode: 'direct',
              expectedVersion: 0,
              idempotencyKey: commitProbe.idempotencyKey,
            }),
          waitForBlockedMutation: () => new Promise<void>((resolve) => setTimeout(resolve, 150)),
          commitInactive: () => blockerConnection.commit(),
          rollbackInactive: () => blockerConnection.rollback(),
          async restoreActive() {
            if (!changed) return;
            await restoreSyntheticProjectMembership(pool, actor, currentProjectId);
          },
        });
        const afterCommit = await rejectedCreationInvariantCounts(
          pool,
          currentProjectId,
          commitProbe.title,
          commitProbe.idempotencyKey,
        );
        return result && rejectedCreationCountsUnchanged(beforeCommit, afterCommit);
      } finally {
        await blockerConnection.rollback().catch(() => undefined);
        blockerConnection.release();
        mutationConnection.release();
      }
    },

    async idempotentRetry(manifest) {
      const creator = caller(db, actorId(manifest, 'creatorApprover', 0));
      const currentProjectId = projectId(manifest, 0);
      const input = {
        projectId: currentProjectId,
        title: 'Synthetic idempotent task',
        description: null,
        assignmentMode: 'direct' as const,
        expectedVersion: 0 as const,
        idempotencyKey: randomUUID(),
      };
      const results = await Promise.allSettled([
        creator.createDraft(input),
        creator.createDraft(input),
      ]);
      if (
        results.some((result) => result.status !== 'fulfilled') ||
        results[0]?.status !== 'fulfilled' ||
        results[1]?.status !== 'fulfilled' ||
        !sameReceipt(results[0].value, results[1].value)
      ) {
        return false;
      }
      const receipt = results[0].value;
      const published = await creator.publish({
        projectId: currentProjectId,
        workItemId: textField(receipt, 'workItemId'),
        expectedVersion: numberField(receipt, 'version'),
        idempotencyKey: randomUUID(),
        contract: contract(manifest, 0),
      });
      const staleRejected = await expectedBusinessCode(
        creator.publish({
          projectId: currentProjectId,
          workItemId: textField(receipt, 'workItemId'),
          expectedVersion: numberField(receipt, 'version'),
          idempotencyKey: randomUUID(),
          contract: contract(manifest, 0),
        }),
        'CONFLICT',
      );
      return stateField(published) === 'ready' && staleRejected;
    },

    async aiCannotAccept(manifest) {
      return runAiBoundaryScenario(manifest, async () => {
        const supportTaskId = await findSyntheticSupportTask(pool, manifest);
        if (!supportTaskId) return false;
        const fixture = await activeFixture(db, manifest, 0, 'AI boundary');
        const responsible = caller(db, actorId(manifest, 'claimantA', 0));
        const before = await workItemInvariantCounts(pool, fixture.workItemId);
        const beforeDetail = await responsible.get({
          projectId: projectId(manifest, 0),
          workItemId: fixture.workItemId,
        });
        const contribution = await responsible.recordAiContribution({
          projectId: projectId(manifest, 0),
          workItemId: fixture.workItemId,
          executionTaskId: supportTaskId,
          requestedScope: 'Synthetic support only',
          expectedVersion: fixture.version,
          idempotencyKey: randomUUID(),
        });
        const detail = await responsible.get({
          projectId: projectId(manifest, 0),
          workItemId: fixture.workItemId,
        });
        const afterContribution = await workItemInvariantCounts(pool, fixture.workItemId);
        const contributionStayedAdvisory =
          stateField(contribution) === 'in_progress' &&
          numberField(contribution, 'version') === fixture.version &&
          record(detail) &&
          record(beforeDetail) &&
          detail.state === beforeDetail.state &&
          detail.version === beforeDetail.version &&
          detail.accepted === null &&
          afterContribution.aiContributions === before.aiContributions + 1 &&
          afterContribution.appeals === before.appeals &&
          afterContribution.decisions === before.decisions;
        if (!contributionStayedAdvisory) return false;

        const submitted = await responsible.submit({
          projectId: projectId(manifest, 0),
          workItemId: fixture.workItemId,
          expectedVersion: fixture.version,
          idempotencyKey: randomUUID(),
          summary: 'Synthetic human submission after AI support',
          deliverables: ['Synthetic human-owned deliverable'],
        });
        const approver = caller(db, actorId(manifest, 'creatorApprover', 0));
        const reviewed = await approver.review({
          projectId: projectId(manifest, 0),
          workItemId: fixture.workItemId,
          submissionId: textField(submitted, 'submissionId'),
          expectedVersion: numberField(submitted, 'version'),
          idempotencyKey: randomUUID(),
          ...revisionInput(),
        });
        const opened = await responsible.appeal({
          projectId: projectId(manifest, 0),
          workItemId: fixture.workItemId,
          submissionId: textField(submitted, 'submissionId'),
          reviewId: textField(reviewed, 'reviewId'),
          expectedVersion: numberField(reviewed, 'version'),
          idempotencyKey: randomUUID(),
          disputeType: 'criterion_application',
          grounds: 'Synthetic human appeal after AI support.',
        });
        const decided = await caller(db, actorId(manifest, 'arbitrator', 0)).decideAppeal({
          projectId: projectId(manifest, 0),
          workItemId: fixture.workItemId,
          submissionId: textField(submitted, 'submissionId'),
          reviewId: textField(reviewed, 'reviewId'),
          appealId: textField(opened, 'appealId'),
          expectedVersion: numberField(opened, 'version'),
          idempotencyKey: randomUUID(),
          decision: 'accept_submission',
          criterionIds: ['criterion-1'],
          evidenceReferences: [{ kind: 'evidence', reference: 'synthetic-evidence' }],
          rationale: 'Synthetic human arbitrator owns the final decision.',
        });
        const finalDetail = await responsible.get({
          projectId: projectId(manifest, 0),
          workItemId: fixture.workItemId,
        });
        const afterDecision = await workItemInvariantCounts(pool, fixture.workItemId);
        return (
          stateField(decided) === 'accepted' &&
          record(finalDetail) &&
          finalDetail.accepted === true &&
          afterDecision.aiContributions === before.aiContributions + 1 &&
          afterDecision.appeals === before.appeals + 1 &&
          afterDecision.decisions === before.decisions + 1
        );
      });
    },

    async onTimeIndependent(manifest) {
      const dueAtMs = Date.now() + 5_000;
      const fixture = await activeFixture(
        db,
        manifest,
        0,
        'late acceptance boundary',
        new Date(dueAtMs).toISOString(),
      );
      const remainingMs = dueAtMs - Date.now() + 25;
      if (remainingMs > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, remainingMs));
      }
      const currentProjectId = projectId(manifest, 0);
      const responsible = caller(db, actorId(manifest, 'claimantA', 0));
      const approver = caller(db, actorId(manifest, 'creatorApprover', 0));
      const unknown = await responsible.get({
        projectId: currentProjectId,
        workItemId: fixture.workItemId,
      });
      if (!record(unknown) || unknown.submittedOnTime !== null || unknown.accepted !== null) {
        return false;
      }
      const submitted = await responsible.submit({
        projectId: currentProjectId,
        workItemId: fixture.workItemId,
        expectedVersion: fixture.version,
        idempotencyKey: randomUUID(),
        summary: 'Synthetic late submission',
        deliverables: ['Synthetic late deliverable'],
      });
      const before = await responsible.get({
        projectId: currentProjectId,
        workItemId: fixture.workItemId,
      });
      if (!record(before) || before.submittedOnTime !== false || before.accepted !== null)
        return false;
      await approver.review({
        projectId: currentProjectId,
        workItemId: fixture.workItemId,
        submissionId: textField(submitted, 'submissionId'),
        expectedVersion: numberField(submitted, 'version'),
        idempotencyKey: randomUUID(),
        decision: 'accepted',
        rationale: 'Synthetic acceptance criteria are satisfied.',
      });
      const after = await approver.get({
        projectId: currentProjectId,
        workItemId: fixture.workItemId,
      });
      return record(after) && after.submittedOnTime === false && after.accepted === true;
    },

    async phaseOneRegression(manifest) {
      const result = await smokeWithRealRouters(db, pool, manifest);
      return result.personalProjects && result.teamProjects && result.filePath;
    },
  };
}

export function createTeamTaskLifecycleProductionCanary(input: {
  db: DB;
  pool: TeamTaskLifecycleCanaryQueryPool;
  logger?: unknown;
}): TeamTaskLifecycleProductionCanary {
  return createAdapter({
    validatePersistedBoundary: (manifest) => validatePersistedBoundary(input.pool, manifest),
    smoke: (manifest) => smokeWithRealRouters(input.db, input.pool, manifest),
    scenarios: productionScenarios(input.db, input.pool),
  });
}

export const __teamTaskLifecycleProductionCanaryInternals = {
  createAdapter,
  findSyntheticSupportTask,
  manifestShapeValid,
  runInactiveCommitRace,
  runInactiveLockTimeoutProbe,
  rejectedCreationCountsUnchanged,
  runAiBoundaryScenario,
  expectedBusinessCode,
  sameReceipt,
};
