import { describe, expect, it } from 'vitest';
import {
  PROJECT_TASK_FOREIGN_KEY_QUERY,
  type ProjectTaskForeignKeyRow,
  assertExactProjectTaskForeignKey,
} from './team-project-integration-safety.js';

const exactForeignKey: ProjectTaskForeignKeyRow = {
  constraintName: 'fk_tasks_project_id_projects_id',
  tableName: 'tasks',
  columnName: 'project_id',
  referencedTableName: 'projects',
  referencedColumnName: 'id',
  deleteRule: 'SET NULL',
};

describe('team project integration safety', () => {
  it('joins both information-schema sources using the exact constraint identity', () => {
    const sql = PROJECT_TASK_FOREIGN_KEY_QUERY.toLowerCase().replace(/\s+/g, ' ').trim();

    expect(sql).toContain('information_schema.referential_constraints as rc');
    expect(sql).toContain('information_schema.key_column_usage as kcu');
    expect(sql).toContain('kcu.constraint_schema = rc.constraint_schema');
    expect(sql).toContain('kcu.constraint_name = rc.constraint_name');
    expect(sql).toContain('kcu.table_name = rc.table_name');
    expect(sql).toContain('rc.constraint_schema = database()');
    expect(sql).toContain('kcu.table_schema = database()');
    expect(sql).toContain("rc.table_name = 'tasks'");
    expect(sql).toContain("rc.referenced_table_name = 'projects'");
  });

  it('accepts exactly the required tasks.project_id foreign key', () => {
    expect(() => assertExactProjectTaskForeignKey([exactForeignKey])).not.toThrow();
  });

  it.each([
    ['zero rows', []],
    ['an alternate tasks column', [{ ...exactForeignKey, columnName: 'session_id' }]],
    [
      'a mismatched referenced column',
      [{ ...exactForeignKey, referencedColumnName: 'external_id' }],
    ],
    ['a mismatched delete rule', [{ ...exactForeignKey, deleteRule: 'CASCADE' }]],
    [
      'multiple project foreign keys',
      [exactForeignKey, { ...exactForeignKey, constraintName: 'fk_tasks_alternate' }],
    ],
  ] as const)('rejects %s', (_label, rows) => {
    expect(() => assertExactProjectTaskForeignKey(rows)).toThrow(
      'integration database must have exactly tasks.project_id -> projects.id ON DELETE SET NULL',
    );
  });
});
