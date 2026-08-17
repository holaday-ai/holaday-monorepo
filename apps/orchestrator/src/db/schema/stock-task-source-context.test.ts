import { readFileSync } from 'node:fs';
import { getTableColumns } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { tasks } from './tasks.js';

describe('stock task source context schema', () => {
  it('declares the JSON source context on the tasks table', () => {
    expect(Object.keys(getTableColumns(tasks))).toContain('sourceContext');
  });

  it('adds the source_context column through the numbered migration', () => {
    const migration = readFileSync(
      new URL('../../../drizzle/0047_tasks_source_context.sql', import.meta.url),
      'utf8',
    );
    expect(migration).toMatch(/ALTER TABLE `tasks`[\s\S]*`source_context` JSON NULL/);
  });
});
