import { readCoreTaskRecord } from '../agent/core-task-record.js';
import { summarizeCost } from '../agent/llm-cost-summary.js';
import {
  type ServicesContext,
  parseServicesContext,
  readServicesEvidence,
} from './ordinary-maintenance-services.js';
import type { MaintenanceIdentity } from './ordinary-maintenance.js';
export type MaintenanceReadinessInput = {
  identity: MaintenanceIdentity;
  expectedIdentity: MaintenanceIdentity;
  schemaCheck: () => Promise<void>;
  recordsCheck: () => Promise<void>;
  servicesCheck: () => Promise<void>;
};
export async function verifyMaintenanceReadiness(input: MaintenanceReadinessInput): Promise<void> {
  const validIdentity = (value: MaintenanceIdentity) =>
    value &&
    typeof value.candidate === 'string' &&
    typeof value.bootId === 'string' &&
    /^[a-f0-9]{40}$/.test(value.candidate) &&
    /^[a-f0-9]{32}$/.test(value.bootId);
  if (
    !input ||
    !validIdentity(input.identity) ||
    !validIdentity(input.expectedIdentity) ||
    ![input.schemaCheck, input.recordsCheck, input.servicesCheck].every(
      (fn) => typeof fn === 'function',
    )
  )
    throw new Error('MAINTENANCE_READINESS_INPUT');
  if (
    input.identity.candidate !== input.expectedIdentity.candidate ||
    input.identity.bootId !== input.expectedIdentity.bootId
  )
    throw new Error('MAINTENANCE_IDENTITY_MISMATCH');
  await input.schemaCheck();
  await input.recordsCheck();
  await input.servicesCheck();
}
export type ReadinessQuery = (
  sql: string,
  values?: unknown[],
) => Promise<Record<string, unknown>[]>;
export async function checkMaintenanceSchema(query: ReadinessQuery): Promise<void> {
  const rows = await query(
    "SELECT table_name AS table_name, column_name AS column_name, data_type AS data_type, column_type AS column_type, is_nullable AS is_nullable, column_default AS column_default FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name IN ('tasks', 'llm_calls')",
  );
  const column = (table: string, name: string) =>
    rows.find((row) => row.table_name === table && row.column_name === name);
  const id = column('tasks', 'execution_id');
  if (
    id?.column_type !== 'varchar(64)' ||
    id.is_nullable !== 'YES' ||
    ['execution_revision', 'core_record_version'].some((name) => {
      const row = column('tasks', name);
      return (
        row?.column_type !== 'bigint unsigned' ||
        row.is_nullable !== 'NO' ||
        String(row.column_default) !== '0'
      );
    }) ||
    [
      'prompt_tokens',
      'completion_tokens',
      'cache_read_tokens',
      'cache_write_tokens',
      'cost_usd',
    ].some((name) => {
      const row = column('llm_calls', name);
      return !row || row.is_nullable !== 'YES' || row.column_default !== null;
    }) ||
    column('llm_calls', 'cost_usd')?.column_type !== 'decimal(12,6)' ||
    ['cost_status', 'usage_status', 'region', 'provider_request_id'].some(
      (name) => !column('llm_calls', name),
    )
  )
    throw new Error('MAINTENANCE_SCHEMA_UNPROVEN');
}
export async function checkMaintenanceRecords(query: ReadinessQuery): Promise<void> {
  // Preserve paused tasks and future definitions; never silently replay claims.
  const counts = await query(
    "SELECT (SELECT COUNT(*) FROM tasks WHERE status NOT IN ('completed','partial_success','failed','cancelled','paused','awaiting_user')) + (SELECT COUNT(*) FROM scheduled_tasks WHERE status = 'running') + (SELECT COUNT(*) FROM planned_task_runs WHERE status IN ('pending','running')) + (SELECT COUNT(*) FROM batch_tasks WHERE status IN ('pending','running')) AS active",
  );
  if (counts.length !== 1 || (counts[0]?.active !== 0 && counts[0]?.active !== '0'))
    throw new Error('MAINTENANCE_RECORDS_UNSETTLED');
  let lastId = 0;
  // Bounded pages, not a sample falsely reported as exhaustive verification.
  for (let page = 0; ; page++) {
    if (page >= 100) throw new Error('MAINTENANCE_RECORD_SCAN_LIMIT');
    const rows = await query(
      'SELECT id, status, execution_id AS executionId, execution_revision AS executionRevision, core_record_version AS recordVersion, result FROM tasks WHERE id > ? ORDER BY id LIMIT 100',
      [lastId],
    );
    for (const row of rows) {
      const id = Number(row.id);
      if (!Number.isSafeInteger(id) || id <= lastId) throw new Error('MAINTENANCE_RECORD_FORMAT');
      let result = row.result;
      if (typeof result === 'string') {
        try {
          result = JSON.parse(result);
        } catch {
          throw new Error('MAINTENANCE_RECORD_FORMAT');
        }
      }
      const record = readCoreTaskRecord({
        head: {
          status: row.status as string,
          executionId: row.executionId as string | null,
          executionRevision: Number(row.executionRevision),
          recordVersion: Number(row.recordVersion),
        },
        result,
      });
      if (record.kind === 'invalid') throw new Error('MAINTENANCE_RECORD_FORMAT');
      lastId = id;
    }
    if (rows.length < 100) break;
  }
  const costs = await query(
    'SELECT SUM(cost_usd) AS known, COUNT(*) - COUNT(cost_usd) AS unknown FROM llm_calls',
  );
  const cost = costs[0];
  if (
    costs.length !== 1 ||
    cost?.unknown == null ||
    !Number.isSafeInteger(Number(cost.unknown)) ||
    Number(cost.unknown) < 0 ||
    (cost.known !== null && !Number.isFinite(Number(cost.known)))
  )
    throw new Error('MAINTENANCE_ACCOUNTING_UNPROVEN');
  const summary = summarizeCost(cost.known as string | null, cost.unknown as string | number);
  if (Number(cost.unknown) > 0 && summary.totalCostUsd !== null)
    throw new Error('MAINTENANCE_ACCOUNTING_UNPROVEN');
}
export async function checkMaintenanceServices(context?: ServicesContext): Promise<void> {
  const parsed = parseServicesContext(context);
  // Schema/record verification may take time: never reuse its starting clock.
  await readServicesEvidence({ ...parsed, nowMs: Date.now() });
}
export async function verifyProductionMaintenanceReadiness(
  identity: MaintenanceIdentity,
  expectedIdentity: MaintenanceIdentity,
  context?: ServicesContext,
): Promise<void> {
  const services = parseServicesContext(context);
  if (
    services.stage !== 'preopen' ||
    services.identity?.candidate !== identity.candidate ||
    services.identity?.bootId !== identity.bootId
  )
    throw new Error('MAINTENANCE_IDENTITY_MISMATCH');
  let query: ReadinessQuery;
  await verifyMaintenanceReadiness({
    identity,
    expectedIdentity,
    schemaCheck: async () => {
      const { pool } = await import('../db/client.js');
      query = async (sql, values) => {
        const [rows] = await pool.query(sql, values);
        if (!Array.isArray(rows)) throw new Error('MAINTENANCE_QUERY_UNPROVEN');
        return rows as Record<string, unknown>[];
      };
      await checkMaintenanceSchema(query);
    },
    recordsCheck: () => checkMaintenanceRecords(query),
    servicesCheck: () => checkMaintenanceServices(services),
  });
}
