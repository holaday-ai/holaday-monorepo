import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import mysql from 'mysql2/promise';

function loadDotenvAllowingEmpty(path: string): void {
  const result = loadDotenv({ path, override: false });
  if (!result.parsed) return;
  for (const [key, value] of Object.entries(result.parsed)) {
    if (process.env[key] === '') process.env[key] = value;
  }
}

const appRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const repoRoot = resolve(appRoot, '../..');
loadDotenvAllowingEmpty(resolve(repoRoot, '.env'));
loadDotenvAllowingEmpty(resolve(repoRoot, '.env.local'));
loadDotenvAllowingEmpty(resolve(appRoot, '.env.local'));

const REQUIRED_TABLES = [
  'api_keys',
  'batch_task_items',
  'batch_tasks',
  'execution_memory',
  'execution_stats',
  'notifications',
  'notification_channels',
  'payments',
  'pending_cookies',
  'projects',
  'scheduled_tasks',
  'sessions',
  'skills',
  'stock_dashboard_snapshots',
  'task_events',
  'task_files',
  'task_quotas',
  'task_steps',
  'tasks',
  'user_profiles',
  'user_site_stats',
  'users',
  'verification_codes',
  'webhook_idempotency',
] as const;

const REQUIRED_COLUMNS: Record<string, readonly string[]> = {
  users: [
    'external_id',
    'email',
    'password_hash',
    'plan',
    'role',
    'plan_expires_at',
    'status',
    'auth_version',
    'display_name',
    'google_id',
    'avatar_url',
    'email_verified',
    'phone',
    'phone_verified',
    'selected_roles',
    'selected_skills',
    'role_changes_this_month',
    'role_changes_period_start',
  ],
  tasks: [
    'external_id',
    'user_id',
    'session_id',
    'skill_id',
    'status',
    'pause_reason',
    'intent',
    'title',
    'role_id',
    'opus_used',
    'starred',
    'starred_at',
    'project_id',
    'plan',
    'plan_text',
    'plan_status',
    'awaiting_question',
    'awaiting_kind',
    'result',
    'error_code',
    'error_message',
    'original_summary',
    'formatted_summary',
    'response_layer_metadata',
    'contract_json',
    'evidence_json',
    'verification_json',
    'verification_passed',
    'failure_level',
  ],
  task_steps: [
    'external_id',
    'task_id',
    'seq',
    'kind',
    'status',
    'input',
    'output',
    'error_message',
    'parent_step_id',
    'pending_confirm_payload',
    'retry_count',
    'heal_attempts',
    'heal_succeeded',
    'heal_elapsed_ms',
    'heal_input_tokens',
    'heal_output_tokens',
  ],
  scheduled_tasks: [
    'external_id',
    'user_id',
    'intent',
    'repeat_type',
    'cron_expression',
    'next_run_at',
    'timezone',
    'status',
    'last_run_at',
    'last_task_id',
    'last_run_status',
    'last_error',
    'rrule',
    'duration_minutes',
    'description',
    'reminder_minutes',
    'last_reminder_run',
  ],
  task_files: ['external_id', 'user_id', 'task_id', 'kind', 'status', 'expires_at'],
  batch_tasks: [
    'external_id',
    'user_id',
    'status',
    'items_total',
    'items_done',
    'items_review',
    'items_failed',
  ],
  payments: ['provider', 'provider_order_id', 'provider_capture_id', 'kind', 'status'],
  pending_cookies: [
    'user_id',
    'cookies_json',
    'encrypted_blob',
    'encryption_iv',
    'encryption_tag',
    'encrypted_key',
    'cookie_count',
  ],
  webhook_idempotency: ['user_id', 'idempotency_key', 'request_hash', 'expires_at'],
  api_keys: ['external_id', 'user_id', 'name', 'key_prefix', 'key_hash', 'last_used_at'],
};

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL ?? 'mysql://holaday:holaday-dev@127.0.0.1:3306/holaday';
  const conn = await mysql.createConnection({ uri: url });
  try {
    const [[dbRow]] = await conn.query<Array<{ db: string }>>('SELECT DATABASE() AS db');
    const database = dbRow?.db;
    if (!database) throw new Error('DATABASE_URL did not select a database');

    const [tableRows] = await conn.query<Array<{ table_name: string }>>(
      `SELECT table_name AS table_name
       FROM information_schema.tables
       WHERE table_schema = ?`,
      [database],
    );
    const tables = new Set(tableRows.map((r) => r.table_name));
    const missingTables = REQUIRED_TABLES.filter((t) => !tables.has(t));

    const [columnRows] = await conn.query<Array<{ table_name: string; column_name: string }>>(
      `SELECT table_name AS table_name, column_name AS column_name
       FROM information_schema.columns
       WHERE table_schema = ?`,
      [database],
    );
    const columnsByTable = new Map<string, Set<string>>();
    for (const row of columnRows) {
      const set = columnsByTable.get(row.table_name) ?? new Set<string>();
      set.add(row.column_name);
      columnsByTable.set(row.table_name, set);
    }

    const missingColumns: string[] = [];
    for (const [table, required] of Object.entries(REQUIRED_COLUMNS)) {
      if (!tables.has(table)) continue;
      const columns = columnsByTable.get(table) ?? new Set<string>();
      for (const column of required) {
        if (!columns.has(column)) missingColumns.push(`${table}.${column}`);
      }
    }

    if (missingTables.length > 0 || missingColumns.length > 0) {
      console.error(`Database schema verification failed for ${database}.`);
      if (missingTables.length > 0) {
        console.error(`Missing tables: ${missingTables.join(', ')}`);
      }
      if (missingColumns.length > 0) {
        console.error(`Missing columns: ${missingColumns.join(', ')}`);
      }
      console.error('Run the numbered migrations or drizzle push before starting orchestrator.');
      process.exitCode = 1;
      return;
    }

    console.log(`Database schema verified for ${database}.`);
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
