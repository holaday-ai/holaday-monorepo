import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import {
  readCutoverWorkScope,
  validateLegacyWorkBoundary,
  cutoverLegacyInterruptionRisk,
  cutoverWorkScopeReady,
} from './browser-cutover-evidence.mjs';
const h = (x) => createHash('sha256').update(x).digest('hex');
const policy = {
  approvalRef: 'exact-legacy-navigation-deferral-20261002',
  sourceResultSha256: '653d441102e3ef314816d94165dea9daf633d01d0923c36e7d31bc7d589ed727',
  setFingerprint: '192900b8bbd82d0456952f07f66cffe145f7131e738ab1c74f97ee327205f446',
  noAutomaticReplay: true,
};
test(
  'real SQL exact approved navigation set stays unknown; absent, changed, additional, active-parent and ordinary paths refuse',
  { skip: !process.env.CUTOVER_DONE_QA_MYSQL_URL },
  async () => {
    const url = new URL(process.env.CUTOVER_DONE_QA_MYSQL_URL);
    assert.equal(url.protocol, 'mysql:');
    assert.equal(url.hostname, '127.0.0.1');
    assert.match(url.pathname, /^\/holaday_cutover_done_qa_[a-f0-9]{8,32}$/);
    const bytes = await readFile(process.env.CUTOVER_NAVIGATION_PRIVATE_SOURCE);
    assert.equal(h(bytes), policy.sourceResultSha256);
    const rows = JSON.parse(bytes).evidence.executing;
    assert.equal(rows.length, 10);
    const require = createRequire(process.env.CUTOVER_DONE_QA_REQUIRE_ROOT + '/package.json');
    const db = await require('mysql2/promise').createConnection({
      uri: url.toString(),
      dateStrings: true,
      supportBigNumbers: true,
      bigNumberStrings: true,
      jsonStrings: true,
      timezone: 'Z',
    });
    const now = Date.now();
    const approval = {
      schemaVersion: 2,
      kind: 'first-cutover',
      attempt: '12345678-1234-4234-8234-123456789abc',
      candidate: 'a'.repeat(40),
      configDigest: 'b'.repeat(64),
      migrationDigest: 'c'.repeat(64),
      inventoryDigest: 'd'.repeat(64),
      legacyDigest: 'e'.repeat(64),
      maintenanceEndsAtMs: now + 60000,
      reconcileByMs: now + 120000,
      operatorRef: 'qa',
      legacyInterruption: {
        mode: 'controlled-interruption',
        scope: 'legacy-non-payment-memory',
        approvalRef: 'legacy-interruption-20260928',
        capabilityDigest: 'f'.repeat(64),
        observeUntilMs: now + 30000,
        noAutomaticReplay: true,
      },
      exactLegacyNavigationDeferral: policy,
    };
    try {
      const others = [
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
      for (const table of others)
        await db.query(
          `CREATE TEMPORARY TABLE ${table}(id BIGINT PRIMARY KEY,status VARCHAR(32),render_status VARCHAR(32),completion_lease_owner VARCHAR(64),completion_lease_until DATETIME(3),lease_owner VARCHAR(64),lease_until DATETIME(3)) ENGINE=InnoDB`,
        );
      await db.query(
        'CREATE TEMPORARY TABLE tasks(id BIGINT PRIMARY KEY,status VARCHAR(32),error_code VARCHAR(128),created_at DATETIME(3),updated_at DATETIME(3),completed_at DATETIME(3)) ENGINE=InnoDB',
      );
      await db.query(
        'CREATE TEMPORARY TABLE task_steps(id BIGINT PRIMARY KEY,external_id VARCHAR(128),task_id BIGINT,parent_step_id BIGINT,seq INT,kind VARCHAR(32),status VARCHAR(32),risk_level VARCHAR(32),retry_count INT,input JSON,output JSON,error_code VARCHAR(128),error_message TEXT,created_at DATETIME(3),started_at DATETIME(3),completed_at DATETIME(3)) ENGINE=InnoDB',
      );
      const parents = new Map();
      for (const r of rows) parents.set(r.task_id, r);
      for (const r of parents.values())
        await db.query('INSERT INTO tasks VALUES (?,?,?,?,?,?)', [
          r.task_id,
          r.parentStatus,
          r.parentErrorCode,
          r.parentCreatedAt,
          r.parentUpdatedAt,
          r.parentCompletedAt,
        ]);
      const keys = [
        'id',
        'external_id',
        'task_id',
        'parent_step_id',
        'seq',
        'kind',
        'status',
        'risk_level',
        'retry_count',
        'input',
        'output',
        'error_code',
        'error_message',
        'created_at',
        'started_at',
        'completed_at',
      ];
      for (const r of rows)
        await db.query(
          'INSERT INTO task_steps VALUES (' + keys.map(() => '?').join(',') + ')',
          keys.map((k) => r[k]),
        );
      const read = () =>
        readCutoverWorkScope(db, {
          now: () => now,
          includeReplaySources: true,
          firstCutoverApproval: approval,
        });
      const accepted = await read();
      assert.deepEqual(accepted.unsettled, []);
      assert.equal(accepted.pendingReplay, 10);
      assert.equal(accepted.unresolvedWorkCount, 10);
      assert.equal(accepted.eligibleReplay, 0);
      assert.equal(accepted.deferredUnverifiedWork.length, 10);
      assert(
        accepted.deferredUnverifiedWork.every(
          (r) => r.outcome === 'unverified' && r.automaticReplay === false,
        ),
      );
      const observed = {
        schemaVersion: 2,
        inventoryDigest: approval.inventoryDigest,
        observedAtMs: now,
        unsettledWork: 0,
        unknownWriters: 0,
        knownExternalWork: accepted.deferredUnverifiedWork,
        activeRequests: { kind: 'unobservable', reason: 'legacy-no-inflight-api' },
        externalWork: { kind: 'unobservable', reason: 'legacy-no-inflight-api' },
        capabilityDigest: approval.legacyInterruption.capabilityDigest,
        replaySourcesDigest: accepted.replaySourcesDigest,
        pendingReplay: 10,
        deferredUnverifiedWork: accepted.deferredUnverifiedWork,
        unresolvedWorkCount: 10,
        eligibleReplay: 0,
      };
      assert.equal(
        validateLegacyWorkBoundary({
          observation: observed,
          approval,
          phase: 'prepare',
          nowMs: now,
        }).mode,
        'controlled-interruption',
      );
      assert.throws(() =>
        validateLegacyWorkBoundary({
          observation: { ...observed, pendingReplay: 0 },
          approval,
          phase: 'prepare',
          nowMs: now,
        }),
      );
      assert.equal((await readCutoverWorkScope(db, { now: () => now })).unsettled.length, 10);
      assert.notEqual(
        cutoverLegacyInterruptionRisk(approval),
        cutoverLegacyInterruptionRisk({ ...approval, exactLegacyNavigationDeferral: undefined }),
      );
      const first = rows[0];
      await db.query("UPDATE tasks SET status='executing' WHERE id=?", [first.task_id]);
      await assert.rejects(read);
      await db.query('UPDATE tasks SET status=? WHERE id=?', [first.parentStatus, first.task_id]);
      await db.query("UPDATE task_steps SET kind='click' WHERE id=?", [first.id]);
      await assert.rejects(read);
      await db.query("UPDATE task_steps SET kind='goto' WHERE id=?", [first.id]);
      await db.query('DELETE FROM task_steps WHERE id=?', [first.id]);
      await assert.rejects(read);
      await db.query(
        'INSERT INTO task_steps VALUES (' + keys.map(() => '?').join(',') + ')',
        keys.map((k) => first[k]),
      );
      await db.query(
        "INSERT INTO task_steps(id,task_id,status,kind,created_at) VALUES(999999999,?,'executing','goto','2026-07-01 00:00:00')",
        [first.task_id],
      );
      await assert.rejects(read);
      await db.query('DELETE FROM task_steps WHERE id=999999999');
      await db.query(
        "INSERT INTO task_steps(id,task_id,status,kind,created_at) VALUES(999999998,?,'executing','goto','2026-10-02 13:00:00')",
        [first.task_id],
      );
      const withNew = await read();
      assert.equal(withNew.deferredUnverifiedWork.length, 10);
      assert.equal(withNew.unsettled.length, 1);
      assert.equal(withNew.unresolvedWorkCount, 11);
      assert.equal(cutoverWorkScopeReady(withNew, approval), false);
      // Opened producers' unrelated new work stays visible but never becomes deferred.
      await db.query('DELETE FROM task_steps WHERE id=999999998');

      await assert.rejects(() =>
        readCutoverWorkScope(db, {
          now: () => now,
          firstCutoverApproval: {
            ...approval,
            exactLegacyNavigationDeferral: { ...policy, setFingerprint: '0'.repeat(64) },
          },
        }),
      );
      await assert.rejects(() =>
        readCutoverWorkScope(db, {
          now: () => approval.reconcileByMs,
          firstCutoverApproval: approval,
        }),
      );
    } finally {
      await db.end();
    }
  },
);
