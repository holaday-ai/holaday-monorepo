import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readCutoverWorkScope } from './browser-cutover-evidence.mjs';

// Explicit isolated QA database only; temporary tables disappear with this
// dedicated connection. No production schema or persisted work is modified.
test(
  'real MySQL work reader accepts dated successful done but retains malformed done and independent executing effects',
  { skip: !process.env.CUTOVER_DONE_QA_MYSQL_URL },
  async () => {
    const url = new URL(process.env.CUTOVER_DONE_QA_MYSQL_URL);
    assert.equal(url.protocol, 'mysql:');
    assert(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname));
    assert.match(url.pathname, /^\/holaday_cutover_done_qa_[a-f0-9]{8,32}$/);
    const require = createRequire(process.env.CUTOVER_DONE_QA_REQUIRE_ROOT + '/package.json');
    const db = await require('mysql2/promise').createConnection({
      uri: url.toString(),
      dateStrings: true,
    });
    try {
      const tables = [
        'tasks',
        'task_steps',
        'scheduled_tasks',
        'planned_task_runs',
        'batch_tasks',
        'exploration_runs',
        'video_edit_render_attempts',
        'video_edit_versions',
        'account_closure_requests',
        'account_closure_steps',
        'planned_task_run_items',
        'batch_task_items',
        'planned_tasks',
      ];
      for (const table of tables)
        await db.query(
          `CREATE TEMPORARY TABLE ${table} (id BIGINT PRIMARY KEY,status VARCHAR(32),render_status VARCHAR(32),started_at DATETIME(3),completed_at DATETIME(3),completion_lease_owner VARCHAR(64),completion_lease_until DATETIME(3),lease_owner VARCHAR(64),lease_until DATETIME(3)) ENGINE=InnoDB`,
        );
      await db.query("INSERT INTO tasks (id,status) VALUES (1,'cancelled'),(2,'failed')");
      await db.query(
        "INSERT INTO task_steps (id,status,started_at,completed_at) VALUES (1,'done','2026-07-01 00:00:00','2026-07-01 00:00:01'),(2,'done',NULL,'2026-07-01 00:00:01'),(3,'done','2026-07-01 00:00:00',NULL),(4,'done','2026-07-01 00:00:01','2026-07-01 00:00:00'),(5,'executing','2026-07-01 00:00:00',NULL),(6,'mystery','2026-07-01 00:00:00','2026-07-01 00:00:01'),(7,'completed',NULL,NULL),(8,'done','2026-07-01 00:00:00','2026-07-01 00:00:00')",
      );
      const result = await readCutoverWorkScope(db, { now: () => Date.now() });
      assert.deepEqual(result.unsettled, [
        { table: 'task_steps', id: 2, status: 'done' },
        { table: 'task_steps', id: 3, status: 'done' },
        { table: 'task_steps', id: 4, status: 'done' },
        { table: 'task_steps', id: 5, status: 'executing' },
        { table: 'task_steps', id: 6, status: 'mystery' },
      ]);
      const [retained] = await db.query('SELECT id,status FROM task_steps ORDER BY id');
      assert.equal(retained.length, 8);
      assert.equal(retained[4].status, 'executing');
    } finally {
      await db.end();
    }
  },
);
