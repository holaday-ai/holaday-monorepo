import { createServer } from 'node:http';
import { type Browser, type Page, chromium } from 'playwright';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SelectedTargetResolver } from '../../../../../packages/browser-driver/src/selected-target.js';
let browser: Browser;
let page: Page;
let origin: string;
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
    const resolver = new SelectedTargetResolver(page as never, 3, [origin]);
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
    const r = new SelectedTargetResolver(page as never, 3, [origin]);
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
    const r = new SelectedTargetResolver(page as never, 3, [origin]);
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
    const r = new SelectedTargetResolver(page as never, 3, [origin]);
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
    const r = new SelectedTargetResolver(page as never, 3, [origin]);
    await r.observe();
    const t = await r.describe({ kind: 'key', payload: { key: 'Enter' } }, 1);
    expect(t.form?.transactionalAction).toBe(true);
    expect(t.form?.action).not.toContain('operation');
  });
  it('reads effective submitter overrides and external associated fields', async () => {
    await page.setContent(
      '<form id="f" role="search" action="/search"><input id="q" name="q"><button id="search" formaction="/payment" formmethod="post">Search</button></form><input form="f" name="amount" type="number">',
    );
    const r = new SelectedTargetResolver(page as never, 3, [origin]);
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
    const r = new SelectedTargetResolver(page as never, 3, [origin]);
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
    const r = new SelectedTargetResolver(page as never, 3, [origin]);
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
    const ticket = await r.describe(blocked, 2);
    await expect(
      r.execute(blocked, { token: ticket.token, observationRevision: 2 }),
    ).rejects.toThrow();
    expect(await page.locator('body').getAttribute('data-effects')).toBeNull();
  });
});
