import { afterEach, beforeEach, expect, it, vi } from 'vitest';

// Catch missing preflight, treating read errors as safe, or failing to recheck
// immediately before 0042. Real DDL/data effects are covered by MySQL integration.
const fixture = vi.hoisted(() => ({
  columns: ['status', 'updated_at', 'completed_at'] as string[],
  unsafe: false,
  failRead: false,
  changeAfterDdl: false,
  writes: [] as string[],
  predicates: [] as string[],
  closed: false,
}));
vi.mock('dotenv', () => ({ config: () => ({ parsed: {} }) }));
vi.mock('node:fs/promises', () => ({
  readdir: async () => ['0000_base.sql', '0042_payment_completed_at.sql'],
  readFile: async (path: string) =>
    path.endsWith('0000_base.sql')
      ? 'CREATE TABLE qa_marker (id INT);'
      : 'UPDATE payments SET completed_at = updated_at;',
}));
vi.mock('mysql2/promise', () => ({
  default: {
    createConnection: async () => ({
      query: async (sql: string) => {
        if (sql.startsWith('SELECT')) {
          if (fixture.failRead) throw new Error('private database detail');
          if (sql.includes('information_schema.COLUMNS'))
            return [fixture.columns.map((name) => ({ name }))];
          fixture.predicates.push(sql);
          return [fixture.unsafe ? [{ unsafe: 1 }] : []];
        }
        fixture.writes.push(sql);
        if (fixture.changeAfterDdl) fixture.unsafe = true;
        return [{ affectedRows: 0 }];
      },
      end: async () => {
        fixture.closed = true;
      },
    }),
  },
}));

let previousExitCode: typeof process.exitCode;
beforeEach(() => {
  previousExitCode = process.exitCode;
  vi.resetModules();
  Object.assign(fixture, {
    columns: ['status', 'updated_at', 'completed_at'],
    unsafe: false,
    failRead: false,
    changeAfterDdl: false,
    writes: [],
    predicates: [],
    closed: false,
  });
});
afterEach(() => {
  process.exitCode = previousExitCode;
  vi.restoreAllMocks();
});
async function run() {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  await import('./apply-numbered-migrations.js');
  await vi.waitFor(() => expect(log.mock.calls.length + error.mock.calls.length).toBe(1));
  expect(fixture.closed).toBe(true);
  return { log, error };
}
it.each(['missing time', 'legacy column absent', 'read failed', 'status absent'])(
  'refuses before the first SQL write when %s',
  async (fault) => {
    if (fault === 'missing time') fixture.unsafe = true;
    if (fault === 'legacy column absent') {
      fixture.columns = ['status', 'updated_at'];
      fixture.unsafe = true;
    }
    if (fault === 'read failed') fixture.failRead = true;
    if (fault === 'status absent') fixture.columns = ['updated_at'];
    const { error } = await run();
    expect(error).toHaveBeenCalledWith('MIGRATION_PAYMENT_TIME_UNPROVEN');
    expect(process.exitCode).toBe(1);
    expect(fixture.writes).toEqual([]);
  },
);
it('rechecks before 0042 instead of trusting the initial observation', async () => {
  fixture.changeAfterDdl = true;
  const { error } = await run();
  expect(error).toHaveBeenCalledWith('MIGRATION_PAYMENT_TIME_UNPROVEN');
  expect(fixture.writes).toEqual(['CREATE TABLE qa_marker (id INT)']);
});
it.each(['current', 'empty database', 'legacy unpaid only'])(
  'permits %s without treating pending NULL timestamps as unsafe',
  async (shape) => {
    if (shape === 'empty database') fixture.columns = [];
    if (shape === 'legacy unpaid only') fixture.columns = ['status', 'updated_at'];
    const { log, error } = await run();
    expect(error).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledOnce();
    expect(fixture.writes).toEqual([
      'CREATE TABLE qa_marker (id INT)',
      'UPDATE payments SET completed_at = updated_at',
    ]);
    if (shape !== 'empty database') {
      expect(fixture.predicates).toHaveLength(2);
      for (const sql of fixture.predicates) {
        expect(sql).toContain("status = 'completed'");
        expect(sql.includes('completed_at IS NULL')).toBe(shape === 'current');
      }
    }
  },
);
