import { and, eq, gt, isNull, or } from 'drizzle-orm';
import type { Logger } from 'pino';
import type { DB } from '../../db/client.js';
import { type ExecutionMemory, executionMemory } from '../../db/schema/execution-memory.js';

/** Read-only memory surface retained for Qwen core tasks. */
export class MemoryService {
  constructor(
    private readonly db: DB,
    _logger: Logger,
  ) {
    void _logger;
  }

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

  async pickRelevant(userIdInternal: number, intent: string): Promise<ExecutionMemory[]> {
    const all = await this.listForUser(userIdInternal);
    const lower = intent.toLowerCase();
    const tokens = lower.split(/\s+/).filter((token) => token.length >= 2);
    const preferences: ExecutionMemory[] = [];
    const others: ExecutionMemory[] = [];
    for (const row of all) {
      if (row.category === 'preference') {
        preferences.push(row);
        continue;
      }
      const key = row.keyName.toLowerCase();
      const value = row.value.toLowerCase();
      const matched =
        tokens.some((token) => key.includes(token) || value.includes(token)) ||
        key.split(/\s+/).some((word) => lower.includes(word.toLowerCase()));
      if (matched) others.push(row);
    }
    others.sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());
    return [...preferences, ...others.slice(0, 5)];
  }

  formatForPrompt(memories: ExecutionMemory[]): string {
    if (memories.length === 0) return '';
    const lines = memories.map(
      (memory) => `- [${memory.category}] ${memory.keyName}：${memory.value}`,
    );
    return ['---', '你对这个用户的了解（来自过往任务）：', ...lines, '---'].join('\n');
  }
}
