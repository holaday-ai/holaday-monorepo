import { describe, expect, it, vi } from 'vitest';
import type { MessagesAdapter } from '../llm/messages-adapter.js';
import { generateSuggestions } from './suggestions-generator.js';

function buildAdapter(output: string): MessagesAdapter {
  return {
    metadata: { provider: 'anthropic', model: 'test-model' },
    create: vi.fn().mockResolvedValue({
      id: 'msg_test',
      metadata: { provider: 'anthropic', model: 'test-model' },
      content: [{ type: 'text', text: output }],
      stopReason: 'end_turn',
      usage: {
        inputTokens: 1,
        outputTokens: 1,
        cacheReadInputTokens: null,
        cacheCreationInputTokens: null,
        complete: true,
      },
    }),
  };
}

describe('generateSuggestions', () => {
  it('uses the provider-neutral adapter and keeps the existing request contract', async () => {
    const adapter = buildAdapter('["比较同类方案","整理执行清单","保存研究结论"]');

    await expect(
      generateSuggestions({
        messagesAdapter: adapter,
        intent: '研究零售行业并输出方案',
        summary: '已完成研究。',
      }),
    ).resolves.toEqual(['比较同类方案', '整理执行清单', '保存研究结论']);

    expect(adapter.create).toHaveBeenCalledWith({
      maxTokens: 200,
      thinking: { type: 'disabled' },
      system: expect.stringContaining('给出 2-3 个用户可能想继续做的相关任务'),
      messages: [{ role: 'user', content: '任务：研究零售行业并输出方案\n结果摘要：已完成研究。' }],
    });
  });

  it('absorbs provider errors so suggestions cannot fail a completed task', async () => {
    const adapter = buildAdapter('[]');
    vi.mocked(adapter.create).mockRejectedValueOnce(new Error('provider failed'));

    await expect(
      generateSuggestions({
        messagesAdapter: adapter,
        intent: '整理资料',
        summary: '完成',
      }),
    ).resolves.toEqual([]);
  });
});
