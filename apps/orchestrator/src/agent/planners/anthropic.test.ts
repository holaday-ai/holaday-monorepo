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

  it('tells the planner to stop before high-risk final confirmations', async () => {
    const { AnthropicPlanner, PLAN_TOOL_NAME } = await import('./anthropic.js');

    const client = fakeClient((req) => {
      const systemText = JSON.stringify(req.system);
      expect(systemText).toContain('Do NOT include the final confirmation action');
      expect(systemText).toContain('Place order');
      expect(systemText).toContain('Delete');
      expect(systemText).toContain('Unsubscribe');
      expect(systemText).toContain('review / confirmation page');
      return buildToolUseMessage({ steps: [{ kind: 'wait', risk: 'low' }] }, PLAN_TOOL_NAME);
    });

    const planner = new AnthropicPlanner({ client });
    await planner.plan({ intent: '取消订阅这个服务' });
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

  it('calls recorder.record on success with status=ok + usage + planSize', async () => {
    const { AnthropicPlanner, PLAN_TOOL_NAME } = await import('./anthropic.js');
    const { NoopLlmCallRecorder } = await import('../llm-call-recorder.js');

    const client = fakeClient(() =>
      buildToolUseMessage(
        {
          steps: [
            { kind: 'goto', payload: { url: 'https://example.com' }, risk: 'low' },
            { kind: 'wait', risk: 'low' },
          ],
        },
        PLAN_TOOL_NAME,
      ),
    );

    const seen: unknown[] = [];
    const recorder = new (class extends NoopLlmCallRecorder {
      override async record(call: unknown) {
        seen.push(call);
      }
    })();

    await new AnthropicPlanner({ client, recorder }).plan({
      intent: '研究一下',
      userId: 'usr_abc123',
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      userExternalId: 'usr_abc123',
      provider: 'anthropic',
      model: 'claude-opus-4-7',
      purpose: 'commander.plan',
      status: 'ok',
      inputTokens: 100,
      outputTokens: 50,
      requestMeta: { planSize: 2 },
    });
  });

  it('records status=error when the API returns a non-tool_use response', async () => {
    const { AnthropicPlanner } = await import('./anthropic.js');
    const { NoopLlmCallRecorder } = await import('../llm-call-recorder.js');

    const client = fakeClient(
      () =>
        ({
          id: 'msg_text',
          type: 'message',
          role: 'assistant',
          model: 'claude-opus-4-7',
          content: [{ type: 'text', text: 'sorry, no tool' }],
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: {
            input_tokens: 2049,
            output_tokens: 97,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
        }) as unknown as Anthropic.Message,
    );

    const seen: { status?: string }[] = [];
    const recorder = new (class extends NoopLlmCallRecorder {
      override async record(call: unknown) {
        seen.push(call as { status?: string });
      }
    })();

    await expect(
      new AnthropicPlanner({ client, recorder }).plan({
        intent: 'x',
        userId: 'usr_fail',
      }),
    ).rejects.toThrow();
    expect(seen).toHaveLength(1);
    expect(seen[0]?.status).toBe('error');
  });

  it('skips recording when ctx.userId is missing (tests / internal calls)', async () => {
    const { AnthropicPlanner, PLAN_TOOL_NAME } = await import('./anthropic.js');
    const { NoopLlmCallRecorder } = await import('../llm-call-recorder.js');

    const client = fakeClient(() =>
      buildToolUseMessage({ steps: [{ kind: 'wait', risk: 'low' }] }, PLAN_TOOL_NAME),
    );

    const seen: unknown[] = [];
    const recorder = new (class extends NoopLlmCallRecorder {
      override async record(call: unknown) {
        seen.push(call);
      }
    })();

    await new AnthropicPlanner({ client, recorder }).plan({ intent: 'anonymous call' });
    expect(seen).toHaveLength(0);
  });
});

describe('AnthropicPlanner.healSelector', () => {
  const failingStep = {
    id: 'stp_test',
    kind: 'extract' as const,
    risk: 'low' as const,
    selector: {
      description: 'Baidu result headlines',
      strategies: [{ kind: 'css' as const, value: '.old-bad-selector' }],
      scope: { timeoutMs: 5_000 },
      selfHeal: true,
    },
  };
  const diagnostic = {
    url: 'https://www.baidu.com/s?wd=x',
    title: '百度搜索',
    strategies: [
      { kind: 'css', selector: 'css(.old-bad-selector)', reason: 'waitFor timeout 2000ms' },
    ],
    screenshot:
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  };

  it('returns a parsed ResilientSelector when Claude emits a valid emit_selector tool_use', async () => {
    const { AnthropicPlanner, HEAL_TOOL_NAME } = await import('./anthropic.js');

    let capturedReq: Anthropic.MessageCreateParams | null = null;
    const client = fakeClient((req) => {
      capturedReq = req;
      return buildToolUseMessage(
        {
          description: 'Baidu result headlines (healed)',
          strategies: [
            { kind: 'css', value: '#content_left h3 a' },
            { kind: 'css', value: '#content_left h3' },
            { kind: 'css', value: '.c-title' },
          ],
          scope: { timeoutMs: 5000 },
          selfHeal: true,
        },
        HEAL_TOOL_NAME,
      );
    });

    const healed = await new AnthropicPlanner({ client }).healSelector({
      userId: 'usr_heal',
      intent: '帮我整理半导体要闻',
      originalStep: failingStep,
      diagnostic,
    });

    expect(healed.selector).not.toBeNull();
    expect(healed.selector?.description).toBe('Baidu result headlines (healed)');
    expect(healed.selector?.strategies).toHaveLength(3);
    expect(healed.selector?.strategies[0]).toEqual({ kind: 'css', value: '#content_left h3 a' });
    // HealResult also reports metrics — even on a synthetic test fixture.
    expect(typeof healed.elapsedMs).toBe('number');
    expect(healed.inputTokens).toBe(100);
    expect(healed.outputTokens).toBe(50);

    // Verify the request included the screenshot as an image block.
    // Anthropic SDK's MessageCreateParams is a discriminated union
    // (stream/non-stream) that TS narrows to `never` on a plain
    // optional-chain access, so match the cast idiom used elsewhere
    // in this file (lines ~160 / ~182 / ~203 for the `captured.system`
    // readouts in the plan tests).
    expect(capturedReq).not.toBeNull();
    const req = capturedReq as unknown as { messages: { role: string; content: unknown }[] };
    const firstMsg = req.messages[0];
    expect(firstMsg?.role).toBe('user');
    expect(Array.isArray(firstMsg?.content)).toBe(true);
    const content = firstMsg?.content as Anthropic.ContentBlockParam[];
    const hasImage = content.some(
      (b) =>
        b.type === 'image' &&
        'source' in b &&
        b.source.type === 'base64' &&
        b.source.media_type === 'image/png',
    );
    expect(hasImage).toBe(true);
    // Text block mentions the already-tried strategies so the model doesn't repeat.
    const textBlock = content.find((b) => b.type === 'text') as
      | Anthropic.TextBlockParam
      | undefined;
    expect(textBlock?.text).toContain('.old-bad-selector');
    expect(textBlock?.text).toContain('waitFor timeout 2000ms');
    expect(textBlock?.text).toContain('https://www.baidu.com/s?wd=x');
  });

  it('returns null (declines) when the model response lacks the emit_selector tool_use', async () => {
    const { AnthropicPlanner } = await import('./anthropic.js');
    const client = fakeClient(() => buildToolUseMessage({ foo: 'bar' }, 'some_other_tool'));
    const healed = await new AnthropicPlanner({ client }).healSelector({
      originalStep: failingStep,
      diagnostic,
    });
    expect(healed.selector).toBeNull();
  });

  it('returns null when the tool_use input fails ResilientSelector schema', async () => {
    const { AnthropicPlanner, HEAL_TOOL_NAME } = await import('./anthropic.js');
    // Empty strategies array — resilientSelectorSchema requires min(1).
    const client = fakeClient(() =>
      buildToolUseMessage({ description: 'bad', strategies: [] }, HEAL_TOOL_NAME),
    );
    const healed = await new AnthropicPlanner({ client }).healSelector({
      originalStep: failingStep,
      diagnostic,
    });
    expect(healed.selector).toBeNull();
  });

  it('returns null when the API call throws (contract: never throws)', async () => {
    const { AnthropicPlanner } = await import('./anthropic.js');
    const client = fakeClient(() => {
      throw new Error('simulated 500');
    });
    const healed = await new AnthropicPlanner({ client }).healSelector({
      originalStep: failingStep,
      diagnostic,
    });
    expect(healed.selector).toBeNull();
  });

  it('records a commander.heal row with usage + purpose=commander.heal when userId is present', async () => {
    const { AnthropicPlanner, HEAL_TOOL_NAME } = await import('./anthropic.js');
    const { NoopLlmCallRecorder } = await import('../llm-call-recorder.js');

    const client = fakeClient(() =>
      buildToolUseMessage(
        {
          description: 'healed',
          strategies: [
            { kind: 'css', value: 'a' },
            { kind: 'css', value: 'b' },
            { kind: 'css', value: 'c' },
          ],
        },
        HEAL_TOOL_NAME,
      ),
    );

    const seen: { purpose: string; status: string }[] = [];
    const recorder = new (class extends NoopLlmCallRecorder {
      override async record(call: { purpose: string; status: string }) {
        seen.push({ purpose: call.purpose, status: call.status });
      }
    })();

    await new AnthropicPlanner({ client, recorder }).healSelector({
      userId: 'usr_heal',
      originalStep: failingStep,
      diagnostic,
    });
    expect(seen).toEqual([{ purpose: 'commander.heal', status: 'ok' }]);
  });

  it('returns null without calling the client when the failing step has no selector', async () => {
    const { AnthropicPlanner } = await import('./anthropic.js');
    let called = false;
    const client = fakeClient(() => {
      called = true;
      return buildToolUseMessage({}, 'never');
    });
    const healed = await new AnthropicPlanner({ client }).healSelector({
      originalStep: { ...failingStep, selector: undefined },
      diagnostic,
    });
    expect(healed.selector).toBeNull();
    expect(called).toBe(false);
  });
});
