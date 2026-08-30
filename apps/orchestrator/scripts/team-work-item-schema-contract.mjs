const externalIdTables = [
  'team_milestones',
  'team_work_items',
  'team_work_item_assignments',
  'acceptance_contract_versions',
  'team_work_item_submissions',
  'team_work_item_reviews',
  'team_work_item_appeals',
  'team_arbitration_decisions',
  'team_work_item_events',
  'team_evidence_bindings',
  'team_ai_contributions',
];

const index = (table, name, unique, columns) => ({ table, name, unique, columns });
const foreignKey = (table, name, columns, referencedTable, referencedColumns) => ({
  table,
  name,
  columns,
  referencedTable,
  referencedColumns,
});
const column = (table, name, dataType, columnType, nullable, options = {}) => ({
  table,
  name,
  dataType,
  columnType,
  nullable,
  ...options,
});

const tenantIndexes = [
  [
    'team_milestones',
    'ix_team_milestones_tenant_status',
    ['organization_id', 'project_id', 'status'],
  ],
  [
    'team_work_items',
    'ix_team_work_items_tenant_status',
    ['organization_id', 'project_id', 'status'],
  ],
  [
    'team_work_item_assignments',
    'ix_team_work_item_assignments_tenant_status',
    ['organization_id', 'project_id', 'status'],
  ],
  [
    'team_work_item_dependencies',
    'ix_team_work_item_dependencies_tenant',
    ['organization_id', 'project_id'],
  ],
  [
    'acceptance_contract_versions',
    'ix_acceptance_contract_versions_tenant',
    ['organization_id', 'project_id', 'work_item_id'],
  ],
  [
    'team_work_item_submissions',
    'ix_team_work_item_submissions_tenant',
    ['organization_id', 'project_id', 'work_item_id'],
  ],
  [
    'team_work_item_reviews',
    'ix_team_work_item_reviews_tenant_decision',
    ['organization_id', 'project_id', 'decision'],
  ],
  [
    'team_work_item_appeals',
    'ix_team_work_item_appeals_tenant_status',
    ['organization_id', 'project_id', 'status'],
  ],
  [
    'team_arbitration_decisions',
    'ix_team_arbitration_decisions_tenant',
    ['organization_id', 'project_id', 'decided_at'],
  ],
  [
    'team_work_item_events',
    'ix_team_work_item_events_tenant_type',
    ['organization_id', 'project_id', 'event_type'],
  ],
  [
    'team_evidence_bindings',
    'ix_team_evidence_bindings_tenant',
    ['organization_id', 'project_id', 'work_item_id'],
  ],
  [
    'team_ai_contributions',
    'ix_team_ai_contributions_tenant',
    ['organization_id', 'project_id', 'work_item_id'],
  ],
].map(([table, name, columns]) => index(table, name, false, columns));

const lineageIndexes = [
  index('projects', 'uk_projects_id_organization', true, ['id', 'organization_id']),
  index('tasks', 'uk_tasks_id_project_user', true, ['id', 'project_id', 'user_id']),
  index('team_milestones', 'uk_team_milestones_id_tenant', true, [
    'id',
    'organization_id',
    'project_id',
  ]),
  index('team_work_items', 'uk_team_work_items_id_tenant', true, [
    'id',
    'organization_id',
    'project_id',
  ]),
  index('acceptance_contract_versions', 'uk_acceptance_contract_versions_id_lineage', true, [
    'id',
    'work_item_id',
    'organization_id',
    'project_id',
  ]),
  index('team_work_item_submissions', 'uk_team_work_item_submissions_id_lineage', true, [
    'id',
    'contract_version_id',
    'work_item_id',
    'organization_id',
    'project_id',
  ]),
  index('team_work_item_submissions', 'uk_team_work_item_submissions_id_tenant_item', true, [
    'id',
    'work_item_id',
    'organization_id',
    'project_id',
  ]),
  index('team_work_item_reviews', 'uk_team_work_item_reviews_id_lineage', true, [
    'id',
    'submission_id',
    'work_item_id',
    'organization_id',
    'project_id',
  ]),
  index('team_work_item_reviews', 'uk_team_work_item_reviews_id_tenant_item', true, [
    'id',
    'work_item_id',
    'organization_id',
    'project_id',
  ]),
  index('team_work_item_appeals', 'uk_team_work_item_appeals_id_tenant_item', true, [
    'id',
    'work_item_id',
    'organization_id',
    'project_id',
  ]),
  index('team_ai_contributions', 'uk_team_ai_contributions_id_tenant_item', true, [
    'id',
    'work_item_id',
    'organization_id',
    'project_id',
  ]),
];

const businessIndexes = [
  ...externalIdTables.map((table) =>
    index(table, `uk_${table}_external_id`, true, ['external_id']),
  ),
  index('team_work_item_assignments', 'uk_team_work_item_assignments_responsible_active', true, [
    'responsible_active_key',
  ]),
  index('team_work_item_dependencies', 'uk_team_work_item_dependencies_edge', true, [
    'work_item_id',
    'depends_on_work_item_id',
  ]),
  index('acceptance_contract_versions', 'uk_acceptance_contract_versions_work_item_version', true, [
    'work_item_id',
    'version',
  ]),
  index('team_work_item_submissions', 'uk_team_work_item_submissions_work_item_version', true, [
    'work_item_id',
    'submission_version',
  ]),
  index('team_work_item_reviews', 'uk_team_work_item_reviews_submission', true, ['submission_id']),
  index('team_work_item_appeals', 'uk_team_work_item_appeals_submission', true, ['submission_id']),
  index('team_arbitration_decisions', 'uk_team_arbitration_decisions_appeal', true, ['appeal_id']),
  index('team_work_item_events', 'uk_team_work_item_events_organization_idempotency', true, [
    'organization_id',
    'idempotency_key',
  ]),
];

const workItemLineage = (table, name) =>
  foreignKey(table, name, ['work_item_id', 'organization_id', 'project_id'], 'team_work_items', [
    'id',
    'organization_id',
    'project_id',
  ]);

export const TEAM_WORK_ITEM_SCHEMA_CONTRACT = {
  indexes: [...businessIndexes, ...tenantIndexes, ...lineageIndexes],
  foreignKeys: [
    foreignKey(
      'team_milestones',
      'fk_team_milestones_organization',
      ['organization_id'],
      'organizations',
      ['id'],
    ),
    foreignKey(
      'team_milestones',
      'fk_team_milestones_created_by',
      ['created_by_user_id'],
      'users',
      ['id'],
    ),
    foreignKey(
      'team_work_items',
      'fk_team_work_items_organization',
      ['organization_id'],
      'organizations',
      ['id'],
    ),
    foreignKey(
      'team_work_items',
      'fk_team_work_items_created_by',
      ['created_by_user_id'],
      'users',
      ['id'],
    ),
    foreignKey(
      'team_work_item_assignments',
      'fk_team_work_item_assignments_organization',
      ['organization_id'],
      'organizations',
      ['id'],
    ),
    foreignKey(
      'team_work_item_assignments',
      'fk_team_work_item_assignments_user',
      ['user_id'],
      'users',
      ['id'],
    ),
    foreignKey(
      'team_work_item_assignments',
      'fk_team_work_item_assignments_offered_by',
      ['offered_by_user_id'],
      'users',
      ['id'],
    ),
    foreignKey(
      'team_work_item_dependencies',
      'fk_team_work_item_dependencies_organization',
      ['organization_id'],
      'organizations',
      ['id'],
    ),
    foreignKey(
      'team_work_item_dependencies',
      'fk_team_work_item_dependencies_created_by',
      ['created_by_user_id'],
      'users',
      ['id'],
    ),
    foreignKey(
      'acceptance_contract_versions',
      'fk_acceptance_contract_versions_organization',
      ['organization_id'],
      'organizations',
      ['id'],
    ),
    foreignKey(
      'acceptance_contract_versions',
      'fk_acceptance_contract_versions_approver',
      ['approver_user_id'],
      'users',
      ['id'],
    ),
    foreignKey(
      'acceptance_contract_versions',
      'fk_acceptance_contract_versions_arbitrator',
      ['arbitrator_user_id'],
      'users',
      ['id'],
    ),
    foreignKey(
      'acceptance_contract_versions',
      'fk_acceptance_contract_versions_created_by',
      ['created_by_user_id'],
      'users',
      ['id'],
    ),
    foreignKey(
      'acceptance_contract_versions',
      'fk_acceptance_contract_versions_confirmed_by',
      ['confirmed_by_user_id'],
      'users',
      ['id'],
    ),
    foreignKey(
      'team_work_item_submissions',
      'fk_team_work_item_submissions_organization',
      ['organization_id'],
      'organizations',
      ['id'],
    ),
    foreignKey(
      'team_work_item_submissions',
      'fk_team_work_item_submissions_submitted_by',
      ['submitted_by_user_id'],
      'users',
      ['id'],
    ),
    foreignKey(
      'team_work_item_reviews',
      'fk_team_work_item_reviews_organization',
      ['organization_id'],
      'organizations',
      ['id'],
    ),
    foreignKey(
      'team_work_item_reviews',
      'fk_team_work_item_reviews_reviewer',
      ['reviewer_user_id'],
      'users',
      ['id'],
    ),
    foreignKey(
      'team_work_item_appeals',
      'fk_team_work_item_appeals_organization',
      ['organization_id'],
      'organizations',
      ['id'],
    ),
    foreignKey(
      'team_work_item_appeals',
      'fk_team_work_item_appeals_opened_by',
      ['opened_by_user_id'],
      'users',
      ['id'],
    ),
    foreignKey(
      'team_arbitration_decisions',
      'fk_team_arbitration_decisions_organization',
      ['organization_id'],
      'organizations',
      ['id'],
    ),
    foreignKey(
      'team_arbitration_decisions',
      'fk_team_arbitration_decisions_arbitrator',
      ['arbitrator_user_id'],
      'users',
      ['id'],
    ),
    foreignKey(
      'team_work_item_events',
      'fk_team_work_item_events_organization',
      ['organization_id'],
      'organizations',
      ['id'],
    ),
    foreignKey(
      'team_work_item_events',
      'fk_team_work_item_events_actor',
      ['actor_user_id'],
      'users',
      ['id'],
    ),
    foreignKey(
      'team_evidence_bindings',
      'fk_team_evidence_bindings_organization',
      ['organization_id'],
      'organizations',
      ['id'],
    ),
    foreignKey(
      'team_evidence_bindings',
      'fk_team_evidence_bindings_artifact',
      ['evidence_artifact_id'],
      'evidence_artifacts',
      ['id'],
    ),
    foreignKey(
      'team_evidence_bindings',
      'fk_team_evidence_bindings_task_file',
      ['task_file_id'],
      'task_files',
      ['id'],
    ),
    foreignKey(
      'team_evidence_bindings',
      'fk_team_evidence_bindings_bound_by',
      ['bound_by_user_id'],
      'users',
      ['id'],
    ),
    foreignKey(
      'team_ai_contributions',
      'fk_team_ai_contributions_organization',
      ['organization_id'],
      'organizations',
      ['id'],
    ),
    foreignKey(
      'team_ai_contributions',
      'fk_team_ai_contributions_contributed_by',
      ['contributed_by_user_id'],
      'users',
      ['id'],
    ),
    foreignKey(
      'team_milestones',
      'fk_team_milestones_project_tenant',
      ['project_id', 'organization_id'],
      'projects',
      ['id', 'organization_id'],
    ),
    foreignKey(
      'team_work_items',
      'fk_team_work_items_project_tenant',
      ['project_id', 'organization_id'],
      'projects',
      ['id', 'organization_id'],
    ),
    foreignKey(
      'team_work_items',
      'fk_team_work_items_milestone_lineage',
      ['milestone_id', 'organization_id', 'project_id'],
      'team_milestones',
      ['id', 'organization_id', 'project_id'],
    ),
    foreignKey(
      'team_work_items',
      'fk_team_work_items_current_contract_lineage',
      ['current_contract_version_id', 'id', 'organization_id', 'project_id'],
      'acceptance_contract_versions',
      ['id', 'work_item_id', 'organization_id', 'project_id'],
    ),
    workItemLineage(
      'team_work_item_assignments',
      'fk_team_work_item_assignments_work_item_lineage',
    ),
    workItemLineage(
      'team_work_item_dependencies',
      'fk_team_work_item_dependencies_work_item_lineage',
    ),
    foreignKey(
      'team_work_item_dependencies',
      'fk_team_work_item_dependencies_predecessor_lineage',
      ['depends_on_work_item_id', 'organization_id', 'project_id'],
      'team_work_items',
      ['id', 'organization_id', 'project_id'],
    ),
    workItemLineage(
      'acceptance_contract_versions',
      'fk_acceptance_contract_versions_work_item_lineage',
    ),
    workItemLineage(
      'team_work_item_submissions',
      'fk_team_work_item_submissions_work_item_lineage',
    ),
    foreignKey(
      'team_work_item_submissions',
      'fk_team_work_item_submissions_contract_lineage',
      ['contract_version_id', 'work_item_id', 'organization_id', 'project_id'],
      'acceptance_contract_versions',
      ['id', 'work_item_id', 'organization_id', 'project_id'],
    ),
    workItemLineage('team_work_item_reviews', 'fk_team_work_item_reviews_work_item_lineage'),
    foreignKey(
      'team_work_item_reviews',
      'fk_team_work_item_reviews_submission_lineage',
      ['submission_id', 'contract_version_id', 'work_item_id', 'organization_id', 'project_id'],
      'team_work_item_submissions',
      ['id', 'contract_version_id', 'work_item_id', 'organization_id', 'project_id'],
    ),
    workItemLineage('team_work_item_appeals', 'fk_team_work_item_appeals_work_item_lineage'),
    foreignKey(
      'team_work_item_appeals',
      'fk_team_work_item_appeals_review_lineage',
      ['review_id', 'submission_id', 'work_item_id', 'organization_id', 'project_id'],
      'team_work_item_reviews',
      ['id', 'submission_id', 'work_item_id', 'organization_id', 'project_id'],
    ),
    workItemLineage(
      'team_arbitration_decisions',
      'fk_team_arbitration_decisions_work_item_lineage',
    ),
    foreignKey(
      'team_arbitration_decisions',
      'fk_team_arbitration_decisions_appeal_lineage',
      ['appeal_id', 'work_item_id', 'organization_id', 'project_id'],
      'team_work_item_appeals',
      ['id', 'work_item_id', 'organization_id', 'project_id'],
    ),
    workItemLineage('team_work_item_events', 'fk_team_work_item_events_work_item_lineage'),
    foreignKey(
      'team_work_item_events',
      'fk_team_work_item_events_contract_lineage',
      ['contract_version_id', 'work_item_id', 'organization_id', 'project_id'],
      'acceptance_contract_versions',
      ['id', 'work_item_id', 'organization_id', 'project_id'],
    ),
    workItemLineage('team_evidence_bindings', 'fk_team_evidence_bindings_work_item_lineage'),
    foreignKey(
      'team_evidence_bindings',
      'fk_team_evidence_bindings_submission_lineage',
      ['submission_id', 'work_item_id', 'organization_id', 'project_id'],
      'team_work_item_submissions',
      ['id', 'work_item_id', 'organization_id', 'project_id'],
    ),
    foreignKey(
      'team_evidence_bindings',
      'fk_team_evidence_bindings_review_lineage',
      ['review_id', 'work_item_id', 'organization_id', 'project_id'],
      'team_work_item_reviews',
      ['id', 'work_item_id', 'organization_id', 'project_id'],
    ),
    foreignKey(
      'team_evidence_bindings',
      'fk_team_evidence_bindings_appeal_lineage',
      ['appeal_id', 'work_item_id', 'organization_id', 'project_id'],
      'team_work_item_appeals',
      ['id', 'work_item_id', 'organization_id', 'project_id'],
    ),
    foreignKey(
      'team_evidence_bindings',
      'fk_team_evidence_bindings_ai_lineage',
      ['ai_contribution_id', 'work_item_id', 'organization_id', 'project_id'],
      'team_ai_contributions',
      ['id', 'work_item_id', 'organization_id', 'project_id'],
    ),
    workItemLineage('team_ai_contributions', 'fk_team_ai_contributions_work_item_lineage'),
    foreignKey(
      'team_ai_contributions',
      'fk_team_ai_contributions_execution_task_lineage',
      ['execution_task_id', 'project_id', 'contributed_by_user_id'],
      'tasks',
      ['id', 'project_id', 'user_id'],
    ),
  ],
  columns: [
    column('team_work_items', 'title', 'varchar', 'varchar(255)', false),
    column('team_work_items', 'version', 'int', 'int unsigned', false, { defaultValue: '1' }),
    column('team_work_items', 'blocker_json', 'json', 'json', true),
    column('team_work_items', 'milestone_id', 'bigint', 'bigint unsigned', true),
    column('team_work_items', 'current_contract_version_id', 'bigint', 'bigint unsigned', true),
    column(
      'team_work_item_assignments',
      'responsible_active_key',
      'bigint',
      'bigint unsigned',
      true,
      {
        extra: 'STORED GENERATED',
        generationExpression:
          "CASE WHEN role = 'responsible' AND status = 'accepted' THEN work_item_id ELSE NULL END",
      },
    ),
    column('acceptance_contract_versions', 'deliverables_json', 'json', 'json', false),
    column('acceptance_contract_versions', 'criteria_json', 'json', 'json', false),
    column('acceptance_contract_versions', 'required_evidence_types_json', 'json', 'json', false),
    column('team_work_item_submissions', 'deliverables_json', 'json', 'json', false),
    column('team_work_item_reviews', 'failed_criterion_ids_json', 'json', 'json', true),
    column('team_work_item_reviews', 'evidence_refs_json', 'json', 'json', true),
    column('team_work_item_reviews', 'revision_instructions_json', 'json', 'json', true),
    column('team_arbitration_decisions', 'conflict_snapshot_json', 'json', 'json', false),
    column('team_arbitration_decisions', 'criterion_ids_json', 'json', 'json', false),
    column('team_arbitration_decisions', 'evidence_refs_json', 'json', 'json', false),
    column('team_work_item_events', 'contract_version_id', 'bigint', 'bigint unsigned', true),
    column('team_work_item_events', 'metadata_json', 'json', 'json', true),
    column('team_evidence_bindings', 'submission_id', 'bigint', 'bigint unsigned', true),
    column('team_evidence_bindings', 'review_id', 'bigint', 'bigint unsigned', true),
    column('team_evidence_bindings', 'appeal_id', 'bigint', 'bigint unsigned', true),
    column('team_evidence_bindings', 'ai_contribution_id', 'bigint', 'bigint unsigned', true),
    column('team_evidence_bindings', 'metadata_json', 'json', 'json', true),
    column('team_ai_contributions', 'input_source_summary_json', 'json', 'json', false),
    column('team_ai_contributions', 'usage_snapshot_json', 'json', 'json', false),
    column('team_ai_contributions', 'unverified_risks_json', 'json', 'json', false),
  ],
};

function normalizeExpression(value) {
  return String(value ?? '')
    .toLowerCase()
    .replaceAll('`', '')
    .replace(/_utf8mb4/g, '')
    .replaceAll("\\'", "'")
    .replace(/[()\s]+/g, ' ')
    .trim();
}

export function findTeamWorkItemSchemaViolations({ columns, indexes, foreignKeys }) {
  const violations = [];
  const indexGroups = new Map();
  for (const row of indexes) {
    const key = `${row.table_name}\0${row.index_name}`;
    indexGroups.set(key, [...(indexGroups.get(key) ?? []), row]);
  }
  for (const required of TEAM_WORK_ITEM_SCHEMA_CONTRACT.indexes) {
    const actual = (indexGroups.get(`${required.table}\0${required.name}`) ?? [])
      .slice()
      .sort((a, b) => Number(a.seq_in_index) - Number(b.seq_in_index));
    const actualColumns = actual.map((row) => row.column_name);
    const actualUnique = actual.length > 0 && actual.every((row) => Number(row.non_unique) === 0);
    if (
      actualColumns.length !== required.columns.length ||
      actualColumns.some((name, position) => name !== required.columns[position]) ||
      actualUnique !== required.unique ||
      actual.some((row) => row.sub_part != null)
    ) {
      violations.push(
        `index ${required.table}.${required.name} must be ${required.unique ? 'UNIQUE ' : ''}(${required.columns.join(', ')})`,
      );
    }
  }

  const foreignKeyGroups = new Map();
  for (const row of foreignKeys) {
    const key = `${row.table_name}\0${row.constraint_name}`;
    foreignKeyGroups.set(key, [...(foreignKeyGroups.get(key) ?? []), row]);
    if (row.table_name.startsWith('team_') || row.table_name === 'acceptance_contract_versions') {
      if (String(row.delete_rule).toUpperCase() !== 'RESTRICT') {
        violations.push(
          `foreign key ${row.table_name}.${row.constraint_name} must use ON DELETE RESTRICT`,
        );
      }
    }
  }
  for (const required of TEAM_WORK_ITEM_SCHEMA_CONTRACT.foreignKeys) {
    const actual = (foreignKeyGroups.get(`${required.table}\0${required.name}`) ?? [])
      .slice()
      .sort((a, b) => Number(a.ordinal_position) - Number(b.ordinal_position));
    const matches =
      actual.length === required.columns.length &&
      actual.every(
        (row, position) =>
          row.column_name === required.columns[position] &&
          row.referenced_table_name === required.referencedTable &&
          row.referenced_column_name === required.referencedColumns[position] &&
          String(row.delete_rule).toUpperCase() === 'RESTRICT',
      );
    if (!matches) {
      violations.push(
        `foreign key ${required.table}.${required.name} must map (${required.columns.join(', ')}) to ${required.referencedTable}(${required.referencedColumns.join(', ')}) ON DELETE RESTRICT`,
      );
    }
  }

  const columnRows = new Map(columns.map((row) => [`${row.table_name}\0${row.column_name}`, row]));
  for (const required of TEAM_WORK_ITEM_SCHEMA_CONTRACT.columns) {
    const actual = columnRows.get(`${required.table}\0${required.name}`);
    const baseMatches =
      actual &&
      String(actual.data_type).toLowerCase() === required.dataType &&
      String(actual.column_type).toLowerCase() === required.columnType &&
      (String(actual.is_nullable).toUpperCase() === 'YES') === required.nullable;
    let matches = baseMatches;
    if (matches && Object.hasOwn(required, 'defaultValue')) {
      matches = String(actual.column_default) === required.defaultValue;
    }
    if (matches && required.extra) {
      matches = String(actual.extra).toUpperCase().includes(required.extra);
      const expression = normalizeExpression(actual.generation_expression);
      matches = matches && expression === normalizeExpression(required.generationExpression);
    }
    if (!matches) violations.push(`column ${required.table}.${required.name} has invalid metadata`);
  }
  return [...new Set(violations)];
}
