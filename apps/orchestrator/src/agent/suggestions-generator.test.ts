import { describe, expect, it, vi } from 'vitest';
import type { MessagesAdapter } from '../llm/messages-adapter.js';
import { generateSuggestions } from './suggestions-generator.js';

function buildAdapter(output: string): MessagesAdapter {
  const metadata = {
    provider: 'alibaba-model-studio' as const,
    model: 'qwen3.8-flash',
    region: 'intl' as const,
    deploymentScope: 'international' as const,
    endpointKind: 'public' as const,
    protocol: 'messages' as const,
  };
  return {
    metadata,
    create: vi.fn().mockResolvedValue({
      id: 'msg_test',
      metadata,
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

    expect(adapter.create).toHaveBeenCalledWith(
      {
        maxTokens: 200,
        thinking: { type: 'disabled' },
        system: expect.stringContaining('给出 2-3 个用户可能想继续做的相关任务'),
        messages: [
          { role: 'user', content: '任务：研究零售行业并输出方案\n结果摘要：已完成研究。' },
        ],
      },
      { timeoutMs: 4000, maxRetries: 0 },
    );
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

  it.each([
    ['不采购', '采购茶歇饮品与轻食'],
    ['不要采购', '购买茶歇饮品与轻食'],
    ['不要购买', '采购茶歇饮品与轻食'],
    ['禁止采购', '下单茶歇饮品与轻食'],
    ['别采购', '支付茶歇饮品费用'],
    ['勿采购', '结算茶歇饮品费用'],
  ])('inherits %s when the model proposes %s', async (restriction, prohibited) => {
    const adapter = buildAdapter(JSON.stringify([prohibited, '整理活动执行清单']));

    await expect(generateSuggestions({
      messagesAdapter: adapter,
      intent: `为内部读书交流会拟定组织方案，只在对话中输出文字，${restriction}。`,
      summary: '已整理活动组织方案。',
    })).resolves.toEqual(['整理活动执行清单']);
  });

  it('preserves procurement follow-ups when the user has not prohibited them', async () => {
    await expect(generateSuggestions({
      messagesAdapter: buildAdapter('["采购茶歇饮品与轻食","整理活动执行清单"]'),
      intent: '整理读书交流会方案，并建议采购茶歇所需物品。',
      summary: '已整理活动组织方案。',
    })).resolves.toEqual(['采购茶歇饮品与轻食', '整理活动执行清单']);
  });
});
