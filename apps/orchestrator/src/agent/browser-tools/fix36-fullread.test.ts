import { type Browser, type Page, chromium } from 'playwright';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { classifyRuntimeAction } from '../supercar/runtime-action-policy.js';
import { probeBrowserBlocker } from './browser-blocker-probe.js';
import { LOGIN_POPUP_NOTICE } from './full-page-read.js';
import { createPlaywrightUnifiedExecutor } from './playwright-unified-executor.js';
import { createUnifiedActionGate } from './unified-action-gate.js';
import { UnifiedToolInputError, parseUnifiedBrowserAction } from './unified-tools.js';

/**
 * FIX-36 #9 (BOSS 2026-10-25): the AI reads the whole page by default. A login popup no
 * longer masks the page or hands it over; the AI may close it (×, 关闭, Escape). Typing into a
 * login / verification form, captchas and writes keep their red lines.
 */

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
}, 60_000);
afterAll(async () => {
  await browser?.close();
});
const saved = process.env.BROWSER_FULL_PAGE_READ;
afterEach(() => {
  if (saved === undefined) delete process.env.BROWSER_FULL_PAGE_READ;
  else process.env.BROWSER_FULL_PAGE_READ = saved;
});

/** A Gaode-like route page with an SMS login popup over it. */
const ROUTE = `<main>
  <h1>杭州东站 到 西湖断桥 路线规划</h1>
  <section><h2>推荐路线</h2>
    <p>方案一：驾车约 25 分钟，全程 12.3 公里，途经环城北路、北山街。</p>
    <p>方案二：地铁 1 号线换乘公交，约 42 分钟，步行 800 米。</p>
    <p>方案三：打车约 28 分钟，预计 38 元，实时路况畅通，建议从东广场出发。</p>
  </section>
  <input aria-label="搜索地点" name="keyword">
</main>
<div role="dialog" aria-modal="true" id="login" style="position:fixed;inset:20% 30%;background:#fff;border:1px solid #ccc">
  <h2>手机号登录</h2>
  <p>登录后可保存常用路线</p>
  <input name="phone" placeholder="请输入手机号">
  <input name="sms" placeholder="请输入短信验证码">
  <input type="password" name="pwd" value="synthetic-password">
  <button>获取验证码</button>
  <button>登录</button>
  <button aria-label="关闭" onclick="document.getElementById('login').remove()">×</button>
</div>
<script>addEventListener('keydown', (e) => { if (e.key === 'Escape') document.getElementById('login')?.remove(); });</script>`;

async function routePage(): Promise<Page> {
  const page = await browser.newPage();
  await page.route('https://www.amap.com/**', (r) =>
    r.fulfill({ contentType: 'text/html; charset=utf-8', body: ROUTE }),
  );
  await page.goto('https://www.amap.com/dir?from=hzd&to=duanqiao');
  return page;
}

async function refOf(page: Page, pattern: RegExp): Promise<string> {
  const tree = await page.locator('body').ariaSnapshot({ mode: 'ai' } as never);
  const ref = tree
    .split('\n')
    .find((line) => pattern.test(line))
    ?.match(/\[ref=(\w+)\]/)?.[1];
  if (!ref) throw new Error(`no ref for ${pattern} in ${tree}`);
  return ref;
}

function gateFor(page: Page) {
  const park = vi.fn(async (_question: string, _kind: string) => '已完成');
  return {
    park,
    gate: createUnifiedActionGate({
      page,
      onBeforeAction: classifyRuntimeAction,
      labelForRef: () => null,
      park,
      aborted: () => false,
    }),
  };
}

describe('FIX-36 #9 · the page behind a login popup is read', () => {
  it('get_page_text reads the routes and the popup; a typed password value stays masked', async () => {
    const page = await routePage();
    const tools = createPlaywrightUnifiedExecutor(page, { observationV2: true });
    try {
      const data = JSON.parse((await tools.execute({ tool: 'get_page_text' })).text);
      expect(data.redacted ?? false).toBe(false);
      expect(data.text).toContain('驾车约 25 分钟，全程 12.3 公里');
      expect(data.text).toContain('手机号登录');
      expect(data.text).not.toContain('synthetic-password');
    } finally {
      tools.dispose();
      await page.close();
    }
  });

  it('with BROWSER_FULL_PAGE_READ=false the page is masked again (config only)', async () => {
    process.env.BROWSER_FULL_PAGE_READ = 'false';
    const page = await routePage();
    const tools = createPlaywrightUnifiedExecutor(page, { observationV2: true });
    try {
      const data = JSON.parse((await tools.execute({ tool: 'get_page_text' })).text);
      expect(data.status).toBe('redacted_unread');
      expect(data.text).toBeUndefined();
    } finally {
      tools.dispose();
      await page.close();
    }
  });

  it('the blocker probe treats the login popup as something to close, not a wall', async () => {
    const page = await routePage();
    expect(await probeBrowserBlocker(page)).toMatchObject({
      reason: 'login',
      disposition: 'continue',
      message: LOGIN_POPUP_NOTICE,
    });
    process.env.BROWSER_FULL_PAGE_READ = 'false';
    const masked = await probeBrowserBlocker(page);
    expect(masked).toMatchObject({ reason: 'login' });
    expect((masked as { disposition?: string }).disposition).toBeUndefined();
    await page.close();
  });

  it('a map page with little text (canvas) and a login popup: still the AI’s to close', async () => {
    const page = await browser.newPage();
    await page.route('https://www.amap.com/**', (r) =>
      r.fulfill({
        contentType: 'text/html; charset=utf-8',
        body: '<canvas width="800" height="600"></canvas><div role="dialog" aria-modal="true" style="position:fixed;inset:20%;background:#fff"><h2>手机号登录</h2><input placeholder="手机号码"><button>发送验证码</button><button>立即登录</button></div>',
      }),
    );
    await page.goto('https://www.amap.com/');
    expect(await probeBrowserBlocker(page)).toMatchObject({
      reason: 'login',
      disposition: 'continue',
    });
    await page.close();
  });

  it('a login iframe over a quote page (not a dialog, not a component) is the AI’s to close (local live-sh)', async () => {
    const page = await browser.newPage();
    await page.route('https://quote.eastmoney.com/**', (r) =>
      r.fulfill({
        contentType: 'text/html; charset=utf-8',
        body: '<main><h1>上证指数 000001</h1><p>最新 3690.48 涨跌 +32.45 涨幅 +0.89% 今开 3623.57 最高 3691.40 最低 3574.27 昨收 3658.03 成交额 8987 亿元</p></main><div style="position:fixed;inset:15% 25%;background:#fff"><iframe src="https://exaccount2.eastmoney.com/Home/Login4" style="width:100%;height:100%;border:0"></iframe></div>',
      }),
    );
    await page.route('https://exaccount2.eastmoney.com/**', (r) =>
      r.fulfill({
        contentType: 'text/html; charset=utf-8',
        body: '<h2>账号登录</h2><input placeholder="手机号/用户名"><input type="password"><button>登录</button>',
      }),
    );
    await page.goto('https://quote.eastmoney.com/zs000001.html');
    await page.frames()[1]?.waitForLoadState();
    expect(await probeBrowserBlocker(page)).toMatchObject({
      reason: 'login',
      disposition: 'continue',
      message: LOGIN_POPUP_NOTICE,
    });
    await page.close();
  });

  it('a login address is still a wall to hand over', async () => {
    const page = await browser.newPage();
    await page.route('https://passport.example.com/**', (r) =>
      r.fulfill({
        contentType: 'text/html; charset=utf-8',
        body: '<h1>账号登录</h1><input placeholder="用户名"><input type="password"><button>登录</button>',
      }),
    );
    await page.goto('https://passport.example.com/login');
    const hit = await probeBrowserBlocker(page);
    expect(hit).toMatchObject({ reason: 'login' });
    expect((hit as { disposition?: string }).disposition).toBeUndefined();
    await page.close();
  });

  it('a captcha is still handed over', async () => {
    const page = await browser.newPage();
    await page.setContent(
      `${ROUTE.split('<div role="dialog"')[0]}<div role="dialog" aria-modal="true" style="position:fixed;inset:20%"><h2>安全验证</h2><p>请拖动滑块完成拼图验证</p><div class="geetest_slider">滑块</div></div>`,
    );
    const hit = await probeBrowserBlocker(page);
    expect(hit).toMatchObject({ reason: 'captcha' });
    expect((hit as { disposition?: string }).disposition).toBeUndefined();
    await page.close();
  });
});

describe('FIX-36 #9 · a full-page screenshot never shows typed secrets (Codex P1 on PR #299)', () => {
  const form = (card: string, otp: string, city: string) =>
    `<form style="font:20px sans-serif"><label>卡号 <input name="cardNumber" value="${card}"></label><br><label>短信验证码 <input placeholder="请输入验证码" value="${otp}"></label><br><input type="password" value="${otp}"><br><label>城市 <input name="city" value="${city}"></label></form>`;
  async function shot(html: string) {
    const page = await browser.newPage({ viewport: { width: 640, height: 320 } });
    await page.setContent(html);
    const tools = createPlaywrightUnifiedExecutor(page, { observationV2: true });
    try {
      const result = await tools.execute({ tool: 'screenshot' });
      expect(result.ok).toBe(true);
      return (result as { image?: { data: string } }).image?.data;
    } finally {
      tools.dispose();
      await page.close();
    }
  }

  it('card, verification-code and password values are masked; the page is not touched', async () => {
    const empty = await shot(form('', '', '杭州'));
    const filled = await shot(form('4111111111111111', '123456', '杭州'));
    expect(filled).toBeTruthy();
    expect(filled).toBe(empty);
  });

  it('an ordinary field is still shown', async () => {
    expect(await shot(form('', '', '杭州'))).not.toBe(await shot(form('', '', '')));
  });
});

describe('FIX-36 #9 · popups may be closed; credentials are never typed', () => {
  it('the popup’s × (关闭) is clicked without a takeover', async () => {
    const page = await routePage();
    const { gate, park } = gateFor(page);
    const decision = await gate(
      { tool: 'click', ref: await refOf(page, /button "关闭"/) },
      'before',
    );
    expect(decision).toMatchObject({ kind: 'proceed' });
    expect(park).not.toHaveBeenCalled();
    await page.close();
  });

  it('typing a phone number into the login popup is refused, and the task goes on (no takeover)', async () => {
    const page = await routePage();
    const { gate, park } = gateFor(page);
    const decision = await gate(
      { tool: 'type', ref: await refOf(page, /textbox "请输入手机号"/), text: '13800000000' },
      'before',
    );
    expect(decision).toMatchObject({ kind: 'skip', message: expect.stringContaining('不代填') });
    expect(park).not.toHaveBeenCalled();
    expect(await page.locator('input[name=phone]').inputValue()).toBe('');
    await page.close();
  });

  it('typing into the verification-code box itself is still a takeover, as before', async () => {
    const page = await routePage();
    const { gate, park } = gateFor(page);
    await gate(
      { tool: 'type', ref: await refOf(page, /textbox "请输入短信验证码"/), text: '1234' },
      'before',
    );
    expect(park.mock.calls[0]?.[1]).toBe('login');
    await page.close();
  });

  it('the-internet /large_form as it is: Details are filled, the Account block (with its password) is not (core-08)', async () => {
    const page = await browser.newPage();
    // The live page's structure (checked 2026-10-25): an Account fieldset with a password box,
    // then a Details fieldset with the date control.
    await page.setContent(
      '<form id="large-form" action="/large_form" method="post"><fieldset><legend>Account</legend><label for="first-name">First name</label><input type="text" id="first-name" name="first_name"><label for="last-name">Last name</label><input type="text" id="last-name" name="last_name"><label>Email</label><input type="email" name="email"><label>Password</label><input type="password" name="password"><input type="text" name="nickname" placeholder="Nickname (optional)"></fieldset><fieldset><legend>Details</legend><label for="birthday">Birthday</label><input type="date" id="birthday" name="birthday"><span>Age</span><input type="number" name="age" aria-label="Age"><label for="bio">About you</label><textarea id="bio" name="bio"></textarea></fieldset></form>',
    );
    const { gate, park } = gateFor(page);
    for (const [pattern, text] of [
      [/textbox "Birthday"/, '2026-10-25'],
      [/textbox "About you"/, '你好'],
    ] as const)
      expect(
        await gate({ tool: 'type', ref: await refOf(page, pattern), text }, 'before'),
      ).toMatchObject({ kind: 'proceed' });
    for (const pattern of [/textbox "First name"/, /textbox "Nickname \(optional\)"/])
      expect(
        await gate({ tool: 'type', ref: await refOf(page, pattern), text: 'tom' }, 'before'),
      ).toMatchObject({ kind: 'skip', message: expect.stringContaining('不代填') });
    expect(park).not.toHaveBeenCalled();
    await page.close();
  });

  it('typing into the page’s own search box (outside the popup) is not', async () => {
    const page = await routePage();
    const { gate, park } = gateFor(page);
    const decision = await gate(
      { tool: 'type', ref: await refOf(page, /textbox "搜索地点"/), text: '西湖' },
      'before',
    );
    expect(decision).toMatchObject({ kind: 'proceed' });
    expect(park).not.toHaveBeenCalled();
    await page.close();
  });

  it('press_key Escape closes the popup; it is the only key offered', async () => {
    expect(parseUnifiedBrowserAction('press_key', { key: 'Escape' })).toMatchObject({
      tool: 'press_key',
      key: 'Escape',
    });
    expect(() => parseUnifiedBrowserAction('press_key', { key: 'Enter' })).toThrow(
      UnifiedToolInputError,
    );
    const page = await routePage();
    const tools = createPlaywrightUnifiedExecutor(page, { observationV2: true });
    try {
      const result = await tools.execute({ tool: 'press_key', key: 'Escape' });
      expect(result.ok).toBe(true);
      expect(await page.locator('#login').count()).toBe(0);
    } finally {
      tools.dispose();
      await page.close();
    }
  });
});
