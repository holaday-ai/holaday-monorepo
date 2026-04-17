import { sql } from 'drizzle-orm';
import {
  bigint,
  datetime,
  decimal,
  index,
  int,
  json,
  mysqlTable,
  text,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';

/**
 * `llm_calls` — billing base. Every LLM invocation (commander + skill agents)
 * gets one row. Cost is computed at insert time using the price in effect.
 */
export const llmCalls = mysqlTable(
  'llm_calls',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
    externalId: varchar('external_id', { length: 32 }).notNull(),
    userId: bigint('user_id', { mode: 'number', unsigned: true }).notNull(),
    taskId: bigint('task_id', { mode: 'number', unsigned: true }),
    stepId: bigint('step_id', { mode: 'number', unsigned: true }),
    provider: varchar('provider', { length: 32 }).notNull().default('anthropic'),
    model: varchar('model', { length: 64 }).notNull(),
    purpose: varchar('purpose', { length: 32 }).notNull(),
    promptTokens: int('prompt_tokens').notNull().default(0),
    completionTokens: int('completion_tokens').notNull().default(0),
    cacheReadTokens: int('cache_read_tokens').notNull().default(0),
    cacheWriteTokens: int('cache_write_tokens').notNull().default(0),
    costUsd: decimal('cost_usd', { precision: 12, scale: 6 }).notNull().default('0'),
    latencyMs: int('latency_ms'),
    status: varchar('status', { length: 16 }).notNull().default('ok'),
    errorMessage: text('error_message'),
    requestMeta: json('request_meta'),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (t) => [
    uniqueIndex('uk_llm_calls_external_id').on(t.externalId),
    index('ix_llm_calls_user_created_at').on(t.userId, t.createdAt),
    index('ix_llm_calls_task_id').on(t.taskId),
    index('ix_llm_calls_model').on(t.model),
  ],
);

export type LlmCall = typeof llmCalls.$inferSelect;
export type NewLlmCall = typeof llmCalls.$inferInsert;
