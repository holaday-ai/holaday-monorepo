import { pino } from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONTENT_TOPIC_WORKFLOW } from '../execution/expert-workflow-content-topic.js';
import { reloadFeatureFlagsForTest, setFeatureFlagsForTest } from '../execution/feature-flags.js';
import type {
  NeutralResponsesRequest,
  NeutralResponsesResult,
  ResponsesAdapter,
} from '../llm/responses-adapter.js';
import { ResponsesAdapterError } from '../llm/responses-adapter.js';
import { runGenerateTask } from './generate-runner.js';

type ScriptedResponse = Partial<Omit<NeutralResponsesResult, 'metadata'>> | Error | 'hang';

const METADATA = {
  provider: 'alibaba-model-studio' as const,
  region: 'cn' as const,
  deploymentScope: 'china_mainland' as const,
  model: 'qwen3.8-plus',
  endpointKind: 'public' as const,
  protocol: 'responses' as const,
};

function makeLogger() {
  return pino({ level: 'silent' });
}

function makeAdapter(...script: ScriptedResponse[]): ResponsesAdapter {
  let index = 0;
  const stream = vi.fn(
    async (
      _request: NeutralResponsesRequest,
      options?: {
        signal?: AbortSignal;
        timeoutMs?: number;
        onTextDelta?: (delta: string) => void;
      },
    ): Promise<NeutralResponsesResult> => {
      const next = script[Math.min(index++, script.length - 1)] ?? {};
      if (next === 'hang') {
        return new Promise((_resolve, reject) => {
          const abort = () => reject(new ResponsesAdapterError('REQUEST_ABORTED'));
          if (options?.signal?.aborted) abort();
          else options?.signal?.addEventListener('abort', abort, { once: true });
        });
      }
      if (next instanceof Error) throw next;
      const text = next.text ?? '生成结果';
      if (text) options?.onTextDelta?.(text);
      return {
        id: next.id ?? `resp_${index}`,
        metadata: METADATA,
        text,
        sources: next.sources ?? [],
        usage: next.usage ?? { inputTokens: 100, outputTokens: 50 },
        status: next.status ?? 'completed',
        ...(next.incompleteReason ? { incompleteReason: next.incompleteReason } : {}),
      };
    },
  );
  return { metadata: METADATA, stream };
}

function callCount(adapter: ResponsesAdapter): number {
  return vi.mocked(adapter.stream).mock.calls.length;
}

function requestAt(adapter: ResponsesAdapter, index = 0): NeutralResponsesRequest {
  const request = vi.mocked(adapter.stream).mock.calls[index]?.[0];
  if (!request) throw new Error(`missing request ${index}`);
  return request;
}

function run(
  adapter: ResponsesAdapter,
  overrides: Partial<Parameters<typeof runGenerateTask>[0]> = {},
) {
  return runGenerateTask({
    taskId: 'tsk_test',
    userId: 'usr_test',
    intent: '写一份 AI 产品 PRD 草案',
    responsesAdapter: adapter,
    logger: makeLogger(),
    ...overrides,
  });
}

afterEach(() => {
  reloadFeatureFlagsForTest();
  vi.useRealTimers();
});

describe('runGenerateTask — Qwen Responses runtime', () => {
  it('returns completed text, usage and streamed deltas', async () => {
    const adapter = makeAdapter({
      text: '这是一份产品方案。',
      usage: { inputTokens: 1234, outputTokens: 567 },
    });
    const deltas: string[] = [];
    const outcome = await run(adapter, { onStreamDelta: (delta) => deltas.push(delta) });

    expect(outcome).toMatchObject({
      status: 'completed',
      summary: '这是一份产品方案。',
      inputTokens: 1234,
      outputTokens: 567,
    });
    expect(deltas).toEqual(['这是一份产品方案。']);
    expect(requestAt(adapter).maxOutputTokens).toBe(8192);
  });

  it('uses the neutral Qwen metadata and never accepts a provider/model override', async () => {
    const adapter = makeAdapter({ text: 'ok' });
    await run(adapter);

    expect(adapter.metadata).toEqual(METADATA);
    expect(requestAt(adapter)).not.toHaveProperty('model');
  });

  it('maps text and image attachments before the user intent', async () => {
    const adapter = makeAdapter({ text: '已分析' });
    await run(adapter, {
      intent: '分析附件',
      attachments: [
        { type: 'text', text: '[附件: a.csv]\na,b' },
        {
          type: 'image',
          source: { type: 'base64', media_type: 'image/png', data: 'aGVsbG8=' },
        },
      ],
    });

    expect(requestAt(adapter).input).toEqual([
      {
        role: 'user',
        content: [
          { type: 'input_text', text: '[附件: a.csv]\na,b' },
          {
            type: 'input_image',
            source: { mediaType: 'image/png', data: 'aGVsbG8=' },
          },
          { type: 'input_text', text: '分析附件' },
        ],
      },
    ]);
  });

  it('uses no tools for ordinary writing and static research', async () => {
    const writing = makeAdapter({ text: '文案' });
    const research = makeAdapter({ text: '报告' });
    await run(writing, { intent: '写一段品牌文案' });
    await run(research, { intent: '介绍量子计算的基本原理' });
    expect(requestAt(writing).tools).toEqual([]);
    expect(requestAt(research).tools).toEqual([]);
  });

  it('uses the three approved built-in tools for fresh research', async () => {
    const adapter = makeAdapter({
      text: '最新信息',
      sources: [
        {
          title: '官方公告',
          url: 'https://example.com/news',
          provenance: 'web_search',
        },
      ],
    });
    const outcome = await run(adapter, { intent: '这家公司今天有什么最新新闻？' });

    expect(requestAt(adapter).tools).toEqual([
      { type: 'web_search' },
      { type: 'web_extractor' },
      { type: 'code_interpreter' },
    ]);
    expect(requestAt(adapter).instructions).toContain('必须先调用 web_search');
    expect(outcome.summary).toContain('### 核验来源');
    expect(outcome.sourceUrls).toEqual(['https://example.com/news']);
  });

  it('fails a fresh request when the adapter observed no source', async () => {
    const outcome = await run(makeAdapter({ text: '没有来源的答案' }), {
      intent: '今天最新的 AI 新闻是什么？',
    });
    expect(outcome).toMatchObject({
      status: 'failed',
      summary: '',
      reason: '未取得可核验的最新来源，请稍后重试。',
    });
  });

  it('deduplicates and filters unsafe source URLs', async () => {
    const adapter = makeAdapter({
      text: '最新信息',
      sources: [
        { title: '来源 A', url: 'https://example.com/a', provenance: 'web_search' },
        { title: '重复', url: 'https://example.com/a', provenance: 'web_search' },
        { title: '危险', url: 'javascript:alert(1)', provenance: 'web_search' },
      ],
    });
    const outcome = await run(adapter, { intent: '今天的最新消息' });
    expect(outcome.sourceUrls).toEqual(['https://example.com/a']);
    expect(outcome.summary).not.toContain('javascript:');
  });

  it('continues an incomplete max-output response and accumulates usage', async () => {
    const adapter = makeAdapter(
      {
        text: '第一段',
        status: 'incomplete',
        incompleteReason: 'max_output_tokens',
        usage: { inputTokens: 10, outputTokens: 20 },
      },
      {
        text: '第二段',
        status: 'completed',
        usage: { inputTokens: 30, outputTokens: 40 },
      },
    );
    const outcome = await run(adapter);

    expect(outcome).toMatchObject({
      status: 'completed',
      summary: '第一段第二段',
      inputTokens: 40,
      outputTokens: 60,
    });
    const firstInput = requestAt(adapter, 0).input;
    expect(Array.isArray(firstInput)).toBe(true);
    expect(requestAt(adapter, 1).input).toEqual([
      ...(firstInput as ReadonlyArray<unknown>),
      { role: 'assistant', content: '第一段' },
      { role: 'user', content: '请继续上文，不要重复已有内容。' },
    ]);
  });

  it('adds a visible notice after exhausting continuation budget', async () => {
    const adapter = makeAdapter({
      text: '片段',
      status: 'incomplete',
      incompleteReason: 'max_output_tokens',
    });
    const outcome = await run(adapter);
    expect(callCount(adapter)).toBe(3);
    expect(outcome.summary).toContain('内容因长度限制被截断');
  });

  it('retries an empty response once and then returns a fixed safe error', async () => {
    const adapter = makeAdapter({ text: '' }, { text: '' });
    const outcome = await run(adapter);
    expect(callCount(adapter)).toBe(2);
    expect(outcome).toMatchObject({
      status: 'failed',
      reason: 'AI 连续两次返回空内容，请重试或简化任务。',
    });
  });

  it('sanitizes provider errors instead of exposing their messages', async () => {
    const adapter = makeAdapter(new Error('private provider detail and endpoint'));
    const outcome = await run(adapter);
    expect(outcome.reason).toBe('生成服务暂时不可用，请稍后重试。');
    expect(outcome.reason).not.toContain('private provider detail');
  });

  it('aborts a hanging request at the task timeout', async () => {
    const outcome = await run(makeAdapter('hang'), { timeoutMs: 10 });
    expect(outcome.status).toBe('failed');
    expect(outcome.reason).toContain('生成超时');
  });

  it('retries two idle streams at the heartbeat boundary and fails safely', async () => {
    vi.useFakeTimers();
    const adapter = makeAdapter('hang', 'hang');
    const pending = run(adapter, { timeoutMs: 180_000 });

    await vi.advanceTimersByTimeAsync(50_000);
    await vi.advanceTimersByTimeAsync(50_000);
    const outcome = await pending;

    expect(callCount(adapter)).toBe(2);
    expect(outcome).toMatchObject({
      status: 'failed',
      reason: 'AI 长时间没有响应，请简化任务后重试。',
    });
  });

  it('preserves an earlier partial response when continuation fails', async () => {
    const adapter = makeAdapter(
      { text: '已生成部分', status: 'incomplete', incompleteReason: 'max_output_tokens' },
      new ResponsesAdapterError('PROVIDER_ERROR'),
    );
    const outcome = await run(adapter);
    expect(outcome.status).toBe('completed');
    expect(outcome.summary).toContain('已生成部分');
    expect(outcome.summary).toContain('内容因网络或超时被截断');
  });
});

describe('runGenerateTask — lightweight and expert workflows', () => {
  it('answers deterministic arithmetic without a model call', async () => {
    const adapter = makeAdapter({ text: '不应调用' });
    const outcome = await run(adapter, { intent: '1 加 1 等于几？' });
    expect(outcome.status).toBe('completed');
    expect(outcome.summary).toContain('2');
    expect(callCount(adapter)).toBe(0);
  });

  it('uses no tools for lightweight model-backed knowledge', async () => {
    const adapter = makeAdapter({ text: '简短解释' });
    await run(adapter, { intent: '什么是递归？' });
    expect(requestAt(adapter).tools).toEqual([]);
  });

  it('forced expert mode includes the decision-ready evidence contract', async () => {
    const adapter = makeAdapter({ text: '分析结果' });
    await run(adapter, {
      intent: '分析这个商业方案的风险',
      expertMode: 'expert',
    });
    expect(requestAt(adapter).instructions).toContain('专家模式质量合同');
    expect(requestAt(adapter).instructions).toContain('事实边界');
  });

  it('parks missing workflow inputs before any model call', async () => {
    setFeatureFlagsForTest({ EXPERT_WORKFLOW: true });
    const adapter = makeAdapter({ text: '不应调用' });
    const outcome = await run(adapter, { intent: '帮我复盘下抖音直播' });
    expect(outcome.status).toBe('awaiting_user');
    expect(outcome.summary).toContain('直播 GMV');
    expect(callCount(adapter)).toBe(0);
  });

  it('parks arithmetic contradictions before any model call', async () => {
    setFeatureFlagsForTest({ EXPERT_WORKFLOW: true });
    const adapter = makeAdapter({ text: '不应调用' });
    const outcome = await run(adapter, {
      intent: '复盘抖音直播 GMV 200000 UV 5000 订单 500 客单价 50 转化率 10%',
    });
    expect(outcome.status).toBe('awaiting_user');
    expect(outcome.summary).toContain('校验未通过');
    expect(callCount(adapter)).toBe(0);
  });

  it('uses the workflow prompt, budget and follow-up footer when intake is ready', async () => {
    setFeatureFlagsForTest({ EXPERT_WORKFLOW: true });
    const adapter = makeAdapter({ text: '## 核心数据\n已完成' });
    const outcome = await run(adapter, {
      intent: '复盘抖音直播 GMV 100000 UV 20000 订单 1250 客单价 80 转化率 6.25%',
    });
    expect(requestAt(adapter).instructions).toContain('抖音直播复盘');
    expect(requestAt(adapter).maxOutputTokens).toBe(4096);
    expect(outcome.summary).toContain('HOLA_FOLLOW_UP_ACTIONS_START');
  });

  it('uses the content-topic workflow bounded budget', async () => {
    setFeatureFlagsForTest({ EXPERT_WORKFLOW: true });
    const adapter = makeAdapter({ text: '## 数据校验\n已通过' });
    await run(adapter, {
      intent: '品类 母婴 平台小红书 生成 8 个选题',
      workflowOverride: CONTENT_TOPIC_WORKFLOW,
    });
    expect(requestAt(adapter).maxOutputTokens).toBe(5120);
  });

  it('turns a model awaiting marker into an awaiting_user outcome', async () => {
    const outcome = await run(makeAdapter({ text: '[AWAITING_USER_INPUT] 请补充目标。' }));
    expect(outcome).toMatchObject({ status: 'awaiting_user', summary: '请补充目标。' });
  });
});
