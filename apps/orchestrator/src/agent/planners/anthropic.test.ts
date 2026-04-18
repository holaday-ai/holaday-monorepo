import type Anthropic from '@anthropic-ai/sdk';
import { beforeAll, describe, expect, it } from 'vitest';

beforeAll(() => {
  process.env.JWT_SECRET ??= 'test-secret-must-be-at-least-32-characters-long-yes';
  process.env.DATABASE_URL ??= 'mysql://test:test@127.0.0.1:3306/test';
  process.env.REDIS_URL ??= 'redis://127.0.0.1:6379/0';
});

/**
 * A minimal fake Anthropic client that only implements messages.create.
 * We cast to `Anthropic` at the edge — the planner only touches this one
 * method, so the fake is safe for the unit test's scope.
 */
function fakeClient(handler: (req: Anthropic.MessageCreateParams) => Anthropic.Message): Anthropic {
  const client = {
    messages: {
      create: async (req: Anthropic.MessageCreateParams) => handler(req),
    },
  };
  return client as unknown as Anthropic;
}

function buildToolUseMessage(input: unknown, toolName: string): Anthropic.Message {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-4-7',
    content: [
      {
        type: 'tool_use',
        id: 'toolu_plan',
        name: toolName,
        input,
      },
    ],
    stop_reason: 'tool_use',
    stop_sequence: null,
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  } as unknown as Anthropic.Message;
}

describe('AnthropicPlanner', () => {
  it('maps the emit_plan tool_use input into PlannedSteps with NanoIDs', async () => {
    const { AnthropicPlanner, PLAN_TOOL_NAME } = await import('./anthropic.js');

    const client = fakeClient((req) => {
      expect(req.model).toBe('claude-opus-4-7');
      expect(req.tool_choice).toEqual({ type: 'tool', name: PLAN_TOOL_NAME });
      expect(req.max_tokens).toBe(16_000);
      return buildToolUseMessage(
        {
          steps: [
            {
              kind: 'goto',
              payload: { url: 'https://qianniu.1688.com' },
              risk: 'low',
            },
            {
              kind: 'click',
              selector: {
                description: 'Inbox tab',
                strategies: [{ kind: 'text', value: '待处理' }],
              },
              risk: 'medium',
              requiresConfirm: false,
            },
          ],
        },
        PLAN_TOOL_NAME,
      );
    });

    const planner = new AnthropicPlanner({ client });
    const plan = await planner.plan({
      intent: '汇总过去 24 小时未回复的千牛客服消息',
      occupation: 'ecommerce-customer-service',
    });

    expect(plan).toHaveLength(2);
    expect(plan[0]).toMatchObject({
      kind: 'goto',
      risk: 'low',
      payload: { url: 'https://qianniu.1688.com' },
    });
    expect(plan[0]?.id).toMatch(/^stp_/);
    expect(plan[1]).toMatchObject({ kind: 'click', risk: 'medium' });
    expect(plan[1]?.selector?.description).toBe('Inbox tab');
  });

  it('throws PlannerError when the response has no tool_use block', async () => {
    const { AnthropicPlanner, PlannerError } = await import('./anthropic.js');

    const client = fakeClient(
      () =>
        ({
          id: 'msg_text',
          type: 'message',
          role: 'assistant',
          model: 'claude-opus-4-7',
          content: [{ type: 'text', text: 'sorry, I cannot.' }],
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: {
            input_tokens: 10,
            output_tokens: 10,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
        }) as unknown as Anthropic.Message,
    );

    const planner = new AnthropicPlanner({ client });
    await expect(planner.plan({ intent: 'x' })).rejects.toBeInstanceOf(PlannerError);
  });

  it('throws PlannerError when tool input fails schema validation', async () => {
    const { AnthropicPlanner, PLAN_TOOL_NAME, PlannerError } = await import('./anthropic.js');

    const client = fakeClient(() =>
      buildToolUseMessage(
        {
          steps: [
            {
              // missing required `kind`
              risk: 'low',
            },
          ],
        },
        PLAN_TOOL_NAME,
      ),
    );

    const planner = new AnthropicPlanner({ client });
    await expect(planner.plan({ intent: 'x' })).rejects.toBeInstanceOf(PlannerError);
  });

  it('sends cache_control on the system prompt for prefix-cache hits', async () => {
    const { AnthropicPlanner, PLAN_TOOL_NAME } = await import('./anthropic.js');

    let captured: Anthropic.MessageCreateParams | null = null;
    const client = fakeClient((req) => {
      captured = req;
      return buildToolUseMessage({ steps: [{ kind: 'wait', risk: 'low' }] }, PLAN_TOOL_NAME);
    });

    await new AnthropicPlanner({ client }).plan({
      intent: 'x',
      occupation: 'ecommerce-ops',
      skills: [{ slug: 'taobao-qianniu-inbox', description: '汇总未回客服消息' }],
    });

    expect(captured).not.toBeNull();
    const system = (captured as unknown as { system: Anthropic.TextBlockParam[] }).system;
    expect(Array.isArray(system)).toBe(true);
    expect(system[0]?.cache_control).toEqual({ type: 'ephemeral' });
  });

  it('renders skill catalogue as "- slug — description" lines', async () => {
    const { AnthropicPlanner, PLAN_TOOL_NAME } = await import('./anthropic.js');

    let captured: Anthropic.MessageCreateParams | null = null;
    const client = fakeClient((req) => {
      captured = req;
      return buildToolUseMessage({ steps: [{ kind: 'wait', risk: 'low' }] }, PLAN_TOOL_NAME);
    });

    await new AnthropicPlanner({ client }).plan({
      intent: 'route me to a skill',
      skills: [
        { slug: 'taobao-qianniu-inbox', description: '汇总未回客服消息' },
        { slug: 'shengyi-canmou-export', description: '导出生意参谋近 7 天数据' },
      ],
    });

    const system = (captured as unknown as { system: Anthropic.TextBlockParam[] }).system;
    const catalogueBlock = system[1];
    expect(catalogueBlock?.type).toBe('text');
    expect(catalogueBlock?.text).toContain('- taobao-qianniu-inbox — 汇总未回客服消息');
    expect(catalogueBlock?.text).toContain('- shengyi-canmou-export — 导出生意参谋近 7 天数据');
    // Full SKILL.md body must NOT be in the prompt — only one-line descriptions.
    expect(catalogueBlock?.text).not.toMatch(/千牛/u);
    expect(catalogueBlock?.cache_control).toEqual({ type: 'ephemeral' });
  });

  it('omits the catalogue block entirely when there are no skills and no occupation', async () => {
    const { AnthropicPlanner, PLAN_TOOL_NAME } = await import('./anthropic.js');

    let captured: Anthropic.MessageCreateParams | null = null;
    const client = fakeClient((req) => {
      captured = req;
      return buildToolUseMessage({ steps: [{ kind: 'wait', risk: 'low' }] }, PLAN_TOOL_NAME);
    });

    await new AnthropicPlanner({ client }).plan({ intent: 'no skills no occupation' });

    const system = (captured as unknown as { system: Anthropic.TextBlockParam[] }).system;
    expect(system).toHaveLength(1);
  });
});
