import type { Logger } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import type { MessagesAdapter } from '../../llm/messages-adapter.js';
import { generatePlan } from './plan-service.js';

function buildAdapter(output: string): MessagesAdapter {
  return {
    metadata: {
      provider: 'alibaba-model-studio',
      model: 'qwen3.7-plus',
      region: 'intl',
      deploymentScope: 'international',
      endpointKind: 'public',
      protocol: 'messages',
    },
    create: vi.fn().mockResolvedValue({
      id: 'msg_synthetic_plan',
      metadata: {
        provider: 'alibaba-model-studio',
        model: 'qwen3.7-plus',
        region: 'intl',
        deploymentScope: 'international',
        endpointKind: 'public',
        protocol: 'messages',
      },
      content: [{ type: 'text', text: output }],
      stopReason: 'end_turn',
      usage: {
        inputTokens: 20,
        outputTokens: 30,
        cacheReadInputTokens: null,
        cacheCreationInputTokens: null,
        complete: true,
      },
    }),
  };
}

function buildLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(),
  } as unknown as Logger;
}

describe('generatePlan', () => {
  it('renders a validated provider-neutral JSON plan into the existing UI contract', async () => {
    const adapter = buildAdapter(
      JSON.stringify({
        steps: [
          { text: '检索两个平台的最新价格', tool: '搜索 API' },
          { text: '整理差异并生成对比表', tool: '生成内容' },
        ],
        estimatedSeconds: 8,
      }),
    );

    await expect(
      generatePlan({
        messagesAdapter: adapter,
        intent: '对比京东和淘宝 MacBook Air 的价格',
        logger: buildLogger(),
        taskId: 'tsk_synthetic',
      }),
    ).resolves.toEqual({
      planText:
        '**执行计划**\n1. 检索两个平台的最新价格（搜索 API）\n2. 整理差异并生成对比表（生成内容）\n\n**预计耗时**：~8s',
      planStatus: [
        { idx: 0, status: 'pending' },
        { idx: 1, status: 'pending' },
      ],
    });

    expect(adapter.create).toHaveBeenCalledWith(
      {
        maxTokens: 512,
        thinking: { type: 'disabled' },
        system: expect.stringContaining('只输出一个 JSON 对象'),
        messages: [{ role: 'user', content: '任务：对比京东和淘宝 MacBook Air 的价格' }],
      },
      { timeoutMs: 6_000, maxRetries: 0 },
    );
  });

  it('accepts a fenced JSON object without exposing the fence to the UI', async () => {
    const adapter = buildAdapter(
      '```json\n{"steps":[{"text":"读取资料","tool":"文件处理"},{"text":"生成摘要","tool":"生成内容"}],"estimatedSeconds":12}\n```',
    );

    const result = await generatePlan({
      messagesAdapter: adapter,
      intent: '整理这份材料并生成摘要',
      logger: buildLogger(),
    });

    expect(result.planText).toContain('1. 读取资料（文件处理）');
    expect(result.planText).not.toContain('```');
  });

  it('treats an explicit skip decision as no plan', async () => {
    const adapter = buildAdapter('{"skip":true}');

    await expect(
      generatePlan({
        messagesAdapter: adapter,
        intent: '今天上海天气',
        logger: buildLogger(),
      }),
    ).resolves.toEqual({ planText: null, planStatus: null });
  });

  it.each([
    [1, 'too few'],
    [7, 'too many'],
  ])('rejects %s plan steps', async (stepCount) => {
    const adapter = buildAdapter(
      JSON.stringify({
        steps: Array.from({ length: stepCount }, (_, index) => ({
          text: `处理步骤 ${index + 1}`,
          tool: '文件处理',
        })),
        estimatedSeconds: 10,
      }),
    );

    await expect(
      generatePlan({
        messagesAdapter: adapter,
        intent: '完成一个多步骤任务',
        logger: buildLogger(),
      }),
    ).resolves.toEqual({ planText: null, planStatus: null });
  });

  it('rejects a plan with an unsupported tool label', async () => {
    const adapter = buildAdapter(
      '{"steps":[{"text":"读取页面","tool":"任意代码"},{"text":"整理结果","tool":"生成内容"}],"estimatedSeconds":10}',
    );

    await expect(
      generatePlan({
        messagesAdapter: adapter,
        intent: '读取页面并整理结果',
        logger: buildLogger(),
      }),
    ).resolves.toEqual({ planText: null, planStatus: null });
  });

  it.each([
    '提交订单并付款',
    '立即预订酒店',
    '提交预约申请',
    '发送邮件给客户',
    '公开分享文件',
    '更改访问权限',
    '永久删除账户',
    'Send the email',
  ])('rejects a plan that performs the high-risk final action “%s”', async (action) => {
    const adapter = buildAdapter(
      JSON.stringify({
        steps: [
          { text: '核对操作对象与明细', tool: '浏览器操作' },
          { text: action, tool: '浏览器操作' },
        ],
        estimatedSeconds: 10,
      }),
    );

    await expect(
      generatePlan({
        messagesAdapter: adapter,
        intent: '准备高风险操作',
        logger: buildLogger(),
      }),
    ).resolves.toEqual({ planText: null, planStatus: null });
  });

  it('allows a high-risk flow to stop at a final confirmation preview', async () => {
    const adapter = buildAdapter(
      '{"steps":[{"text":"核对商品与收货信息","tool":"浏览器操作"},{"text":"到达最终确认页并展示订单明细","tool":"浏览器操作"}],"estimatedSeconds":10}',
    );

    const result = await generatePlan({
      messagesAdapter: adapter,
      intent: '帮我准备购买购物车里的商品但不要下单',
      logger: buildLogger(),
    });

    expect(result.planStatus).toHaveLength(2);
    expect(result.planText).toContain('到达最终确认页并展示订单明细');
  });

  it('absorbs provider failures so planning cannot block task creation', async () => {
    const adapter = buildAdapter('{"skip":true}');
    vi.mocked(adapter.create).mockRejectedValueOnce(new Error('provider secret detail'));
    const logger = buildLogger();

    await expect(
      generatePlan({
        messagesAdapter: adapter,
        intent: '整理一份完整报告',
        logger,
        taskId: 'tsk_synthetic',
      }),
    ).resolves.toEqual({ planText: null, planStatus: null });

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'tsk_synthetic', reason: 'PROVIDER_ERROR' }),
      'plan-service: generate failed, falling through to no-plan',
    );
    expect(JSON.stringify(vi.mocked(logger.warn).mock.calls)).not.toContain(
      'provider secret detail',
    );
  });
});
