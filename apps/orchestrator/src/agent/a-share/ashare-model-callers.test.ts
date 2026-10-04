import { describe, expect, it, vi } from 'vitest';
import type {
  MessagesAdapter,
  NeutralMessagesRequest,
  NeutralMessagesResponse,
} from '../../llm/messages-adapter.js';
import { BUILTIN_MODEL_CATALOG, type BrainEntry } from '../../llm/model-catalog.js';
import { createProductionModelRuntimeWiring } from '../../llm/model-runtime-wiring.js';
import {
  ASHARE_INTERPRET_REQUEST,
  ASHARE_JUDGE_REQUEST,
  ASHARE_MODEL_PURPOSE,
  ashareMessagesAdapter,
  createAshareModelCallers,
} from './ashare-model-callers.js';

/** 合成环境：不含真实 key、不发网络（createMessages 被替换）。 */
const ASHARE_SYNTHETIC_MODEL_ENV = {
  NODE_ENV: 'test' as const,
  MODEL_RUNTIME_POLICY: 'qwen_only' as const,
  QWEN_CORE_ROLLOUT_MODE: 'all' as const,
  QWEN_CORE_ENABLED_LANES: '',
  QWEN_CORE_ALLOWLIST: '',
  QWEN_MESSAGES_ADAPTER_ENABLED: true,
  QWEN_RESPONSES_ADAPTER_ENABLED: true,
  DASHSCOPE_API_KEY: '',
  DASHSCOPE_WORKSPACE_ID: '',
  DASHSCOPE_INTL_API_KEY: 'synthetic-intl-key',
  DASHSCOPE_INTL_ANTHROPIC_BASE_URL: 'https://dashscope-intl.aliyuncs.com/apps/anthropic',
  DASHSCOPE_INTL_RESPONSES_BASE_URL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
  DASHSCOPE_INTL_WORKSPACE_ID: '',
  DASHSCOPE_CN_API_KEY: 'synthetic-cn-key',
  DASHSCOPE_CN_ANTHROPIC_BASE_URL: 'https://dashscope.aliyuncs.com/apps/anthropic',
  DASHSCOPE_CN_RESPONSES_BASE_URL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  DASHSCOPE_CN_WORKSPACE_ID: '',
  QWEN_REASONING_MODEL: 'qwen3.8-max',
  QWEN_STANDARD_MODEL: 'qwen3.7-plus',
  QWEN_FAST_MODEL: 'qwen3.8-flash',
  QWEN_CODING_MODEL: 'qwen3-coder-plus',
  QWEN_VERIFIER_MODEL: 'qwen3.8-flash',
  QWEN_VERIFY_FAST_MODEL: 'qwen3.8-flash',
  QWEN_VERIFY_STRICT_MODEL: 'qwen3.8-max',
  QWEN_VISION_MODEL: 'qwen3.8-max',
};

function textResponse(text: string): NeutralMessagesResponse {
  return {
    id: 'msg_fake',
    metadata: {
      provider: 'alibaba-model-studio',
      model: 'fake',
      region: 'cn',
      deploymentScope: 'china_mainland',
      endpointKind: 'public',
      protocol: 'messages',
    },
    content: [{ type: 'text', text }],
    stopReason: 'end_turn',
    usage: {
      inputTokens: null,
      outputTokens: null,
      cacheReadInputTokens: null,
      cacheCreationInputTokens: null,
      complete: false,
    },
  };
}

describe('ashare-model-callers（模型目录 generate 通道）', () => {
  it('从目录 generate lane 取 standard 档 adapter（默认千问）', () => {
    const createMessages = vi.fn(({ purpose, environment }) => {
      const adapter: MessagesAdapter = {
        metadata: {
          provider: 'alibaba-model-studio',
          model: (environment as { QWEN_STANDARD_MODEL: string }).QWEN_STANDARD_MODEL,
          region: 'cn',
          deploymentScope: 'china_mainland',
          endpointKind: 'public',
          protocol: 'messages',
        },
        create: vi.fn(),
      };
      expect(purpose).toBe(ASHARE_MODEL_PURPOSE);
      return adapter;
    });
    const wiring = createProductionModelRuntimeWiring(ASHARE_SYNTHETIC_MODEL_ENV, {
      createMessages,
    });
    const runtime = wiring.resolveCore({
      actorExternalId: 'usr_any',
      lane: 'generate',
      ownership: { scope: 'personal', userRegion: 'cn' },
    });
    const adapter = ashareMessagesAdapter(runtime);
    expect(adapter?.metadata.provider).toBe('alibaba-model-studio');
    expect(createMessages).toHaveBeenCalledTimes(1);
  });

  it('runtime 不可用 → null（调用侧按 reasonCode 失败，不回落旧模型）', () => {
    const wiring = createProductionModelRuntimeWiring(ASHARE_SYNTHETIC_MODEL_ENV);
    const runtime = wiring.resolveCore({
      actorExternalId: 'usr_any',
      lane: 'generate',
      ownership: { scope: 'personal', userRegion: null },
    });
    expect(runtime.kind).toBe('unavailable');
    expect(ashareMessagesAdapter(runtime)).toBeNull();
  });

  it('目录切到 Claude 时同一通道跟随（Claude 路径保留，未删除）', () => {
    const claude = BUILTIN_MODEL_CATALOG.find((b: BrainEntry) => b.provider === 'anthropic');
    if (!claude) return; // 目录里隐藏/未列出时跳过
    const createExternalMessages = vi.fn(
      ({ provider, model }: { provider: 'anthropic' | 'openai'; model: string }) =>
        ({ metadata: { provider, model }, create: vi.fn() }) as MessagesAdapter,
    );
    const wiring = createProductionModelRuntimeWiring(
      { ...ASHARE_SYNTHETIC_MODEL_ENV, ANTHROPIC_API_KEY: 'synthetic-anthropic-key' },
      { createExternalMessages },
    );
    const runtime = wiring.resolveCore({
      actorExternalId: 'usr_any',
      lane: 'generate',
      ownership: { scope: 'personal', userRegion: null },
      brain: claude,
    });
    expect(ashareMessagesAdapter(runtime)?.metadata.provider).toBe('anthropic');
  });

  it('interpret / judge 参数与原 tasks.ts 内联闭包一致，只取 text 块', async () => {
    const seen: NeutralMessagesRequest[] = [];
    const adapter: MessagesAdapter = {
      metadata: { provider: 'anthropic', model: 'x' },
      create: async (req) => {
        seen.push(req);
        const r = textResponse('第一段');
        r.content.push({ type: 'tool_use', id: 't', name: 'n', input: {} });
        r.content.push({ type: 'text', text: '第二段' });
        return r;
      },
    };
    const callers = createAshareModelCallers(adapter, { judgeEnabled: true });
    expect(await callers.interpret({ system: 'S', user: 'U' })).toBe('第一段\n第二段');
    await callers.judge?.({ system: 'JS', user: 'JU' });
    expect(seen[0]).toEqual({
      maxTokens: ASHARE_INTERPRET_REQUEST.maxTokens,
      temperature: ASHARE_INTERPRET_REQUEST.temperature,
      system: 'S',
      messages: [{ role: 'user', content: 'U' }],
      thinking: { type: 'disabled' },
    });
    expect(seen[1]).toMatchObject({ maxTokens: 160, temperature: 0, system: 'JS' });
    expect(ASHARE_JUDGE_REQUEST).toEqual({ maxTokens: 160, temperature: 0 });
  });

  it('judge flag 关 → 不注入 judge（runner 走 regex-only 原行为）', () => {
    const adapter = { metadata: { provider: 'anthropic', model: 'x' }, create: vi.fn() };
    const callers = createAshareModelCallers(adapter as MessagesAdapter, { judgeEnabled: false });
    expect(callers.judge).toBeUndefined();
    expect('judge' in callers).toBe(false);
  });
});
