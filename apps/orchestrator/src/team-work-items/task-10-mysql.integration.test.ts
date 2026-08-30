import { newExternalId } from '@holaday/shared-types';
import { drizzle } from 'drizzle-orm/mysql2';
import mysql, { type Pool, type ResultSetHeader, type RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DB } from '../db/client.js';
import * as schema from '../db/schema/index.js';
import {
  DrizzleTeamTaskEvidenceRepository,
  type EvidenceAiTransaction,
  type TeamTaskEvidenceRepository,
  TeamTaskEvidenceService,
  type TeamTaskEvidenceServiceDependencies,
} from './team-task-evidence-service.js';

const LOCK_WAIT_TIMEOUT_SECONDS = 5;
const TEST_TIMEOUT_MS = 20_000;
const NOW = '2026-08-31T03:00:00.000Z';
const DUE_AT = '2026-09-30T03:00:00.000Z';
const FUTURE = '2099-01-01T00:00:00.000Z';
const PAST = '2000-01-01T00:00:00.000Z';

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
  workItemId: number;
  workItemExternalId: string;
  currentContractId: number;
  creator: Person;
  responsible: Person;
  ordinaryMember: Person;
};
type CountRow = RowDataPacket & { count: number };

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
    !/task10/i.test(database) ||
    !/test/i.test(database)
  ) {
    throw new Error('MYSQL_URL must target the isolated loopback Task 10 test database');
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

async function captureDatabaseError(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error('expected a real MySQL constraint error');
}

class FailingEventRepository implements TeamTaskEvidenceRepository {
  constructor(private readonly delegate: DrizzleTeamTaskEvidenceRepository) {}

  transaction<T>(work: (transaction: EvidenceAiTransaction) => Promise<T>): Promise<T> {
    return this.delegate.transaction((transaction) => {
      const faulted = new Proxy(transaction, {
        get(targetTransaction, property) {
          if (property === 'appendEvent') {
            return async () => {
              throw new Error('forced Task 10 event persistence failure');
            };
          }
          const value = Reflect.get(targetTransaction, property, targetTransaction);
          return typeof value === 'function' ? value.bind(targetTransaction) : value;
        },
      }) as EvidenceAiTransaction;
      return work(faulted);
    });
  }
}

class ThrowingRepository implements TeamTaskEvidenceRepository {
  constructor(private readonly error: unknown) {}

  async transaction<T>(_work: (transaction: EvidenceAiTransaction) => Promise<T>): Promise<T> {
    throw this.error;
  }
}

integrationDescribe('Task 10 real-MySQL evidence and AI contribution boundaries', () => {
  let pool: Pool;
  let db: DB;

  function evidenceService(
    repository: TeamTaskEvidenceRepository = new DrizzleTeamTaskEvidenceRepository(db),
  ) {
    const dependencies: TeamTaskEvidenceServiceDependencies = {
      now: () => NOW,
      isLifecycleEnabled: () => true,
      newId: (kind) => newExternalId(kind),
    };
    return new TeamTaskEvidenceService(repository, dependencies);
  }

  async function createPerson(label: string): Promise<Person> {
    const externalId = newExternalId('user');
    const id = await insertRow(
      pool,
      'INSERT INTO users (external_id, email, password_hash) VALUES (?, ?, ?)',
      [externalId, `${label}-${externalId}@task10.integration.test`, 'integration-test-only'],
    );
    return { id, externalId };
  }

  async function addOrganizationMember(
    organizationId: number,
    person: Person,
    role: 'owner' | 'manager' | 'member' = 'member',
  ): Promise<void> {
    await insertRow(
      pool,
      'INSERT INTO organization_members (external_id, organization_id, user_id, role, status) VALUES (?, ?, ?, ?, ?)',
      [newExternalId('organizationMember'), organizationId, person.id, role, 'active'],
    );
  }

  async function addProjectMember(
    projectId: number,
    person: Person,
    role: 'lead' | 'member' | 'viewer' = 'member',
  ): Promise<void> {
    await insertRow(
      pool,
      'INSERT INTO project_members (external_id, project_id, user_id, role, status) VALUES (?, ?, ?, ?, ?)',
      [newExternalId('projectMember'), projectId, person.id, role, 'active'],
    );
  }

  async function createFixture(
    requiredEvidenceTypes: readonly string[] = ['source_document'],
  ): Promise<Fixture> {
    const creator = await createPerson('creator');
    const responsible = await createPerson('responsible');
    const ordinaryMember = await createPerson('ordinary');
    const organizationId = await insertRow(
      pool,
      'INSERT INTO organizations (external_id, name, owner_user_id, status, team_projects_enabled) VALUES (?, ?, ?, ?, ?)',
      [newExternalId('organization'), 'Task 10 isolated integration', creator.id, 'active', true],
    );
    await addOrganizationMember(organizationId, creator, 'owner');
    await addOrganizationMember(organizationId, responsible);
    await addOrganizationMember(organizationId, ordinaryMember);
    const projectId = await insertRow(
      pool,
      'INSERT INTO projects (external_id, user_id, organization_id, name) VALUES (?, ?, ?, ?)',
      [newExternalId('project'), creator.id, organizationId, 'Task 10 integration project'],
    );
    await addProjectMember(projectId, creator, 'lead');
    await addProjectMember(projectId, responsible);
    await addProjectMember(projectId, ordinaryMember);
    const workItemExternalId = newExternalId('teamWorkItem');
    const workItemId = await insertRow(
      pool,
      'INSERT INTO team_work_items (external_id, organization_id, project_id, created_by_user_id, title, assignment_mode, status, version, due_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        workItemExternalId,
        organizationId,
        projectId,
        creator.id,
        'Task 10 transaction fixture',
        'assigned',
        'in_progress',
        7,
        new Date(DUE_AT),
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
        new Date(NOW),
      ],
    );
    const currentContractId = await insertRow(
      pool,
      'INSERT INTO acceptance_contract_versions (external_id, organization_id, project_id, work_item_id, version, objective, deliverables_json, criteria_json, required_evidence_types_json, approver_user_id, arbitrator_user_id, due_at, max_revision_rounds, created_by_user_id, confirmed_by_user_id, confirmed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        newExternalId('acceptanceContractVersion'),
        organizationId,
        projectId,
        workItemId,
        1,
        'Prove Task 10 evidence and AI boundaries',
        JSON.stringify(['report']),
        JSON.stringify([{ id: 'quality', description: 'Evidence is verifiable' }]),
        JSON.stringify(requiredEvidenceTypes.map((type) => ({ type }))),
        creator.id,
        creator.id,
        new Date(DUE_AT),
        2,
        creator.id,
        responsible.id,
        new Date(NOW),
      ],
    );
    await pool.execute('UPDATE team_work_items SET current_contract_version_id = ? WHERE id = ?', [
      currentContractId,
      workItemId,
    ]);
    return {
      organizationId,
      projectId,
      workItemId,
      workItemExternalId,
      currentContractId,
      creator,
      responsible,
      ordinaryMember,
    };
  }

  async function createTask(
    fixture: Fixture,
    input: {
      result?: unknown;
      opusUsed?: boolean;
      owner?: Person;
      projectId?: number;
    } = {},
  ) {
    const owner = input.owner ?? fixture.responsible;
    const externalId = newExternalId('task');
    const id = await insertRow(
      pool,
      'INSERT INTO tasks (external_id, user_id, project_id, status, origin, intent, result, opus_used, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        externalId,
        owner.id,
        input.projectId ?? fixture.projectId,
        'completed',
        'user',
        'Task 10 isolated execution',
        JSON.stringify(input.result ?? { summary: 'immutable result' }),
        input.opusUsed ?? true,
        new Date(NOW),
      ],
    );
    return { id, externalId };
  }

  async function createTaskFile(
    fixture: Fixture,
    taskId: number,
    input: {
      kind?: 'input' | 'output' | 'temp';
      status?: 'active' | 'expired';
      expiresAt?: string | null;
      storagePath?: string;
      owner?: Person;
    } = {},
  ) {
    const owner = input.owner ?? fixture.responsible;
    const externalId = newExternalId('file');
    const id = await insertRow(
      pool,
      'INSERT INTO task_files (external_id, user_id, task_id, kind, filename, mimetype, size_bytes, storage_path, status, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        externalId,
        owner.id,
        taskId,
        input.kind ?? 'input',
        'private-input.txt',
        'text/plain',
        64,
        input.storagePath ?? '/private/task10/never-return-this-path',
        input.status ?? 'active',
        input.expiresAt === undefined
          ? new Date(FUTURE)
          : input.expiresAt === null
            ? null
            : new Date(input.expiresAt),
      ],
    );
    return { id, externalId };
  }

  async function createArtifact(
    fixture: Fixture,
    taskId: number,
    input: { purpose?: string; expiresAt?: string | null; owner?: Person } = {},
  ) {
    const owner = input.owner ?? fixture.responsible;
    const externalId = newExternalId('evidenceArtifact');
    const id = await insertRow(
      pool,
      'INSERT INTO evidence_artifacts (external_id, owner_user_id, task_id, artifact_kind, purpose, source_url, final_url, r2_bucket, r2_key, content_type, size_bytes, sha256, captured_at, collector_lane, raw_excerpt, confidence, retention_policy, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        externalId,
        owner.id,
        taskId,
        'html_snapshot',
        input.purpose ?? 'task_evidence',
        'https://private-source.example/secret',
        'https://private-final.example/secret',
        'private-bucket',
        'private/task10/never-return-this-key',
        'text/html',
        128,
        'a'.repeat(64),
        new Date(NOW),
        'integration',
        'raw private excerpt that must never leave the repository',
        'observed',
        'task_30d',
        input.expiresAt === undefined
          ? new Date(FUTURE)
          : input.expiresAt === null
            ? null
            : new Date(input.expiresAt),
      ],
    );
    return { id, externalId };
  }

  function bindInput(
    fixture: Fixture,
    source: Record<string, unknown>,
    key: string,
    evidenceType: string,
  ) {
    return {
      actorExternalId: fixture.responsible.externalId,
      workItemExternalId: fixture.workItemExternalId,
      expectedVersion: 7,
      idempotencyKey: key,
      source,
      metadata: { evidenceType, confidence: 'verified' },
    };
  }

  async function countByOrganization(table: string, organizationId: number): Promise<number> {
    const allowed = new Set([
      'team_evidence_bindings',
      'team_ai_contributions',
      'team_work_item_events',
    ]);
    if (!allowed.has(table)) throw new Error('unapproved Task 10 aggregate assertion table');
    const [rows] = await pool.execute<CountRow[]>(
      `SELECT COUNT(*) AS count FROM ${table} WHERE organization_id = ?`,
      [organizationId],
    );
    return rows[0]?.count ?? 0;
  }

  beforeAll(async () => {
    if (!target) throw new Error('unreachable skipped Task 10 integration suite');
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
    const [tableRows] = await pool.execute<Array<RowDataPacket & { count: number }>>(
      "SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name IN ('team_evidence_bindings', 'team_ai_contributions')",
    );
    expect(tableRows[0]?.count).toBe(2);
    db = drizzle(pool, { schema, mode: 'default', casing: 'snake_case' }) as unknown as DB;
  });

  afterAll(async () => {
    if (pool) await pool.end();
  });

  it(
    'enforces writer, source ownership publication, and tenant-project lineage',
    async () => {
      const fixture = await createFixture();
      const task = await createTask(fixture);
      const file = await createTaskFile(fixture, task.id);
      const artifact = await createArtifact(fixture, task.id);
      const service = evidenceService();

      await expect(
        service.bindEvidence(
          bindInput(
            fixture,
            { kind: 'taskFile', taskFileId: file.externalId },
            'bind-file',
            'source_document',
          ),
        ),
      ).resolves.toMatchObject({ command: 'bind_evidence', sourceKind: 'taskFile' });
      await expect(
        service.bindEvidence(
          bindInput(
            fixture,
            { kind: 'evidenceArtifact', evidenceArtifactId: artifact.externalId },
            'bind-artifact',
            'source_document',
          ),
        ),
      ).resolves.toMatchObject({ command: 'bind_evidence', sourceKind: 'evidenceArtifact' });
      await expect(
        service.bindEvidence(
          bindInput(
            fixture,
            { kind: 'controlledExternalRef', url: 'https://reference.example:443/proof' },
            'bind-external',
            'source_document',
          ),
        ),
      ).resolves.toMatchObject({ command: 'bind_evidence', sourceKind: 'controlledExternalRef' });

      await expect(
        service.bindEvidence({
          ...bindInput(
            fixture,
            { kind: 'taskFile', taskFileId: file.externalId },
            'ordinary-member',
            'source_document',
          ),
          actorExternalId: fixture.ordinaryMember.externalId,
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });

      const collaboratorOwner = await createPerson('collaborator-source-owner');
      await addOrganizationMember(fixture.organizationId, collaboratorOwner);
      await addProjectMember(fixture.projectId, collaboratorOwner);
      await insertRow(
        pool,
        'INSERT INTO team_work_item_assignments (external_id, organization_id, project_id, work_item_id, user_id, role, status, offered_by_user_id, responded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          newExternalId('teamWorkItemAssignment'),
          fixture.organizationId,
          fixture.projectId,
          fixture.workItemId,
          collaboratorOwner.id,
          'collaborator',
          'accepted',
          fixture.creator.id,
          new Date(NOW),
        ],
      );
      const collaboratorTask = await createTask(fixture, { owner: collaboratorOwner });
      const collaboratorFile = await createTaskFile(fixture, collaboratorTask.id, {
        owner: collaboratorOwner,
      });
      const collaboratorArtifact = await createArtifact(fixture, collaboratorTask.id, {
        owner: collaboratorOwner,
      });
      const submissionExternalId = newExternalId('teamSubmission');
      await insertRow(
        pool,
        'INSERT INTO team_work_item_submissions (external_id, organization_id, project_id, work_item_id, contract_version_id, submitted_by_user_id, submission_version, summary, deliverables_json, submitted_on_time, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          submissionExternalId,
          fixture.organizationId,
          fixture.projectId,
          fixture.workItemId,
          fixture.currentContractId,
          fixture.responsible.id,
          1,
          'Ownership publication target',
          JSON.stringify(['report']),
          true,
          new Date(NOW),
        ],
      );
      const collaboratorSources = [
        {
          source: { kind: 'taskFile', taskFileId: collaboratorFile.externalId },
          sourceKind: 'taskFile',
        },
        {
          source: {
            kind: 'evidenceArtifact',
            evidenceArtifactId: collaboratorArtifact.externalId,
          },
          sourceKind: 'evidenceArtifact',
        },
      ] as const;
      for (const [index, collaboratorSource] of collaboratorSources.entries()) {
        await expect(
          service.bindEvidence(
            bindInput(
              fixture,
              collaboratorSource.source,
              `unpublished-collaborator-source-${index}`,
              'source_document',
            ),
          ),
        ).rejects.toMatchObject({ code: 'NOT_FOUND' });

        await expect(
          service.bindEvidence({
            ...bindInput(
              fixture,
              collaboratorSource.source,
              `owner-publishes-source-${index}`,
              'source_document',
            ),
            actorExternalId: collaboratorOwner.externalId,
          }),
        ).resolves.toMatchObject({
          command: 'bind_evidence',
          sourceKind: collaboratorSource.sourceKind,
          targetKind: 'workItem',
        });

        await expect(
          service.bindEvidence({
            ...bindInput(
              fixture,
              collaboratorSource.source,
              `responsible-reuses-published-source-${index}`,
              'source_document',
            ),
            target: { kind: 'submission', id: submissionExternalId },
          }),
        ).resolves.toMatchObject({
          command: 'bind_evidence',
          sourceKind: collaboratorSource.sourceKind,
          targetKind: 'submission',
          targetId: submissionExternalId,
        });
      }

      const outsider = await createPerson('cross-tenant');
      const outsiderOrganizationId = await insertRow(
        pool,
        'INSERT INTO organizations (external_id, name, owner_user_id, status, team_projects_enabled) VALUES (?, ?, ?, ?, ?)',
        [newExternalId('organization'), 'Foreign tenant', outsider.id, 'active', true],
      );
      await addOrganizationMember(outsiderOrganizationId, outsider, 'owner');
      await expect(
        service.getEvidencePackage({
          actorExternalId: outsider.externalId,
          workItemExternalId: fixture.workItemExternalId,
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });

      const crossProject = await createPerson('cross-project');
      await addOrganizationMember(fixture.organizationId, crossProject);
      const otherProjectId = await insertRow(
        pool,
        'INSERT INTO projects (external_id, user_id, organization_id, name) VALUES (?, ?, ?, ?)',
        [newExternalId('project'), fixture.creator.id, fixture.organizationId, 'Foreign project'],
      );
      await addProjectMember(otherProjectId, crossProject);
      await expect(
        service.getEvidencePackage({
          actorExternalId: crossProject.externalId,
          workItemExternalId: fixture.workItemExternalId,
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });

      await addProjectMember(otherProjectId, fixture.responsible);
      const crossProjectTask = await createTask(fixture, { projectId: otherProjectId });
      const crossProjectFile = await createTaskFile(fixture, crossProjectTask.id);
      await expect(
        service.bindEvidence(
          bindInput(
            fixture,
            { kind: 'taskFile', taskFileId: crossProjectFile.externalId },
            'cross-project-source',
            'source_document',
          ),
        ),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });

      const foreignTenantOwner = await createPerson('foreign-source-tenant-owner');
      const foreignTenantId = await insertRow(
        pool,
        'INSERT INTO organizations (external_id, name, owner_user_id, status, team_projects_enabled) VALUES (?, ?, ?, ?, ?)',
        [
          newExternalId('organization'),
          'Foreign source tenant',
          foreignTenantOwner.id,
          'active',
          true,
        ],
      );
      await addOrganizationMember(foreignTenantId, foreignTenantOwner, 'owner');
      await addOrganizationMember(foreignTenantId, fixture.responsible);
      const foreignTenantProjectId = await insertRow(
        pool,
        'INSERT INTO projects (external_id, user_id, organization_id, name) VALUES (?, ?, ?, ?)',
        [
          newExternalId('project'),
          foreignTenantOwner.id,
          foreignTenantId,
          'Foreign source project',
        ],
      );
      await addProjectMember(foreignTenantProjectId, foreignTenantOwner, 'lead');
      await addProjectMember(foreignTenantProjectId, fixture.responsible);
      const foreignTenantTask = await createTask(fixture, {
        projectId: foreignTenantProjectId,
      });
      const foreignTenantArtifact = await createArtifact(fixture, foreignTenantTask.id);
      await expect(
        service.bindEvidence(
          bindInput(
            fixture,
            {
              kind: 'evidenceArtifact',
              evidenceArtifactId: foreignTenantArtifact.externalId,
            },
            'cross-tenant-source',
            'source_document',
          ),
        ),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });

      const packageDto = await service.getEvidencePackage({
        actorExternalId: fixture.responsible.externalId,
        workItemExternalId: fixture.workItemExternalId,
      });
      expect(packageDto.evidenceBindings).toHaveLength(7);
      const serialized = JSON.stringify(packageDto);
      for (const forbidden of [
        'storagePath',
        'storage_path',
        'r2Key',
        'never-return-this',
        'rawExcerpt',
        'raw private excerpt',
        'https://reference.example',
        'private-source.example',
        'private-final.example',
      ]) {
        expect(serialized).not.toContain(forbidden);
      }
      expect(serialized).not.toMatch(/"id":\d/u);
    },
    TEST_TIMEOUT_MS,
  );

  it('uses only the pointed confirmed contract and only valid evidence in preflight', async () => {
    const fixture = await createFixture(['source_document', 'proof']);
    await insertRow(
      pool,
      'INSERT INTO acceptance_contract_versions (external_id, organization_id, project_id, work_item_id, version, objective, deliverables_json, criteria_json, required_evidence_types_json, approver_user_id, arbitrator_user_id, due_at, max_revision_rounds, created_by_user_id, confirmed_by_user_id, confirmed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        newExternalId('acceptanceContractVersion'),
        fixture.organizationId,
        fixture.projectId,
        fixture.workItemId,
        2,
        'Historical higher version must not replace the pointer',
        JSON.stringify(['report']),
        JSON.stringify([{ id: 'other', description: 'Other criteria' }]),
        JSON.stringify([]),
        fixture.creator.id,
        fixture.creator.id,
        new Date(DUE_AT),
        2,
        fixture.creator.id,
        fixture.responsible.id,
        new Date(NOW),
      ],
    );
    const task = await createTask(fixture);
    const first = await createTaskFile(fixture, task.id);
    const second = await createTaskFile(fixture, task.id);
    const proof = await createTaskFile(fixture, task.id);
    const expired = await createTaskFile(fixture, task.id, { expiresAt: PAST });
    const service = evidenceService();
    await service.bindEvidence(
      bindInput(
        fixture,
        { kind: 'taskFile', taskFileId: first.externalId },
        'preflight-source-a',
        'source_document',
      ),
    );
    await service.bindEvidence(
      bindInput(
        fixture,
        { kind: 'taskFile', taskFileId: second.externalId },
        'preflight-source-b',
        ' source_document ',
      ),
    );
    await insertRow(
      pool,
      'INSERT INTO team_evidence_bindings (external_id, organization_id, project_id, work_item_id, task_file_id, source_kind, metadata_json, bound_by_user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [
        newExternalId('teamEvidenceBinding'),
        fixture.organizationId,
        fixture.projectId,
        fixture.workItemId,
        expired.id,
        'taskFile',
        JSON.stringify({ evidenceType: 'proof' }),
        fixture.responsible.id,
      ],
    );
    await insertRow(
      pool,
      'INSERT INTO team_evidence_bindings (external_id, organization_id, project_id, work_item_id, source_kind, controlled_external_ref, metadata_json, bound_by_user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [
        newExternalId('teamEvidenceBinding'),
        fixture.organizationId,
        fixture.projectId,
        fixture.workItemId,
        'taskFile',
        'https://damaged.example/proof',
        JSON.stringify({ evidenceType: 'proof' }),
        fixture.responsible.id,
      ],
    );

    await expect(
      service.preflight({
        actorExternalId: fixture.responsible.externalId,
        workItemExternalId: fixture.workItemExternalId,
      }),
    ).resolves.toMatchObject({
      missingEvidenceTypes: ['proof'],
      schemaValidation: { valid: false, issueCodes: ['REQUIRED_EVIDENCE_MISSING'] },
    });
    await service.bindEvidence(
      bindInput(
        fixture,
        { kind: 'taskFile', taskFileId: proof.externalId },
        'preflight-proof',
        'proof',
      ),
    );
    await expect(
      service.preflight({
        actorExternalId: fixture.responsible.externalId,
        workItemExternalId: fixture.workItemExternalId,
      }),
    ).resolves.toMatchObject({
      missingEvidenceTypes: [],
      schemaValidation: { valid: true, issueCodes: [] },
    });
  });

  it(
    'derives and freezes AI facts, excludes invalid inputs, and conflicts on another key',
    async () => {
      const fixture = await createFixture();
      const task = await createTask(fixture, { result: { summary: 'stable execution result' } });
      await createTaskFile(fixture, task.id, { kind: 'input' });
      await createTaskFile(fixture, task.id, { kind: 'input', expiresAt: PAST });
      await createTaskFile(fixture, task.id, { kind: 'output' });
      await createTaskFile(fixture, task.id, { kind: 'temp' });
      await createArtifact(fixture, task.id, { purpose: 'task_evidence' });
      await createArtifact(fixture, task.id, { purpose: 'task_evidence', expiresAt: PAST });
      await createArtifact(fixture, task.id, { purpose: 'browser_observation' });
      await insertRow(
        pool,
        'INSERT INTO llm_calls (external_id, user_id, task_id, provider, model, purpose, prompt_tokens, completion_tokens, cache_read_tokens, cache_write_tokens, cost_usd, latency_ms, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          newExternalId('llmCall'),
          fixture.responsible.id,
          task.id,
          'openai',
          'integration-model',
          'task10',
          120,
          80,
          10,
          5,
          '0.001000',
          900,
          'ok',
        ],
      );
      const service = evidenceService();
      const input = {
        actorExternalId: fixture.responsible.externalId,
        workItemExternalId: fixture.workItemExternalId,
        expectedVersion: 7,
        executionTaskId: task.externalId,
        requestedScope: 'Summarize the verified execution result',
        idempotencyKey: 'task10-ai-frozen-replay',
      } as const;
      const firstReceipt = await service.recordAiContribution(input);
      const firstPackage = await service.getEvidencePackage({
        actorExternalId: fixture.responsible.externalId,
        workItemExternalId: fixture.workItemExternalId,
      });
      expect(firstPackage.aiContributions).toHaveLength(1);
      expect(firstPackage.aiContributions[0]).toMatchObject({
        inputSourceSummary: {
          sourceKinds: ['task_file', 'evidence_artifact'],
          sourceCount: 2,
        },
        resultVersion: expect.stringMatching(/^rv_[a-f0-9]{32}$/u),
        usageSnapshot: {
          taskUnits: 1,
          opusUnits: 1,
          llmCallCount: 1,
          inputTokens: 120,
          outputTokens: 80,
          cacheReadTokens: 10,
          cacheWriteTokens: 5,
          latencyMs: 900,
        },
      });

      await createTaskFile(fixture, task.id, { kind: 'input' });
      await insertRow(
        pool,
        'INSERT INTO llm_calls (external_id, user_id, task_id, provider, model, purpose, prompt_tokens, completion_tokens, cost_usd, latency_ms, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          newExternalId('llmCall'),
          fixture.responsible.id,
          task.id,
          'openai',
          'late-model',
          'task10-late',
          999,
          999,
          '0.001000',
          999,
          'ok',
        ],
      );
      await pool.execute('UPDATE tasks SET updated_at = ? WHERE id = ?', [
        new Date(FUTURE),
        task.id,
      ]);

      await expect(service.recordAiContribution(input)).resolves.toEqual(firstReceipt);
      const replayedPackage = await service.getEvidencePackage({
        actorExternalId: fixture.responsible.externalId,
        workItemExternalId: fixture.workItemExternalId,
      });
      expect(replayedPackage.aiContributions).toEqual(firstPackage.aiContributions);
      await expect(
        service.recordAiContribution({ ...input, idempotencyKey: 'task10-ai-distinct-key' }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'allows only one different-key writer for the same execution task under concurrency',
    async () => {
      const fixture = await createFixture();
      const task = await createTask(fixture);
      const service = evidenceService();
      const base = {
        actorExternalId: fixture.responsible.externalId,
        workItemExternalId: fixture.workItemExternalId,
        expectedVersion: 7,
        executionTaskId: task.externalId,
        requestedScope: 'Concurrent Task 10 contribution',
      } as const;
      const outcomes = await Promise.allSettled([
        service.recordAiContribution({ ...base, idempotencyKey: 'task10-ai-race-a' }),
        service.recordAiContribution({ ...base, idempotencyKey: 'task10-ai-race-b' }),
      ]);
      expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
      const loser = outcomes.find((outcome) => outcome.status === 'rejected');
      if (loser?.status !== 'rejected') throw new Error('missing Task 10 race loser');
      expect(errorCode(loser.reason)).toBe('CONFLICT');
      expect(await countByOrganization('team_ai_contributions', fixture.organizationId)).toBe(1);
      expect(await countByOrganization('team_work_item_events', fixture.organizationId)).toBe(1);
    },
    TEST_TIMEOUT_MS,
  );

  it('rolls back evidence facts when event persistence fails', async () => {
    const fixture = await createFixture();
    const task = await createTask(fixture);
    const file = await createTaskFile(fixture, task.id);
    const beforeBindings = await countByOrganization(
      'team_evidence_bindings',
      fixture.organizationId,
    );
    const beforeEvents = await countByOrganization('team_work_item_events', fixture.organizationId);
    const service = evidenceService(
      new FailingEventRepository(new DrizzleTeamTaskEvidenceRepository(db)),
    );
    await expect(
      service.bindEvidence(
        bindInput(
          fixture,
          { kind: 'taskFile', taskFileId: file.externalId },
          'task10-faulted-event',
          'source_document',
        ),
      ),
    ).rejects.toThrow('forced Task 10 event persistence failure');
    expect(await countByOrganization('team_evidence_bindings', fixture.organizationId)).toBe(
      beforeBindings,
    );
    expect(await countByOrganization('team_work_item_events', fixture.organizationId)).toBe(
      beforeEvents,
    );
  });

  it('maps real MySQL FK, unique, and CHECK failures without swallowing unknown errors', async () => {
    const fixture = await createFixture();
    const validBindingExternalId = newExternalId('teamEvidenceBinding');
    await insertRow(
      pool,
      'INSERT INTO team_evidence_bindings (external_id, organization_id, project_id, work_item_id, source_kind, controlled_external_ref, metadata_json, bound_by_user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [
        validBindingExternalId,
        fixture.organizationId,
        fixture.projectId,
        fixture.workItemId,
        'controlledExternalRef',
        'https://constraint.example/one',
        JSON.stringify({ evidenceType: 'source_document' }),
        fixture.responsible.id,
      ],
    );
    const uniqueError = await captureDatabaseError(() =>
      pool.execute(
        'INSERT INTO team_evidence_bindings (external_id, organization_id, project_id, work_item_id, source_kind, controlled_external_ref, bound_by_user_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [
          validBindingExternalId,
          fixture.organizationId,
          fixture.projectId,
          fixture.workItemId,
          'controlledExternalRef',
          'https://constraint.example/two',
          fixture.responsible.id,
        ],
      ),
    );
    expect(errorCode(uniqueError)).toBe('ER_DUP_ENTRY');

    const fkError = await captureDatabaseError(() =>
      pool.execute(
        'INSERT INTO team_evidence_bindings (external_id, organization_id, project_id, work_item_id, source_kind, controlled_external_ref, bound_by_user_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [
          newExternalId('teamEvidenceBinding'),
          fixture.organizationId,
          fixture.projectId + 9_999_999,
          fixture.workItemId,
          'controlledExternalRef',
          'https://constraint.example/fk',
          fixture.responsible.id,
        ],
      ),
    );
    expect(errorCode(fkError)).toBe('ER_NO_REFERENCED_ROW_2');

    const checkError = await captureDatabaseError(() =>
      pool.execute(
        'INSERT INTO team_task_review_delegations (external_id, organization_id, project_id, delegator_user_id, delegate_user_id, valid_from, valid_until) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [
          newExternalId('teamTaskReviewDelegation'),
          fixture.organizationId,
          fixture.projectId,
          fixture.creator.id,
          fixture.creator.id,
          new Date(NOW),
          new Date(DUE_AT),
        ],
      ),
    );
    expect(errorCode(checkError)).toBe('ER_CHECK_CONSTRAINT_VIOLATED');

    const validServiceInput = bindInput(
      fixture,
      { kind: 'controlledExternalRef', url: 'https://mapping.example/proof' },
      'task10-real-db-error-mapping',
      'source_document',
    );
    await expect(
      evidenceService(new ThrowingRepository(fkError)).bindEvidence(validServiceInput),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      evidenceService(new ThrowingRepository(uniqueError)).bindEvidence(validServiceInput),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(
      evidenceService(new ThrowingRepository(checkError)).bindEvidence(validServiceInput),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    const unknownError = new Error('unknown database failure');
    await expect(
      evidenceService(new ThrowingRepository(unknownError)).bindEvidence(validServiceInput),
    ).rejects.toBe(unknownError);
  });
});
