import {
  assertNoOwnedRows,
  createRelationalDeleteHandler,
  directUserRows,
  rowsOwnedThroughGrandparent,
  rowsOwnedThroughParent,
} from '../handler-contract.js';

const deferredObjectRows = [
  directUserRows('task_files'),
  directUserRows('evidence_artifacts', 'owner_user_id'),
];
const crossCategoryDependencies = [
  directUserRows('notifications'),
  directUserRows('stock_risk_monitors'),
];

export const taskExecutionClosureHandler = createRelationalDeleteHandler({
  categoryId: 'task_execution',
  preflight: async (context) => {
    // Object-backed file/evidence rows belong to Task 7. Notification and
    // stock-monitor children must be handled by their own governed categories
    // before task parents can be removed without relying on FK side effects.
    await assertNoOwnedRows(context, [...deferredObjectRows, ...crossCategoryDependencies]);
  },
  targets: [
    rowsOwnedThroughGrandparent({
      tableName: 'claim_evidence_links',
      parentTableName: 'claims',
      ownerTableName: 'tasks',
      childParentColumn: 'claim_id',
      parentOwnerColumn: 'task_id',
    }),
    rowsOwnedThroughParent({
      tableName: 'task_action_captures',
      parentTableName: 'tasks',
      childParentColumn: 'task_id',
    }),
    rowsOwnedThroughParent({
      tableName: 'task_steps',
      parentTableName: 'tasks',
      childParentColumn: 'task_id',
    }),
    rowsOwnedThroughParent({
      tableName: 'task_events',
      parentTableName: 'tasks',
      childParentColumn: 'task_id',
    }),
    rowsOwnedThroughParent({
      tableName: 'claims',
      parentTableName: 'tasks',
      childParentColumn: 'task_id',
    }),
    rowsOwnedThroughParent({
      tableName: 'canary_results',
      parentTableName: 'tasks',
      childParentColumn: 'task_id',
    }),
    rowsOwnedThroughGrandparent({
      tableName: 'planned_task_run_items',
      parentTableName: 'planned_task_runs',
      ownerTableName: 'planned_tasks',
      childParentColumn: 'planned_task_run_id',
      parentOwnerColumn: 'planned_task_id',
    }),
    rowsOwnedThroughParent({
      tableName: 'planned_task_runs',
      parentTableName: 'planned_tasks',
      childParentColumn: 'planned_task_id',
    }),
    rowsOwnedThroughParent({
      tableName: 'planned_task_occurrence_overrides',
      parentTableName: 'planned_tasks',
      childParentColumn: 'planned_task_id',
    }),
    rowsOwnedThroughParent({
      tableName: 'planned_task_items',
      parentTableName: 'planned_tasks',
      childParentColumn: 'planned_task_id',
    }),
    rowsOwnedThroughParent({
      tableName: 'batch_task_items',
      parentTableName: 'batch_tasks',
      childParentColumn: 'batch_id',
    }),
    directUserRows('batch_tasks'),
    directUserRows('planned_tasks'),
    directUserRows('scheduled_tasks'),
    directUserRows('tasks'),
    directUserRows('projects'),
  ],
});
