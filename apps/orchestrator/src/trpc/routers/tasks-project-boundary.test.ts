import { drizzle } from 'drizzle-orm/mysql2';
import { describe, expect, it } from 'vitest';
import * as schema from '../../db/schema/index.js';
import { __tasksInternals } from './tasks.js';

describe('personal task project boundary', () => {
  it('requires the target project to remain outside every organization', () => {
    const db = drizzle.mock({ schema, mode: 'default', casing: 'snake_case' });
    const query = __tasksInternals.buildPersonalProjectLookupQuery(db, 41, 'prj_personal').toSQL();

    expect(query.sql).toContain('`projects`.`external_id` = ?');
    expect(query.sql).toContain('`projects`.`user_id` = ?');
    expect(query.sql).toContain('`projects`.`organization_id` is null');
    expect(query.params).toEqual(['prj_personal', 41, 1]);
  });
});
