import type { Logger } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import type { FirecrawlLane } from '../firecrawl/firecrawl-lane.js';
import type { NeutralResponsesRequest, ResponsesAdapter } from '../llm/responses-adapter.js';
import { selfIdentitySentences } from './scrape-answer-check.js';
import { runScrapeTask } from './scrape-runner.js';

/**
 * G2g s01 (local B cuxBlr, 「搜一下 HOLA DAY AI 是什么」): the write-up of the search results answered
 * 「"HOLA DAY" 是我自己的名字——我是一个浏览器任务执行助手」 — the assistant's own name and role from
 * its system prompt, not something any fetched page said.
 */
const METADATA = {
  provider: 'alibaba-model-studio' as const,
  region: 'cn' as const,
  deploymentScope: 'china_mainland' as const,
  model: 'qwen3.8-plus',
  endpointKind: 'public' as const,
  protocol: 'responses' as const,
};

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
  trace: vi.fn(),
  child: () => logger,
} as unknown as Logger;

const DAY_OF_AI =
  '# Day of AI\n\nDay of AI is a free initiative from MIT RAISE that brings AI literacy to K-12 students. It was first held on May 13, 2022.';

function adapterSaying(texts: string[]) {
  const requests: NeutralResponsesRequest[] = [];
  const adapter: ResponsesAdapter = {
    metadata: METADATA,
    stream: vi.fn(async (request: NeutralResponsesRequest) => {
      requests.push(request);
      const text = texts[Math.min(requests.length - 1, texts.length - 1)]!;
      return {
        id: `resp_${requests.length}`,
        metadata: METADATA,
        text,
        sources: [],
        usage: { inputTokens: 10, outputTokens: 10 },
        status: 'completed' as const,
      };
    }),
  };
  return { adapter, requests };
}

function searchLane(markdown = DAY_OF_AI): FirecrawlLane {
  return {
    scrape: vi.fn(),
    search: vi.fn(async () => ({
      ok: true as const,
      results: [{ url: 'https://dayofai.org/', markdown, title: 'Day of AI' }],
    })),
  } as unknown as FirecrawlLane;
}

const run = (adapter: ResponsesAdapter, firecrawl = searchLane()) =>
  runScrapeTask({
    taskId: 'tsk_g2g_s01',
    userId: 'usr_test',
    intent: '搜一下 HOLA DAY AI 是什么',
    responsesAdapter: adapter,
    firecrawl,
    logger,
  });

const SELF =
  '根据抓取的内容，我需要澄清一下：\n\n**"HOLA DAY"** 是我自己的名字——我是一个浏览器任务执行助手。\n\n你可能想了解的是 **Day of AI**：它是 MIT RAISE 发起的免费 AI 教育倡议，首次举办于 2022 年 5 月 13 日。';
const CLEAN =
  '搜索结果里没有名为 HOLA DAY AI 的内容，最接近的是 Day of AI：MIT RAISE 发起的免费 AI 教育倡议，首次举办于 2022 年 5 月 13 日。';

describe('G2g s01: a search answer about a name like the assistant’s own comes from what was read', () => {
  it('the write-up is told that its own name and role are not material', async () => {
    const { adapter, requests } = adapterSaying([CLEAN]);
    await run(adapter);
    expect(requests[0]!.instructions).toContain(
      '你的名字和上面对你自己的介绍只说明你是谁，不是资料',
    );
  });

  it('an answer presenting the assistant itself is sent back once, and the corrected one delivered', async () => {
    const { adapter, requests } = adapterSaying([SELF, CLEAN]);
    const outcome = await run(adapter);
    expect(requests).toHaveLength(2);
    const sentBack = JSON.stringify(requests[1]!.input);
    expect(sentBack).toContain('是你对自己的介绍，不是已读资料');
    expect(outcome.status).toBe('completed');
    expect(outcome.summary).toContain('最接近的是 Day of AI');
    expect(outcome.summary).not.toContain('我自己的名字');
  });

  it('still there after the correction: those sentences are not delivered, the rest is', async () => {
    const { adapter } = adapterSaying([SELF, SELF]);
    const outcome = await run(adapter);
    expect(outcome.status).toBe('completed');
    expect(outcome.summary).not.toMatch(/我自己的名字|浏览器任务执行助手/);
    expect(outcome.summary).toContain('Day of AI');
  });

  it('a price sentence with 「也是我」 in it is kept whole (G2g review)', async () => {
    const answer = `${CLEAN}这也是我看到的最低价 ¥99。`;
    const { adapter, requests } = adapterSaying([answer]);
    const outcome = await run(adapter);
    expect(requests).toHaveLength(1);
    expect(outcome.summary).toContain('这也是我看到的最低价 ¥99。');
  });

  it('an answer that is only a self-description goes to the browser (no page said it)', async () => {
    const only = 'HOLA DAY AI 是 HOLA DAY 推出的智能助手（也就是我）。';
    const { adapter } = adapterSaying([only, only]);
    const outcome = await run(adapter);
    expect(outcome.status).toBe('failed');
    expect(outcome.failureKind).toBe('empty');
  });

  it('a page that says it, or a quote, is no self-description', () => {
    const page = 'HOLA DAY 官网：HOLA DAY 是一款 AI 任务执行助手。我们的口号：“我就是你的浏览器”。';
    expect(
      selfIdentitySentences('HOLA DAY 是一款 AI 任务执行助手（官网 holaday.ai）。', [page]),
    ).toEqual([]);
    expect(selfIdentitySentences('它的口号是“我就是你的浏览器”。', [])).toEqual([]);
    expect(selfIdentitySentences('电影《我的名字》于 2020 年上映。', [])).toEqual([]);
    expect(selfIdentitySentences('我们团队发布了新版。', [])).toEqual([]);
    // G2g review: 「也是我」 inside a sentence about something else is no self-description.
    expect(selfIdentitySentences('这也是我看到的最低价 ¥99。', [])).toEqual([]);
    expect(selfIdentitySentences('这就是我找到的第一条结果：Day of AI。', [])).toEqual([]);
    expect(selfIdentitySentences('我就是在官网上读到这个价格的。', [])).toEqual([]);
    expect(
      selfIdentitySentences('HOLA DAY AI 是 HOLA DAY 推出的智能助手（也就是我）。', []),
    ).toHaveLength(1);
    expect(selfIdentitySentences('你问的 HOLA DAY，正是我。', [])).toHaveLength(1);
    expect(
      selfIdentitySentences('**"HOLA DAY"** 是我自己的名字——我是一个浏览器任务执行助手。', []),
    ).toHaveLength(1);
  });
});

describe('GOAL2 H4: a question about HOLA DAY itself reads holaday.ai too', () => {
  const OWN =
    '# HOLA DAY\n\nHOLA DAY 是一个帮你上网办事的 AI 助手：说出想做的事，它在云浏览器里替你完成。';
  it('the search did not bring it: holaday.ai is read and is material', async () => {
    const lane = searchLane();
    (lane.scrape as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      url: 'https://holaday.ai/',
      markdown: OWN,
      title: 'HOLA DAY',
    });
    const { adapter, requests } = adapterSaying([
      'HOLA DAY 是一个帮你上网办事的 AI 助手（来源：holaday.ai）。',
    ]);
    const outcome = await run(adapter, lane);
    expect(lane.scrape).toHaveBeenCalledWith('https://holaday.ai/');
    expect(JSON.stringify(requests[0]!.input)).toContain('帮你上网办事的 AI 助手');
    expect(outcome.status).toBe('completed');
  });
  it('a search that brought it, or another subject, reads nothing more', async () => {
    const lane = searchLane();
    (lane.search as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      results: [{ url: 'https://holaday.ai/', markdown: OWN, title: 'HOLA DAY' }],
    });
    const { adapter } = adapterSaying(['HOLA DAY 是一个帮你上网办事的 AI 助手。']);
    await run(adapter, lane);
    expect(lane.scrape).not.toHaveBeenCalled();
  });

  it('复审 #2-10: a complaint or comparison about HOLA DAY reads no extra page', async () => {
    const lane = searchLane();
    const { adapter } = adapterSaying(['搜索结果里没有 HOLA DAY 的差评。']);
    await runScrapeTask({
      taskId: 'tsk_g2g_s01b',
      userId: 'usr_test',
      intent: '搜一下 HOLA DAY 的差评',
      responsesAdapter: adapter,
      firecrawl: lane,
      logger,
    });
    expect(lane.scrape).not.toHaveBeenCalled();
  });

  it('复审 #3-7/8: read second, after the first result; 「HolaDayAI 是干嘛的」 counts', async () => {
    const lane = searchLane();
    (lane.search as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      results: Array.from({ length: 5 }, (_, i) => ({
        url: `https://dayofai.org/${i}`,
        markdown: `# Day of AI ${i}\n\n${'Day of AI is an initiative. '.repeat(500)}`,
        title: `Day of AI ${i}`,
      })),
    });
    (lane.scrape as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      url: 'https://holaday.ai/',
      markdown: OWN,
      title: 'HOLA DAY',
    });
    const { adapter, requests } = adapterSaying(['HOLA DAY 是一个帮你上网办事的 AI 助手。']);
    await runScrapeTask({
      taskId: 'tsk_g2g_s01c',
      userId: 'usr_test',
      intent: 'HolaDayAI 是干嘛的',
      responsesAdapter: adapter,
      firecrawl: lane,
      logger,
    });
    expect(lane.scrape).toHaveBeenCalledWith('https://holaday.ai/');
    expect(JSON.stringify(requests[0]!.input)).toContain('帮你上网办事的 AI 助手');
  });
});
