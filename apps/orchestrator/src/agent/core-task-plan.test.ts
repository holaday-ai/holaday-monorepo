import type { Logger } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { env } from '../config/env.js';
import { createProductionModelRuntimeWiring } from '../llm/model-runtime-wiring.js';
import { prepareCoreTaskPlan } from './core-task-plan.js';

function fixture(options: { allowed?: boolean; output?: string; persisted?: boolean } = {}) {
  const calls: unknown[] = [];
  const writes: unknown[] = [];
  const frames: unknown[] = [];
  const logger = { info: vi.fn(), warn: vi.fn() } as unknown as Logger;
  const wiring = createProductionModelRuntimeWiring(
    {
      ...env,
      QWEN_CORE_ROLLOUT_MODE: 'synthetic',
      QWEN_CORE_ALLOWLIST: 'usr_synthetic',
      QWEN_CORE_ENABLED_LANES:
        options.allowed === false ? 'generate,scrape' : 'plan,generate,scrape',
      QWEN_MESSAGES_ADAPTER_ENABLED: true,
      QWEN_RESPONSES_ADAPTER_ENABLED: true,
      DASHSCOPE_CN_API_KEY: 'synthetic-cn',
      DASHSCOPE_INTL_API_KEY: 'synthetic-intl',
    },
    {
      observe: () => {},
      createMessages: ({ region }) => {
        const metadata = {
          provider: 'alibaba-model-studio' as const,
          region,
          deploymentScope:
            region === 'cn' ? ('china_mainland' as const) : ('international' as const),
          model: 'qwen3.7-plus',
          protocol: 'messages' as const,
          endpointKind: 'public' as const,
        };
        return {
          metadata,
          async create(request) {
            calls.push(request);
            return {
              id: 'fixture',
              metadata,
              content: [
                {
                  type: 'text' as const,
                  text:
                    options.output ??
                    '{"steps":[{"text":"整理材料","tool":"文件处理"},{"text":"归纳结论","tool":"生成内容"}],"estimatedSeconds":8}',
                },
              ],
              stopReason: 'end_turn',
              usage: {
                inputTokens: 10,
                outputTokens: 20,
                cacheReadInputTokens: null,
                cacheCreationInputTokens: null,
                complete: true,
              },
            };
          },
        };
      },
    },
  );
  return {
    calls,
    writes,
    frames,
    input: {
      wiring,
      actorExternalId: 'usr_synthetic',
      modelDataRegion: 'cn',
      intent: '整理给出的材料，提炼关键结论并形成一份简洁的分析提纲。',
      logger,
      persist: async (planText: string) => {
        writes.push(planText);
        return options.persisted !== false;
      },
      publish: (planText: string) => {
        frames.push(planText);
      },
    },
  };
}

describe('core task planning without the dormant browser controller', () => {
  it('produces, persists and publishes a validated same-region plan', async () => {
    const f = fixture();
    await prepareCoreTaskPlan(f.input);
    expect(f.calls).toHaveLength(1);
    expect(f.writes).toHaveLength(1);
    expect(f.writes[0]).toContain('整理材料');
    expect(f.frames).toEqual(f.writes);
  });
  it('does not call the provider when the plan lane is disabled or actor is outside canary', async () => {
    for (const [f, actorExternalId] of [
      [fixture({ allowed: false }), 'usr_synthetic'],
      [fixture(), 'usr_outside'],
    ] as const) {
      await prepareCoreTaskPlan({ ...f.input, actorExternalId });
      expect(f.calls).toEqual([]);
      expect(f.writes).toEqual([]);
    }
  });
  it('skips trivial and lightweight tasks instead of adding a planning request', async () => {
    const f = fixture();
    for (const intent of ['你好', '把这句话翻译成英文：今天是个好天气。']) {
      await prepareCoreTaskPlan({ ...f.input, intent });
    }
    expect(f.calls).toEqual([]);
  });
  it('does not publish late plans when the active-task write is refused', async () => {
    const f = fixture({ persisted: false });
    await prepareCoreTaskPlan(f.input);
    expect(f.writes).toHaveLength(1);
    expect(f.frames).toEqual([]);
  });
  it.each([
    'not json',
    '{"steps":[{"text":"打开网页","tool":"浏览器操作"},{"text":"归纳结论","tool":"生成内容"}],"estimatedSeconds":8}',
  ])('rejects unusable or unmigrated-tool plans', async (output) => {
    const f = fixture({ output });
    await prepareCoreTaskPlan(f.input);
    expect(f.writes).toEqual([]);
    expect(f.frames).toEqual([]);
  });
  it('keeps plan write failures non-fatal and logs only a fixed reason', async () => {
    const f = fixture();
    await expect(
      prepareCoreTaskPlan({
        ...f.input,
        persist: async () => {
          throw new Error('PRIVATE_DB_DETAIL');
        },
      }),
    ).resolves.toBeNull();
    expect(f.frames).toEqual([]);
    expect(JSON.stringify(vi.mocked(f.input.logger.warn).mock.calls)).not.toContain(
      'PRIVATE_DB_DETAIL',
    );
  });
});
