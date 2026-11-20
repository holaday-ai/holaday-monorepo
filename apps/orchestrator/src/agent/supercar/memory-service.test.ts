import type { Logger } from 'pino';
import { describe, expect, it } from 'vitest';
import type { DB } from '../../db/client.js';
import type { MessagesAdapter, NeutralMessagesRequest } from '../../llm/messages-adapter.js';
import { MemoryService, parseExtractedMemories } from './memory-service.js';
import { MemoryService as QwenOnlyMemoryService } from './qwen-only-memory-service.js';

const logger = { info() {}, warn() {} } as unknown as Logger;

describe('memory service (batch 06: Qwen runtime extraction)', () => {
  it('keeps the qwen-only import path pointing at the full service', () => {
    expect(QwenOnlyMemoryService).toBe(MemoryService);
  });

  it('stores only site operations and user preferences, never PII', () => {
    const now = new Date('2026-10-03T00:00:00Z');
    const entries = parseExtractedMemories(
      JSON.stringify([
        {
          category: 'site_state',
          key: '淘宝看价需登录',
          value: '淘宝必须登录才能看价格',
          ttlDays: null,
        },
        { category: 'preference', key: '偏好京东', value: '用户偏好京东', ttlDays: null },
        { category: 'task_history', key: '升级 Pro', value: '2026-04 升级 Pro', ttlDays: 30 },
        { category: 'execution_tip', key: 'x', value: 'y', ttlDays: 30 },
        {
          category: 'preference',
          key: '联系方式',
          value: '邮箱是 someone@example.com',
          ttlDays: null,
        },
        { category: 'preference', key: '手机', value: '13800138000', ttlDays: null },
      ]),
      now,
    );
    expect(entries.map((e) => [e.category, e.keyName])).toEqual([
      ['site_state', '淘宝看价需登录'],
      ['preference', '偏好京东'],
    ]);
    // site_state defaults to a 30-day TTL; preferences are permanent.
    expect(entries[0]?.expiresAt?.toISOString()).toBe('2026-11-02T00:00:00.000Z');
    expect(entries[1]?.expiresAt).toBeNull();
    expect(parseExtractedMemories('not json')).toEqual([]);
    expect(parseExtractedMemories('```json\n[]\n```')).toEqual([]);
  });

  it('extracts with ONE call on the injected adapter (no direct provider client) and upserts', async () => {
    const requests: NeutralMessagesRequest[] = [];
    const adapter: MessagesAdapter = {
      metadata: { provider: 'openai', model: 'fake' },
      async create(request) {
        requests.push(request);
        return {
          id: 'r',
          metadata: this.metadata,
          content: [
            {
              type: 'text',
              text: '[{"category":"site_state","key":"京东搜索","value":"顶部搜索框回车即可","ttlDays":30}]',
            },
          ],
          stopReason: 'end_turn',
          usage: {
            inputTokens: 1,
            outputTokens: 1,
            cacheReadInputTokens: null,
            cacheCreationInputTokens: null,
            complete: true,
          },
        };
      },
    };
    const inserted: unknown[] = [];
    const db = {
      insert: () => ({
        values: (v: unknown) => ({
          onDuplicateKeyUpdate: async () => {
            inserted.push(v);
          },
        }),
      }),
    } as unknown as DB;
    const stored = await new MemoryService(db, logger).extractAndStore({
      adapter,
      userIdInternal: 42,
      intent: '在京东搜耳机',
      summary: '已找到',
      sitesVisited: ['jd.com'],
    });
    expect(stored).toBe(1);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.temperature).toBe(0);
    expect(inserted[0]).toMatchObject({ userId: 42, category: 'site_state', keyName: '京东搜索' });
  });

  it('returns 0 (never throws) when the model call fails', async () => {
    const adapter: MessagesAdapter = {
      metadata: { provider: 'openai', model: 'fake' },
      async create() {
        throw new Error('provider down');
      },
    };
    const stored = await new MemoryService({} as DB, logger).extractAndStore({
      adapter,
      userIdInternal: 1,
      intent: 'x',
      summary: 'y',
    });
    expect(stored).toBe(0);
  });
});
