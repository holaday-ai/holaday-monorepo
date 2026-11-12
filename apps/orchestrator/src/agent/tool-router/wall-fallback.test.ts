import { describe, expect, it } from 'vitest';
import {
  fallbackAnswer,
  fallbackIntent,
  fallbackQuery,
  wallEnd,
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
    expect(text).toContain('不要说成是京东上的');
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
    expect(fallbackAnswer({ wall: { ...wall, from: 'awaiting' }, intent: JD, answer })).toBe(
      `${wallLine({ ...wall, from: 'awaiting' }, false)}\n\n${answer}`,
    );
    const partial = fallbackAnswer({ wall, intent: JD, answer, browserSummary: JD_PARTIAL });
    expect(partial.startsWith(JD_PARTIAL)).toBe(true);
    expect(partial).toContain('另外从公开来源补查（不是京东页面上的数据）：');
    expect(partial.endsWith(answer)).toBe(true);
  });

  it('English tasks get English lines', () => {
    const g2 =
      "Open https://www.g2.com/products/slack/reviews and tell me Slack's overall star rating and number of reviews";
    const w = wallEnd(
      { status: 'awaiting_user', question: 'The page asks for a captcha verification.' },
      g2,
    );
    expect(w).toMatchObject({ kind: 'blocked', site: 'G2' });
    expect(fallbackAnswer({ wall: w!, intent: g2, answer: 'G2 shows 4.5 stars.' })).toMatch(
      /^G2 blocked the visit with a verification check/,
    );
    expect(fallbackIntent(g2, w!)).not.toMatch(/g2\.com\/products/);
  });
});
