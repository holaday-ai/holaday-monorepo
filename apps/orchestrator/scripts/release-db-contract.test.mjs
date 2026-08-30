import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { describe, it } from 'node:test';
import ts from 'typescript';
import {
  STOCK_PREFERENCE_REQUIRED_COLUMNS,
  STOCK_PREFERENCE_REQUIRED_TABLES,
  assertDatabaseReadyForAppRollout,
  findDuplicateMigrationNumbers,
  findMissingRequiredIndexes,
  findMissingRequiredPreAppRolloutMigrations,
  findNonAdditiveMigrationStatements,
  isSkippableAlreadyAppliedError,
  splitMigrationStatements,
} from './release-db-contract.mjs';
import { TEAM_WORK_ITEM_SCHEMA_CONTRACT } from './team-work-item-schema-contract.mjs';

const TEAM_WORK_ITEM_LIFECYCLE_MIGRATION = '0056_team_work_item_lifecycle.sql';
const TEAM_WORK_ITEM_REVIEW_ATTEMPT_MIGRATION = '0057_team_work_item_review_attempts.sql';
const TEAM_WORK_ITEM_TABLES = [
  'team_milestones',
  'team_work_items',
  'team_work_item_assignments',
  'team_work_item_dependencies',
  'acceptance_contract_versions',
  'team_work_item_submissions',
  'team_work_item_reviews',
  'team_task_review_delegations',
  'team_work_item_appeals',
  'team_arbitration_decisions',
  'team_work_item_events',
  'team_project_planning_events',
  'team_evidence_bindings',
  'team_ai_contributions',
];

function readTeamWorkItemLifecycleMigration() {
  return readFileSync(
    new URL(`../drizzle/${TEAM_WORK_ITEM_LIFECYCLE_MIGRATION}`, import.meta.url),
    'utf8',
  );
}

function readTeamWorkItemReviewAttemptMigration() {
  return readFileSync(
    new URL(`../drizzle/${TEAM_WORK_ITEM_REVIEW_ATTEMPT_MIGRATION}`, import.meta.url),
    'utf8',
  );
}

describe('numbered migration filename contract', () => {
  it('rejects two migrations with the same numeric prefix', () => {
    assert.deepEqual(
      findDuplicateMigrationNumbers([
        '0045_planned_tasks.sql',
        '0046_energy_analytics.sql',
        '0046_tasks_source_context.sql',
      ]),
      ['0046'],
    );
  });

  it('keeps the shipped migration directory free of duplicate numeric prefixes', () => {
    const files = readdirSync(new URL('../drizzle/', import.meta.url));
    assert.deepEqual(findDuplicateMigrationNumbers(files), []);
  });

  it('ships the team project foundation migration exactly once', () => {
    const files = readdirSync(new URL('../drizzle/', import.meta.url));
    assert.equal(files.filter((file) => file === '0055_team_project_foundation.sql').length, 1);
  });

  it('ships the additive team work item lifecycle migration exactly once', () => {
    const files = readdirSync(new URL('../drizzle/', import.meta.url));
    assert.equal(files.filter((file) => file === TEAM_WORK_ITEM_LIFECYCLE_MIGRATION).length, 1);

    const statements = splitMigrationStatements(readTeamWorkItemLifecycleMigration());
    assert.deepEqual(findNonAdditiveMigrationStatements(statements), []);
  });

  it('ships the next review-attempt migration and verifies its final column and unique key', () => {
    const files = readdirSync(new URL('../drizzle/', import.meta.url));
    assert.equal(
      files.filter((file) => file === TEAM_WORK_ITEM_REVIEW_ATTEMPT_MIGRATION).length,
      1,
    );
    const migration = readTeamWorkItemReviewAttemptMigration();
    assert.match(
      migration,
      /ALTER TABLE `team_work_item_reviews`[\s\S]*?ADD COLUMN `review_attempt` INT UNSIGNED NOT NULL DEFAULT 1[\s\S]*?DROP INDEX `uk_team_work_item_reviews_submission`[\s\S]*?ADD UNIQUE KEY `uk_team_work_item_reviews_submission_attempt` \(`submission_id`, `review_attempt`\)/,
    );
    const verifier = readFileSync(new URL('./verify-db-schema.ts', import.meta.url), 'utf8');
    assert.match(verifier, /team_work_item_reviews:\s*\[[\s\S]*?'review_attempt'/);
    assert.match(
      verifier,
      /name: 'uk_team_work_item_reviews_submission_attempt',[\s\S]*?columns: \['submission_id', 'review_attempt'\]/,
    );
  });

  it('ships closure migrations as discoverable additive migrations', () => {
    const files = readdirSync(new URL('../drizzle/', import.meta.url));
    const statements = ['0051_account_closures.sql', '0052_feedback_cases.sql'].flatMap(
      (migration) =>
        splitMigrationStatements(
          readFileSync(new URL(`../drizzle/${migration}`, import.meta.url), 'utf8'),
        ),
    );

    assert.deepEqual(findMissingRequiredPreAppRolloutMigrations(files), []);
    assert.deepEqual(findNonAdditiveMigrationStatements(statements), []);
  });

  it('preserves the existing non-login system principal during closure migration', () => {
    const migration = readFileSync(
      new URL('../drizzle/0051_account_closures.sql', import.meta.url),
      'utf8',
    );

    assert.match(
      migration,
      /CHECK \(`status` IN \('active', 'system', 'suspended', 'closure_pending', 'closure_processing', 'closed'\)\)/,
    );
  });

  it('requires migrations 0051 and 0052 before application rollout', () => {
    assert.throws(
      () => assertDatabaseReadyForAppRollout(['0050_user_mfa.sql']),
      /0051_account_closures\.sql, 0052_feedback_cases\.sql/,
    );
    assert.throws(
      () => assertDatabaseReadyForAppRollout(['0050_user_mfa.sql', '0051_account_closures.sql']),
      /0052_feedback_cases\.sql/,
    );
    assert.doesNotThrow(() =>
      assertDatabaseReadyForAppRollout([
        '0050_user_mfa.sql',
        '0051_account_closures.sql',
        '0052_feedback_cases.sql',
      ]),
    );
  });

  it('keeps active and restricted feedback case states mutually exclusive', () => {
    const migration = readFileSync(
      new URL('../drizzle/0052_feedback_cases.sql', import.meta.url),
      'utf8',
    );
    assert.match(migration, /ck_feedback_cases_active_or_restricted/);
    assert.match(
      migration,
      /closure_request_id` IS NULL[\s\S]*user_id` IS NOT NULL[\s\S]*message` IS NOT NULL/,
    );
    assert.match(
      migration,
      /closure_request_id` IS NOT NULL[\s\S]*user_id` IS NULL[\s\S]*hold_reason` IS NOT NULL[\s\S]*message` IS NULL[\s\S]*context` IS NULL[\s\S]*user_agent` IS NULL/,
    );
  });

  it('includes the governed feedback table in the production schema verifier', () => {
    const verifier = readFileSync(new URL('./verify-db-schema.ts', import.meta.url), 'utf8');
    assert.match(verifier, /REQUIRED_TABLES[\s\S]*'feedback_cases'/);
    assert.match(
      verifier,
      /feedback_cases:\s*\[[\s\S]*'external_id'[\s\S]*'user_id'[\s\S]*'closure_request_id'[\s\S]*'message'[\s\S]*'context'[\s\S]*'user_agent'[\s\S]*'hold_reason'[\s\S]*'restricted_at'[\s\S]*'created_at'/,
    );
  });

  it('keeps the production schema verifier syntactically valid TypeScript', () => {
    const verifier = readFileSync(new URL('./verify-db-schema.ts', import.meta.url), 'utf8');
    const compiled = ts.transpileModule(verifier, {
      compilerOptions: { module: ts.ModuleKind.NodeNext, target: ts.ScriptTarget.ES2022 },
      fileName: 'verify-db-schema.ts',
      reportDiagnostics: true,
    });
    const syntaxErrors = (compiled.diagnostics ?? [])
      .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)
      .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
    assert.deepEqual(syntaxErrors, []);
  });
});

describe('team work item lifecycle schema contract', () => {
  it('enforces tenant and immutable-parent lineage with ordered composite foreign keys', () => {
    const migration = readTeamWorkItemLifecycleMigration();
    const normalizedMigration = migration.replace(/\s+/g, ' ');
    const requiredFragments = [
      /ALTER TABLE `projects` ADD UNIQUE KEY `uk_projects_id_organization` \(`id`, `organization_id`\)/,
      /ALTER TABLE `tasks` ADD UNIQUE KEY `uk_tasks_id_project_user` \(`id`, `project_id`, `user_id`\)/,
      /CONSTRAINT `fk_team_milestones_project_tenant`[\s\S]*?FOREIGN KEY \(`project_id`, `organization_id`\) REFERENCES `projects` \(`id`, `organization_id`\) ON DELETE RESTRICT/,
      /UNIQUE KEY `uk_team_work_items_id_tenant` \(`id`, `organization_id`, `project_id`\)/,
      /CONSTRAINT `fk_team_work_items_current_contract_lineage`[\s\S]*?FOREIGN KEY \(`current_contract_version_id`, `id`, `organization_id`, `project_id`\) REFERENCES `acceptance_contract_versions` \(`id`, `work_item_id`, `organization_id`, `project_id`\) ON DELETE RESTRICT/,
      /CONSTRAINT `fk_team_work_item_dependencies_predecessor_lineage`[\s\S]*?FOREIGN KEY \(`depends_on_work_item_id`, `organization_id`, `project_id`\) REFERENCES `team_work_items` \(`id`, `organization_id`, `project_id`\) ON DELETE RESTRICT/,
      /CONSTRAINT `fk_team_work_item_submissions_contract_lineage`[\s\S]*?FOREIGN KEY \(`contract_version_id`, `work_item_id`, `organization_id`, `project_id`\) REFERENCES `acceptance_contract_versions` \(`id`, `work_item_id`, `organization_id`, `project_id`\) ON DELETE RESTRICT/,
      /CONSTRAINT `fk_team_work_item_reviews_submission_lineage`[\s\S]*?FOREIGN KEY \(`submission_id`, `contract_version_id`, `work_item_id`, `organization_id`, `project_id`\) REFERENCES `team_work_item_submissions` \(`id`, `contract_version_id`, `work_item_id`, `organization_id`, `project_id`\) ON DELETE RESTRICT/,
      /CONSTRAINT `fk_team_work_item_reviews_delegation_lineage`[\s\S]*?FOREIGN KEY \(`review_delegation_id`, `organization_id`, `project_id`, `reviewer_user_id`\) REFERENCES `team_task_review_delegations` \(`id`, `organization_id`, `project_id`, `delegate_user_id`\) ON DELETE RESTRICT/,
      /CONSTRAINT `fk_team_work_item_appeals_review_lineage`[\s\S]*?FOREIGN KEY \(`review_id`, `submission_id`, `work_item_id`, `organization_id`, `project_id`\) REFERENCES `team_work_item_reviews` \(`id`, `submission_id`, `work_item_id`, `organization_id`, `project_id`\) ON DELETE RESTRICT/,
      /CONSTRAINT `fk_team_ai_contributions_execution_task_lineage`[\s\S]*?FOREIGN KEY \(`execution_task_id`, `project_id`, `contributed_by_user_id`\) REFERENCES `tasks` \(`id`, `project_id`, `user_id`\) ON DELETE RESTRICT/,
      /CONSTRAINT `fk_team_evidence_bindings_ai_lineage`[\s\S]*?FOREIGN KEY \(`ai_contribution_id`, `work_item_id`, `organization_id`, `project_id`\) REFERENCES `team_ai_contributions` \(`id`, `work_item_id`, `organization_id`, `project_id`\) ON DELETE RESTRICT/,
    ];
    for (const fragment of requiredFragments) assert.match(migration, fragment);
    for (const foreignKey of TEAM_WORK_ITEM_SCHEMA_CONTRACT.foreignKeys) {
      assert.ok(
        normalizedMigration.includes(
          `CONSTRAINT \`${foreignKey.name}\` FOREIGN KEY (${foreignKey.columns.map((column) => `\`${column}\``).join(', ')}) REFERENCES \`${foreignKey.referencedTable}\` (${foreignKey.referencedColumns.map((column) => `\`${column}\``).join(', ')}) ON DELETE RESTRICT`,
        ),
        `missing ordered composite FK ${foreignKey.name}`,
      );
    }
  });

  it('keeps the migration and canonical verifier FK name sets exactly synchronized', () => {
    const migrationNames = [
      ...readTeamWorkItemLifecycleMigration().matchAll(/CONSTRAINT `([^`]+)`/g),
    ].map(([, name]) => name);
    const contractNames = TEAM_WORK_ITEM_SCHEMA_CONTRACT.foreignKeys.map(({ name }) => name);

    assert.equal(migrationNames.length, 65);
    assert.deepEqual([...migrationNames].sort(), [...contractNames].sort());
  });

  it('creates every lifecycle table and the deferred current-contract foreign key', () => {
    const migration = readTeamWorkItemLifecycleMigration();
    const createdTables = [...migration.matchAll(/CREATE TABLE `([^`]+)`/g)].map(
      ([, table]) => table,
    );

    assert.deepEqual(createdTables, TEAM_WORK_ITEM_TABLES);
    assert.match(
      migration,
      /ALTER TABLE `team_work_items`[\s\S]*ADD COLUMN `current_contract_version_id` BIGINT UNSIGNED NULL[\s\S]*FOREIGN KEY \(`current_contract_version_id`, `id`, `organization_id`, `project_id`\) REFERENCES `acceptance_contract_versions` \(`id`, `work_item_id`, `organization_id`, `project_id`\) ON DELETE RESTRICT/,
    );
  });

  it('uses public external ids while keeping dependency edges internal', () => {
    const migration = readTeamWorkItemLifecycleMigration();
    for (const table of TEAM_WORK_ITEM_TABLES.filter(
      (candidate) => candidate !== 'team_work_item_dependencies',
    )) {
      assert.match(
        migration,
        new RegExp(
          `CREATE TABLE \`${table}\`[\\s\\S]*?UNIQUE KEY \`uk_${table}_external_id\` \\(\`external_id\`\\)`,
        ),
      );
    }
    const dependencyStatement = splitMigrationStatements(migration).find((statement) =>
      statement.startsWith('CREATE TABLE `team_work_item_dependencies`'),
    );
    assert.ok(dependencyStatement);
    assert.doesNotMatch(dependencyStatement, /`external_id`/);
  });

  it('enforces lifecycle uniqueness and tenant query indexes in MySQL DDL', () => {
    const migration = readTeamWorkItemLifecycleMigration();
    const requiredFragments = [
      /`responsible_active_key` BIGINT UNSIGNED GENERATED ALWAYS AS \(CASE WHEN `role` = 'responsible' AND `status` = 'accepted' THEN `work_item_id` ELSE NULL END\) STORED/,
      /UNIQUE KEY `uk_team_work_item_assignments_responsible_active` \(`responsible_active_key`\)/,
      /UNIQUE KEY `uk_team_work_item_dependencies_edge` \(`work_item_id`, `depends_on_work_item_id`\)/,
      /UNIQUE KEY `uk_acceptance_contract_versions_work_item_version` \(`work_item_id`, `version`\)/,
      /UNIQUE KEY `uk_team_work_item_submissions_work_item_version` \(`work_item_id`, `submission_version`\)/,
      /UNIQUE KEY `uk_team_work_item_appeals_submission` \(`submission_id`\)/,
      /UNIQUE KEY `uk_team_work_item_events_organization_idempotency` \(`organization_id`, `idempotency_key`\)/,
      /UNIQUE KEY `uk_team_project_planning_events_organization_idempotency` \(`organization_id`, `idempotency_key`\)/,
      /KEY `ix_team_work_items_tenant_status` \(`organization_id`, `project_id`, `status`\)/,
    ];
    for (const fragment of requiredFragments) assert.match(migration, fragment);
  });

  it('keeps lifecycle, review, appeal, arbitration, event, and audit evidence rows restrictive', () => {
    const migration = readTeamWorkItemLifecycleMigration();
    const foreignKeys = [...migration.matchAll(/FOREIGN KEY \([^;]+?ON DELETE (\w+(?: NULL)?)/g)];
    assert.ok(foreignKeys.length > 0);
    assert.deepEqual([...new Set(foreignKeys.map((match) => match[1]))], ['RESTRICT']);
  });

  it('exports every Drizzle table and verifies lifecycle tables, columns, and indexes', () => {
    const schemaIndex = readFileSync(new URL('../src/db/schema/index.ts', import.meta.url), 'utf8');
    const workItemSchema = readFileSync(
      new URL('../src/db/schema/team-work-items.ts', import.meta.url),
      'utf8',
    );
    const verifier = readFileSync(new URL('./verify-db-schema.ts', import.meta.url), 'utf8');
    const schemaFiles = TEAM_WORK_ITEM_TABLES.map((table) => table.replaceAll('_', '-'));

    for (const schemaFile of schemaFiles) {
      assert.match(schemaIndex, new RegExp(`export \\* from './${schemaFile}\\.js';`));
    }
    for (const table of TEAM_WORK_ITEM_TABLES) {
      assert.match(verifier, new RegExp(`'${table}'`));
    }
    assert.match(verifier, /TEAM_WORK_ITEM_REQUIRED_INDEXES/);
    assert.match(verifier, /responsible_active_key/);
    assert.match(verifier, /current_contract_version_id/);
    assert.match(verifier, /team_project_planning_events/);
    assert.match(verifier, /team_milestones:[\s\S]*?'version'/);
    assert.match(verifier, /usage_snapshot_json/);
    for (const tenantIndex of [
      'ix_team_milestones_tenant_status',
      'ix_team_work_items_tenant_status',
      'ix_team_work_item_assignments_tenant_status',
      'ix_team_work_item_dependencies_tenant',
      'ix_acceptance_contract_versions_tenant',
      'ix_team_work_item_submissions_tenant',
      'ix_team_work_item_reviews_tenant_decision',
      'ix_team_work_item_appeals_tenant_status',
      'ix_team_arbitration_decisions_tenant',
      'ix_team_work_item_events_tenant_type',
      'ix_team_project_planning_events_tenant_type',
      'ix_team_evidence_bindings_tenant',
      'ix_team_ai_contributions_tenant',
    ]) {
      assert.match(verifier, new RegExp(`name: '${tenantIndex}'`));
    }
    assert.match(workItemSchema, /fk_team_work_items_current_contract_lineage/);
    assert.match(workItemSchema, /foreignColumns: currentContractLineageColumns\(\)/);
  });

  it('models bounded and auditable review delegation without cross-project authority', () => {
    const migration = readTeamWorkItemLifecycleMigration();
    assert.match(
      migration,
      /CREATE TABLE `team_task_review_delegations`[\s\S]*?`organization_id` BIGINT UNSIGNED NOT NULL[\s\S]*?`project_id` BIGINT UNSIGNED NOT NULL[\s\S]*?`delegator_user_id` BIGINT UNSIGNED NOT NULL[\s\S]*?`delegate_user_id` BIGINT UNSIGNED NOT NULL[\s\S]*?`valid_from` DATETIME\(3\) NOT NULL[\s\S]*?`valid_until` DATETIME\(3\) NOT NULL[\s\S]*?`revoked_at` DATETIME\(3\) NULL[\s\S]*?`revoked_by_user_id` BIGINT UNSIGNED NULL/,
    );
    assert.match(migration, /CHECK \(`valid_until` > `valid_from`\)/);
    assert.match(migration, /CHECK \(`delegator_user_id` <> `delegate_user_id`\)/);
    assert.match(
      migration,
      /CONSTRAINT `fk_team_task_review_delegations_project_tenant`[\s\S]*?FOREIGN KEY \(`project_id`, `organization_id`\) REFERENCES `projects` \(`id`, `organization_id`\) ON DELETE RESTRICT/,
    );
    assert.match(
      migration,
      /UNIQUE KEY `uk_team_task_review_delegations_id_lineage` \(`id`, `organization_id`, `project_id`, `delegate_user_id`\)/,
    );
    assert.match(
      migration,
      /CREATE TABLE `team_work_item_reviews`[\s\S]*?`review_delegation_id` BIGINT UNSIGNED NULL/,
    );
    const verifier = readFileSync(new URL('./verify-db-schema.ts', import.meta.url), 'utf8');
    assert.match(
      verifier,
      /team_task_review_delegations:\s*\[[\s\S]*?'external_id'[\s\S]*?'organization_id'[\s\S]*?'project_id'[\s\S]*?'delegator_user_id'[\s\S]*?'delegate_user_id'[\s\S]*?'valid_from'[\s\S]*?'valid_until'[\s\S]*?'revoked_at'[\s\S]*?'revoked_by_user_id'[\s\S]*?'created_at'/,
    );
    assert.match(verifier, /team_work_item_reviews:\s*\[[\s\S]*?'review_delegation_id'/);
  });
});

describe('release database table and column contract', () => {
  it('requires the privacy-bounded stock preference schema', () => {
    assert.deepEqual(STOCK_PREFERENCE_REQUIRED_TABLES, [
      'stock_preference_profiles',
      'stock_preference_signals',
    ]);
    assert.deepEqual(STOCK_PREFERENCE_REQUIRED_COLUMNS, {
      stock_preference_profiles: ['user_id', 'enabled', 'manual_preferences_json', 'cleared_at'],
      stock_preference_signals: [
        'user_id',
        'kind',
        'dedupe_hash',
        'payload_json',
        'data_as_of',
        'occurred_at',
      ],
    });
  });
});

describe('numbered migration replay safety', () => {
  it('treats an existing check constraint as an applied migration step', () => {
    assert.equal(isSkippableAlreadyAppliedError({ code: 'ER_CHECK_CONSTRAINT_DUP_NAME' }), true);
  });

  it('treats an already-dropped index as an applied migration step', () => {
    assert.equal(
      isSkippableAlreadyAppliedError(
        { code: 'ER_CANT_DROP_FIELD_OR_KEY' },
        {
          file: '0044_payments_provider_order_unique.sql',
          statement: 'DROP INDEX `ix_payments_provider_order` ON `payments`',
        },
      ),
      true,
    );
  });

  it('treats the Task 9 review-attempt legacy index as already dropped on replay', () => {
    assert.equal(
      isSkippableAlreadyAppliedError(
        { code: 'ER_CANT_DROP_FIELD_OR_KEY' },
        {
          file: '0057_team_work_item_review_attempts.sql',
          statement:
            'ALTER TABLE `team_work_item_reviews`\n  DROP INDEX `uk_team_work_item_reviews_submission`',
        },
      ),
      true,
    );
  });

  it('does not suppress a missing-drop error in another migration', () => {
    assert.equal(
      isSkippableAlreadyAppliedError(
        { code: 'ER_CANT_DROP_FIELD_OR_KEY' },
        {
          file: '0004_task_events_simple_pk.sql',
          statement: 'ALTER TABLE task_events DROP PRIMARY KEY',
        },
      ),
      false,
    );
  });

  it('does not suppress unrelated migration failures', () => {
    assert.equal(
      isSkippableAlreadyAppliedError({
        code: 'ER_PARSE_ERROR',
        message: 'syntax error near already exists',
      }),
      false,
    );
  });

  it('splits a create-index statement followed by a drop-index statement', () => {
    assert.deepEqual(
      splitMigrationStatements(`
        CREATE UNIQUE INDEX \`uk_payments_provider_order\`
          ON \`payments\` (\`provider\`, \`provider_order_id\`);
        DROP INDEX \`ix_payments_provider_order\` ON \`payments\`;
      `),
      [
        'CREATE UNIQUE INDEX `uk_payments_provider_order`\n          ON `payments` (`provider`, `provider_order_id`)',
        'DROP INDEX `ix_payments_provider_order` ON `payments`',
      ],
    );
  });
});

describe('release database index contract', () => {
  function indexRows(table_name, index_name, unique, columns) {
    return columns.map((column_name, index) => ({
      table_name,
      index_name,
      non_unique: unique ? 0 : 1,
      seq_in_index: index + 1,
      column_name,
      sub_part: null,
    }));
  }

  const validRows = [
    {
      table_name: 'feedback_cases',
      index_name: 'uk_feedback_cases_external_id',
      non_unique: 0,
      seq_in_index: 1,
      column_name: 'external_id',
      sub_part: null,
    },
    {
      table_name: 'feedback_cases',
      index_name: 'ix_feedback_cases_user_id_id',
      non_unique: 1,
      seq_in_index: 1,
      column_name: 'user_id',
      sub_part: null,
    },
    {
      table_name: 'feedback_cases',
      index_name: 'ix_feedback_cases_user_id_id',
      non_unique: 1,
      seq_in_index: 2,
      column_name: 'id',
      sub_part: null,
    },
    {
      table_name: 'feedback_cases',
      index_name: 'ix_feedback_cases_closure_request_id',
      non_unique: 1,
      seq_in_index: 1,
      column_name: 'closure_request_id',
      sub_part: null,
    },
    {
      table_name: 'account_closure_requests',
      index_name: 'uk_account_closure_requests_external_id',
      non_unique: 0,
      seq_in_index: 1,
      column_name: 'external_id',
      sub_part: null,
    },
    {
      table_name: 'account_closure_requests',
      index_name: 'uk_account_closure_requests_active_user',
      non_unique: 0,
      seq_in_index: 1,
      column_name: 'active_user_id',
      sub_part: null,
    },
    {
      table_name: 'account_closure_requests',
      index_name: 'ix_account_closure_requests_status_grace',
      non_unique: 1,
      seq_in_index: 1,
      column_name: 'status',
      sub_part: null,
    },
    {
      table_name: 'account_closure_requests',
      index_name: 'ix_account_closure_requests_completion_due',
      non_unique: 1,
      seq_in_index: 1,
      column_name: 'status',
      sub_part: null,
    },
    {
      table_name: 'account_closure_requests',
      index_name: 'ix_account_closure_requests_completion_due',
      non_unique: 1,
      seq_in_index: 2,
      column_name: 'completion_next_attempt_at',
      sub_part: null,
    },
    {
      table_name: 'account_closure_requests',
      index_name: 'ix_account_closure_requests_completion_due',
      non_unique: 1,
      seq_in_index: 3,
      column_name: 'completion_lease_until',
      sub_part: null,
    },
    {
      table_name: 'account_closure_requests',
      index_name: 'ix_account_closure_requests_status_grace',
      non_unique: 1,
      seq_in_index: 2,
      column_name: 'grace_ends_at',
      sub_part: null,
    },
    {
      table_name: 'account_closure_steps',
      index_name: 'uk_account_closure_steps_request_category',
      non_unique: 0,
      seq_in_index: 1,
      column_name: 'request_id',
      sub_part: null,
    },
    {
      table_name: 'account_closure_steps',
      index_name: 'uk_account_closure_steps_request_category',
      non_unique: 0,
      seq_in_index: 2,
      column_name: 'category_id',
      sub_part: null,
    },
    {
      table_name: 'account_closure_steps',
      index_name: 'ix_account_closure_steps_status_next_attempt',
      non_unique: 1,
      seq_in_index: 1,
      column_name: 'status',
      sub_part: null,
    },
    {
      table_name: 'account_closure_steps',
      index_name: 'ix_account_closure_steps_status_next_attempt',
      non_unique: 1,
      seq_in_index: 2,
      column_name: 'next_attempt_at',
      sub_part: null,
    },
    {
      table_name: 'account_closure_steps',
      index_name: 'ix_account_closure_steps_lease_until',
      non_unique: 1,
      seq_in_index: 1,
      column_name: 'lease_until',
      sub_part: null,
    },
    {
      table_name: 'account_closure_effects',
      index_name: 'uk_account_closure_effects_request_resource',
      non_unique: 0,
      seq_in_index: 1,
      column_name: 'request_id',
      sub_part: null,
    },
    {
      table_name: 'account_closure_effects',
      index_name: 'uk_account_closure_effects_request_resource',
      non_unique: 0,
      seq_in_index: 2,
      column_name: 'resource_type',
      sub_part: null,
    },
    {
      table_name: 'account_closure_effects',
      index_name: 'uk_account_closure_effects_request_resource',
      non_unique: 0,
      seq_in_index: 3,
      column_name: 'resource_id',
      sub_part: null,
    },
    {
      table_name: 'account_closure_challenges',
      index_name: 'uk_account_closure_challenges_external_id',
      non_unique: 0,
      seq_in_index: 1,
      column_name: 'external_id',
      sub_part: null,
    },
    {
      table_name: 'account_closure_challenges',
      index_name: 'ix_account_closure_challenges_user_action_expiry',
      non_unique: 1,
      seq_in_index: 1,
      column_name: 'user_id',
      sub_part: null,
    },
    {
      table_name: 'account_closure_challenges',
      index_name: 'ix_account_closure_challenges_user_action_expiry',
      non_unique: 1,
      seq_in_index: 2,
      column_name: 'action',
      sub_part: null,
    },
    {
      table_name: 'account_closure_challenges',
      index_name: 'ix_account_closure_challenges_user_action_expiry',
      non_unique: 1,
      seq_in_index: 3,
      column_name: 'expires_at',
      sub_part: null,
    },
    {
      table_name: 'account_closure_receipts',
      index_name: 'uk_account_closure_receipts_number',
      non_unique: 0,
      seq_in_index: 1,
      column_name: 'receipt_number',
      sub_part: null,
    },
    {
      table_name: 'account_closure_receipts',
      index_name: 'uk_account_closure_receipts_request_kind',
      non_unique: 0,
      seq_in_index: 1,
      column_name: 'request_id',
      sub_part: null,
    },
    {
      table_name: 'account_closure_receipts',
      index_name: 'uk_account_closure_receipts_request_kind',
      non_unique: 0,
      seq_in_index: 2,
      column_name: 'kind',
      sub_part: null,
    },
    {
      table_name: 'payments',
      index_name: 'uk_payments_provider_order',
      non_unique: 0,
      seq_in_index: 1,
      column_name: 'provider',
      sub_part: null,
    },
    {
      table_name: 'payments',
      index_name: 'uk_payments_provider_order',
      non_unique: 0,
      seq_in_index: 2,
      column_name: 'provider_order_id',
      sub_part: null,
    },
    {
      table_name: 'energy_daily_metrics',
      index_name: 'uk_energy_daily_metrics_bucket',
      non_unique: 0,
      seq_in_index: 1,
      column_name: 'metric_date',
      sub_part: null,
    },
    {
      table_name: 'energy_daily_metrics',
      index_name: 'uk_energy_daily_metrics_bucket',
      non_unique: 0,
      seq_in_index: 2,
      column_name: 'bucket_hash',
      sub_part: null,
    },
    {
      table_name: 'energy_daily_metrics',
      index_name: 'ix_energy_daily_metrics_expires_at',
      non_unique: 1,
      seq_in_index: 1,
      column_name: 'expires_at',
      sub_part: null,
    },
    {
      table_name: 'energy_daily_metrics',
      index_name: 'ix_energy_daily_metrics_date_type',
      non_unique: 1,
      seq_in_index: 1,
      column_name: 'metric_date',
      sub_part: null,
    },
    {
      table_name: 'energy_daily_metrics',
      index_name: 'ix_energy_daily_metrics_date_type',
      non_unique: 1,
      seq_in_index: 2,
      column_name: 'event_type',
      sub_part: null,
    },
    {
      table_name: 'energy_daily_visitors',
      index_name: 'uk_energy_daily_visitors_day_hash',
      non_unique: 0,
      seq_in_index: 1,
      column_name: 'activity_date',
      sub_part: null,
    },
    {
      table_name: 'energy_daily_visitors',
      index_name: 'uk_energy_daily_visitors_day_hash',
      non_unique: 0,
      seq_in_index: 2,
      column_name: 'visitor_hash',
      sub_part: null,
    },
    {
      table_name: 'energy_daily_visitors',
      index_name: 'ix_energy_daily_visitors_expires_at',
      non_unique: 1,
      seq_in_index: 1,
      column_name: 'expires_at',
      sub_part: null,
    },
    {
      table_name: 'energy_event_receipts',
      index_name: 'ix_energy_event_receipts_expires_at',
      non_unique: 1,
      seq_in_index: 1,
      column_name: 'expires_at',
      sub_part: null,
    },
    ...indexRows('organizations', 'uk_organizations_external_id', true, ['external_id']),
    ...indexRows('organizations', 'ix_organizations_owner', false, ['owner_user_id']),
    ...indexRows('organizations', 'ix_organizations_status', false, ['status']),
    ...indexRows('organization_members', 'uk_organization_members_external_id', true, [
      'external_id',
    ]),
    ...indexRows('organization_members', 'uk_organization_members_organization_user', true, [
      'organization_id',
      'user_id',
    ]),
    ...indexRows('organization_members', 'ix_organization_members_organization_status', false, [
      'organization_id',
      'status',
    ]),
    ...indexRows('organization_members', 'ix_organization_members_user_status', false, [
      'user_id',
      'status',
    ]),
    ...indexRows('organization_members', 'ix_organization_members_manager_status', false, [
      'organization_id',
      'manager_user_id',
      'status',
    ]),
    ...indexRows('organization_invitations', 'uk_organization_invitations_external_id', true, [
      'external_id',
    ]),
    ...indexRows('organization_invitations', 'uk_organization_invitations_token_hash', true, [
      'token_hash',
    ]),
    ...indexRows('organization_invitations', 'ix_organization_invitations_active', false, [
      'organization_id',
      'accepted_at',
      'revoked_at',
      'expires_at',
    ]),
    ...indexRows('projects', 'ix_projects_organization_id', false, ['organization_id']),
    ...indexRows('project_members', 'uk_project_members_external_id', true, ['external_id']),
    ...indexRows('project_members', 'uk_project_members_project_user', true, [
      'project_id',
      'user_id',
    ]),
    ...indexRows('project_members', 'ix_project_members_project_status', false, [
      'project_id',
      'status',
    ]),
    ...indexRows('project_members', 'ix_project_members_user_status', false, ['user_id', 'status']),
  ];

  it('accepts the required unique payment provider-order index', () => {
    assert.deepEqual(findMissingRequiredIndexes(validRows), []);
  });

  it('rejects an incomplete energy metric bucket key', () => {
    assert.deepEqual(
      findMissingRequiredIndexes(
        validRows.filter(
          (row) =>
            !(
              row.index_name === 'uk_energy_daily_metrics_bucket' &&
              row.column_name === 'bucket_hash'
            ),
        ),
      ),
      ['energy_daily_metrics.uk_energy_daily_metrics_bucket UNIQUE(metric_date, bucket_hash)'],
    );
  });

  it('rejects a non-unique daily visitor identity key', () => {
    assert.deepEqual(
      findMissingRequiredIndexes(
        validRows.map((row) =>
          row.index_name === 'uk_energy_daily_visitors_day_hash' ? { ...row, non_unique: 1 } : row,
        ),
      ),
      [
        'energy_daily_visitors.uk_energy_daily_visitors_day_hash UNIQUE(activity_date, visitor_hash)',
      ],
    );
  });

  it('rejects a non-unique payment provider-order index', () => {
    assert.deepEqual(
      findMissingRequiredIndexes(
        validRows.map((row) =>
          row.index_name === 'uk_payments_provider_order' ? { ...row, non_unique: 1 } : row,
        ),
      ),
      ['payments.uk_payments_provider_order UNIQUE(provider, provider_order_id)'],
    );
  });

  it('rejects an incomplete payment provider-order index', () => {
    assert.deepEqual(
      findMissingRequiredIndexes(
        validRows.filter(
          (row) =>
            !(
              row.index_name === 'uk_payments_provider_order' &&
              row.column_name === 'provider_order_id'
            ),
        ),
      ),
      ['payments.uk_payments_provider_order UNIQUE(provider, provider_order_id)'],
    );
  });

  it('rejects prefix columns and accepts numeric metadata strings in any row order', () => {
    assert.deepEqual(
      findMissingRequiredIndexes(
        validRows.map((row) => ({ ...row, sub_part: row.column_name === 'provider' ? 4 : null })),
      ),
      ['payments.uk_payments_provider_order UNIQUE(provider, provider_order_id)'],
    );
    assert.deepEqual(
      findMissingRequiredIndexes(
        validRows
          .map((row) => ({
            ...row,
            non_unique: String(row.non_unique),
            seq_in_index: String(row.seq_in_index),
          }))
          .reverse(),
      ),
      [],
    );
  });
});
