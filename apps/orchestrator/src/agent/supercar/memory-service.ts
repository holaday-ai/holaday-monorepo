/**
 * Cross-task memory (Phase 13 Dim 5; batch 06 rewired to the model runtime).
 *
 * After a browser task completes, ONE short model call (the `generate` lane of
 * the model runtime — 千问 by default; the admin model catalog may route it to
 * Claude/GPT) scans the task description + summary and returns memory entries,
 * which are upserted into `execution_memory` keyed by (user_id, category,
 * key_name).
 *
 * Batch 06 scope: ONLY two kinds are written —
 *   site_state  — 站点操作: how a site works ("淘宝必须登录才能看价格")
 *   preference  — 用户偏好: stable user preferences ("偏好京东而不是淘宝")
 * Older categories already in the table (task_history / execution_tip) are
 * still READ and injected, never newly written.
 *
 * On the next task start the relevant entries are injected into the agent's
 * first user message ("你对这个用户的了解"). Users can delete one entry or
 * clear all (memory router + `deleteForUser` / `clearForUser` here).
 */

import { newExternalId } from '@holaday/shared-types';
import { and, eq, gt, isNull, or } from 'drizzle-orm';
import type { Logger } from 'pino';
import type { DB } from '../../db/client.js';
import { type ExecutionMemory, executionMemory } from '../../db/schema/execution-memory.js';
import type { MessagesAdapter } from '../../llm/messages-adapter.js';

export type MemoryCategory = 'preference' | 'site_state' | 'task_history' | 'execution_tip';

/** Categories the extractor may WRITE (batch 06: site operations + user preferences). */
export const WRITABLE_MEMORY_CATEGORIES: ReadonlySet<MemoryCategory> = new Set([
  'preference',
  'site_state',
]);

const SITE_STATE_DEFAULT_TTL_DAYS = 30;
const MAX_TTL_DAYS = 365;
const MAX_ENTRIES_PER_TASK = 5;

export const EXTRACT_SYSTEM = `你是 HOLA DAY 的记忆提取器。给你一个刚完成的任务记录，从中提取值得长期记住的信息。

只提取这两类：
- site_state — 网站操作经验（"淘宝必须登录才能看价格"、"京东搜索框在页面顶部，回车即可搜索"）
- preference — 用户的稳定偏好（"偏好京东而不是淘宝"、"喜欢简洁回复"）

输出格式：JSON 数组。每项 {"category": "site_state" | "preference", "key": "...", "value": "...", "ttlDays": null | number}。
key 用一句话描述这条记忆的标识（< 80 字符），value 是详细内容（< 500 字符）。
preference 的 ttlDays 用 null（永久），site_state 建议 30。

明确不要提取的：
- 任何个人身份或联系信息（姓名、电话、邮箱、地址、证件号、账号、密码、验证码、银行卡）
- 一次性的查询结果（"今天天气晴"）、通用知识、临时状态

如果没有值得记的，输出 \`[]\`。只输出 JSON。`;

export interface ExtractedMemory {
  category: MemoryCategory;
  keyName: string;
  value: string;
  expiresAt: Date | null;
}

/** Obvious personal identifiers never stored even if the model returns them. */
const PII_RE =
  /(?:\b1[3-9]\d{9}\b)|(?:[\w.+-]+@[\w-]+\.[\w.]+)|(?:\b\d{15,19}\b)|(?:\b\d{17}[\dXx]\b)|密码|验证码|password/i;

export function parseExtractedMemories(raw: string, now: Date = new Date()): ExtractedMemory[] {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: ExtractedMemory[] = [];
  for (const item of parsed) {
    if (out.length >= MAX_ENTRIES_PER_TASK) break;
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    if (
      typeof o.category !== 'string' ||
      !WRITABLE_MEMORY_CATEGORIES.has(o.category as MemoryCategory)
    )
      continue;
    if (typeof o.key !== 'string' || !o.key.trim()) continue;
    if (typeof o.value !== 'string' || !o.value.trim()) continue;
    if (PII_RE.test(o.key) || PII_RE.test(o.value)) continue;
    let ttlDays: number | null = null;
    if (typeof o.ttlDays === 'number' && Number.isFinite(o.ttlDays) && o.ttlDays > 0)
      ttlDays = Math.min(Math.round(o.ttlDays), MAX_TTL_DAYS);
    if (o.category === 'site_state' && ttlDays === null) ttlDays = SITE_STATE_DEFAULT_TTL_DAYS;
    out.push({
      category: o.category as MemoryCategory,
      keyName: o.key.trim().slice(0, 255),
      value: o.value.trim().slice(0, 4_000),
      expiresAt: ttlDays === null ? null : new Date(now.getTime() + ttlDays * 86_400_000),
    });
  }
  return out;
}

export class MemoryService {
  constructor(
    private readonly db: DB,
    private readonly logger: Logger,
  ) {}

  /** The user's currently-valid memory rows. */
  async listForUser(userIdInternal: number): Promise<ExecutionMemory[]> {
    return this.db
      .select()
      .from(executionMemory)
      .where(
        and(
          eq(executionMemory.userId, userIdInternal),
          or(isNull(executionMemory.expiresAt), gt(executionMemory.expiresAt, new Date())),
        ),
      );
  }

  /**
   * Memories worth injecting into the next task: preferences always (small
   * N, high signal); other categories by token overlap with the intent,
   * newest first, capped at 5.
   */
  async pickRelevant(userIdInternal: number, intent: string): Promise<ExecutionMemory[]> {
    const all = await this.listForUser(userIdInternal);
    const lower = intent.toLowerCase();
    const tokens = lower.split(/\s+/).filter((t) => t.length >= 2);
    const prefs: ExecutionMemory[] = [];
    const others: ExecutionMemory[] = [];
    for (const row of all) {
      if (row.category === 'preference') {
        prefs.push(row);
        continue;
      }
      const keyLower = row.keyName.toLowerCase();
      const valueLower = row.value.toLowerCase();
      const matched =
        tokens.some((t) => keyLower.includes(t) || valueLower.includes(t)) ||
        keyLower.split(/\s+/).some((w) => lower.includes(w.toLowerCase()));
      if (matched) others.push(row);
    }
    others.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    return [...prefs, ...others.slice(0, 5)];
  }

  formatForPrompt(memories: ExecutionMemory[]): string {
    if (memories.length === 0) return '';
    const lines = memories.map((m) => `- [${m.category}] ${m.keyName}：${m.value}`);
    return ['---', '你对这个用户的了解（来自过往任务）：', ...lines, '---'].join('\n');
  }

  /** Upsert one row by (user_id, category, key_name). */
  async upsert(userIdInternal: number, entry: ExtractedMemory): Promise<void> {
    await this.db
      .insert(executionMemory)
      .values({
        externalId: newExternalId('memory'),
        userId: userIdInternal,
        category: entry.category,
        keyName: entry.keyName.slice(0, 255),
        value: entry.value,
        expiresAt: entry.expiresAt,
      })
      .onDuplicateKeyUpdate({ set: { value: entry.value, expiresAt: entry.expiresAt } });
  }

  /** 删除入口: remove one of the caller's rows (composite WHERE — never another user's). */
  async deleteForUser(userIdInternal: number, externalId: string): Promise<void> {
    await this.db
      .delete(executionMemory)
      .where(
        and(eq(executionMemory.externalId, externalId), eq(executionMemory.userId, userIdInternal)),
      );
  }

  /** 删除入口: wipe all of the caller's rows. */
  async clearForUser(userIdInternal: number): Promise<void> {
    await this.db.delete(executionMemory).where(eq(executionMemory.userId, userIdInternal));
  }

  /**
   * Extract and store memories from a completed task with ONE call on the
   * given adapter (resolve it from the model runtime's `generate` lane).
   * Best-effort: model / parse failures log and return 0.
   */
  async extractAndStore(opts: {
    adapter: MessagesAdapter;
    userIdInternal: number;
    intent: string;
    summary: string;
    sitesVisited?: string[];
    taskId?: string;
  }): Promise<number> {
    try {
      const sites = opts.sitesVisited?.length ? `访问的网站：${opts.sitesVisited.join(', ')}` : '';
      const userText = [`任务描述：${opts.intent}`, `任务结果：${opts.summary}`, sites]
        .filter(Boolean)
        .join('\n');
      const resp = await opts.adapter.create(
        {
          maxTokens: 600,
          thinking: { type: 'disabled' },
          temperature: 0,
          system: [{ type: 'text', text: EXTRACT_SYSTEM, cacheControl: 'ephemeral' }],
          messages: [{ role: 'user', content: userText.slice(0, 8_000) }],
        },
        { timeoutMs: 30_000, maxRetries: 1 },
      );
      const raw = resp.content
        .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
        .map((b) => b.text)
        .join('\n');
      const entries = parseExtractedMemories(raw);
      for (const entry of entries) await this.upsert(opts.userIdInternal, entry);
      this.logger.info(
        { taskId: opts.taskId, stored: entries.length },
        'memory: extracted + stored',
      );
      return entries.length;
    } catch (err) {
      this.logger.warn(
        { taskId: opts.taskId, err: err instanceof Error ? err.message : String(err) },
        'memory: extract call failed',
      );
      return 0;
    }
  }
}
