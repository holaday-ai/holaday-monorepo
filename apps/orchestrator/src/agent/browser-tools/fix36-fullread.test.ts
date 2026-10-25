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

  it('a long form that also asks for a password: its date box is filled, its username box is not (local core-08)', async () => {
    const page = await browser.newPage();
    await page.setContent(
      '<form><label>Username<input name="username"></label><label>Password<input type="password" name="password"></label><label>Birthday<input type="date" name="birthday" aria-label="Birthday"></label><label>Address<input name="address" aria-label="Address"></label></form>',
    );
    const { gate, park } = gateFor(page);
    const date = await gate(
      { tool: 'type', ref: await refOf(page, /textbox "Birthday"/), text: '2026-10-25' },
      'before',
    );
    expect(date).toMatchObject({ kind: 'proceed' });
    const address = await gate(
      { tool: 'type', ref: await refOf(page, /textbox "Address"/), text: '杭州' },
      'before',
    );
    expect(address).toMatchObject({ kind: 'proceed' });
    const user = await gate(
      { tool: 'type', ref: await refOf(page, /textbox "Username"/), text: 'tom' },
      'before',
    );
    expect(user).toMatchObject({ kind: 'skip', message: expect.stringContaining('不代填') });
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
