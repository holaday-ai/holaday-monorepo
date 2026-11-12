import { describe, expect, it } from 'vitest';
import { checkFallbackPrices } from './wall-checks.js';
import {
  composeFallback,
  fallbackAnswer,
  fallbackIntent,
  fallbackQuery,
  retrievalLine,
  takeoverLine,
  wallEnd,
  wallFallbackAllowed,
  wallLine,
} from './wall-fallback.js';

const JD = '打开 https://item.jd.com/100142621606.html 读商品标题和页面显示的价格';
const ZHIHU = '请使用云端浏览器，打开 https://www.zhihu.com/question/22045646 读问题标题和回答数';
const JD_PARTIAL =
  '部分完成：这是从[京东手机版](https://item.m.jd.com/product/100142621606.html)查到的（你给的京东页面要登录），只拿到了一部分：\n\n- 商品标题：Apple/苹果/苹果【需签收激活】iPhone 16 Pro 128GB 原色...\n- 页面显示价格：¥7??9（未登录时价格被打码）';

describe('wallEnd (REBUILD-2 协调方决定: public sources after a wall)', () => {
  it('a read task paused at a verification page is a wall', () => {
    expect(
      wallEnd(
        {
          status: 'awaiting_user',
          question: '知乎要求先完成人机验证，请在浏览器中完成验证后继续。',
        },
        ZHIHU,
      ),
    ).toEqual({
      kind: 'blocked',
      site: '知乎',
      url: 'https://www.zhihu.com/question/22045646',
      from: 'awaiting',
    });
  });

  it('a read task paused at a login wall is a login wall', () => {
    expect(
      wallEnd(
        { status: 'awaiting_user', question: '页面遇到登录墙，需要你接管登录；当前任务尚未完成。' },
        '天猫 Apple Store 官方旗舰店里 iPhone 16 Pro Max 256GB 卖多少钱',
      ),
    ).toMatchObject({ kind: 'login', site: '天猫', url: null, from: 'awaiting' });
  });

  it('a failed run whose reason names a block is a wall', () => {
    expect(
      wallEnd(
        { status: 'failed', reason: '京东搜索页被风控拦截，未能读取结果。' },
        '在京东搜 iPhone 16 Pro Max 256GB，告诉我第一款的名称和价格',
      ),
    ).toMatchObject({ kind: 'blocked', site: '京东', from: 'failed' });
  });

  it('a partial answer with a masked price is a wall; one without is not', () => {
    expect(
      wallEnd({ status: 'completed', summary: JD_PARTIAL, partial: { found: 1, wanted: 2 } }, JD),
    ).toMatchObject({
      kind: 'login',
      site: '京东',
      from: 'partial',
    });
    expect(
      wallEnd(
        {
          status: 'completed',
          summary: '部分完成：第 3 款没有标价（See options）。',
          partial: { found: 2, wanted: 3 },
        },
        'amazon.com 搜 usb c cable 前3个商品名和价格',
      ),
    ).toBeNull();
  });

  it('completed, cancelled and plain questions are not walls', () => {
    expect(wallEnd({ status: 'completed', summary: '标题：…' }, JD)).toBeNull();
    expect(wallEnd({ status: 'cancelled' }, JD)).toBeNull();
    expect(
      wallEnd({ status: 'awaiting_user', question: '你想看哪个城市的天气？' }, '帮我看看天气'),
    ).toBeNull();
    expect(
      wallEnd({ status: 'failed', reason: '任务超时，请把任务拆小一些再试。' }, JD),
    ).toBeNull();
  });

  it('a payment page, a write or personal data is never routed around', () => {
    expect(
      wallEnd({ status: 'awaiting_user', question: '这是支付页面，需要你登录后自行处理。' }, JD),
    ).toBeNull();
    expect(
      wallEnd(
        { status: 'awaiting_user', question: '页面遇到登录墙，需要你接管登录。' },
        '打开京东帮我把 iPhone 16 Pro 加入购物车',
      ),
    ).toBeNull();
    expect(
      wallEnd(
        { status: 'awaiting_user', question: '页面遇到登录墙，需要你接管登录。' },
        '看看我的京东订单到哪了',
      ),
    ).toBeNull();
  });
});

describe('fallback request, query and answer', () => {
  const wall = {
    kind: 'login' as const,
    site: '京东',
    url: 'https://item.jd.com/100142621606.html',
    from: 'partial' as const,
  };

  it('the request has no address left (the scrape lane would fetch it) and names the wall', () => {
    const text = fallbackIntent(JD, wall);
    expect(text).not.toMatch(/https?:|jd\.com/);
    expect(text).toContain('读商品标题和页面显示的价格');
    expect(text).toContain('京东要登录才能看');
    expect(text).toContain('不要说成「京东价」');
    expect(text).toContain('我在 XX 查到的是 ¥X（日期、链接）');
    expect(text).toContain('日期不明');
    const zh = fallbackIntent(ZHIHU, { ...wall, site: '知乎', kind: 'blocked' });
    expect(zh.startsWith('打开 知乎 读问题标题和回答数')).toBe(true);
    expect(zh).toContain('知乎要做验证');
  });

  it('the query uses the name the browser read, else the address', () => {
    expect(fallbackQuery(JD, wall, JD_PARTIAL)).toMatch(
      /^Apple\/苹果\/苹果【需签收激活】iPhone 16 Pro 128GB 原色 /,
    );
    expect(
      fallbackQuery(ZHIHU, {
        ...wall,
        site: '知乎',
        url: 'https://www.zhihu.com/question/22045646',
      }),
    ).toMatch(/^https:\/\/www\.zhihu\.com\/question\/22045646 /);
  });

  it('a pause is replaced by the wall line; a partial answer keeps what it read', () => {
    const answer = '据什么值得买（2026-11-10），iPhone 16 Pro 128GB 到手价约 ¥6,499。';
    const paused = { ...wall, from: 'awaiting' as const };
    expect(fallbackAnswer({ wall: paused, intent: JD, answer })).toBe(
      `${wallLine(paused, false, JD)}\n\n${answer}\n\n${takeoverLine(paused, false, JD)}`,
    );
    expect(wallLine(paused, false, JD)).toBe(
      '京东要登录才能看价格，没能直接读到页面；以下是我在公开来源查到的（不是京东页面上的数据）：',
    );
    expect(takeoverLine(paused, false, JD)).toBe(
      '需要京东页面上的准确价格，可以登录后让我再读一次。',
    );
    const partial = fallbackAnswer({ wall, intent: JD, answer, browserSummary: JD_PARTIAL });
    expect(partial.startsWith(JD_PARTIAL)).toBe(true);
    expect(partial).toContain('另外从公开来源补查（不是京东页面上的数据）：');
    expect(partial).toContain(`${answer}\n\n需要京东页面上的准确价格`);
  });

  it('English tasks get English lines', () => {
    const g2 =
      "Open https://www.g2.com/products/slack/reviews and tell me Slack's overall star rating and number of reviews";
    const w = wallEnd(
      { status: 'awaiting_user', question: 'The page asks for a captcha verification.' },
      g2,
    );
    expect(w).toMatchObject({ kind: 'blocked', site: 'G2' });
    const en = fallbackAnswer({ wall: w!, intent: g2, answer: 'G2 shows 4.5 stars.' });
    expect(en).toMatch(/^G2 blocked the visit with a verification check/);
    expect(en).toMatch(/complete the verification and ask me to read it again\.$/);
    expect(fallbackIntent(g2, w!)).not.toMatch(/g2\.com\/products/);
  });
});

describe('复审 #2-1: personal data and unknown sites are not routed around', () => {
  const login = { status: 'awaiting_user', question: '页面遇到登录墙，需要你接管登录。' };
  it.each([
    '查一下我在京东买的东西到哪了',
    '查一下我京东的物流',
    '帮我查下京东白条额度',
    '查一下我京东上周买的 iPhone 发票',
    'check my amazon wishlist',
    '查一下公司内网 wiki 的报销流程',
  ])('%s', (intent) => {
    expect(wallEnd(login, intent)).toBeNull();
    expect(wallFallbackAllowed(intent)).toBe(false);
  });

  it.each([
    '帮我查下京东 iPhone 16 Pro Max 256GB 多少钱',
    '告诉我知乎这个问题的回答数',
    '打开 https://www.xiaohongshu.com/explore/1 读笔记标题和作者',
  ])('addressing the assistant is not first person: %s', (intent) => {
    expect(wallFallbackAllowed(intent)).toBe(true);
  });

  it('a login wall on an unnamed site without an address is the user’s', () => {
    expect(wallEnd(login, '帮我查一下报销流程的说明')).toBeNull();
    expect(
      wallEnd(
        { status: 'awaiting_user', question: '网站要求人机验证。' },
        '帮我查一下报销流程的说明',
      ),
    ).toMatchObject({ kind: 'blocked', site: '原网站' });
  });
});

describe('复审 #2-3: prices in the public answer are checked', () => {
  const rows = [
    {
      url: 'https://post.smzdm.com/p/a95xwge0',
      title: 'iPhone 16 Pro 128GB 京东自营好价',
      snippet: '2026-11-10 京东自营 iPhone 16 Pro 128GB 到手价 ¥6,499，叠加券后。',
    },
    {
      url: 'https://item.jd.com/100142621606.html',
      title: 'Apple iPhone 16 Pro 128GB - 京东',
      snippet: '京东价 ¥7999 白条分期',
    },
  ];
  it('a price no row has is removed; the count is said', () => {
    const out = checkFallbackPrices({
      answer:
        '- 什么值得买：¥6,499（2026-11-10，https://post.smzdm.com/p/a95xwge0）\n- 某店：¥5,888',
      rows,
      site: '京东',
    });
    expect(out.removed).toBe(1);
    expect(out.answer).not.toContain('5,888');
    expect(out.answer).toContain('另有 1 处价格在搜索结果原文里找不到，已删去');
  });

  it('another site’s price said to be the walled site’s is rewritten as that site’s', () => {
    const out = checkFallbackPrices({ answer: '京东售价 ¥6499。', rows, site: '京东' });
    expect(out.rewritten).toBe(1);
    expect(out.answer).toMatch(/^什么值得买查到 ¥6499。/);
    expect(out.answer).toContain('日期不明');
    expect(out.answer).toContain('https://post.smzdm.com/p/a95xwge0');
  });

  it('a line already naming the other site keeps its words', () => {
    const out = checkFallbackPrices({
      answer: '据什么值得买爆料，京东页面价 ¥6,499（11月10日，https://post.smzdm.com/p/a95xwge0）',
      rows,
      site: '京东',
    });
    expect(out.rewritten).toBe(0);
    expect(out.answer).toBe(
      '据什么值得买爆料，京东页面价 ¥6,499（11月10日，https://post.smzdm.com/p/a95xwge0）',
    );
  });

  it('the walled site’s own row is a search snippet', () => {
    const out = checkFallbackPrices({ answer: '京东价 ¥7999', rows, site: '京东' });
    expect(out.answer).toBe(
      '京东价 ¥7999（搜索结果里的页面摘要）（日期不明，https://item.jd.com/100142621606.html）',
    );
  });

  it('799 is not 7999; lines without a price are untouched', () => {
    const out = checkFallbackPrices({
      answer: '标题：iPhone 16 Pro\n价格 ¥799',
      rows,
      site: '京东',
    });
    expect(out.answer.split('\n')[0]).toBe('标题：iPhone 16 Pro');
    expect(out.removed).toBe(1);
  });
});

describe('复审 #2-2 + 协调方判定: freshness and the closing line', () => {
  const wall = { kind: 'login' as const, site: '京东', url: null, from: 'awaiting' as const };
  const rows = [
    {
      url: 'https://post.smzdm.com/p/1',
      title: 'iPhone 16 价格',
      snippet: '2026-11-01 京东自营 iPhone 16 ¥5,299',
    },
  ];
  const resultsText =
    '# iPhone 16 价格\n\n2026-11-01 京东自营 iPhone 16 ¥5,299\n\n检索于：百炼联网搜索 · 2026-11-12 13:15（这是检索时间，不是数据本身的时间）';
  const now = new Date('2026-11-12T05:15:00Z');

  it('a live price without today’s date is delivered only as reference', () => {
    const out = composeFallback({
      wall,
      intent: '京东上 iPhone 16 现在多少钱',
      answer: '我在什么值得买查到的是 ¥5,299（2026-11-01，https://post.smzdm.com/p/1）',
      rows,
      resultsText,
      sourceLine: '来源：百炼联网搜索 · 2026-11-12 13:15',
      now,
    });
    expect(out.deliver).toBe(true);
    expect(out.checks.freshness).toBe('stale');
    expect(out.summary).toContain(
      '公开来源里最新的日期是 11 月 1 日，以下仅供参考，不是实时数据。',
    );
    expect(
      out.summary.endsWith('检索于：百炼联网搜索 · 2026-11-12 13:15（检索时间，不是数据时间）'),
    ).toBe(true);
    expect(out.summary).not.toContain('来源：百炼');
  });

  it('an answer stating a time the results do not have is not delivered', () => {
    const out = composeFallback({
      wall,
      intent: '京东上 iPhone 16 现在多少钱',
      answer: '截至 2026-11-12 13:15，我在什么值得买查到的是 ¥5,299（https://post.smzdm.com/p/1）',
      rows: [{ ...rows[0]!, snippet: '2026-11-12 京东自营 iPhone 16 ¥5,299' }],
      resultsText: resultsText.replace('2026-11-01', '2026-11-12'),
      sourceLine: null,
      now,
    });
    expect(out).toMatchObject({ deliver: false, checks: { freshness: 'unsupported_time' } });
  });

  it('a question that is not about time skips the freshness check', () => {
    const out = composeFallback({
      wall: { ...wall, site: '知乎', kind: 'blocked' },
      intent: '打开 https://www.zhihu.com/question/22045646 读问题标题和回答数',
      answer:
        '据搜索摘要，问题标题是「如何学习编程」，约 1,200 个回答（日期不明，https://www.zhihu.com/question/22045646）',
      rows: [],
      resultsText: '',
      sourceLine: null,
      now,
    });
    expect(out.deliver).toBe(true);
    expect(out.checks.freshness).toBeNull();
    expect(retrievalLine('Source: Bailian · 2026-11-12 13:15 (Beijing time)', true)).toBe(
      "Retrieved via Bailian · 2026-11-12 13:15 (Beijing time) (retrieval time, not the data's time)",
    );
  });
});
