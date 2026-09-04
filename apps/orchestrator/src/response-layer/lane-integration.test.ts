import type { Logger } from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DB } from '../db/client.js';
import { runResponseLayerForLane, stampResponseLayerColumns } from './lane-integration.js';

const fakeLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn(),
} as unknown as Logger;

const savedEnv = { ...process.env };

beforeEach(() => {
  process.env.OPENAI_RESPONSE_LAYER_ENABLED = 'true';
  process.env.OPENAI_API_KEY = 'legacy-key';
});

afterEach(() => {
  process.env = { ...savedEnv };
});

describe('retired response-polishing boundary', () => {
  it('returns the primary answer unchanged even when the legacy flag and key are present', async () => {
    const primaryAnswer = '主模型直接生成的答案。'.repeat(30);

    const result = await runResponseLayerForLane({
      taskId: 'tsk_synthetic',
      status: 'completed',
      summary: primaryAnswer,
      logger: fakeLogger,
    });

    expect(result).toEqual({
      summary: primaryAnswer,
      responseLayerOriginal: undefined,
      responseLayerMetadata: undefined,
    });
  });

  it('never writes historical response-layer columns', async () => {
    const updates: unknown[] = [];
    const db = {
      update() {
        updates.push('update');
        throw new Error('retired response polishing must not write');
      },
    } as unknown as DB;

    const persisted = await stampResponseLayerColumns(
      db,
      'tsk_synthetic',
      'primary answer',
      'rewritten answer',
      { model: 'legacy-polisher' },
      fakeLogger,
    );

    expect(persisted).toBe(false);
    expect(updates).toHaveLength(0);
  });
});
