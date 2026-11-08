import type { UiStep } from '@/types/task';
import { describe, expect, it } from 'vitest';
import {
  answerLinks,
  answerSourceCount,
  captchaRequestLine,
  elapsedLabel,
  failureOwnWords,
  failureTurn,
  isEnglishTask,
  liveStatusText,
  normalizeNextSteps,
  offerKind,
  partialLead,
  processLinkLabel,
  shortLinkLabel,
  splitUnverifiedNote,
  stepTimeline,
  stripInternalRefs,
  withoutRepeatedOffers,
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
    expect(liveStatusText({ steps })).toBe('正在点页面上的一个选项…');
    // 复审 #1-3: replaced with plain words, so the sentence still reads; addresses are kept.
    expect(stripInternalRefs('在 tab_2 上点击 e123 没有反应')).toBe('在页面上点击那个按钮没有反应');
    expect(stripInternalRefs('正在读取 tab_3 上的 [ref=e123] 按钮')).toBe('正在读取页面上的按钮');
    expect(stripInternalRefs('用千问总结页面')).toBe('用 AI 总结页面');
    expect(stripInternalRefs('frame_2 里读到价格')).toBe('内嵌框里读到价格');
    expect(stripInternalRefs('打开 https://www.amazon.com/dp/B0X/ref=sr_1_3?keywords=a')).toBe(
      '打开 https://www.amazon.com/dp/B0X/ref=sr_1_3?keywords=a',
    );
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
    // FIX-59 P1-8: an English task's footer is English.
    expect(processLinkLabel(2, true)).toBe('2 sources · Show steps');
    expect(processLinkLabel(1, true)).toBe('1 source · Show steps');
    expect(processLinkLabel(0, true)).toBe('Show steps');
  });

  it('a partial answer says so in words', () => {
    // 复审 #1: the answer's own first line says what is missing — no second preamble.
    expect(partialLead('部分完成：第 3 个没有价格')).toEqual({ lead: '', body: '第 3 个没有价格' });
    expect(partialLead('部分完成：').lead).toBe('这次只拿到了一部分，缺的我写在下面了。');
    expect(partialLead('上证收在 3686.17').lead).toBeNull();
  });
});

const intent = '打开 https://item.jd.com/1.html 读商品标题和价格';

describe('FIX-57 #5 / 复审 #1 · a failed run as an assistant message', () => {
  const JD =
    '任务执行失败：无法读取该京东商品的标题和价格。访问 https://item.jd.com/1.html 后被京东风控拦截，页面跳转到异常提示页（sourceURL: https://pc-frequent-pro.pf.jd.com/?reason=403），需要人工验证或登录后才可能正常展示。建议：简化任务描述后重试。';

  it('says straight away what happened and what it did not get, then offers ways on', () => {
    const turn = failureTurn({
      status: 'failed',
      errorText: JD,
      intent,
      finalUrl: 'https://pc-frequent-pro.pf.jd.com/?from=pc_item&reason=403',
      executionMode: 'browser',
      canRetry: true,
    });
    expect(turn.lead).toBe(
      '京东把这个页面拦下了，要登录或验证后才显示，所以没拿到京东商品的标题和价格。',
    );
    expect(turn.why).toBe('我不能替你登录，也不会绕过它。');
    expect(turn.options.map((o) => o.label)).toEqual([
      '你在浏览器里登录京东，我接着帮你看',
      '我去公开的搜索页或比价网站查同类信息',
    ]);
    expect(turn.options[0]?.prompt).toContain('等我登录好再继续');
    for (const text of [turn.lead, turn.why, ...turn.options.map((o) => o.label)])
      expect(text).not.toMatch(/https?:|这次没拿到你要的结果：|结构性|自动审核|证据边界/);
  });

  it('a run that already tried other sources says so and does not offer them again', () => {
    const turn = failureTurn({
      status: 'failed',
      errorText:
        '任务执行失败：无法获取该商品信息。被京东风控拦截。尝试通过联网搜索搜索「京东 100142621606」等多种关键词，均无返回结果，未能找到替代来源。',
      intent,
      canRetry: true,
    });
    expect(turn.lead).toBe(
      '京东把这个页面拦下了，要登录或验证后才显示，我换了公开来源也没找到，所以没拿到商品信息。',
    );
    expect(turn.options.map((o) => o.label)).toEqual(['你在浏览器里登录京东，我接着帮你看']);
  });

  it('a captcha: only the person does it', () => {
    const turn = failureTurn({
      status: 'failed',
      errorText: '验证码等待已结束，任务未完成。',
      intent: '打开知乎问题读标题',
      canRetry: true,
    });
    expect(turn.lead).toMatch(/要求先做人机验证，这一步只能你本人来，所以/);
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

  it.each([
    '任务执行失败：浏览器能力正在迁移到千问，暂时不可用。',
    '这项能力正在迁移到千问，暂时不可用。',
    '所选模型的服务尚未配置，请切换到千问后重试。',
    '模型服务暂时不可用，有限重试后仍失败，请稍后重试。',
  ])(
    '复审 #1-3: our own service failing gets one fixed sentence, never its words: %s',
    (errorText) => {
      const turn = failureTurn({ status: 'failed', errorText, intent: '查价格', canRetry: true });
      expect(turn.lead).toBe('我这边的服务刚刚出了点问题，这次没做完，你可以稍后再让我试一次。');
      expect(turn.lead).not.toMatch(/千问|模型|迁移/);
      expect(turn.options).toEqual([{ kind: 'retry', label: '再试一次' }]);
    },
  );

  it("复审 #1-3: a ref in the agent's own words reads as plain words", () => {
    const turn = failureTurn({
      status: 'failed',
      errorText: '任务执行失败：在 tab_2 上点击 e123 没有反应，页面没变化。',
      intent: '查价格',
      canRetry: true,
    });
    expect(turn.lead).toBe('在页面上点击那个按钮没有反应，页面没变化，这次没做完。');
  });

  it('a stopped run keeps what it got and offers to start over', () => {
    const turn = failureTurn({ status: 'cancelled', errorText: '', intent: 'x', canRetry: true });
    expect(turn.lead).toBe('任务已取消，没有做完。');
    expect(turn.options).toEqual([{ kind: 'retry', label: '从头再做一次' }]);
  });

  it("the agent's own words lose prefixes, links and advice; long or technical ones are dropped", () => {
    expect(failureOwnWords(JD)).toBe('无法读取该京东商品的标题和价格');
    expect(failureOwnWords('Error: TIMEOUT_EXCEEDED at frame')).toBeNull();
  });
});

describe('复审 #1-1a · the same offer is shown once', () => {
  it('wall-jd: 「你登录京东后我接着抓…」 goes, the fixed login option stays', () => {
    const options = failureTurn({
      status: 'failed',
      errorText: '任务执行失败：京东要求登录后才能查看价格。',
      intent,
      canRetry: true,
    }).options;
    const kept = withoutRepeatedOffers(
      [
        { label: '你登录京东后我接着抓标题和价格？', prompt: 'a' },
        { label: '你手动打开京东页面后，我帮你读取标题和价格？', prompt: 'b' },
        { label: '换个公开渠道帮你查这款商品？', prompt: 'c' },
        { label: '把这款和天猫同款的价格做个对比？', prompt: 'd' },
      ],
      options,
    );
    expect(kept.map((k) => k.label)).toEqual(['把这款和天猫同款的价格做个对比？']);
    expect(offerKind('你在浏览器里登录京东，我接着帮你看')).toBe('handover');
  });
});

describe('复审 #1-1c · long bare links read as the site name', () => {
  it('shortens only a bare long address', () => {
    const url = 'https://item.m.jd.com/product/100142621606.html?ad_od=3';
    expect(shortLinkLabel(url, url)).toBe('京东手机版');
    expect(shortLinkLabel('京东手机版', url)).toBe('京东手机版');
    expect(shortLinkLabel('https://a.cn/x', 'https://a.cn/x')).toBe('https://a.cn/x');
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

describe('复审 #2', () => {
  it('3: the sidebar never shows half an emoji, and cuts at a word or mark when it can', async () => {
    const { summariseIntent } = await import('@/utils/summarise-intent');
    const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
    for (const s of [
      '查a😀😀😀😀😀😀😀😀😀😀😀😀😀',
      '用浏览器查一下😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀',
      '请使用云端浏览器，【Deploy-16 核心验收 01】使用真实浏览器打开 https://www.sse.com.cn 看上证指数',
    ]) {
      const t = summariseIntent(s);
      expect(lone.test(t)).toBe(false);
      expect(Array.from(t).length).toBeLessThanOrEqual(20);
    }
    expect(
      summariseIntent('请使用云端浏览器，amazon.com 搜 usb c cable 前3个商品名'),
    ).not.toContain('浏览器');
  });

  it('4: a partial whose first sentence does not say what is missing keeps the fixed lead', () => {
    expect(
      partialLead(
        '部分完成：京东商品页要求登录，价格没读到；下面是从其他来源找到的参考价。\n\n- 参考价 ¥199',
      ).lead,
    ).toBe('');
    expect(partialLead('**部分完成**：缺第 3、4 款的评分。\n\n前两款……').lead).toBe('');
    expect(partialLead('部分完成：按任务配置使用 Brave 搜索接口读取前 5 条结果。').lead).toBe(
      '这次只拿到了一部分，缺的我写在下面了。',
    );
  });

  it('4: no 「这个网站这个页面」', () => {
    const turn = failureTurn({
      status: 'failed',
      errorText: '任务执行失败：京东要求登录后才能查看价格，我没有替你登录。建议：登录后重试',
      intent: '查京东上 AirPods 价格',
      canRetry: true,
    });
    expect(turn.lead).toBe('这个页面要登录才能看，所以这次没拿到你要的内容。');
    expect(turn.lead).not.toContain('这个网站这个页面');
  });

  it.each([
    ['任务执行失败：通义千问联网搜索接口返回空', '我这边的服务刚刚出了点问题'],
    ['任务执行失败：百炼通道超时，dashscope 503', '我这边的服务刚刚出了点问题'],
    [
      '任务执行失败：read_page 在 frame_1 里找不到 ref=e45 元素，点击 s2e17 也不行',
      '读取页面在内嵌框里找不到元素，点击那个元素也不行，这次没做完。',
    ],
  ])('3: %s', (errorText, lead) => {
    const turn = failureTurn({ status: 'failed', errorText, intent: '查价格', canRetry: true });
    expect(turn.lead).toContain(lead);
    expect(turn.lead).not.toMatch(/千问|通义|百炼|dashscope|read_page|frame_|ref=|s2e17|e45/i);
  });
});

describe('复审 #3', () => {
  it.each([
    ['Friends s1e2 的剧情', 'Friends s1e2 的剧情'],
    ['读取 snapshot 结果', '读取 snapshot 结果'],
    ['调用 read_page 失败', '调用读取页面失败'],
    ['snapshot(tab_2) 返回空', '读取页面返回空'],
    ['点击 s3e17 没反应', '点击那个元素没反应'],
    ['点击 e123', '点击那个按钮'],
  ])('ids and tool names are replaced only where they are used as such: %s', (text, out) => {
    expect(stripInternalRefs(text)).toBe(out);
  });

  it.each([
    ['用 read_page 读', '用读取页面读'],
    ['调用 read_page 读取正文', '调用读取页面读取正文'],
    ['read_page 没读到', '读取页面没读到'],
    ['get_page_text 失败', '读取页面失败'],
    ['web_search 返回空', '搜索返回空'],
    ['request_human 交给用户', '操作交给用户'],
    ['switch_tab 到第二个标签', '操作到第二个标签'],
    ['click_ref 失败', '操作失败'],
    ['页面里写的 wait_for it', '页面里写的操作 it'],
    ['先 snapshot 再点击', '先 snapshot 再点击'],
    ['用户 snapshot_id=3', '用户 snapshot_id=3'],
  ])('复审 #4: a tool name with an underscore is always replaced: %s', (text, out) => {
    expect(stripInternalRefs(text)).toBe(out);
  });

  it('「没问题的两款如下」 does not say what is missing', () => {
    expect(partialLead('部分完成：没问题的两款如下。\n\n- A\n- B').lead).toBe(
      '这次只拿到了一部分，缺的我写在下面了。',
    );
    expect(partialLead('部分完成：第 3 款没找到价格。').lead).toBe('');
  });

  it('BOSS run: 知乎, not zhihu.com; no 「比价网站」 for a question page; no 「我不会代做验证」', () => {
    const turn = failureTurn({
      status: 'failed',
      errorText: '用户已放弃验证，任务未完成。',
      intent:
        '请使用云端浏览器，打开 https://www.zhihu.com/question/19550225 读问题标题和第一个回答',
      canRetry: true,
    });
    expect(turn.lead.startsWith('知乎要求先做人机验证')).toBe(true);
    expect(turn.why).toBe('');
    expect(turn.options.map((o) => o.label)).toEqual([
      '重新打开，遇到验证由你来完成',
      '我换个不需要登录的公开来源找找',
    ]);
  });

  it('BOSS run: the verifier note leaves the answer for 「查看过程」', () => {
    const { body, unverified } = splitUnverifiedNote(
      '1. A S$9.99\n\n未核实：以下内容未能在已读页面中逐字找到，请自行确认——价格「S$9.43」',
    );
    expect(body).toBe(
      '1. A S$9.99\n\n有些内容我没能在页面上逐字核对到，细节在「查看过程」里，用之前可以再看一眼。',
    );
    expect(unverified).toBe('价格「S$9.43」');
  });

  it('BOSS run: the sources an answer cites are listed for 「查看过程」', () => {
    expect(
      answerLinks(
        '收在 3689.91（[东方财富](https://quote.eastmoney.com/a)、[搜狐](https://q.stock.sohu.com/b)）',
      ),
    ).toEqual([
      { label: '东方财富', url: 'https://quote.eastmoney.com/a' },
      { label: '搜狐', url: 'https://q.stock.sohu.com/b' },
    ]);
  });

  it('知乎 verification said once', () => {
    expect(captchaRequestLine('知乎')).toBe(
      '知乎要求先做人机验证，请在浏览器画面里完成（只能你本人操作），完成后我会自动接着做，最多等 10 分钟。',
    );
  });
});

describe('FIX-60 P0-2: the task language is the request’s main language', () => {
  it('a mixed request follows its main language, as the answer does', () => {
    expect(isEnglishTask('Write a short story about a 程序员')).toBe(true);
    expect(isEnglishTask('在 BestBuy 搜 usb c cable 告诉我第一个结果')).toBe(false);
    expect(
      isEnglishTask('请使用云端浏览器，YouTube 搜索「Playwright tutorial」返回前5个视频标题'),
    ).toBe(false);
    expect(
      isEnglishTask('Summarize https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/404'),
    ).toBe(true);
  });
});
