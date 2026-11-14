import { createServer } from 'node:http';
import { type Browser, type CDPSession, type Page, chromium } from 'playwright';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SelectedTargetResolver } from '../../../../../packages/browser-driver/src/selected-target.js';
let browser: Browser;
let page: Page;
let origin: string;
let session: CDPSession;
// The extension sends these over chrome.debugger, which returns objects with
// sorted keys; mirror that so comparisons cannot depend on key order.
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
const server = createServer((_req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.end('<html><body>fixture</body></html>');
});
const selector = (value: string) => ({
  scope: { timeoutMs: 2000 },
  selfHeal: false,
  description: 'model says Search',
  strategies: [{ kind: 'css' as const, value }],
});
beforeAll(async () => {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  browser = await chromium.launch({ args: ['--renderer-process-limit=2'] });
  page = await browser.newPage();
  session = await page.context().newCDPSession(page);
});
afterAll(async () => {
  await browser?.close();
  await new Promise<void>((r) => server.close(() => r()));
});
beforeEach(async () => {
  await page.goto(origin);
});
describe('real target tickets in Chromium', () => {
  it('reads actual text/form, never the model hint; consumes once', async () => {
    await page.setContent(
      '<button id="go" onclick="document.body.dataset.effects=1">搜索</button>',
    );
    const resolver = new SelectedTargetResolver(page as never, 3, [origin], cdp);
    await resolver.observe();
    const action = { kind: 'click' as const, selector: selector('#go') };
    const target = await resolver.describe(action, 1);
    expect(target.element.visibleText).toBe('搜索');
    expect(target.origin).toBe(origin);
    expect(target.form).toBeNull();
    await resolver.execute(action, { token: target.token, observationRevision: 1 });
    expect(await page.locator('body').getAttribute('data-effects')).toBe('1');
    await expect(
      resolver.execute(action, { token: target.token, observationRevision: 1 }),
    ).rejects.toThrow();
  });
  it('rejects ambiguous, missing and stale targets with zero effects', async () => {
    await page.setContent('<button>搜索</button><button>搜索</button>');
    const r = new SelectedTargetResolver(page as never, 3, [origin], cdp);
    await r.observe();
    await expect(r.describe({ kind: 'click', selector: selector('button') }, 1)).rejects.toThrow(
      'target_ambiguous',
    );
    await expect(r.describe({ kind: 'click', selector: selector('#missing') }, 1)).rejects.toThrow(
      'target_missing',
    );
    const a = { kind: 'click' as const, selector: selector('button:first-child') };
    const t = await r.describe(a, 1);
    await page
      .locator('button')
      .first()
      .evaluate((el) => {
        el.textContent = '确认支付';
      });
    await expect(r.execute(a, { token: t.token, observationRevision: 1 })).rejects.toThrow(
      'stale_observation',
    );
  });
  it('describes iframe and open shadow controls, denies ungranted frames', async () => {
    await page.setContent(
      '<iframe srcdoc="<button id=inside>删除项目</button>"></iframe><div id=host></div>',
    );
    await page.locator('#host').evaluate((el) => {
      el.attachShadow({ mode: 'open' }).innerHTML = '<button id="shadow">搜索</button>';
    });
    const r = new SelectedTargetResolver(page as never, 3, [origin], cdp);
    await r.observe();
    expect(
      (await r.describe({ kind: 'click', selector: selector('#inside') }, 1)).element.visibleText,
    ).toBe('删除项目');
    expect(
      (await r.describe({ kind: 'click', selector: selector('#shadow') }, 1)).element.visibleText,
    ).toBe('搜索');
  });
  it('Enter reads deep focused element and payment form without a submit control', async () => {
    await page.setContent(
      '<form action="/payment" method="post"><label>转账金额<input id="amount" name="amount" type="number"></label></form>',
    );
    await page.locator('input').focus();
    const r = new SelectedTargetResolver(page as never, 3, [origin], cdp);
    await r.observe();
    const t = await r.describe({ kind: 'key', payload: { key: 'Enter' } }, 1);
    expect(t.element.tagName).toBe('input');
    expect(t.form?.action).toBe(`${origin}/payment`);
    expect(t.form?.hasAmountField).toBe(true);
    expect(t.form?.method).toBe('post');
  });
  it('keeps transactional meaning when form action query is redacted', async () => {
    await page.setContent(
      '<form action="/api?operation=delete" role="search"><input id="query" name="q"></form>',
    );
    await page.locator('input').focus();
    const r = new SelectedTargetResolver(page as never, 3, [origin], cdp);
    await r.observe();
    const t = await r.describe({ kind: 'key', payload: { key: 'Enter' } }, 1);
    expect(t.form?.transactionalAction).toBe(true);
    expect(t.form?.action).not.toContain('operation');
  });
  it('reads effective submitter overrides and external associated fields', async () => {
    await page.setContent(
      '<form id="f" role="search" action="/search"><input id="q" name="q"><button id="search" formaction="/payment" formmethod="post">Search</button></form><input form="f" name="amount" type="number">',
    );
    const r = new SelectedTargetResolver(page as never, 3, [origin], cdp);
    await r.observe();
    const clicked = await r.describe({ kind: 'click', selector: selector('#search') }, 1);
    expect(clicked.form).toMatchObject({
      action: `${origin}/payment`,
      method: 'post',
      transactionalAction: true,
      hasAmountField: true,
      searchLike: false,
    });
    await page.locator('#q').focus();
    const keyed = await r.describe({ kind: 'key', payload: { key: 'Enter' } }, 1);
    expect(keyed.form).toEqual(clicked.form);
  });
  it('new observation revokes old tickets and redirects require a grant', async () => {
    await page.setContent('<button>Search</button>');
    const r = new SelectedTargetResolver(page as never, 3, [origin], cdp);
    await r.observe();
    const a = { kind: 'click' as const, selector: selector('button') };
    const t = await r.describe(a, 1);
    await r.observe();
    await expect(r.execute(a, { token: t.token, observationRevision: 1 })).rejects.toThrow();
    await page.goto(origin.replace('127.0.0.1', 'localhost'));
    await expect(r.observe()).rejects.toThrow('origin_grant_required');
  });
  it('binds shadow node identity and redacted action query; blocks pointer-events retargeting', async () => {
    await page.setContent('<div id="host"></div>');
    await page.locator('#host').evaluate((el) => {
      el.attachShadow({ mode: 'open' }).innerHTML = '<a id="link" href="/delete?id=1">删除</a>';
    });
    const r = new SelectedTargetResolver(page as never, 3, [origin], cdp);
    await r.observe();
    const action = { kind: 'click' as const, selector: selector('#link'), deadlineMs: 100 };
    const first = await r.describe(action, 1);
    await page.locator('#link').evaluate((el) => el.setAttribute('href', '/delete?id=2'));
    const second = await r.describe(action, 1);
    expect(second.elementId).toBe(first.elementId);
    expect(second.objectDigest).not.toBe(first.objectDigest);
    await page.locator('#link').evaluate((el) => el.replaceWith(el.cloneNode(true)));
    const replacement = await r.describe(action, 1);
    expect(replacement.elementId).not.toBe(second.elementId);
    await page.setContent(
      '<button id="behind" onclick="document.body.dataset.effects=1" style="position:absolute;inset:0">删除</button><button id="front" style="position:absolute;inset:0;pointer-events:none">Search</button>',
    );
    await r.observe();
    const blocked = { kind: 'click' as const, selector: selector('#front'), deadlineMs: 100 };
    // The click would land on #behind: never described as the selected #front.
    await expect(r.describe(blocked, 2)).rejects.toThrow('target_obscured');
    expect(await page.locator('body').getAttribute('data-effects')).toBeNull();
  });
});

describe('the described target is what the click or key actually hits (FIX-PR250)', () => {
  const shadowPay = (mode: 'open' | 'closed', nested = false) =>
    `<div id="host" style="position:absolute;left:10px;top:10px;width:220px;height:80px"></div>
<script>
  const inner = '<button style="width:220px;height:80px" onclick="document.body.dataset.effects=(+document.body.dataset.effects||0)+1">确认支付</button>';
  const root = document.querySelector('#host').attachShadow({ mode: '${mode}' });
  if (${nested}) {
    root.innerHTML = '<div id="inner-host" style="width:220px;height:80px"></div>';
    root.querySelector('#inner-host').attachShadow({ mode: 'closed' }).innerHTML = inner;
  } else root.innerHTML = inner;
</script>`;
  it.each([
    ['open', false],
    ['closed', false],
    ['open + nested closed', true],
  ] as const)('a %s shadow host reads as its inner payment button', async (label, nested) => {
    await page.setContent(shadowPay(label.startsWith('open') ? 'open' : 'closed', nested));
    const r = new SelectedTargetResolver(page as never, 3, [origin], cdp);
    await r.observe();
    const action = { kind: 'click' as const, selector: selector('#host') };
    const target = await r.describe(action, 1);
    expect(target.element).toMatchObject({
      visibleText: '确认支付',
      role: 'button',
      tagName: 'button',
    });
    // Execution clicks the same point and lands on that same button.
    await r.execute(action, { token: target.token, observationRevision: 1 });
    expect(await page.locator('body').getAttribute('data-effects')).toBe('1');
  });
  it('reads the button beneath a pointer-events:none overlay; an intercepting overlay is obscured', async () => {
    await page.setContent(
      `<button id="pay" style="width:220px;height:80px">确认支付</button>
<div id="tip" style="position:absolute;left:8px;top:8px;width:220px;height:80px;pointer-events:none">提示</div>`,
    );
    const r = new SelectedTargetResolver(page as never, 3, [origin], cdp);
    await r.observe();
    expect(
      (await r.describe({ kind: 'click', selector: selector('#pay') }, 1)).element.visibleText,
    ).toBe('确认支付');
    await page.locator('#tip').evaluate((el) => {
      (el as HTMLElement).style.pointerEvents = 'auto';
    });
    await r.observe();
    await expect(r.describe({ kind: 'click', selector: selector('#pay') }, 2)).rejects.toThrow(
      'target_obscured',
    );
  });
  it('a click landing in a cross-origin frame inside the selection is unreadable', async () => {
    const other = origin.replace('127.0.0.1', 'localhost');
    await page.setContent(
      `<div id="box" style="width:300px;height:150px"><iframe src="${other}/" style="width:300px;height:150px;border:0"></iframe></div>`,
    );
    await page.frames()[1]?.waitForLoadState();
    const r = new SelectedTargetResolver(page as never, 3, [origin], cdp);
    await r.observe();
    // In-process: the hit is in the frame's document, outside the selection;
    // out-of-process: hit testing stops at the frame element. Never described.
    await expect(r.describe({ kind: 'click', selector: selector('#box') }, 1)).rejects.toThrow(
      /target_(?:unreadable|obscured)/,
    );
    await page.setContent(
      '<div id="box" style="width:300px;height:150px"><object style="width:300px;height:150px"></object></div>',
    );
    await r.observe();
    await expect(r.describe({ kind: 'click', selector: selector('#box') }, 2)).rejects.toThrow(
      'target_unreadable',
    );
  });
  it('Enter reads the focused button inside a closed shadow root, not its host', async () => {
    await page.setContent(shadowPay('closed'));
    await page.mouse.click(30, 30);
    await page.evaluate(() => {
      document.body.dataset.effects = '0';
    });
    const r = new SelectedTargetResolver(page as never, 3, [origin], cdp);
    await r.observe();
    const action = { kind: 'key' as const, payload: { key: 'Enter' } };
    const target = await r.describe(action, 1);
    expect(target.element).toMatchObject({ visibleText: '确认支付', tagName: 'button' });
  });
  it('binds the redacted page path and transaction context; a path change blocks execution', async () => {
    await page.goto(`${origin}/checkout?coupon=SECRET#step`);
    await page.setContent(
      '<button id="next" type="button" onclick="document.body.dataset.effects=1">继续</button>',
    );
    const r = new SelectedTargetResolver(page as never, 3, [origin], cdp);
    await r.observe();
    const action = { kind: 'click' as const, selector: selector('#next') };
    const target = await r.describe(action, 1);
    expect(target.page).toEqual({ url: `${origin}/checkout`, transactional: true });
    await page.evaluate(() => history.pushState(null, '', '/other'));
    await expect(
      r.execute(action, { token: target.token, observationRevision: 1 }),
    ).rejects.toThrow('target_changed');
    expect(await page.locator('body').getAttribute('data-effects')).toBeNull();
    await page.goto(`${origin}/list?step=payment`);
    await page.setContent('<button id="next">继续</button>');
    await r.observe();
    expect((await r.describe(action, 2)).page).toEqual({
      url: `${origin}/list`,
      transactional: true,
    });
    await page.goto(`${origin}/list?q=shoes`);
    await page.setContent('<button id="next">下一页</button>');
    await r.observe();
    expect((await r.describe(action, 3)).page).toEqual({
      url: `${origin}/list`,
      transactional: false,
    });
  });
});
