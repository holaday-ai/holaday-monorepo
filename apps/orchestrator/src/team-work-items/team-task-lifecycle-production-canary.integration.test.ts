import { newExternalId } from '@holaday/shared-types';
import { drizzle } from 'drizzle-orm/mysql2';
import mysql, { type Pool, type ResultSetHeader } from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { env as appEnv } from '../config/env.js';
import type { DB } from '../db/client.js';
import * as schema from '../db/schema/index.js';
import {
  LIFECYCLE_CANARY_SCENARIOS,
  type LifecycleCanaryManifest,
  type LifecycleCanaryRole,
  lifecycleCanaryBoundaryDigestForScopes,
} from './team-task-lifecycle-canary-runner.js';
import { createTeamTaskLifecycleProductionCanary } from './team-task-lifecycle-production-canary.js';

const TEST_TIMEOUT_MS = 120_000;

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

async function insertRow(pool: Pool, sql: string, values: readonly unknown[]): Promise<number> {
  const [result] = await pool.execute<ResultSetHeader>(sql, [...values]);
  expect(result.affectedRows).toBe(1);
  expect(result.insertId).toBeGreaterThan(0);
  return result.insertId;
}

const target = parseIntegrationTarget();
const integrationDescribe = target ? describe.sequential : describe.skip;

integrationDescribe('production canary adapter against real MySQL', () => {
  let db: DB;
  let pool: Pool;
  let manifest: LifecycleCanaryManifest;
  let previousTeamProjectsEnabled: boolean;
  let previousLifecycleEnabled: boolean;

  async function createNonLoginUser(): Promise<Person> {
    const externalId = newExternalId('user');
    const id = await insertRow(
      pool,
      'INSERT INTO users (external_id, email, password_hash, status, google_id, phone, mfa_enabled) VALUES (?, NULL, ?, ?, NULL, NULL, ?)',
      [externalId, '', 'active', false],
    );
    return { id, externalId };
  }

  beforeAll(async () => {
    if (!target) return;
    pool = mysql.createPool({
      ...target,
      connectionLimit: 8,
      multipleStatements: false,
      connectTimeout: 5_000,
    });
    pool.on('connection', (connection) => {
      connection.query('SET SESSION innodb_lock_wait_timeout = 5');
    });
    db = drizzle(pool, { schema, mode: 'default', casing: 'snake_case' }) as unknown as DB;

    const mutableEnv = appEnv as typeof appEnv & {
      TEAM_PROJECTS_ENABLED: boolean;
      TEAM_TASK_LIFECYCLE_ENABLED: boolean;
    };
    previousTeamProjectsEnabled = mutableEnv.TEAM_PROJECTS_ENABLED;
    previousLifecycleEnabled = mutableEnv.TEAM_TASK_LIFECYCLE_ENABLED;
    mutableEnv.TEAM_PROJECTS_ENABLED = true;
    mutableEnv.TEAM_TASK_LIFECYCLE_ENABLED = true;

    const roles: readonly LifecycleCanaryRole[] = [
      'creatorApprover',
      'claimantA',
      'claimantB',
      'arbitrator',
    ];
    const people = Object.fromEntries(
      await Promise.all(
        roles.map(async (role) => {
          const person = await createNonLoginUser();
          return [role, person] as const;
        }),
      ),
    ) as Record<LifecycleCanaryRole, Person>;

    const scopes: LifecycleCanaryManifest['scopes'][number][] = [];
    for (const organizationIndex of [0, 1] as const) {
      const organizationId = newExternalId('organization');
      const organizationInternalId = await insertRow(
        pool,
        'INSERT INTO organizations (external_id, name, owner_user_id, status, team_projects_enabled) VALUES (?, ?, ?, ?, ?)',
        [
          organizationId,
          `Synthetic canary integration ${organizationIndex + 1}`,
          people.creatorApprover.id,
          'active',
          true,
        ],
      );
      const projectId = newExternalId('project');
      const projectInternalId = await insertRow(
        pool,
        'INSERT INTO projects (external_id, user_id, organization_id, name) VALUES (?, ?, ?, ?)',
        [
          projectId,
          people.creatorApprover.id,
          organizationInternalId,
          `Synthetic canary integration project ${organizationIndex + 1}`,
        ],
      );
      const actors = {} as LifecycleCanaryManifest['scopes'][number]['actors'];
      for (const role of roles) {
        const organizationMemberId = newExternalId('organizationMember');
        const projectMemberId = newExternalId('projectMember');
        await insertRow(
          pool,
          'INSERT INTO organization_members (external_id, organization_id, user_id, role, status) VALUES (?, ?, ?, ?, ?)',
          [
            organizationMemberId,
            organizationInternalId,
            people[role].id,
            role === 'creatorApprover' ? 'owner' : 'member',
            'active',
          ],
        );
        await insertRow(
          pool,
          'INSERT INTO project_members (external_id, project_id, user_id, role, status) VALUES (?, ?, ?, ?, ?)',
          [
            projectMemberId,
            projectInternalId,
            people[role].id,
            role === 'creatorApprover' ? 'lead' : 'member',
            'active',
          ],
        );
        actors[role] = {
          userId: people[role].externalId,
          organizationMemberId,
          projectMemberId,
        };
      }
      scopes.push({ organizationId, projectId, actors });
    }
    const [firstScope, secondScope] = scopes;
    if (!firstScope || !secondScope) throw new Error('synthetic canary fixture is incomplete');

    await insertRow(
      pool,
      "INSERT INTO tasks (external_id, user_id, status, origin, intent) VALUES (?, ?, 'completed', 'user', ?)",
      [
        newExternalId('task'),
        people.creatorApprover.id,
        'Synthetic personal terminal task for production-canary integration',
      ],
    );
    const supportTaskId = await insertRow(
      pool,
      "INSERT INTO tasks (external_id, user_id, project_id, status, origin, intent, result, completed_at) VALUES (?, ?, (SELECT id FROM projects WHERE external_id = ?), 'completed', 'user', ?, ?, CURRENT_TIMESTAMP(3))",
      [
        newExternalId('task'),
        people.claimantA.id,
        firstScope.projectId,
        'Synthetic completed support task for production-canary integration',
        JSON.stringify({ summary: 'Synthetic verified execution result' }),
      ],
    );
    await insertRow(
      pool,
      "INSERT INTO llm_calls (external_id, user_id, task_id, provider, model, purpose, prompt_tokens, completion_tokens, cost_usd, latency_ms, status) VALUES (?, ?, ?, 'openai', 'synthetic-canary-model', 'team-task-canary', 1, 1, '0.000000', 1, 'ok')",
      [newExternalId('llmCall'), people.claimantA.id, supportTaskId],
    );

    const manifestScopes: LifecycleCanaryManifest['scopes'] = [firstScope, secondScope];
    const boundaryDigest = lifecycleCanaryBoundaryDigestForScopes(manifestScopes);
    const attestation = (operatorSlot: 'primary' | 'secondary', confirmedAt: string) => ({
      schemaVersion: 1 as const,
      source: 'holaday-team-task-lifecycle-operator-attestation-v1' as const,
      operatorSlot,
      operatorPrincipal: `ops:${operatorSlot}-human`,
      boundaryDigest,
      confirmedAt,
      confirmedSyntheticBoundary: true as const,
      signature: Buffer.alloc(64, operatorSlot === 'primary' ? 1 : 2).toString('base64'),
    });
    manifest = {
      schemaVersion: 1,
      source: 'holaday-team-task-lifecycle-canary-manifest-v1',
      confirmation: {
        source: 'holaday-team-task-lifecycle-dual-operator-confirmation-v1',
        boundaryDigest,
        primaryAttestation: attestation('primary', '2026-08-31T05:00:00.000Z'),
        secondaryAttestation: attestation('secondary', '2026-08-31T05:05:00.000Z'),
        distinctHumanOperatorsConfirmed: true,
      },
      scopes: manifestScopes,
    };
  });

  afterAll(async () => {
    const mutableEnv = appEnv as typeof appEnv & {
      TEAM_PROJECTS_ENABLED: boolean;
      TEAM_TASK_LIFECYCLE_ENABLED: boolean;
    };
    if (previousTeamProjectsEnabled !== undefined) {
      mutableEnv.TEAM_PROJECTS_ENABLED = previousTeamProjectsEnabled;
    }
    if (previousLifecycleEnabled !== undefined) {
      mutableEnv.TEAM_TASK_LIFECYCLE_ENABLED = previousLifecycleEnabled;
    }
    if (pool) await pool.end();
  });

  it(
    'proves the exact 4 x 2 boundary, Phase 1 smoke, and all 13 production scenarios',
    async () => {
      const adapter = createTeamTaskLifecycleProductionCanary({ db, pool: pool as never });

      await expect(adapter.validateBoundary(manifest)).resolves.toBe(true);
      await expect(adapter.smoke(manifest)).resolves.toEqual({
        personalProjects: true,
        teamProjects: true,
        filePath: true,
      });

      const outcomes: Array<readonly [LifecycleCanaryRole | string, boolean]> = [];
      for (const scenario of LIFECYCLE_CANARY_SCENARIOS) {
        outcomes.push([scenario, await adapter.executeScenario(scenario, manifest)]);
      }
      expect(Object.fromEntries(outcomes)).toEqual(
        Object.fromEntries(LIFECYCLE_CANARY_SCENARIOS.map((scenario) => [scenario, true])),
      );
    },
    TEST_TIMEOUT_MS,
  );
});
