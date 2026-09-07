import { describe, expect, it, vi } from 'vitest';
import { env } from '../config/env.js';
import { createProductionModelRuntimeWiring } from '../llm/model-runtime-wiring.js';
import { publishCoreTaskSuggestions } from './core-task-suggestions.js';

function fixture(options: { allowed?: boolean; output?: string; failed?: boolean } = {}) {
  const calls: Array<{ region: string; request: unknown; options: unknown }> = [];
  const frames: string[][] = [];
  const wiring = createProductionModelRuntimeWiring(
    {
      ...env,
      QWEN_CORE_ROLLOUT_MODE: 'synthetic',
      QWEN_CORE_ALLOWLIST: 'usr_suggestions_fixture',
      QWEN_CORE_ENABLED_LANES: options.allowed === false ? 'generate' : 'generate,suggestions',
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
          async create(request, requestOptions) {
            calls.push({ region, request, options: requestOptions });
            if (options.failed) throw new Error('PRIVATE_PROVIDER_DETAIL');
            return {
              id: 'fixture',
              metadata,
              content: [
                {
                  type: 'text' as const,
                  text: options.output ?? '["整理后续执行清单","比较两种材料结构"]',
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
    frames,
    input: {
      wiring,
      actorExternalId: 'usr_suggestions_fixture',
      modelDataRegion: 'cn',
      rawIntent: '整理提供的材料，归纳关键事实并输出一份简洁提纲。',
      intent: '整理提供的材料，归纳关键事实并输出一份简洁提纲。',
      summary: '合成材料的主要事实及待确认事项。',
      isCurrent: vi.fn(async () => true),
      publish: (items: string[]) => {
        frames.push(items);
      },
    },
  };
}

describe('core follow-up suggestions boundary', () => {
  it.each(['cn', 'intl'])(
    'uses only the selected %s region and a bounded optional request',
    async (modelDataRegion) => {
      const f = fixture();
      await publishCoreTaskSuggestions({ ...f.input, modelDataRegion });
      expect(f.calls).toHaveLength(1);
      expect(f.calls[0]).toMatchObject({
        region: modelDataRegion,
        options: { timeoutMs: 4000, maxRetries: 0 },
      });
      expect(f.frames).toEqual([['整理后续执行清单', '比较两种材料结构']]);
      expect(f.input.isCurrent).toHaveBeenCalledTimes(2);
    },
  );
  it('does not call a model for disabled lanes, outside actors, missing regions or trivial content', async () => {
    for (const input of [
      {},
      { actorExternalId: 'usr_outside' },
      { modelDataRegion: null },
      { intent: ' ' },
      { summary: ' ' },
      { intent: '你好', rawIntent: '你好' },
    ]) {
      const f = fixture({ allowed: Object.keys(input).length > 0 });
      await publishCoreTaskSuggestions({ ...f.input, ...input });
      expect(f.calls).toEqual([]);
      expect(f.frames).toEqual([]);
    }
  });
  it('does not call a model after the saved result became stale', async () => {
    const f = fixture();
    f.input.isCurrent.mockResolvedValue(false);
    await publishCoreTaskSuggestions(f.input);
    expect(f.calls).toEqual([]);
    expect(f.frames).toEqual([]);
  });
  it('suppresses stale results after the model returns', async () => {
    const f = fixture();
    f.input.isCurrent.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await publishCoreTaskSuggestions(f.input);
    expect(f.calls).toHaveLength(1);
    expect(f.frames).toEqual([]);
  });
  it('inherits tail restrictions without trimming the original intent', async () => {
    const f = fixture({ output: '["发送总结邮件","整理后续执行清单"]' });
    const intent = `${'合成材料。'.repeat(150)}不要发送邮件`;
    await publishCoreTaskSuggestions({ ...f.input, intent });
    expect(JSON.stringify(f.calls[0]?.request)).toContain(intent);
    expect(f.frames).toEqual([['整理后续执行清单']]);
  });
  it.each([{ output: 'not json' }, { output: '[]' }, { failed: true }])(
    'keeps empty, malformed and failed suggestions silent',
    async (options) => {
      const f = fixture(options);
      await expect(publishCoreTaskSuggestions(f.input)).resolves.toBeUndefined();
      expect(f.frames).toEqual([]);
    },
  );
  it('absorbs state reads and delivery failures without rejecting the main task', async () => {
    const f = fixture();
    await expect(
      publishCoreTaskSuggestions({
        ...f.input,
        isCurrent: async () => {
          throw new Error('PRIVATE_DB_DETAIL');
        },
      }),
    ).resolves.toBeUndefined();
    expect(f.calls).toEqual([]);
    await expect(
      publishCoreTaskSuggestions({
        ...f.input,
        publish: () => {
          throw new Error('PRIVATE_SOCKET_DETAIL');
        },
      }),
    ).resolves.toBeUndefined();
    expect(f.frames).toEqual([]);
  });
});
