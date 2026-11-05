import type { UiStep } from '@/types/task';
import { describe, expect, it } from 'vitest';
import {
  answerSourceCount,
  elapsedLabel,
  failureOwnWords,
  failureTurn,
  liveStatusText,
  normalizeNextSteps,
  partialLead,
  processLinkLabel,
  stepTimeline,
  stripInternalRefs,
} from './assistant-turn';

const step = (tickIndex: number, actionKind: string, actionSummary?: string): UiStep => ({
  tickIndex,
  status: 'done',
  actionKind,
  ...(actionSummary ? { actionSummary } : {}),
  startedAt: tickIndex,
});

describe('FIX-57 #3 · the live status line', () => {
  it('says what is happening now, on which site, in plain words', () => {
    const steps = [step(1, 'navigate', '打开 https://quote.eastmoney.com/zs000001.html')];
    expect(liveStatusText({ steps })).toBe('正在打开东方财富…');
    expect(liveStatusText({ steps: [...steps, step(2, 'snapshot')] })).toBe('在读东方财富的内容…');
    expect(liveStatusText({ steps: [...steps, step(2, 'click', '点击 行情中心')] })).toBe(
      '正在点「行情中心」…',
    );
    expect(liveStatusText({ steps: [...steps, step(2, 'web_search')] })).toBe('正在搜索资料…');
    expect(
      liveStatusText({
        steps: [...steps, step(2, 'browser_rescue', '页面要登录或被拦下了，换个公开来源试试…')],
      }),
    ).toBe('页面要登录或被拦下了，换个公开来源试试…');
  });

  it('never shows a ref id, a tab/frame id or a provider name', () => {
    const steps = [step(1, 'click', '点击 e123')];
    expect(liveStatusText({ steps })).toBe('在页面上找需要的内容…');
    expect(
      stripInternalRefs('读取 tab_3 的 frame_ab12（ref=e5）via Firecrawl 和 qwen3.8-max'),
    ).toBe('读取 的 via 和');
    const all = [
      step(1, 'navigate', '打开 https://www.jd.com/'),
      step(2, 'read_url'),
      step(3, 'click_ref', '点击 ref=e9'),
      step(4, 'type_in_ref'),
      step(5, 'wait_for'),
      step(6, 'switch_tab'),
    ];
    for (let i = 1; i <= all.length; i++) {
      expect(liveStatusText({ steps: all.slice(0, i) })).not.toMatch(
        /ref|tab_|frame_|firecrawl|brave|qwen|snapshot|read_url|click/i,
      );
    }
  });

  it('before any step: the phase', () => {
    expect(liveStatusText({ steps: [] })).toBe('正在理解你的需求…');
    expect(liveStatusText({ steps: [], subStatus: 'generating' })).toBe('正在写回答…');
  });

  it('the timeline folds repeats and keeps what the agent said', () => {
    const lines = stepTimeline([
      step(1, 'navigate', '打开 https://www.zhihu.com/question/1'),
      step(2, 'snapshot'),
      step(3, 'get_page_text'),
      step(4, 'text', '页面要登录，我换个来源'),
    ]);
    expect(lines.map((l) => l.text)).toEqual([
      '打开知乎',
      '读知乎的内容',
      '页面要登录，我换个来源',
    ]);
  });

  it('elapsed time', () => {
    expect(elapsedLabel(21)).toBe('21 秒');
    expect(elapsedLabel(125)).toBe('2 分 05 秒');
  });
});

describe('FIX-57 #2 · the answer footer', () => {
  it('counts distinct linked sites', () => {
    const text =
      '收在 3686.17 [东方财富](https://quote.eastmoney.com/a) [又一处](https://quote.eastmoney.com/b) [英为](https://cn.investing.com/x)';
    expect(answerSourceCount(text)).toBe(2);
    expect(processLinkLabel(2)).toBe('参考了 2 个来源 · 查看过程');
    expect(processLinkLabel(0)).toBe('查看过程');
  });

  it('a partial answer says so in words', () => {
    expect(partialLead('部分完成：第 3 个没有价格')).toEqual({
      lead: '这次只拿到了一部分，缺的我写在下面了。',
      body: '第 3 个没有价格',
    });
    expect(partialLead('上证收在 3686.17').lead).toBeNull();
  });
});

describe('FIX-57 #5 · a failed run as an assistant message', () => {
  const JD =
    '任务执行失败：无法读取该京东商品的标题和价格。访问 https://item.jd.com/1.html 后被京东风控拦截，页面跳转到异常提示页（sourceURL: https://pc-frequent-pro.pf.jd.com/?reason=403），需要人工验证或登录后才可能正常展示。建议：简化任务描述后重试。';

  it('always says what was not obtained, where it stuck, and offers ways on', () => {
    const turn = failureTurn({
      status: 'failed',
      errorText: JD,
      intent: '打开 https://item.jd.com/1.html 读商品标题和价格',
      finalUrl: 'https://pc-frequent-pro.pf.jd.com/?from=pc_item&reason=403',
      executionMode: 'browser',
      canRetry: true,
    });
    expect(turn.lead).toBe('这次没拿到你要的结果：无法读取该京东商品的标题和价格。');
    expect(turn.why).toContain('京东把页面拦下了');
    expect(turn.why).toContain('不会绕过');
    expect(turn.options.map((o) => o.label)).toEqual([
      '你在浏览器里登录京东，我接着帮你看',
      '我去公开的搜索页或比价网站查同类信息',
    ]);
    expect(turn.options[0]?.prompt).toContain('等我登录好再继续');
    // No engineering words, no URLs in what the person reads.
    for (const text of [turn.lead, turn.why, ...turn.options.map((o) => o.label)])
      expect(text).not.toMatch(/https?:|结构性|自动审核|证据边界|任务未完成，结果不能/);
  });

  it('a run that already tried other sources says so and does not offer them again', () => {
    const turn = failureTurn({
      status: 'failed',
      errorText:
        '任务执行失败：无法获取该商品信息。被京东风控拦截。尝试通过联网搜索搜索「京东 100142621606」等多种关键词，均无返回结果，未能找到替代来源。',
      intent: '打开 https://item.jd.com/1.html 读商品标题和价格',
      canRetry: true,
    });
    expect(turn.why).toContain('我已经换公开来源（搜索、比价站）找过，也没找到。');
    expect(turn.options.map((o) => o.label)).toEqual(['你在浏览器里登录京东，我接着帮你看']);
  });

  it('a captcha: only the person does it', () => {
    const turn = failureTurn({
      status: 'failed',
      errorText: '验证码等待已结束，任务未完成。',
      intent: '打开知乎问题读标题',
      canRetry: true,
    });
    expect(turn.lead).toMatch(/^这次没拿到你要的结果/);
    expect(turn.options.length).toBeGreaterThan(0);
  });

  it('a timeout offers a retry and another source', () => {
    const turn = failureTurn({
      status: 'failed',
      errorText: 'navigation timeout of 30000ms exceeded',
      intent: '打开 example.com 读标题',
      canRetry: true,
    });
    expect(turn.options.map((o) => o.kind)).toEqual(['retry', 'prompt']);
  });

  it('our model service failing is said as ours, with a retry', () => {
    const turn = failureTurn({
      status: 'failed',
      errorText: '模型服务暂时不可用，有限重试后仍失败，请稍后重试。',
      intent: '读商品价格',
      canRetry: true,
    });
    expect(turn.lead).toBe('这次没拿到你要的结果。');
    expect(turn.why).toContain('我这边的模型服务');
    expect(turn.options).toEqual([{ kind: 'retry', label: '再试一次' }]);
  });

  it('a stopped run keeps what it got and offers to start over', () => {
    const turn = failureTurn({ status: 'cancelled', errorText: '', intent: 'x', canRetry: true });
    expect(turn.lead).toBe('这次任务已取消，没有做完。');
    expect(turn.options).toEqual([{ kind: 'retry', label: '从头再做一次' }]);
  });

  it("the agent's own words lose prefixes, links and advice; long or technical ones are dropped", () => {
    expect(failureOwnWords(JD)).toBe('无法读取该京东商品的标题和价格');
    expect(failureOwnWords('Error: TIMEOUT_EXCEEDED at frame')).toBeNull();
  });
});

describe('FIX-57 #4 · next steps', () => {
  it('accepts older string lists and new {label,prompt}; cleans and caps at 3', () => {
    expect(
      normalizeNextSteps([
        '查看深证成指表现',
        { label: '开盘后我再拉一次实时点位对比？', prompt: '今天开盘后查上证实时点位并对比' },
        { label: '开盘后我再拉一次实时点位对比？', prompt: '重复' },
        { label: '读 tab_1？', prompt: '读 tab_1 的 ref=e3' },
        { label: '整理对比表？', prompt: '整理成对比表' },
        { label: '第五条', prompt: '第五条' },
      ]),
    ).toEqual([
      { label: '查看深证成指表现', prompt: '查看深证成指表现' },
      { label: '开盘后我再拉一次实时点位对比？', prompt: '今天开盘后查上证实时点位并对比' },
      { label: '整理对比表？', prompt: '整理成对比表' },
    ]);
  });
});
