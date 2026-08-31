import { describe, expect, it } from 'vitest';
import { DATA_CATEGORY_IDS } from '../data-governance/types.js';
import * as schema from '../db/schema/index.js';
import { ACCOUNT_CLOSURE_TABLE_OWNERSHIP } from './table-ownership.js';

const DRIZZLE_TABLE_NAME = Symbol.for('drizzle:Name');

describe('account closure persistence table ownership', () => {
  it('assigns every exported Drizzle table to exactly one canonical closure category', () => {
    const exportedTableNames = Object.values(schema)
      .map((value) => (value as unknown as Record<symbol, unknown> | null)?.[DRIZZLE_TABLE_NAME])
      .filter((value): value is string => typeof value === 'string')
      .sort();
    const registeredTableNames = ACCOUNT_CLOSURE_TABLE_OWNERSHIP.map(
      (entry) => entry.tableName,
    ).sort();

    expect(new Set(registeredTableNames).size).toBe(registeredTableNames.length);
    expect(registeredTableNames).toEqual(exportedTableNames);
    expect(
      ACCOUNT_CLOSURE_TABLE_OWNERSHIP.every((entry) =>
        DATA_CATEGORY_IDS.includes(entry.categoryId),
      ),
    ).toBe(true);
  });

  it('routes every user-owned video editing table through task execution cleanup', () => {
    const owners = Object.fromEntries(
      ACCOUNT_CLOSURE_TABLE_OWNERSHIP.map(({ tableName, categoryId }) => [tableName, categoryId]),
    );

    expect({
      video_edit_projects: owners.video_edit_projects,
      video_edit_versions: owners.video_edit_versions,
      video_edit_action_quotes: owners.video_edit_action_quotes,
      video_edit_render_attempts: owners.video_edit_render_attempts,
    }).toEqual({
      video_edit_projects: 'task_execution',
      video_edit_versions: 'task_execution',
      video_edit_action_quotes: 'task_execution',
      video_edit_render_attempts: 'task_execution',
    });
  });

  it('routes every team workspace table through task execution cleanup', () => {
    const owners = Object.fromEntries(
      ACCOUNT_CLOSURE_TABLE_OWNERSHIP.map(({ tableName, categoryId }) => [tableName, categoryId]),
    );

    expect({
      organizations: owners.organizations,
      organization_members: owners.organization_members,
      organization_invitations: owners.organization_invitations,
      project_members: owners.project_members,
    }).toEqual({
      organizations: 'task_execution',
      organization_members: 'task_execution',
      organization_invitations: 'task_execution',
      project_members: 'task_execution',
    });
  });

  it('routes all twelve team work-item lifecycle fact tables through task execution', () => {
    const owners = Object.fromEntries(
      ACCOUNT_CLOSURE_TABLE_OWNERSHIP.map(({ tableName, categoryId }) => [tableName, categoryId]),
    );
    const lifecycleFactTables = [
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
    ] as const;

    expect(lifecycleFactTables).toHaveLength(12);
    expect(Object.fromEntries(lifecycleFactTables.map((table) => [table, owners[table]]))).toEqual(
      Object.fromEntries(lifecycleFactTables.map((table) => [table, 'task_execution'])),
    );
  });
});
