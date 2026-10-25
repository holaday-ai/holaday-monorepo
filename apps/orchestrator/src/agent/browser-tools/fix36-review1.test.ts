import { createServer } from 'node:http';
import { readLoginContext } from '@holaday/shared-types';
import { type Browser, type CDPSession, type Page, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { SelectedTargetResolver } from '../../../../../packages/browser-driver/src/selected-target.js';
import { classifyRuntimeAction } from '../supercar/runtime-action-policy.js';
import { detectBrowserBlocker } from './browser-completion.js';
import {
  createDescriptionActionGate,
  createUnifiedActionGate,
  describeUserBrowserAction,
} from './unified-action-gate.js';
import { runUnifiedBrowserLoop } from './unified-browser-loop.js';

/**
 * FIX-36 复审 #1 blocker (red line: never type an account / phone number, never log in or
 * authorize for the user). A login popup that is a plain <div>, a box named only by its
 * <label>, a 「6位数字」 code box and 「授权登录 / 获取验证码」 controls are all refused — in the
 * cloud browser and in the user's own browser. Search and route boxes are not.
 */

/** A Gaode-like page: route panel (absolute), search form, and a plain-div login popup. */
const PAGE = `<main>
  <h1>杭州东站 到 西湖断桥</h1>
  <form role="search"><input aria-label="搜索地点" name="keyword"></form>
  <div style="position:absolute;left:0;top:80px;width:300px;height:160px">
    <input class="LocationItem_input" id="from" placeholder="请输入起点">
    <input id="to" placeholder="请输入终点">
  </div>
  <p>方案一：驾车约 25 分钟，全程 12.3 公里。</p>
</main>
<div id="mask" style="position:fixed;inset:0;background:rgba(0,0,0,.3)">
  <div style="position:absolute;left:30%;top:20%;width:40%;height:50%;background:#fff">
    <p>手机号登录</p>
    <input id="phone" placeholder="请输入手机号">
    <input id="code" placeholder="请输入6位数字">
    <input id="invite" placeholder="邀请人（选填）">
    <span id="get" role="button" onclick="document.body.dataset.sent=1">获取验证码</span>
    <div id="auth" role="button" onclick="document.body.dataset.auth=1">授权登录</div>
    <span id="close" role="button" aria-label="关闭" onclick="document.getElementById('mask').remove()">×</span>
  </div>
</div>`;

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
}, 60_000);
afterAll(async () => {
  await browser?.close();
});

async function open(html: string): Promise<Page> {
  const page = await browser.newPage();
  await page.setContent(html);
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
  const park = vi.fn(async (_question: string, _kind: string) => '确认执行');
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

describe('FIX-36 复审 #1 · cloud browser: a plain-div login popup', () => {
  it('typing a phone number is refused, nothing typed, no takeover', async () => {
    const page = await open(PAGE);
    const { gate, park } = gateFor(page);
    const decision = await gate(
      { tool: 'type', ref: await refOf(page, /textbox "请输入手机号"/), text: '13800000000' },
      'before',
    );
    expect(decision).toMatchObject({ kind: 'skip', message: expect.stringContaining('不代填') });
    expect(park).not.toHaveBeenCalled();
    await page.close();
  });

  it('a 「6位数字」 code box is refused too', async () => {
    const page = await open(PAGE);
    const { gate } = gateFor(page);
    expect(
      await gate(
        { tool: 'type', ref: await refOf(page, /textbox "请输入6位数字"/), text: '123456' },
        'before',
      ),
    ).toMatchObject({ kind: 'skip', message: expect.stringContaining('不代填') });
    await page.close();
  });

  it('「获取验证码」 and 「授权登录」 are refused before the click; nothing is sent', async () => {
    const page = await open(PAGE);
    const { gate, park } = gateFor(page);
    for (const name of ['获取验证码', '授权登录']) {
      const decision = await gate(
        { tool: 'click', ref: await refOf(page, new RegExp(`button "${name}"`)) },
        'before',
      );
      expect(decision).toMatchObject({
        kind: 'skip',
        message: expect.stringContaining('不替用户点击'),
      });
    }
    expect(park).not.toHaveBeenCalled();
    expect(await page.locator('body').getAttribute('data-sent')).toBeNull();
    await page.close();
  });

  it('the popup’s × may still be clicked', async () => {
    const page = await open(PAGE);
    const { gate, park } = gateFor(page);
    expect(
      await gate({ tool: 'click', ref: await refOf(page, /button "关闭"/) }, 'before'),
    ).toMatchObject({ kind: 'proceed' });
    expect(park).not.toHaveBeenCalled();
    await page.close();
  });

  it('reverse: the search box and the route from / to boxes are typed as before', async () => {
    const page = await open(PAGE);
    const { gate } = gateFor(page);
    for (const name of ['搜索地点', '请输入起点', '请输入终点']) {
      expect(
        await gate(
          { tool: 'type', ref: await refOf(page, new RegExp(`textbox "${name}"`)), text: '西湖' },
          'before',
        ),
      ).toMatchObject({ kind: 'proceed' });
    }
    await page.close();
  });
});

describe('FIX-36 复审 #1 · readLoginContext in the page', () => {
  it('any box of a login block is a login field, by the block alone; the route box is not', async () => {
    const page = await open(PAGE);
    const read = (css: string) => page.locator(css).evaluate(readLoginContext, false);
    expect(await read('#invite')).toMatchObject({ loginField: true, loginControl: false });
    expect(await read('#code')).toMatchObject({ loginField: true, loginControl: false });
    expect(await read('#get')).toMatchObject({ loginField: false, loginControl: true });
    expect(await read('#close')).toMatchObject({ loginField: false, loginControl: false });
    expect(await read('#from')).toEqual({
      loginField: false,
      loginControl: false,
      loginBlock: false,
    });
    expect(await read('[name=keyword]')).toEqual({
      loginField: false,
      loginControl: false,
      loginBlock: false,
    });
    await page.close();
  });

  it('a popup that only says 登录 counts once the probe reports a login popup', async () => {
    const page = await open(
      '<main><p>正文</p></main><div style="position:fixed;left:30%;top:20%;width:40%;height:40%"><p>登录后查看更多</p><input id="nick" placeholder="昵称"><button id="go">登录</button></div>',
    );
    const read = (css: string, popup: boolean) =>
      page.locator(css).evaluate(readLoginContext, popup);
    expect((await read('#nick', false)).loginField).toBe(false);
    expect((await read('#nick', true)).loginField).toBe(true);
    expect((await read('#go', true)).loginControl).toBe(true);
    await page.close();
  });
});

describe('FIX-36 复审 #1 · cloud browser: no popup needed', () => {
  it('a box named only by its <label> (账号) is refused', async () => {
    const page = await open('<div><label>账号 <input id="x"></label><button>查询</button></div>');
    const { gate } = gateFor(page);
    expect(
      await gate({ tool: 'type', ref: await refOf(page, /textbox "账号"/), text: 'tom' }, 'before'),
    ).toMatchObject({ kind: 'skip' });
    await page.close();
  });

  it('复审 #2 #4 reverse: a contact or booking form’s phone and e-mail are filled', async () => {
    const page = await open(
      '<form><label>联系人 <input id="n"></label><label>手机号码 <input id="m" type="tel"></label><label>邮箱 <input id="e" type="email"></label><label>预约日期 <input type="date" id="d"></label><button>提交预约</button></form>',
    );
    const { gate } = gateFor(page);
    for (const [name, text] of [
      ['手机号码', '13800000000'],
      ['邮箱', 'a@example.com'],
      ['联系人', '张三'],
    ])
      expect(
        await gate(
          { tool: 'type', ref: await refOf(page, new RegExp(`textbox "${name}"`)), text },
          'before',
        ),
      ).toMatchObject({ kind: 'proceed' });
    await page.close();
  });

  it('a lone 「授权登录」 button is refused anywhere', async () => {
    const page = await open('<p>第三方应用申请使用你的账号信息</p><button>授权登录</button>');
    const { gate } = gateFor(page);
    expect(
      await gate({ tool: 'click', ref: await refOf(page, /button "授权登录"/) }, 'before'),
    ).toMatchObject({ kind: 'skip', message: expect.stringContaining('不替用户点击') });
    await page.close();
  });
});

describe('FIX-36 复审 #1 · the user’s own browser (extension path)', () => {
  let page: Page;
  let session: CDPSession;
  let origin: string;
  const server = createServer((_req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end('<html><body>fixture</body></html>');
  });
  const sortKeys = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(sortKeys)
      : value && typeof value === 'object'
        ? Object.fromEntries(
            Object.entries(value)
              .sort(([a], [b]) => (a < b ? -1 : 1))
              .map(([key, inner]) => [key, sortKeys(inner)]),
          )
        : value;
  const cdp = async (method: string, params?: Record<string, unknown>) =>
    sortKeys(await session.send(method as never, params as never));
  const selector = (value: string) => ({
    scope: { timeoutMs: 2000 },
    selfHeal: false,
    description: 'fixture',
    strategies: [{ kind: 'css' as const, value }],
  });
  beforeAll(async () => {
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    page = await browser.newPage();
    session = await page.context().newCDPSession(page);
  });
  afterAll(async () => {
    await page?.close();
    await new Promise<void>((r) => server.close(() => r()));
  });

  async function decide(action: Parameters<typeof describeUserBrowserAction>[0]) {
    const resolver = new SelectedTargetResolver(page as never, 3, [origin], cdp);
    await resolver.observe();
    const target = await resolver.describe(action as never, 1);
    const park = vi.fn(async () => '确认执行');
    const gate = createDescriptionActionGate({
      describe: async () => describeUserBrowserAction(action, target),
      onBeforeAction: classifyRuntimeAction,
      pageUrl: () => origin,
      park,
      aborted: () => false,
    });
    return { decision: await gate(action, 'before'), park, target };
  }

  it('typing the phone box and clicking 「授权登录」 are refused; × and the route box are not', async () => {
    await page.goto(origin);
    await page.setContent(PAGE);
    const typed = await decide({
      kind: 'type',
      selector: selector('#phone'),
      payload: { text: '13800000000' },
    });
    expect(typed.target.element.loginField).toBe(true);
    expect(typed.decision).toMatchObject({
      kind: 'skip',
      message: expect.stringContaining('不代填'),
    });
    const auth = await decide({ kind: 'click', selector: selector('#auth') });
    expect(auth.decision).toMatchObject({
      kind: 'skip',
      message: expect.stringContaining('不替用户点击'),
    });
    expect((await decide({ kind: 'click', selector: selector('#close') })).decision).toMatchObject({
      kind: 'proceed',
    });
    expect(
      (await decide({ kind: 'type', selector: selector('#from'), payload: { text: '杭州东站' } }))
        .decision,
    ).toMatchObject({ kind: 'proceed' });
    expect(await page.locator('#phone').inputValue()).toBe('');
    expect(await page.locator('body').getAttribute('data-auth')).toBeNull();
  });

  it('on a focused login box only Escape is allowed (Enter would log in)', async () => {
    await page.goto(origin);
    await page.setContent(PAGE);
    await page.locator('#phone').focus();
    expect(
      (await decide({ kind: 'key', payload: { key: 'Enter' } } as never)).decision,
    ).toMatchObject({ kind: 'skip' });
    expect(
      (await decide({ kind: 'key', payload: { key: 'Escape' } } as never)).decision,
    ).toMatchObject({ kind: 'proceed' });
  });
});

describe('FIX-36 复审 #1 #4 · an image code next to an SMS login is a captcha', () => {
  it.each(['请输入图形验证码 看不清？换一张', '图片验证码', '点击按钮进行验证', '请完成行为验证'])(
    '「%s」 → captcha',
    (extra) => {
      const hit = detectBrowserBlocker({
        url: 'https://passport.example.com/',
        title: '登录',
        text: `手机号登录 请输入手机号 ${extra} 获取验证码 登录`,
        visible: true,
      });
      expect(hit).toMatchObject({ reason: 'captcha' });
    },
  );
  it('an SMS login alone is still a login', () => {
    expect(
      detectBrowserBlocker({
        url: 'https://www.amap.com/',
        title: '高德地图',
        text: '手机号登录 请输入手机号 请输入短信验证码 获取验证码 登录',
        visible: true,
      }),
    ).toMatchObject({ reason: 'login' });
  });
});

describe('FIX-36 复审 #1 #5 · BROWSER_FULL_PAGE_READ=false also turns off popup closing', () => {
  async function firstRequest() {
    const requests: Array<{ system: string; tools: Array<{ name: string }> }> = [];
    const adapter = {
      metadata: { provider: 'anthropic', model: 'fixture' },
      async create(request: { system: string; tools: Array<{ name: string }> }) {
        requests.push(request);
        return {
          id: '1',
          metadata: { provider: 'anthropic', model: 'fixture' },
          content: [
            {
              type: 'tool_use',
              id: '1',
              name: 'finish',
              input: { status: 'failed', summary: '测试' },
            },
          ],
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
    await runUnifiedBrowserLoop({
      intent: '打开 example.com',
      adapter,
      maxSteps: 2,
      execute: async () => ({ ok: true, text: 'x' }),
      currentPageUrl: () => 'about:blank',
    } as never);
    return requests[0]!;
  }
  const saved = process.env.BROWSER_FULL_PAGE_READ;
  afterAll(() => {
    if (saved === undefined) delete process.env.BROWSER_FULL_PAGE_READ;
    else process.env.BROWSER_FULL_PAGE_READ = saved;
  });

  it('on (default): rule 4 closes popups and press_key is offered', async () => {
    delete process.env.BROWSER_FULL_PAGE_READ;
    const request = await firstRequest();
    expect(request.system).toContain('press_key(Escape)');
    expect(request.tools.map((t) => t.name)).toContain('press_key');
  });

  it('off: the old rule 4, no press_key', async () => {
    process.env.BROWSER_FULL_PAGE_READ = 'false';
    const request = await firstRequest();
    expect(request.system).not.toContain('press_key');
    expect(request.system).toContain('4. 整页登录/验证码，或目标内容被验证墙挡住时');
    expect(request.tools.map((t) => t.name)).not.toContain('press_key');
  });
});

/** 复审 #2 A3: a full-screen mask, a plain box inside it (no position of its own). */
const A3 = `<main><h1>商品详情</h1><input type="search" aria-label="搜索商品"></main>
<div style="position:fixed;inset:0;background:rgba(0,0,0,.5)">
  <div style="margin:10% auto;width:360px;background:#fff">
    <div>短信登录</div>
    <input id="a3-phone" placeholder="请输入">
    <input id="a3-code" placeholder="验证码">
    <span id="a3-send" role="button" onclick="document.body.dataset.sent=1">发送</span>
    <button id="a3-login" onclick="document.body.dataset.login=1">登录</button>
    <span id="a3-close" role="button" aria-label="关闭">×</span>
  </div>
</div>`;
/** 复审 #2 A2: 「账号」 is a sibling's text; a plain box, a password box, 登录 and 下一步. */
const A2 = `<div style="position:fixed;inset:0;background:rgba(0,0,0,.5)">
  <div style="margin:10% auto;width:360px;background:#fff">
    <div><span>账号</span><input id="a2-account"></div>
    <div><span>密码</span><input id="a2-password" type="password"></div>
    <button id="a2-login">登录</button>
    <a id="a2-next" href="#next">下一步</a>
  </div>
</div>`;

describe('FIX-36 复审 #2 #1 · a login box inside a full-screen mask', () => {
  it('A3: the phone box, 「发送」 and 「登录」 are refused; × and the page’s search box are not', async () => {
    const page = await open(A3);
    const { gate, park } = gateFor(page);
    expect(
      await gate(
        {
          tool: 'type',
          ref: await refOf(page, /textbox "请输入"$|textbox "请输入" \[/),
          text: '13800000000',
        },
        'before',
      ),
    ).toMatchObject({ kind: 'skip' });
    for (const name of ['发送', '登录'])
      expect(
        await gate(
          { tool: 'click', ref: await refOf(page, new RegExp(`button "${name}"`)) },
          'before',
        ),
      ).toMatchObject({ kind: 'skip', message: expect.stringContaining('不替用户点击') });
    expect(
      await gate({ tool: 'click', ref: await refOf(page, /button "关闭"/) }, 'before'),
    ).toMatchObject({ kind: 'proceed' });
    expect(
      await gate(
        { tool: 'type', ref: await refOf(page, /searchbox "搜索商品"/), text: '耳机' },
        'before',
      ),
    ).toMatchObject({ kind: 'proceed' });
    expect(park).not.toHaveBeenCalled();
    expect(await page.locator('#a3-phone').inputValue()).toBe('');
    expect(await page.locator('body').getAttribute('data-sent')).toBeNull();
    await page.close();
  });

  it('A2: the account box (named by a sibling), 「登录」 and 「下一步」 are refused', async () => {
    const page = await open(A2);
    const { gate } = gateFor(page);
    const read = (css: string) => page.locator(css).evaluate(readLoginContext, false);
    expect(await read('#a2-account')).toMatchObject({ loginField: true });
    for (const css of ['#a2-login', '#a2-next'])
      expect(await read(css)).toMatchObject({ loginControl: true, loginBlock: true });
    for (const name of ['登录', '下一步'])
      expect(
        await gate(
          { tool: 'click', ref: await refOf(page, new RegExp(`(?:button|link) "${name}"`)) },
          'before',
        ),
      ).toMatchObject({ kind: 'skip' });
    await page.close();
  });
});

describe('FIX-36 复审 #2 #3 · 下一步 / Next / 继续 of a login form', () => {
  it('a step-one login form (account box + Next, no password yet): Next is a login control', async () => {
    const page = await open(
      '<form><label>Email or username <input name="username" autocomplete="username"></label><button type="button" id="next">Next</button><button type="button" id="help">Help</button></form>',
    );
    const read = (css: string) => page.locator(css).evaluate(readLoginContext, false);
    expect(await read('#next')).toMatchObject({ loginControl: true, loginBlock: true });
    expect((await read('#help')).loginControl).toBe(false);
    await page.close();
  });

  it('the user’s own browser: Enter on any button of a login block is refused, Escape is not', () => {
    const element = {
      role: 'button',
      visibleText: '帮助',
      ariaLabel: null,
      title: null,
      placeholder: null,
      name: null,
      inputType: null,
      tagName: 'button',
      loginField: false,
      loginControl: false,
      loginBlock: true,
    };
    const target = {
      token: '00000000-0000-4000-8000-000000000001',
      elementId: '22222222-2222-4222-8222-222222222222',
      objectDigest: 'a'.repeat(64),
      tabId: 3,
      frameId: 'main',
      origin: 'https://fixture.test',
      page: { url: 'https://fixture.test/login', transactional: false },
      observationRevision: 1,
      capturedAt: 1,
      element,
      form: null,
    };
    const enter = describeUserBrowserAction(
      { kind: 'key', payload: { key: 'Enter' } } as never,
      target,
    );
    expect(enter.descriptors[0]).toMatchObject({ credentialForm: true });
    const escaped = describeUserBrowserAction(
      { kind: 'key', payload: { key: 'Escape' } } as never,
      target,
    );
    expect(escaped.descriptors[0]).not.toHaveProperty('credentialForm');
    const click = describeUserBrowserAction({ kind: 'click', selector: {} } as never, {
      ...target,
      element: { ...element, loginControl: true, visibleText: '下一步' },
    });
    expect(classifyRuntimeAction(click.descriptors[0]!)).toMatchObject({ allowed: false });
  });
});

describe('FIX-36 复审 #2 #5 · a page header’s 登录 / 注册 does not make its other boxes login boxes', () => {
  it('the header city box is typed while the probe reports a login popup', async () => {
    const page = await open(
      '<header style="position:fixed;top:0;left:0;right:0;height:60px"><a href="/login">登录</a><a href="/reg">注册</a><input id="city" placeholder="选择城市"></header><main style="margin-top:80px"><p>正文</p></main>',
    );
    expect(await page.locator('#city').evaluate(readLoginContext, true)).toMatchObject({
      loginField: false,
    });
    await page.close();
  });
});

describe('FIX-36 复审 #2 #6 · an extension that does not report login fields', () => {
  it('account words are still refused from the labels alone; a phone box is not', () => {
    const base = { kind: 'type' as const, inputType: 'text', tagName: 'input' };
    expect(classifyRuntimeAction({ ...base, placeholder: '请输入账号' })).toMatchObject({
      allowed: false,
      refuse: expect.any(String),
    });
    expect(classifyRuntimeAction({ ...base, placeholder: '请输入手机号' })).toMatchObject({
      allowed: true,
    });
  });
});

describe('FIX-36 复审 #2 · readLoginContext survives serialisation', () => {
  it('compiled with keepNames (as tsx runs it), its source has no __name helper', async () => {
    const { createRequire } = await import('node:module');
    const tsx = createRequire(import.meta.url).resolve('tsx');
    const { transformSync } = createRequire(tsx)('esbuild') as typeof import('esbuild');
    const { code } = transformSync(
      `${readLoginContext.toString()}\nglobalThis.__compiled = readLoginContext;`,
      { keepNames: true, loader: 'js' },
    );
    new Function(code)();
    const compiled = (globalThis as { __compiled?: () => unknown }).__compiled!;
    expect(compiled.toString()).not.toContain('__name');
    const page = await open(A3);
    expect(await page.locator('#a3-phone').evaluate(compiled as never, false)).toMatchObject({
      loginField: true,
    });
    await page.close();
  });
});
