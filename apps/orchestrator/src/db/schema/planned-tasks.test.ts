import { readFileSync } from 'node:fs';
import { getTableColumns } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  plannedTaskItems,
  plannedTaskOccurrenceOverrides,
  plannedTaskRunItems,
  plannedTaskRuns,
  plannedTasks,
} from './planned-tasks.js';

describe('planned task schema', () => {
  it('stores the plan definition separately from execution history', () => {
    expect(Object.keys(getTableColumns(plannedTasks))).toEqual(
      expect.arrayContaining([
        'externalId',
        'userId',
        'title',
        'instruction',
        'scope',
        'repeatType',
        'firstRunAt',
        'endsAt',
        'nextRunAt',
        'timezone',
        'status',
        'itemCount',
        'lastRunStatus',
      ]),
    );
    expect(Object.keys(getTableColumns(plannedTaskRuns))).toEqual(
      expect.arrayContaining([
        'externalId',
        'plannedTaskId',
        'title',
        'scheduledFor',
        'seriesScheduledFor',
        'trigger',
        'status',
        'itemsTotal',
      ]),
    );
    expect(getTableColumns(plannedTaskRuns).title.notNull).toBe(true);
  });

  it('creates immutable run titles in the fresh database migration', () => {
    const migration = readFileSync(
      new URL('../../../drizzle/0045_planned_tasks.sql', import.meta.url),
      'utf8',
    );
    const runTable = migration.match(/CREATE TABLE `planned_task_runs` \(([\s\S]*?)\n\);/)?.[1];
    expect(runTable).toContain('`title` VARCHAR(200) NOT NULL');
  });

  it('supports multiple plan items and per-run item results', () => {
    expect(Object.keys(getTableColumns(plannedTaskItems))).toEqual(
      expect.arrayContaining(['externalId', 'plannedTaskId', 'seq', 'instruction', 'enabled']),
    );
    expect(Object.keys(getTableColumns(plannedTaskRunItems))).toEqual(
      expect.arrayContaining([
        'externalId',
        'plannedTaskRunId',
        'plannedTaskItemId',
        'seq',
        'status',
        'taskId',
      ]),
    );
  });

  it('supports one-off edits and deletions without mutating the series', () => {
    expect(Object.keys(getTableColumns(plannedTaskOccurrenceOverrides))).toEqual(
      expect.arrayContaining([
        'externalId',
        'plannedTaskId',
        'originalScheduledFor',
        'action',
        'scheduledFor',
        'instruction',
      ]),
    );
  });
});
