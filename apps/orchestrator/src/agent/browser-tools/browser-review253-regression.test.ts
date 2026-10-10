/**
 * REVIEW-PR253 (read-only review harness, not part of the PR).
 * Real Chromium + loopback server; the model is scripted. Mirrors the cloud
 * runner wiring: V2 executor, #248 unified gate (with ref/frame resolution and
 * validate()), runUnifiedBrowserLoop with checkInterruption.
 */
import { appendFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { type Browser, type Page, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { stripTrackingFromUrl } from '../../execution/url-identity.js';
import type { MessagesAdapter, NeutralMessagesRequest } from '../../llm/messages-adapter.js';
import { classifyRuntimeAction } from '../supercar/runtime-action-policy.js';
import { createPlaywrightUnifiedExecutor } from './playwright-unified-executor.js';
import { createUnifiedActionGate } from './unified-action-gate.js';
import { runUnifiedBrowserLoop } from './unified-browser-loop.js';
import type { UnifiedBrowserAction } from './unified-tools.js';

const LOG = process.env.REVIEW_LOG;
const row = (value: Record<string, unknown>) => {
  if (LOG) appendFileSync(LOG, `${JSON.stringify(value)}\n`);
};

let browser: Browser;
let base: string;
const hits: Record<string, number> = {};
const pages: Record<string, string> = {};
const server = createServer((req, res) => {
  const path = (req.url ?? '/').split('?')[0] ?? '/';
  const key = `${req.method} ${path}`;
  hits[key] = (hits[key] ?? 0) + 1;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(pages[path] ?? '<p>ok</p>');
});
const count = (prefix: string) =>
  Object.entries(hits)
    .filter(([key]) => key.includes(prefix))
    .reduce((sum, [, n]) => sum + n, 0);
const reset = () => {
  for (const key of Object.keys(hits)) delete hits[key];
};

beforeAll(async () => {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  browser = await chromium.launch({ headless: true, args: ['--renderer-process-limit=2'] });
}, 60_000);
afterAll(async () => {
  await browser?.close();
  await new Promise<void>((r) => server.close(() => r()));
});

function wire(page: Page, reply: string | null = '不要') {
  const tools = createPlaywrightUnifiedExecutor(page, {
    observationV2: true,
    actionTimeoutMs: 2000,
  });
  let parked = 0;
  const gateAction = async (action: UnifiedBrowserAction, phase: 'before' | 'after') => {
    if (phase === 'before' && tools.observation) {
      try {
        await tools.observation.validate(action);
      } catch {
        return { kind: 'skip' as const, message: 'stale' };
      }
    }
    const targetPage = tools.observation?.resolve(action).page ?? page;
    return createUnifiedActionGate({
      page: targetPage,
      locatorForAction: (a, ref) =>
        tools.observation?.locator(tools.observation.resolve(a).frame, ref) ??
        targetPage.locator(`aria-ref=${ref}`),
      frameForAction: (a) => tools.observation?.resolve(a).frame ?? targetPage.mainFrame(),
      onBeforeAction: classifyRuntimeAction,
      labelForRef: () => null,
      park: async () => {
        parked++;
        return reply;
      },
      aborted: () => false,
    })(action, phase);
  };
  return { tools, gateAction, parked: () => parked };
}

/** Scripted model: each step is (lastToolResultJson) => tool call(s). */
type Step = (
  state: Record<string, unknown> | null,
) => Array<{ name: string; input: Record<string, unknown> }>;
function adapterFor(steps: Step[]) {
  let turn = 0;
  const last = (request: NeutralMessagesRequest) => {
    const content = request.messages.at(-1)?.content;
    if (!content || typeof content === 'string') return null;
    const results = content.filter((b) => b.type === 'tool_result');
    const result = results.at(-1);
    if (!result || result.type !== 'tool_result') return null;
    try {
      return JSON.parse(result.content as string);
    } catch {
      return { raw: result.content };
    }
  };
  return {
    create: async (request: NeutralMessagesRequest) => {
      const step = steps[Math.min(turn++, steps.length - 1)];
      if (!step) throw new Error('missing scripted step');
      return {
        content: step(last(request)).map((call, i) => ({
          type: 'tool_use',
          id: `t${turn}-${i}`,
          name: call.name,
          input: call.input,
        })),
      };
    },
  } as unknown as MessagesAdapter;
}
const refOf = (state: Record<string, unknown> | null, label: string) => {
  const tree = String(state?.tree ?? '');
  const line = tree.split('\n').find((l) => l.includes(label) && /ref=e\d+/.test(l));
  return line?.match(/ref=(e\d+)/)?.[1] ?? 'e0';
};
const ctx = (state: Record<string, unknown> | null) => ({
  observationRevision: state?.observationRevision,
  tabId: state?.tabId,
  frameId: state?.frameId,
});
const read: Step = () => [{ name: 'read_page', input: {} }];
const finish: Step = () => [
  { name: 'finish', input: { status: 'completed', summary: 'done', evidence: 'ok' } },
];

async function scenario(
  name: string,
  html: Record<string, string>,
  first: Step,
  options: { second?: Step; reply?: string | null; start?: string } = {},
) {
  Object.assign(pages, html);
  reset();
  const page = await browser.newPage();
  await page.goto(base + (options.start ?? '/'));
  await page.waitForTimeout(150);
  reset();
  const { tools, gateAction, parked } = wire(page, options.reply ?? '不要');
  const executed: string[] = [];
  try {
    const steps: Step[] = [read, first, ...(options.second ? [read, options.second] : []), finish];
    const result = await runUnifiedBrowserLoop({
      intent: name,
      adapter: adapterFor(steps),
      execute: async (action) => {
        const outcome = await tools.execute(action);
        executed.push(
          `${action.tool}:${outcome.ok ? 'ok' : 'fail'}${outcome.interruption ? ':interrupted' : ''}`,
        );
        return outcome;
      },
      gateAction,
      observationV2: true,
      checkInterruption: () => tools.observation?.interruption(),
      maxSteps: steps.length + 1,
    });
    const value = {
      name,
      status: result.status,
      reason: 'reason' in result ? result.reason : undefined,
      parked: parked(),
      executed,
      orderEffects: count('/order'),
      writes: Object.fromEntries(
        Object.entries(hits).filter(([k]) => !k.startsWith('GET /search') || true),
      ),
    };
    row(value);
    if (name.startsWith('A')) {
      expect(value.status).toBe('awaiting_user');
      expect(value.reason).toBe('unexpected_effect');
      if (/^A[234]/.test(name)) expect(value.orderEffects).toBe(1);
      expect(executed.filter((x) => /^(click|type):ok/.test(x))).toHaveLength(1);
    }
    if (/^B[12356]/.test(name)) {
      expect(value.status).not.toBe('awaiting_user');
      expect(value.reason).not.toBe('unexpected_effect');
      expect(executed.some((x) => x.includes('interrupted'))).toBe(false);
      const expected = name.startsWith('B6') ? 1 : options.second ? 2 : 1;
      expect(executed.filter((x) => /^(click|type|scroll_until):ok/.test(x))).toHaveLength(
        expected,
      );
    }
    return value;
  } finally {
    tools.dispose();
    await page
      .context()
      .close()
      .catch(() => undefined);
  }
}
const typeSubmit: Step = (s) => [
  { name: 'type', input: { ref: refOf(s, 'textbox'), text: '手机', submit: true, ...ctx(s) } },
];
const clickLabel =
  (label: string): Step =>
  (s) => [{ name: 'click', input: { ref: refOf(s, label), ...ctx(s) } }];
const NAV = `<nav><a href="/orders">我的订单</a> <a href="/cart">购物车</a></nav>`;

describe('1. effect verification after the first side effect', () => {
  it('A1 review-3: Enter intercepted by JS and turned into a POST write', async () => {
    const r = await scenario(
      'A1-enter-intercept-post',
      {
        '/': `<form role="search" action="/search"><input name="q" aria-label="搜索词" onkeydown="if(event.key==='Enter'){event.preventDefault();fetch('/order/create',{method:'POST'})}"></form>`,
      },
      typeSubmit,
      { second: clickLabel('textbox') },
    );
    expect(r.orderEffects).toBe(1);
  });
  it('A1b review-3 exact: Enter intercepted, effect with no DOM / network receipt', async () => {
    await scenario(
      'A1b-enter-intercept-no-receipt',
      {
        '/': `<form role="search" action="/search"><input name="q" aria-label="搜索词" onkeydown="if(event.key==='Enter'){event.preventDefault();window.effects=(window.effects||0)+1}"></form>`,
      },
      typeSubmit,
    );
  });
  it('A2 click 搜索 actually POSTs an order', async () => {
    await scenario(
      'A2-search-click-post-order',
      {
        '/': `${NAV}<input aria-label="关键词"><button onclick="fetch('/order/create',{method:'POST'});document.querySelector('p').textContent='已提交'">搜索</button><p></p>`,
      },
      clickLabel('搜索'),
      { second: clickLabel('搜索') },
    );
  });
  it('A3 click 搜索 writes via GET and shows a neutral receipt', async () => {
    await scenario(
      'A3-search-click-get-write-neutral-text',
      {
        '/': `<input aria-label="关键词"><button onclick="fetch('/order/create?sku=1');document.querySelector('p').textContent='操作成功'">搜索</button><p></p>`,
      },
      clickLabel('搜索'),
      { second: clickLabel('搜索') },
    );
  });
  it('A4 click 搜索 writes via image GET; page header already says 我的订单', async () => {
    await scenario(
      'A4-search-click-pixel-write-order-nav',
      {
        '/': `${NAV}<input aria-label="关键词"><button onclick="new Image().src='/order/create?sku=1';document.querySelector('p').textContent='下单成功，订单号 1001'">搜索</button><p></p>`,
      },
      clickLabel('搜索'),
      { second: clickLabel('搜索') },
    );
  });
  it('A5 click 搜索 redirects to /pay; the next 继续 is gated', async () => {
    await scenario(
      'A5-search-redirect-pay-then-continue',
      {
        '/': `<input aria-label="关键词"><button onclick="location.href='/pay?orderId=1'">搜索</button>`,
        '/pay': `<h1>收银台</h1><button onclick="fetch('/order/pay?id=1')">继续</button>`,
      },
      clickLabel('搜索'),
      { second: clickLabel('继续') },
    );
  });
  it('A6 click 搜索 redirects to /cashier; next 下一步 is gated', async () => {
    await scenario(
      'A6-search-redirect-cashier-then-next',
      {
        '/': `<input aria-label="关键词"><button onclick="location.href='/cashier/index?o=1'">搜索</button>`,
        '/cashier/index': `<button onclick="fetch('/order/pay?id=1')">下一步</button>`,
      },
      clickLabel('搜索'),
      { second: clickLabel('下一步') },
    );
  });
});

describe('1b. confirmation / pause rate on ordinary reads', () => {
  it('B1 plain GET search via Enter, then next page', async () => {
    await scenario(
      'B1-plain-get-search-then-next-page',
      {
        '/': `<form role="search" action="/search"><input name="q" aria-label="搜索词"></form>`,
        '/search': `<p>结果 1</p><a href="/search?page=2">下一页</a>`,
      },
      typeSubmit,
      { second: clickLabel('下一页') },
    );
  });
  it('B2 same search, page sends an analytics beacon (POST) on submit', async () => {
    await scenario(
      'B2-get-search-with-analytics-beacon',
      {
        '/': `<form role="search" action="/search" onsubmit="navigator.sendBeacon('/collect','e=search')"><input name="q" aria-label="搜索词"></form>`,
        '/search': `<p>结果 1</p><a href="/search?page=2">下一页</a>`,
      },
      typeSubmit,
      { second: clickLabel('下一页') },
    );
  });
  it('B3 pagination click; result page fires an analytics POST on load', async () => {
    await scenario(
      'B3-next-page-with-load-analytics-post',
      {
        '/': `<p>结果 1</p><a href="/list2">下一页</a>`,
        '/list2': `<script>fetch('/collect',{method:'POST',body:'pv'})</script><p>结果 2</p><a href="/list3">下一页</a>`,
      },
      clickLabel('下一页'),
      { second: clickLabel('下一页') },
    );
  });
  it('B4 ordinary page with a 登录 link in the header: read_page', async () => {
    Object.assign(pages, {
      '/': `<header><a href="/login">登录</a> | <a href="/reg">注册</a></header><h1>商品列表</h1><ul><li>收纳盒 29元</li><li>收纳袋 10元</li></ul>`,
    });
    const page = await browser.newPage();
    await page.goto(base);
    const { tools } = wire(page);
    try {
      const out = JSON.parse((await tools.execute({ tool: 'read_page' })).text);
      const text = JSON.parse((await tools.execute({ tool: 'get_page_text' })).text);
      row({
        name: 'B4-login-link-header-read',
        readRedacted: out.redacted ?? false,
        readTree: String(out.tree).slice(0, 40),
        textRedacted: text.redacted ?? false,
        textHasContent: String(text.text ?? text.tree).includes('收纳盒'),
      });
      expect(out.redacted ?? false).toBe(false);
      expect(String(text.text)).toContain('收纳盒');
      await page.setContent('<header>Sign in</header><h1>Products</h1>');
      const en = JSON.parse((await tools.execute({ tool: 'read_page' })).text);
      row({ name: 'B4b-sign-in-header-read', readRedacted: en.redacted ?? false });
      expect(en.redacted ?? false).toBe(false);
      expect(en.tree).toContain('Products');
    } finally {
      tools.dispose();
      await page.close();
    }
  });
  it('B5 background heartbeat POST does not pause navigation', async () => {
    await scenario(
      'B5-background-heartbeat-post',
      {
        '/': `<script>setInterval(()=>fetch('/heartbeat',{method:'POST'}),200)</script><a href="/search?page=2">下一页</a>`,
        '/search': '<p>结果</p>',
      },
      clickLabel('下一页'),
    );
  });
  it('B6 infinite list that loads via POST (GraphQL-style) with scroll_until', async () => {
    await scenario(
      'B6-scroll-until-post-loader',
      {
        '/': `<ul id="l">${'<li>item</li>'.repeat(30)}</ul><div style="height:2000px"></div><script>addEventListener('scroll',()=>{if(innerHeight+scrollY>document.body.scrollHeight-400)fetch('/graphql',{method:'POST',body:'{list}'}).then(()=>{document.querySelector('#l').insertAdjacentHTML('beforeend','<li>more</li>'.repeat(10))})})</script>`,
      },
      () => [{ name: 'scroll_until', input: { maxSteps: 4, maxMs: 3000 } }],
    );
  });
});

describe('3. read: links identity, page text, secrets', () => {
  it('C links keep accessible URLs byte-for-byte?', async () => {
    const urls = [
      '/s?keyword=%E6%89%8B%E6%9C%BA&page=2',
      '/item?stockCode=600519',
      '/m#/detail/123',
      '/s?q=a%20b&qrcode=1',
      '/sso?ticket=ST-12345-abcdef&next=%2Fhome',
      '/x?auth=abcdef123456&sig=0123456789abcdef',
      '/article?id=42&utm_source=x',
    ];
    Object.assign(pages, {
      '/': urls.map((u, i) => `<a href="${u}">L${i}</a><br>`).join(''),
    });
    const page = await browser.newPage();
    await page.goto(base);
    const { tools } = wire(page);
    try {
      const result = await tools.execute({ tool: 'links', limit: 50 });
      const out = JSON.parse(result.text);
      urls.forEach((u, i) => {
        if (i === 4 || i === 5) {
          expect(out.items[i]?.containsSensitiveParameters).toBe(true);
          expect(out.items[i]?.url).toContain('[redacted]');
          expect(result.links).toContain(stripTrackingFromUrl(base + u));
        } else {
          expect(out.items[i]?.url).toBe(stripTrackingFromUrl(base + u));
          expect(result.links).toContain(stripTrackingFromUrl(base + u));
        }
        row({
          name: `C-link-${i}`,
          href: base + u,
          urlIdentity: stripTrackingFromUrl(base + u),
          links: out.items[i]?.url,
          inSources: (result.links ?? []).includes(out.items[i]?.url),
        });
      });
    } finally {
      tools.dispose();
      await page.close();
    }
  });
  it('D get_page_text ranges, end marker and one-shot cursors', async () => {
    Object.assign(pages, { '/': `<pre>${'a'.repeat(1000)}</pre>` });
    const page = await browser.newPage();
    await page.goto(base);
    const { tools } = wire(page);
    try {
      const chunks = [];
      let cursor: string | undefined;
      for (let i = 0; i < 4; i++) {
        const out = JSON.parse(
          (
            await tools.execute({
              tool: 'get_page_text',
              maxChars: 400,
              ...(cursor ? { cursor } : {}),
            })
          ).text,
        );
        chunks.push({
          range: out.range,
          end: out.end,
          truncated: out.truncated,
          cursor: Boolean(out.cursor),
          len: out.text.length,
        });
        if (!out.cursor) break;
        cursor = out.cursor;
      }
      const reused = await tools.execute({ tool: 'get_page_text', cursor: cursor ?? 'x' });
      row({ name: 'D-page-text-chunks', chunks, reusedCursorOk: reused.ok });
      expect(chunks.map((c) => c.range)).toEqual([
        [0, 400],
        [400, 800],
        [800, 1000],
      ]);
      expect(chunks.map((c) => c.end)).toEqual([false, false, true]);
      expect(reused.ok).toBe(false);
    } finally {
      tools.dispose();
      await page.close();
    }
  });
  it('E secrets: cookie, password value, token-like field, auth header', async () => {
    Object.assign(pages, {
      '/': `<script>document.cookie='sid=COOKIE_SECRET_123'</script><h1>设置</h1><label>API 令牌<input name="apitoken" value="TOKEN_SECRET_456"></label><a href="/next">下一页</a>`,
      '/pwd': `<h1>账户</h1><label>新密码<input type="password" value="PASSWORD_SECRET_789"></label>`,
    });
    const page = await browser.newPage();
    await page.setExtraHTTPHeaders({ Authorization: 'Bearer AUTH_SECRET_000' });
    await page.goto(base);
    const { tools } = wire(page);
    try {
      const outputs: string[] = [];
      for (const tool of ['read_page', 'get_page_text', 'links', 'tables', 'list_tabs'] as const)
        outputs.push((await tools.execute({ tool } as UnifiedBrowserAction)).text);
      const state = JSON.parse(outputs[0] ?? '{}');
      const acted = await tools.execute({
        tool: 'click',
        ref: refOf(state, '下一页'),
        observationRevision: state.observationRevision,
      });
      outputs.push(acted.text, JSON.stringify(acted.effect ?? {}));
      await page.goto(`${base}/pwd`);
      for (const tool of ['read_page', 'get_page_text'] as const)
        outputs.push((await tools.execute({ tool } as UnifiedBrowserAction)).text);
      const all = outputs.join('\n');
      for (const secret of ['COOKIE_SECRET_123', 'AUTH_SECRET_000', 'PASSWORD_SECRET_789'])
        expect(all).not.toContain(secret);
      row({
        name: 'E-secrets',
        cookie: all.includes('COOKIE_SECRET_123'),
        auth: all.includes('AUTH_SECRET_000'),
        password: all.includes('PASSWORD_SECRET_789'),
        tokenField: all.includes('TOKEN_SECRET_456'),
      });
    } finally {
      tools.dispose();
      await page.close();
    }
  });
});

describe('5. flag off keeps the old executor', () => {
  it('F V1 executor: new tools unavailable, snapshot/click unchanged', async () => {
    Object.assign(pages, { '/': '<button onclick="document.body.dataset.x=1">搜索</button>' });
    const page = await browser.newPage();
    await page.goto(base);
    const tools = createPlaywrightUnifiedExecutor(page, { actionTimeoutMs: 2000 });
    try {
      const snap = await tools.execute({ tool: 'snapshot' });
      const ref = snap.text.match(/button "搜索" \[ref=(e\d+)\]/)?.[1] ?? 'e0';
      const clicked = await tools.execute({ tool: 'click', ref });
      const v2tool = await tools.execute({ tool: 'read_page' });
      expect(tools.observation).toBeNull();
      expect(clicked.ok).toBe(true);
      expect(clicked.effect).toBeUndefined();
      expect(v2tool.text).toContain('capability_missing');
      row({
        name: 'F-flag-off',
        observation: tools.observation === null,
        clicked: clicked.ok && (await page.locator('body').getAttribute('data-x')) === '1',
        readPage: v2tool.text,
        effect: clicked.effect ?? null,
      });
    } finally {
      tools.dispose();
      await page.close();
    }
  });
});

describe('pre-existing check on the old (flag-off) snapshot path', () => {
  it('G V1 snapshot: token-like field value and SSO ticket links', async () => {
    Object.assign(pages, {
      '/': `<label>API 令牌<input name="apitoken" value="TOKEN_SECRET_456"></label><a href="/sso?ticket=ST-12345-abcdef">SSO</a><a href="/s?keyword=%E6%89%8B%E6%9C%BA">K</a>`,
    });
    const page = await browser.newPage();
    await page.goto(base);
    const tools = createPlaywrightUnifiedExecutor(page, { actionTimeoutMs: 2000 });
    try {
      const snap = await tools.execute({ tool: 'snapshot' });
      const extract = await tools.execute({ tool: 'extract', instruction: 'links' });
      const all = [snap.text, extract.text, JSON.stringify(snap.links ?? [])].join('\n');
      row({
        name: 'G-v1-preexisting',
        tokenField: all.includes('TOKEN_SECRET_456'),
        ticket: all.includes('ST-12345-abcdef'),
        keywordKept: all.includes('keyword=%E6%89%8B%E6%9C%BA'),
      });
    } finally {
      tools.dispose();
      await page.close();
    }
  });
});
