import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  TEAM_WORK_ITEM_SCHEMA_CONTRACT,
  findTeamWorkItemSchemaViolations,
} from './team-work-item-schema-contract.mjs';

function validInformationSchema() {
  const columns = TEAM_WORK_ITEM_SCHEMA_CONTRACT.columns.map((column) => ({
    table_name: column.table,
    column_name: column.name,
    data_type: column.dataType,
    column_type: column.columnType,
    is_nullable: column.nullable ? 'YES' : 'NO',
    column_default: column.defaultValue ?? null,
    extra: column.extra ?? '',
    generation_expression: column.generationExpression ?? '',
  }));
  const indexes = TEAM_WORK_ITEM_SCHEMA_CONTRACT.indexes.flatMap((index) =>
    index.columns.map((column, offset) => ({
      table_name: index.table,
      index_name: index.name,
      non_unique: index.unique ? 0 : 1,
      seq_in_index: offset + 1,
      column_name: column,
      sub_part: null,
    })),
  );
  const foreignKeys = TEAM_WORK_ITEM_SCHEMA_CONTRACT.foreignKeys.flatMap((foreignKey) =>
    foreignKey.columns.map((column, offset) => ({
      table_name: foreignKey.table,
      constraint_name: foreignKey.name,
      delete_rule: 'RESTRICT',
      ordinal_position: offset + 1,
      column_name: column,
      referenced_table_name: foreignKey.referencedTable,
      referenced_column_name: foreignKey.referencedColumns[offset],
    })),
  );
  return { columns, indexes, foreignKeys };
}

describe('team work item production schema verifier', () => {
  it('accepts the complete lifecycle information_schema contract', () => {
    assert.deepEqual(findTeamWorkItemSchemaViolations(validInformationSchema()), []);
  });

  it('rejects a missing FK and a composite FK in the wrong order', () => {
    const missing = validInformationSchema();
    missing.foreignKeys = missing.foreignKeys.filter(
      (row) => row.constraint_name !== 'fk_team_work_item_assignments_work_item_lineage',
    );
    assert.match(
      findTeamWorkItemSchemaViolations(missing).join('\n'),
      /assignments_work_item_lineage/,
    );

    const reordered = validInformationSchema();
    const rows = reordered.foreignKeys.filter(
      (row) => row.constraint_name === 'fk_team_work_item_reviews_submission_lineage',
    );
    [rows[0].column_name, rows[1].column_name] = [rows[1].column_name, rows[0].column_name];
    assert.match(
      findTeamWorkItemSchemaViolations(reordered).join('\n'),
      /reviews_submission_lineage/,
    );
  });

  it('rejects CASCADE on any lifecycle FK', () => {
    const actual = validInformationSchema();
    actual.foreignKeys[0].delete_rule = 'CASCADE';
    assert.match(findTeamWorkItemSchemaViolations(actual).join('\n'), /RESTRICT/);
  });

  it('rejects a normal column masquerading as the responsible generated key', () => {
    const actual = validInformationSchema();
    const column = actual.columns.find((row) => row.column_name === 'responsible_active_key');
    column.extra = '';
    column.generation_expression = '';
    assert.match(findTeamWorkItemSchemaViolations(actual).join('\n'), /responsible_active_key/);
  });

  it('accepts the escaped generated expression returned by MySQL 8.4', () => {
    const actual = validInformationSchema();
    const column = actual.columns.find((row) => row.column_name === 'responsible_active_key');
    column.generation_expression =
      "(case when ((`role` = _utf8mb4\\'responsible\\') and (`status` = _utf8mb4\\'accepted\\')) then `work_item_id` else NULL end)";
    assert.deepEqual(findTeamWorkItemSchemaViolations(actual), []);
  });

  it('rejects inner grouping that changes AND comparison precedence', () => {
    const actual = validInformationSchema();
    const column = actual.columns.find((row) => row.column_name === 'responsible_active_key');
    column.generation_expression =
      "CASE WHEN (role = 'responsible' AND status) = 'accepted' THEN work_item_id ELSE NULL END";
    assert.match(findTeamWorkItemSchemaViolations(actual).join('\n'), /responsible_active_key/);
  });

  for (const [label, expression] of [
    [
      'not-equal operators',
      "CASE WHEN role <> 'responsible' AND status <> 'accepted' THEN work_item_id ELSE NULL END",
    ],
    [
      'OR instead of AND',
      "CASE WHEN role = 'responsible' OR status = 'accepted' THEN work_item_id ELSE NULL END",
    ],
    [
      'swapped THEN and ELSE values',
      "CASE WHEN role = 'responsible' AND status = 'accepted' THEN NULL ELSE work_item_id END",
    ],
  ]) {
    it(`rejects ${label} in the generated expression`, () => {
      const actual = validInformationSchema();
      const column = actual.columns.find((row) => row.column_name === 'responsible_active_key');
      column.generation_expression = expression;
      assert.match(findTeamWorkItemSchemaViolations(actual).join('\n'), /responsible_active_key/);
    });
  }

  for (const [label, constraintName] of [
    ['organization', 'fk_team_work_items_organization'],
    ['event actor', 'fk_team_work_item_events_actor'],
    ['evidence artifact', 'fk_team_evidence_bindings_artifact'],
    ['evidence task file', 'fk_team_evidence_bindings_task_file'],
    ['AI contributor', 'fk_team_ai_contributions_contributed_by'],
  ]) {
    it(`rejects a missing ${label} foreign key`, () => {
      const actual = validInformationSchema();
      actual.foreignKeys = actual.foreignKeys.filter(
        (row) => row.constraint_name !== constraintName,
      );
      assert.match(findTeamWorkItemSchemaViolations(actual).join('\n'), new RegExp(constraintName));
    });
  }

  it('rejects signed or default-zero work item version metadata', () => {
    const actual = validInformationSchema();
    const column = actual.columns.find(
      (row) => row.table_name === 'team_work_items' && row.column_name === 'version',
    );
    column.column_type = 'int';
    column.column_default = '0';
    assert.match(findTeamWorkItemSchemaViolations(actual).join('\n'), /team_work_items\.version/);
  });

  it('rejects UNIQUE in place of a required non-unique tenant index', () => {
    const actual = validInformationSchema();
    for (const row of actual.indexes.filter(
      (candidate) => candidate.index_name === 'ix_team_work_items_tenant_status',
    )) {
      row.non_unique = 0;
    }
    assert.match(findTeamWorkItemSchemaViolations(actual).join('\n'), /tenant_status/);
  });
});
