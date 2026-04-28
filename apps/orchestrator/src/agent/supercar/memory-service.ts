/**
 * Phase 13 Dim 5 — cross-task memory.
 *
 * After a task completes, run a separate Anthropic call (Sonnet to
 * keep cost down) that scans the task description + summary for
 * long-term-valuable facts. The model returns a JSON array of
 * memory entries which we upsert into `execution_memory` keyed by
 * (user_id, category, key_name).
 *
 * On the next task start, fetch the user's memories and inject the
 * relevant ones into the agent's first user message under a
 * "你对这个用户的了解" section. Relevance is a cheap keyword match
 * — preferences always inject (small N, high value); other
 * categories only inject if their key_name shares a token with the
 * incoming intent.
 */

import Anthropic from '@anthropic-ai/sdk';
import { and, eq, gt, isNull, or } from 'drizzle-orm';
import { newExternalId } from '@holaday/shared-types';
import type { Logger } from 'pino';
import type { DB } from '../../db/client.js';
import { executionMemory, type ExecutionMemory } from '../../db/schema/execution-memory.js';

export type MemoryCategory =
  | 'preference'
  | 'site_state'
  | 'task_history'
  | 'execution_tip';

const VALID_CATEGORIES: ReadonlySet<MemoryCategory> = new Set([
  'preference',
  'site_state',
  'task_history',
  'execution_tip',
]);

const EXTRACT_SYSTEM = `你是 HOLA DAY 的记忆提取器。给你一个刚完成的任务记录，从中提取值得长期记住的信息。

只提取这四类：
- preference   — 用户的稳定偏好（"偏好京东而不是淘宝"、"喜欢简洁回复"）
- site_state   — 网站使用建议（"淘宝必须登录才能看价格"、"小红书移动版搜索不稳定"）
- task_history — 重要的一次性事件（"2026-04 升级 Pro"、"邮箱是 xxx@xxx"）
- execution_tip — 给未来 agent 的执行经验（"查 MacBook 价格直接搜 Apple 官网更准"）

输出格式：JSON 数组。每项 {"category": "...", "key": "...", "value": "...", "ttlDays": null | number}。

key 用一句话描述这条记忆的标识（< 80 字符），value 是详细内容（< 500 字符）。
ttlDays = null 表示永久（preference 默认永久），其他类别建议 30 天。

明确不要提取的：
- 一次性的查询结果（"今天天气晴"）
- 通用知识（"北京是首都"）
- 临时状态（"正在上传文件"）

如果没有值得记的，输出 \`[]\`。`;

export interface ExtractedMemory {
  category: MemoryCategory;
  keyName: string;
  value: string;
  expiresAt: Date | null;
}

export class MemoryService {
  constructor(
    private readonly db: DB,
    private readonly logger: Logger,
  ) {}

  /**
   * Pull the user's currently-valid memory rows. Used both by the
   * agent-loop (to compose the user-message preamble) and by the
   * memory-management UI in /settings.
   */
  async listForUser(userIdInternal: number): Promise<ExecutionMemory[]> {
    const rows = await this.db
      .select()
      .from(executionMemory)
      .where(
        and(
          eq(executionMemory.userId, userIdInternal),
          or(isNull(executionMemory.expiresAt), gt(executionMemory.expiresAt, new Date())),
        ),
      );
    return rows;
  }

  /**
   * Pick the memories worth injecting into the next task's user
   * message. Preferences always go in (high-signal, small N);
   * other categories filter on a token-overlap match against the
   * incoming intent. Cap at 5 non-preference rows so the prompt
   * doesn't bloat past usefulness.
   */
  async pickRelevant(
    userIdInternal: number,
    intent: string,
  ): Promise<ExecutionMemory[]> {
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
      // Token overlap on either the key or the value text.
      const matched =
        tokens.some((t) => keyLower.includes(t) || valueLower.includes(t)) ||
        keyLower.split(/\s+/).some((w) => lower.includes(w.toLowerCase()));
      if (matched) others.push(row);
    }
    // Most-recent first within "others" so a newer site-state tip
    // outranks a stale one when both match.
    others.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    return [...prefs, ...others.slice(0, 5)];
  }

  /**
   * Render the picked memories as a user-message-ready preamble.
   * Empty string when nothing to inject — caller appends only when
   * the result is non-empty.
   */
  formatForPrompt(memories: ExecutionMemory[]): string {
    if (memories.length === 0) return '';
    const lines = memories.map((m) => `- [${m.category}] ${m.keyName}：${m.value}`);
    return ['---', '你对这个用户的了解（来自过往任务）：', ...lines, '---'].join('\n');
  }

  /**
   * Upsert a single memory row by (user_id, category, key_name).
   * Touches updated_at so the recency sort in pickRelevant works
   * across re-saves.
   */
  async upsert(
    userIdInternal: number,
    entry: ExtractedMemory,
  ): Promise<void> {
    const now = new Date();
    // Drizzle MySQL has `onDuplicateKeyUpdate` for natural-key
    // upserts. The (user_id, category, key_name) unique index
    // backs this, so a re-store of the same key bumps the value +
    // touches updated_at.
    void now;
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
      .onDuplicateKeyUpdate({
        set: {
          value: entry.value,
          expiresAt: entry.expiresAt,
        },
      });
  }

  /**
   * Extract memories from a completed task via a Sonnet call. Best-
   * effort: parse failures + Anthropic errors log and continue.
   */
  async extractAndStore(opts: {
    apiKey: string;
    userIdInternal: number;
    intent: string;
    summary: string;
    sitesVisited?: string[];
    taskId?: string;
  }): Promise<number> {
    const client = new Anthropic({ apiKey: opts.apiKey });
    try {
      const sites = opts.sitesVisited?.length ? `访问的网站：${opts.sitesVisited.join(', ')}` : '';
      const userText = [
        `任务描述：${opts.intent}`,
        `任务结果：${opts.summary}`,
        sites,
      ]
        .filter(Boolean)
        .join('\n');
      const resp = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 600,
        system: [{ type: 'text', text: EXTRACT_SYSTEM, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: userText }],
      });
      const raw = resp.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text.trim())
        .join('\n')
        .trim();
      if (!raw) return 0;
      // Tolerate ```json fences the model occasionally adds.
      const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
      let parsed: unknown;
      try {
        parsed = JSON.parse(cleaned);
      } catch (err) {
        this.logger.warn(
          { taskId: opts.taskId, err: err instanceof Error ? err.message : String(err), preview: cleaned.slice(0, 200) },
          'memory: extractor returned non-JSON',
        );
        return 0;
      }
      if (!Array.isArray(parsed)) return 0;
      let stored = 0;
      for (const item of parsed) {
        if (!isExtractedMemoryShape(item)) continue;
        const expires = item.ttlDays != null
          ? new Date(Date.now() + item.ttlDays * 86_400_000)
          : null;
        await this.upsert(opts.userIdInternal, {
          category: item.category,
          keyName: String(item.key).slice(0, 255),
          value: String(item.value).slice(0, 4_000),
          expiresAt: expires,
        });
        stored += 1;
      }
      this.logger.info(
        { taskId: opts.taskId, stored, considered: (parsed as unknown[]).length },
        'memory: extracted + stored',
      );
      return stored;
    } catch (err) {
      this.logger.warn(
        { taskId: opts.taskId, err: err instanceof Error ? err.message : String(err) },
        'memory: extract call failed',
      );
      return 0;
    }
  }
}

function isExtractedMemoryShape(v: unknown): v is {
  category: MemoryCategory;
  key: string;
  value: string;
  ttlDays: number | null;
} {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  if (typeof o.category !== 'string' || !VALID_CATEGORIES.has(o.category as MemoryCategory)) {
    return false;
  }
  if (typeof o.key !== 'string' || !o.key.trim()) return false;
  if (typeof o.value !== 'string' || !o.value.trim()) return false;
  if (o.ttlDays != null && typeof o.ttlDays !== 'number') return false;
  return true;
}
