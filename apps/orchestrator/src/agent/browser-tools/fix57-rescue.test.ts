import { describe, expect, it, vi } from 'vitest';
import type { MessagesAdapter } from '../../llm/messages-adapter.js';
import {
  RESCUE_GIVE_UP_RE,
  RESCUE_PARTIAL_RE,
  RESCUE_STATUS,
  WRITE_INTENT_RE,
  isEnglishIntent,
  isReadOnlyIntent,
  plainAnswer,
  rescuedAnswer,
  runUnifiedBrowserLoop,
  withoutSourceLines,
} from './unified-browser-loop.js';

/**
 * FIX-57 #5: a read task stopped by a login wall (or about to give up on a blocked page)
 * first tries other public routes — once, at most 2 more sites — and is handed over or
 * fails honestly after that. Never for forms, writes, logins or the person's own data.
 */
function scriptedLoop(calls: Array<{ name: string; input: Record<string, unknown> }>) {
  let turn = 0;
  const seen: string[] = [];
  const adapter: MessagesAdapter = {
    metadata: { provider: 'anthropic', model: 'fixture' },
    async create(request) {
      seen.push(JSON.stringify(request.messages.at(-1)));
      const call = calls[Math.min(turn++, calls.length - 1)]!;
      return {
        id: String(turn),
        metadata: { provider: 'anthropic', model: 'fixture' },
        content: [{ type: 'tool_use', id: String(turn), ...call }],
        stopReason: 'tool_use',
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          cacheReadInputTokens: null,
          cacheCreationInputTokens: null,
          complete: true,
        },
      };
    },
  };
  return { adapter, seen };
}

const JD = '打开 https://item.jd.com/100142621606.html 读商品标题和页面显示的价格';
const WALL = { reason: 'login', message: '页面遇到登录墙，需要你接管登录；当前任务尚未完成。' };
const ROUTE = '换一条不需要登录的公开路线';

function run(
  intent: string,
  calls: Array<{ name: string; input: Record<string, unknown> }>,
  options: { rescue?: boolean; walled?: (url: string) => boolean; maxSteps?: number } = {},
) {
  const { adapter, seen } = scriptedLoop(calls);
  let url = 'about:blank';
  const opened: string[] = [];
  const onRescue = vi.fn();
  const walled = options.walled ?? ((u: string) => /passport\.jd\.com/.test(u));
  return runUnifiedBrowserLoop({
    intent,
    adapter,
    maxSteps: options.maxSteps ?? 12,
    rescue: options.rescue ?? true,
    onRescue,
    currentPageUrl: () => url,
    probeBlocker: async () => (walled(url) ? WALL : null),
    execute: (async (action: { tool: string; url?: string }) => {
      if (action.tool === 'navigate') {
        opened.push(action.url!);
        url = /item\.jd\.com/.test(action.url!)
          ? 'https://passport.jd.com/new/login.aspx?ReturnUrl=x'
          : action.url!;
        return { ok: true, text: '已打开', url };
      }
      if (/bing\.com/.test(url))
        return {
          ok: true,
          text: JSON.stringify({
            url,
            tree: [
              '- link "a" https://www.aaa-shop.com/p/1 [ref=e1]',
              '- link "b" https://www.bbb-shop.com/p/2 [ref=e2]',
              '- link "c" https://www.ccc-shop.com/p/3 [ref=e3]',
              '- link "d" https://www.ddd-shop.com/p/4 [ref=e4]',
            ].join('\n'),
          }),
        };
      if (/item\.m\.jd\.com/.test(url))
        return {
          ok: true,
          text: JSON.stringify({
            url,
            tree: '- heading "Apple iPhone 16 Pro" [level=1] [ref=e1]\n- text "¥7999"',
          }),
        };
      return { ok: true, text: JSON.stringify({ tree: '- heading "页面" [level=1] [ref=e1]' }) };
    }) as never,
  } as never).then((outcome) => ({ outcome, seen: seen.join('\n'), opened, onRescue }));
}

describe('FIX-57 #5 · a login wall on a read task: another public route first', () => {
  it('the wall is not handed over at once: the model is told to route around it', async () => {
    const { outcome, seen, opened, onRescue } = await run(JD, [
      { name: 'navigate', input: { url: 'https://item.jd.com/100142621606.html' } },
      { name: 'navigate', input: { url: 'https://www.smzdm.com/search?q=100142621606' } },
      { name: 'finish', input: { status: 'failed', summary: '比价站也没有这款商品的价格' } },
    ]);
    expect(seen).toContain(ROUTE);
    expect(seen).toContain('不要登录');
    // The named site is jd.com; the rescue lets a public site outside it open.
    expect(opened).toContain('https://www.smzdm.com/search?q=100142621606');
    expect(onRescue).toHaveBeenCalledTimes(1);
    expect(onRescue).toHaveBeenCalledWith(RESCUE_STATUS.wall);
    expect(outcome.status).toBe('failed');
  });

  it('a wall met again on another page after the rescue is handed to the user', async () => {
    const { outcome } = await run(
      JD,
      [
        { name: 'navigate', input: { url: 'https://item.jd.com/100142621606.html' } },
        { name: 'navigate', input: { url: 'https://search.jd.com/Search?keyword=100142621606' } },
        { name: 'finish', input: { status: 'completed', summary: '价格 ¥99' } },
      ],
      { walled: (u) => /passport\.jd\.com|search\.jd\.com/.test(u) },
    );
    expect(outcome).toMatchObject({ status: 'awaiting_user', reason: 'login' });
  });

  it('staying on the walled page (snapshot) is a reminder, not the handover', async () => {
    const { outcome, seen } = await run(JD, [
      { name: 'navigate', input: { url: 'https://item.jd.com/100142621606.html' } },
      { name: 'snapshot', input: {} },
      { name: 'finish', input: { status: 'failed', summary: '没有拿到价格，卡在登录页' } },
    ]);
    expect(seen).toContain('仍是被挡住的页面');
    expect(outcome.status).toBe('failed');
  });

  it('at most 2 sites outside the named one', async () => {
    const { seen, opened } = await run(JD, [
      { name: 'navigate', input: { url: 'https://item.jd.com/100142621606.html' } },
      { name: 'navigate', input: { url: 'https://cn.bing.com/search?q=100142621606' } },
      { name: 'navigate', input: { url: 'https://www.smzdm.com/' } },
      { name: 'navigate', input: { url: 'https://www.manmanbuy.com/' } },
      { name: 'navigate', input: { url: 'https://www.example-third.com/' } },
      { name: 'finish', input: { status: 'failed', summary: '公开来源都没有价格' } },
    ]);
    // The search page found the routes; it is not one of the two.
    expect(opened).toContain('https://cn.bing.com/search?q=100142621606');
    expect(opened).toContain('https://www.manmanbuy.com/');
    expect(opened).not.toContain('https://www.example-third.com/');
    expect(seen).toContain('不要再打开 example-third.com');
  });

  it('the model asking for a login handover is routed around first, once', async () => {
    const { outcome, seen } = await run(JD, [
      { name: 'navigate', input: { url: 'https://item.jd.com/100142621606.html' } },
      { name: 'request_human', input: { reason: 'login', message: '需要登录' } },
      { name: 'request_human', input: { reason: 'login', message: '还是需要登录' } },
    ]);
    expect(seen).toContain(ROUTE);
    expect(outcome).toMatchObject({ status: 'awaiting_user', reason: 'login' });
  });
});

describe('FIX-57 复审 #1 · the cap holds and a rescued answer is 部分完成', () => {
  it('2: Bing shows 4 other sites — the 3rd and 4th are refused (links on read pages count too)', async () => {
    const { opened, seen } = await run(
      JD,
      [
        { name: 'navigate', input: { url: 'https://item.jd.com/100142621606.html' } },
        { name: 'navigate', input: { url: 'https://cn.bing.com/search?q=100142621606' } },
        { name: 'snapshot', input: {} },
        { name: 'navigate', input: { url: 'https://www.aaa-shop.com/p/1' } },
        { name: 'navigate', input: { url: 'https://www.bbb-shop.com/p/2' } },
        { name: 'navigate', input: { url: 'https://www.ccc-shop.com/p/3' } },
        { name: 'navigate', input: { url: 'https://www.ddd-shop.com/p/4' } },
        { name: 'finish', input: { status: 'failed', summary: '都没有价格' } },
      ],
      { maxSteps: 20 },
    );
    expect(opened).toContain('https://www.aaa-shop.com/p/1');
    expect(opened).toContain('https://www.bbb-shop.com/p/2');
    expect(opened).not.toContain('https://www.ccc-shop.com/p/3');
    expect(opened).not.toContain('https://www.ddd-shop.com/p/4');
    expect(seen).toContain('换网站已经到上限');
  });

  it('2: the walled address is not opened again, even from a search result', async () => {
    const { opened, seen } = await run(
      JD,
      [
        { name: 'navigate', input: { url: 'https://item.jd.com/100142621606.html' } },
        {
          name: 'navigate',
          input: { url: 'https://cn.bing.com/search?q=item.jd.com+100142621606' },
        },
        { name: 'navigate', input: { url: 'https://item.jd.com/100142621606.html' } },
        { name: 'finish', input: { status: 'failed', summary: '没拿到价格，原页面被拦截' } },
      ],
      { maxSteps: 20 },
    );
    expect(opened.filter((u) => u === 'https://item.jd.com/100142621606.html')).toHaveLength(1);
    expect(seen).toContain('这是被挡住的原页面，不要再打开');
  });

  it('4: an answer found elsewhere is 部分完成, and the code says where it came from', async () => {
    const { outcome } = await run(
      JD,
      [
        { name: 'navigate', input: { url: 'https://item.jd.com/100142621606.html' } },
        { name: 'navigate', input: { url: 'https://item.m.jd.com/product/100142621606.html' } },
        { name: 'snapshot', input: {} },
        {
          name: 'finish',
          input: { status: 'completed', summary: 'Apple iPhone 16 Pro，价格 ¥7999。' },
        },
      ],
      { maxSteps: 20 },
    );
    expect(outcome.status).toBe('completed');
    const done = outcome as { summary: string; partial?: { missing?: string } };
    expect(done.summary).toMatch(
      /^部分完成：这是从\[京东手机版\]\(https:\/\/item\.m\.jd\.com\/product\/100142621606\.html\)查到的（你给的京东页面要登录），只拿到了一部分：/,
    );
    expect(done.partial?.missing).toContain('京东页面上的内容');
    // 复审 #2-1: the model's own source line is not said a second time.
    expect(done.summary).not.toContain('读到的信息如下');
    expect(done.summary).toContain('Apple iPhone 16 Pro，价格 ¥7999。');
  });
});

describe('FIX-57 #5 · giving up on a blocked page: one more route first', () => {
  it('a failed answer about a risk page gets one rescue turn, then fails as before', async () => {
    const { outcome, seen, onRescue } = await run(
      JD,
      [
        { name: 'navigate', input: { url: 'https://www.jd.com/' } },
        {
          name: 'finish',
          input: { status: 'failed', summary: '被京东风控拦截，页面显示暂时无法展示该商品的信息' },
        },
        {
          name: 'finish',
          input: { status: 'failed', summary: '换了公开来源仍被拦截，没有拿到标题和价格' },
        },
      ],
      { walled: () => false },
    );
    expect(seen).toContain('先别结束');
    expect(onRescue).toHaveBeenCalledWith(RESCUE_STATUS.stuck);
    expect(outcome).toMatchObject({ status: 'failed' });
    expect(outcome.status === 'failed' && outcome.reason).toContain('换了公开来源');
  });

  it('a failed answer that is not about a blocked page is not sent back', async () => {
    const { seen, outcome } = await run(
      JD,
      [
        { name: 'navigate', input: { url: 'https://www.jd.com/' } },
        { name: 'finish', input: { status: 'failed', summary: '用户要的型号并不存在' } },
      ],
      { walled: () => false },
    );
    expect(seen).not.toContain(ROUTE);
    expect(outcome.status).toBe('failed');
  });

  it('no rescue near the step limit', async () => {
    const { seen } = await run(
      JD,
      [
        { name: 'navigate', input: { url: 'https://item.jd.com/100142621606.html' } },
        { name: 'finish', input: { status: 'failed', summary: '登录页挡住了' } },
      ],
      { maxSteps: 4 },
    );
    expect(seen).not.toContain(ROUTE);
  });
});

describe('FIX-57 #5 · what a rescue got only partly is 部分完成', () => {
  it('masked, cut or login-only values', () => {
    for (const t of [
      '价格：¥7??9（未登录脱敏）',
      '标题被截断',
      '完整价格需登录后才可见',
      '价格被遮挡',
    ])
      expect(RESCUE_PARTIAL_RE.test(t)).toBe(true);
    expect(RESCUE_PARTIAL_RE.test('价格：¥7999，标题：iPhone 16 Pro')).toBe(false);
  });
});

describe('复审 #2-1 · source lines the code already wrote', () => {
  it.each([
    '从[京东手机版](https://item.m.jd.com/p/1.html)读到的信息如下：',
    '从京东手机版读到的信息如下：',
    '以下是从京东手机版获取的商品信息：',
  ])('drops %s', (line) => {
    expect(withoutSourceLines(`${line}\n\n- 价格：¥7??9`)).toBe('- 价格：¥7??9');
  });
  it.each([
    '从页面上看到的价格是 ¥99，标题被截断了。',
    '信息来自 2024 年 10 月的页面快照，可能不是最新价格。',
    '数据来源：国家统计局 2025 年公报。',
  ])('复审 #3-1: keeps a line that says when or from where else: %s', (t) => {
    expect(withoutSourceLines(t)).toBe(t);
  });
});

describe('复审 #3 · 代 BOSS 体验: the answer reads like talk', () => {
  it('京东: a lead-in that goes on with the answer loses only the lead-in', () => {
    expect(
      withoutSourceLines('从京东手机版页面读到的信息：商品标题显示为「Apple iPhone 16 Pro」。'),
    ).toBe('商品标题显示为「Apple iPhone 16 Pro」。');
  });

  it('亚马逊: no 「照页面原样」, long names cut (kept apart), no featured offer in words', () => {
    const raw = [
      '在亚马逊新加坡站搜索 usb c cable 后，前三个商品信息如下（价格和名称均照页面原样）：',
      '',
      '1. UGREEN 2 Pack USB C to USB C Charger Cable, Type C 100W PD Fast Charging Cord Compatible with iPhone 15 Pro Max, MacBook Pro, Switch, 1M — S$10.92 Was: S$17.42',
      '2. UGREEN 2 Pack USB C to USB C Charger Cable, Type C 100W PD Fast Charging Cord Compatible with iPhone 15 Pro Max, MacBook Pro, Switch, 2M — S$12.45 Was: S$21.22',
      '3. Belkin Eco USB C to USB C 60W Braided Cable 3.3ft iPhone Charger Cord — S$9.43（页面标注 No featured offers available，下方显示 S$9.43 (1 new offer)）',
    ].join('\n');
    const out = plainAnswer(raw);
    expect(out).not.toMatch(/原样|No featured/);
    expect(out).toContain('前三个商品信息如下：');
    const [one, two, three] = out.split('\n').filter((l) => /^\d\./.test(l));
    expect(one).toMatch(
      /^1\. UGREEN 2 Pack USB C to USB C Charger Cable, Type C 100W…1M — S\$10\.92/,
    );
    expect(two).toMatch(/…2M — S\$12\.45/);
    expect(three).toBe(
      '3. Belkin Eco USB C to USB C 60W Braided Cable 3.3ft… — S$9.43（这款没有主推价，有 1 个卖家报价 S$9.43）',
    );
  });

  it('复审 #7 亚马逊 (real run): no 「按页面原文保留…字样」, offers in words, no cut inside a bracket', () => {
    const raw = [
      '在亚马逊新加坡站搜索“USB C cable”后，从搜索结果页读取到前5个商品的名称和价格如下：',
      '',
      '3. Belkin Eco USB C to USB C 60W Braided Cable 3.3ft… — S$9.43(1 new offer)  ',
      '4. Belkin Eco-Friendly Braided USB-A to USB-C Cable (6.6ft, Charger Cord for iPhone 16 Pro Max, 2M) — S$8.21(2 new offers)  ',
      '',
      '第3、4条当前没有主推价，页面显示为卖家报价形式，已按页面原文保留“(1 new offer)”与“(2 new offers)”字样。',
    ].join('\n');
    const out = plainAnswer(raw);
    expect(out).not.toMatch(/原文|字样|new offer/);
    expect(out).toContain('— S$9.43（有 1 个卖家报价）');
    expect(out).toContain('— S$8.21（有 2 个卖家报价）');
    expect(out).toContain('4. Belkin Eco-Friendly Braided USB-A to USB-C Cable… — S$8.21');
    expect(out.split('\n').at(-1)).toBe('第3、4条当前没有主推价，页面显示为卖家报价形式。');
  });

  it('复审 #7 English answers stay English', () => {
    const raw = [
      '1. Belkin Cable — S$9.43(1 new offer)',
      '2. Anker Cable — S$8.90 (as shown on the page)',
      '',
      'Prices are recorded as shown on the page.',
    ].join('\n');
    const out = plainAnswer(raw, true);
    expect(out).toBe('1. Belkin Cable — S$9.43 (1 seller offer)\n2. Anker Cable — S$8.90');
    expect(out).not.toMatch(/[\u4e00-\u9fff]/);
  });

  it('复审 #6: a fact line with something new stays (PLUS 价)', () => {
    const t = '价格 ¥7??9。\n- 价格：¥7??9，另有 PLUS 价 ¥7??0';
    expect(plainAnswer(t)).toBe(t);
    const note = '价格 ¥7??9。\n- 价格：¥7??9（未登录被打码）';
    expect(plainAnswer(note)).toBe('价格 ¥7??9。');
    const other = '价格 ¥7??9。\n- 价格：¥7??9（PLUS 会员 ¥7??0）';
    expect(plainAnswer(other)).toBe(other);
  });

  it('协调方第 3 次代体验 亚马逊 Belkin: said once, no stray 「即」', () => {
    expect(
      plainAnswer(
        '3. 名称：Belkin Eco USB C Cable；价格：该商品没有主推价，有 1 个卖家报价 S$9.43（No featured offers available S$9.43 (1 new offer)）',
      ),
    ).toBe('3. 名称：Belkin Eco USB C Cable；价格：该商品没有主推价，有 1 个卖家报价 S$9.43');
    expect(
      plainAnswer(
        '3. Belkin Cable — 页面显示「No featured offers available」，即该商品没有主推价，有 1 个卖家报价 S$9.43。',
      ),
    ).toBe('3. Belkin Cable — 该商品没有主推价，有 1 个卖家报价 S$9.43。');
    // A note that adds something stays.
    const fresh = '1. UGREEN — S$10.92（限时优惠，原价 S$17.42）';
    expect(plainAnswer(fresh)).toBe(fresh);
  });

  it('协调方第 2 次代体验 京东: the price is said once', () => {
    const raw = [
      '部分完成：这是从[京东手机版](https://item.m.jd.com/product/100142621606.html)查到的，不是你给的京东页面，只能算部分完成。',
      '',
      '在京东移动版页面读到这款商品的标题是「Apple/苹果/苹果【需签收激活】iPhone 16 Pro 128GB 原色...」，价格显示为 ¥7??9，因为没登录被京东打了码。',
      '',
      '- 价格：¥7??9（未登录被遮挡，完整价格需登录后查看）',
      '- 标题：「Apple/苹果/苹果【需签收激活】iPhone 16 Pro 128GB 原色...」',
    ].join('\n');
    const out = plainAnswer(raw);
    expect(out).not.toContain('- 价格：');
    expect(out).not.toContain('- 标题：');
    expect(out.match(/¥7\?\?9/g)).toHaveLength(1);
    // A list that says something new stays.
    const fresh = '标题是「iPhone 16 Pro」。\n\n- 价格：¥7??9（未登录被遮挡）';
    expect(plainAnswer(fresh)).toBe(fresh);
  });

  it('协调方第 2 次代体验 亚马逊: no closing 「原样」 sentence, the English quote goes', () => {
    const raw = [
      '在亚马逊新加坡站搜索 usb c cable，前三个商品的名称和价格如下：',
      '',
      '1. UGREEN 2 Pack USB C to USB C Charger Cable, Type C 100W…1M — S$10.92（原价 S$17.42）',
      '3. Belkin Eco USB C to USB C 60W Braided Cable 3.3ft iPhone Charger Cord — 页面显示「No featured offers available S$9.43 (1 new offer)」，该商品没有主推价，仅有 1 个卖家报价 S$9.43。',
      '',
      '价格均照页面原样记录。',
    ].join('\n');
    const out = plainAnswer(raw);
    expect(out).not.toMatch(/原样|No featured|new offer/);
    expect(out.split('\n').at(-1)).toMatch(
      /^3\. Belkin .*— 该商品没有主推价，仅有 1 个卖家报价 S\$9\.43。$/,
    );
    // Not explained in the line: the quote is said in Chinese.
    expect(
      plainAnswer(
        '3. Belkin Cable — 页面显示「No featured offers available S$9.43 (1 new offer)」',
      ),
    ).toBe('3. Belkin Cable — 没有主推价，有 1 个卖家报价 S$9.43。');
    // A sentence that says more than 「原样」 keeps the rest.
    expect(plainAnswer('价格照页面原样记录，第 3 款要登录才显示。')).toBe('第 3 款要登录才显示。');
  });

  it.each([
    ['价格：¥7??9（页面原样显示，未登录被打码）', '价格：¥7??9（未登录被打码）'],
    ['价格：¥7??9（照页面原样）', '价格：¥7??9'],
    ['价格：¥7??9（页面原样显示）', '价格：¥7??9'],
    ['前三个如下（价格和名称均照页面原样）：', '前三个如下：'],
    ['价格 ¥199（页面原样显示未登录价）', '价格 ¥199（未登录价）'],
    ['评分 4.5（截断，照页面原样）', '评分 4.5（截断）'],
  ])('复审 #4 诚实: only the 原样 words go, the rest of a note stays: %s', (text, out) => {
    expect(plainAnswer(text)).toBe(out);
  });

  it('short names and lines without a price stay as they are', () => {
    const t =
      '1. Anker USB C Cable — S$8.90\n这是一段很长很长的说明文字，没有价格，也不是列表项，所以不应该被截断或改动任何一个字。';
    expect(plainAnswer(t)).toBe(t);
  });
});

describe('复审 #7 · a rescued answer says where it came from once', () => {
  const done = (summary: string) =>
    ({ status: 'completed', summary, steps: 3 }) as Parameters<typeof rescuedAnswer>[0];
  const URL_M = 'https://item.m.jd.com/product/100142621606.html?ad_od=3';
  it('one lead; 「以上信息来自…」 goes; a dated source sentence stays', () => {
    const out = rescuedAnswer(
      done(
        '商品标题是「Apple iPhone 16 Pro」，价格没登录时被京东打了码，只显示 ¥7??9。以上信息来自 [京东手机版](https://item.m.jd.com/product/100142621606.html?ad_od=3)。',
      ),
      { started: true, blockedUrl: 'https://item.jd.com/100142621606.html', why: 'login' },
      URL_M,
    );
    expect(out.summary).toBe(
      `部分完成：这是从[京东手机版](${URL_M})查到的（你给的京东页面要登录），只拿到了一部分：\n\n商品标题是「Apple iPhone 16 Pro」，价格没登录时被京东打了码，只显示 ¥7??9。`,
    );
    const dated = rescuedAnswer(
      done('价格 ¥7999。以上信息来自 2024 年 10 月的页面快照。'),
      { started: true, blockedUrl: 'https://item.jd.com/1.html', why: 'blocked' },
      URL_M,
    );
    expect(dated.summary).toContain('以上信息来自 2024 年 10 月的页面快照。');
    expect(dated.summary).toContain('（你给的京东页面被拦下了）');
  });

  it('English task: English lead (the 部分完成 marker is stripped by the page)', () => {
    const out = rescuedAnswer(
      done('The title is Apple iPhone 16 Pro; the price is masked until you log in.'),
      { started: true, blockedUrl: 'https://item.jd.com/100142621606.html', why: 'login' },
      URL_M,
      true,
    );
    expect(out.summary.split('\n')[0]).toBe(
      `部分完成：I got this from [JD mobile](${URL_M}) (the JD.com page you gave needs a login), so it's only part of what you asked:`,
    );
  });

  it('isEnglishIntent', () => {
    expect(isEnglishIntent('open https://item.jd.com/1.html and read the price')).toBe(true);
    expect(isEnglishIntent('打开 https://item.jd.com/1.html 读价格')).toBe(false);
  });
});

describe('复审 #3 · a login asked for with reason 「other」 is routed around too', () => {
  it('request_human(other, 「需要登录」) gets the rescue note first', async () => {
    const { seen } = await run(JD, [
      { name: 'navigate', input: { url: 'https://item.jd.com/100142621606.html' } },
      {
        name: 'request_human',
        input: {
          reason: 'other',
          message: '京东需要登录才能查看这个商品页面，请你自己登录后告诉我继续。',
        },
      },
      { name: 'finish', input: { status: 'failed', summary: '公开来源也没有价格' } },
    ]);
    expect(seen).toContain(ROUTE);
  });
});

describe('复审 #4 · only a plainly read-only task is routed around (whitelist)', () => {
  it.each([
    '收藏这个商品',
    '领取优惠券',
    '抢购这款手机',
    '打开 https://item.jd.com/1.html',
    '看看能不能领取优惠券',
    '帮我看一下价格，然后抢购',
    '把这个商品分享到微信',
    '打开京东抢购这款手机',
    '读价格后帮我拍下',
    'read the price on https://www.amazon.sg/dp/B0X then buy it',
    '看完价格以后帮我买一个',
    'check the price and add it to cart',
    '查一下价格，有货就下单',
    '看价格低于7000的话直接拍',
    '查到价格就去拍',
  ])('handed to the person: %s', (intent) => {
    expect(isReadOnlyIntent(intent)).toBe(false);
  });

  it.each([
    JD,
    '读商品标题和价格',
    '在亚马逊新加坡站搜 usb c cable，列出前三个的名称和价格',
    '上证指数现在多少点',
    '请使用云端浏览器，打开 https://item.taobao.com/item.htm?id=111 读价格',
    '比较京东和淘宝上 AirPods 的价格',
    'search amazon.sg for usb c cable and list the top 3 prices',
    '看完后告诉我最后一个商品的价格',
    '查一下这款手机的售后政策',
    '读一下这个页面的后续更新',
  ])('routed around: %s', (intent) => {
    expect(isReadOnlyIntent(intent)).toBe(true);
  });
});

describe('FIX-57 #5 · never routed around', () => {
  it.each([
    ['rescue off', JD, false],
    ['a write task', '打开 https://item.jd.com/1.html 把商品加入购物车', true],
    ['a login task', '打开 https://item.jd.com/1.html 帮我登录京东看价格', true],
    ['own account data', '打开 https://order.jd.com/center/list.action 查我的订单', true],
    ['复审 #4 收藏', '打开 https://item.jd.com/100142621606.html 收藏这个商品', true],
    ['复审 #4 领券', '打开 https://item.jd.com/100142621606.html 领取优惠券', true],
    ['复审 #4 抢购', '打开 https://item.jd.com/100142621606.html 抢购这款手机', true],
  ])('%s: the wall is handed over at once', async (_label, intent, rescue) => {
    const { outcome, seen, onRescue } = await run(
      intent as string,
      [
        { name: 'navigate', input: { url: 'https://item.jd.com/100142621606.html' } },
        { name: 'finish', input: { status: 'failed', summary: '登录页' } },
      ],
      { rescue: rescue as boolean, walled: (u) => /passport|order\.jd/.test(u) },
    );
    expect(seen).not.toContain(ROUTE);
    expect(onRescue).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ status: 'awaiting_user', reason: 'login' });
  });

  it('the intent words', () => {
    expect(WRITE_INTENT_RE.test('读商品标题和价格')).toBe(false);
    expect(WRITE_INTENT_RE.test('在 bestbuy.com 搜 usb c cable 列出前 3 个价格')).toBe(false);
    for (const w of [
      '提交表单',
      '下单',
      '发布一条',
      '登录后',
      '我的订单',
      'add to cart',
      'sign in',
    ])
      expect(WRITE_INTENT_RE.test(w)).toBe(true);
    expect(RESCUE_GIVE_UP_RE.test('页面被拦截')).toBe(true);
    expect(RESCUE_GIVE_UP_RE.test('Instagram 返回 HTTP 429（请求过多），未能加载账号主页')).toBe(
      true,
    );
    expect(RESCUE_GIVE_UP_RE.test('型号不存在')).toBe(false);
  });
});
