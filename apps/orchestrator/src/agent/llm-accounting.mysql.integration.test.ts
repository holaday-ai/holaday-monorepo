import { readFile } from 'node:fs/promises';
import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import { describe, expect, it, vi } from 'vitest';
import type { DB } from '../db/client.js';
import { llmCalls } from '../db/schema/llm-calls.js';
import { sumLlmCostForTasks } from '../playbook/explorer/explorer-budget.js';
import type { Context } from '../trpc/context.js';
import { adminFinanceRouter } from '../trpc/routers/admin-finance.js';
import { llmCallsRouter } from '../trpc/routers/llm-calls.js';
import { DrizzleLlmCallRecorder } from './llm-call-recorder.js';

// No dotenv, production URLs, shared local DB, account fixtures, or browser runtime.
vi.mock('dotenv', () => ({ config: () => ({ parsed: {} }) }));

describe.skipIf(process.env.HOLADAY_ACCOUNTING_MYSQL_QA !== '1')(
  'isolated MySQL accounting',
  () => {
    it('migrates old rows without changing amounts, persists Qwen, and preserves NULL through real SQL', async () => {
      const connection = await mysql.createConnection({
        host: '127.0.0.1',
        port: 13316,
        database: 'holaday_control_qa',
        user: 'control_qa',
        password: 'local-control-qa-only',
        timezone: 'Z',
      });
      try {
        // Connection-local temporary tables shadow any permanent names; no DROP/DELETE/reset.
        const initial = await readFile(
          new URL('../../drizzle/0000_initial.sql', import.meta.url),
          'utf8',
        );
        const ddl = initial
          .split('--> statement-breakpoint')
          .find((s) => s.includes('CREATE TABLE `llm_calls`'));
        if (!ddl) throw new Error('Missing baseline llm_calls DDL');
        await connection.query(ddl.replace('CREATE TABLE', 'CREATE TEMPORARY TABLE'));
        await connection.query(
          'CREATE TEMPORARY TABLE users (id bigint PRIMARY KEY, external_id varchar(32), role varchar(16), status varchar(16), display_name varchar(64), email varchar(64))',
        );
        await connection.query(
          'CREATE TEMPORARY TABLE tasks (id bigint PRIMARY KEY, external_id varchar(32), user_id bigint, intent text, title varchar(64), status varchar(16))',
        );
        await connection.query(
          'CREATE TEMPORARY TABLE payments (amount_cents int, currency varchar(3), status varchar(16), completed_at datetime(3))',
        );
        await connection.query(
          "INSERT INTO users VALUES (1, 'usr_qa', 'admin', 'active', 'QA', 'qa@example.invalid'), (2, 'usr_other', 'user', 'active', 'Other', 'other@example.invalid')",
        );
        await connection.query(
          "INSERT INTO tasks VALUES (1, 'tsk_qa', 1, 'QA browser', 'QA', 'completed'), (2, 'tsk_other', 2, 'Other', 'Other', 'completed')",
        );
        await connection.query(
          "INSERT INTO llm_calls (external_id,user_id,task_id,model,purpose,cost_usd) VALUES ('llm_legacy',1,1,'claude-opus-4-7','supercar.turn',1.25)",
        );
        const migration = await readFile(
          new URL('../../drizzle/0060_llm_usage_accounting.sql', import.meta.url),
          'utf8',
        );
        for (const statement of migration
          .split('--> statement-breakpoint')
          .filter((s) => s.trim())) {
          await connection.query(statement);
        }
        const db = drizzle(connection, { mode: 'default', casing: 'snake_case' }) as unknown as DB;
        const errors: unknown[] = [];
        const recorder = new DrizzleLlmCallRecorder(db, { onError: (err) => errors.push(err) });
        await recorder.record({
          userExternalId: 'usr_qa',
          taskExternalId: 'tsk_qa',
          provider: 'alibaba-model-studio',
          model: 'qwen-fixture',
          region: 'cn',
          providerRequestId: 'qa-response',
          purpose: 'supercar.turn',
          inputTokens: 10,
          outputTokens: 5,
          latencyMs: 10,
          status: 'ok',
        });
        await recorder.record({
          userExternalId: 'usr_other',
          taskExternalId: 'tsk_other',
          provider: 'alibaba-model-studio',
          model: 'qwen-fixture',
          region: 'intl',
          purpose: 'supercar.turn',
          inputTokens: null,
          outputTokens: null,
          latencyMs: 10,
          status: 'error',
        });
        expect(errors).toEqual([]);
        const persisted = await db.select().from(llmCalls);
        expect(persisted[0]).toMatchObject({
          costUsd: '1.250000',
          costStatus: 'legacy_estimate',
          usageStatus: 'legacy_reported',
        });
        expect(persisted[1]).toMatchObject({
          costUsd: null,
          costStatus: 'unpriced',
          usageStatus: 'complete',
          region: 'cn',
          providerRequestId: 'qa-response',
          cacheReadTokens: null,
        });
        expect(persisted[2]).toMatchObject({
          costUsd: null,
          costStatus: 'usage_missing',
          promptTokens: null,
        });
        const ctx = { db, userId: 'usr_qa', req: {} } as Context;
        const list = llmCallsRouter.createCaller(ctx);
        const first = await list.list({ limit: 1 });
        expect(first.rows).toHaveLength(1);
        expect(first.rows[0]?.costUsd).toBeNull();
        expect(first.totals).toMatchObject({
          totalCalls: 2,
          knownCostUsd: 1.25,
          totalCostUsd: null,
          unknownCostCalls: 1,
          totalInputTokens: 10,
          totalOutputTokens: 5,
          totalCacheReadTokens: null,
        });
        if (first.nextCursor === null) throw new Error('Expected cursor');
        const second = await list.list({ cursor: first.nextCursor, limit: 1 });
        expect(second.rows[0]?.costUsd).toBe(1.25);
        expect(second.totals).toEqual(first.totals);
        expect((await list.list({ taskExternalId: 'tsk_other' })).rows).toEqual([]);
        expect((await list.list({ until: '2000-01-01T00:00:00.000Z' })).totals.totalCostUsd).toBe(
          0,
        );
        const finance = adminFinanceRouter.createCaller(ctx);
        expect(await finance.summary()).toMatchObject({
          monthLlmCostCnyCents: null,
          monthProfitCnyCents: null,
          monthKnownLlmCostCnyCents: 900,
          unknownCostCalls: 2,
        });
        const models = await finance.costBreakdown();
        expect(models.models.find((m) => m.model === 'qwen-fixture')).toMatchObject({
          costUsd: null,
          totalTokens: null,
          unknownCostCalls: 2,
        });
        const top = await finance.topCostlyTasks();
        expect(top.tasks.find((t) => t.taskId === 'tsk_qa')).toMatchObject({
          costUsd: null,
          knownCostUsd: 1.25,
          totalTokens: null,
          incompleteUsageCalls: 1,
        });
        expect((await finance.costByDay()).series.at(-1)).toMatchObject({
          costCnyCents: null,
          unknownCostCalls: 2,
        });
        expect(await sumLlmCostForTasks(db, [1])).toBe(Number.POSITIVE_INFINITY);
      } finally {
        await connection.end();
      }
    });
  },
);
