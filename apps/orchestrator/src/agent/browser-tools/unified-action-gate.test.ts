import { type Browser, type Page, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { classifyRuntimeAction } from '../supercar/runtime-action-policy.js';
import { createUnifiedActionGate, describeUnifiedAction } from './unified-action-gate.js';
import { runUnifiedBrowserLoop } from './unified-browser-loop.js';
import type { UnifiedBrowserAction } from './unified-tools.js';

/**
 * PR #248 review — the gate must fail closed: a write target it cannot read,
 * a frame it cannot see into, or an Enter that submits a payment form all
 * need the user's confirmation, and a cancel during that wait always wins.
 * Each case asserts the confirmation count and the real DOM effect.
 */

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
}, 60_000);
afterAll(async () => {
  await browser?.close();
});

function gateFor(page: Page, reply: string | null = '不要') {
  const park = vi.fn(async () => reply);
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

async function refOf(page: Page, pattern: RegExp): Promise<string> {
  const tree = await page.locator('body').ariaSnapshot({ mode: 'ai' } as never);
  const ref = tree
    .split('\n')
    .find((line) => pattern.test(line))
    ?.match(/\[ref=(\w+)\]/)?.[1];
  if (!ref) throw new Error(`no ref for ${pattern} in ${tree}`);
  return ref;
}

const IFRAME = (label: string) =>
  `<iframe style="width:400px;height:200px;border:8px solid #ccc;padding:6px" srcdoc="<button style='width:300px;height:80px' onclick='window.hits=(window.hits||0)+1'>${label}</button>"></iframe>`;

describe('frames and real click targets', () => {
  it.each(['确认支付', '删除项目'])(
    'parks a coordinate click on an iframe "%s" button and does not click',
    async (label) => {
      const page = await browser.newPage();
      await page.setContent(IFRAME(label));
      const frame = page.frames()[1];
      const box = await frame?.locator('button').boundingBox();
      if (!frame || !box) throw new Error('fixture frame missing');
      const action: UnifiedBrowserAction = { tool: 'click_at', x: box.x + 20, y: box.y + 20 };
      const description = await describeUnifiedAction(page, action, () => null);
      expect(description.descriptors[0]).toMatchObject({ label, tagName: 'button' });
      const { gate, park } = gateFor(page);
      const decision = await gate(action, 'before');
      expect(park).toHaveBeenCalledWith(expect.stringContaining(label), 'browser_action');
      expect(decision).toMatchObject({ kind: 'stop', outcome: { status: 'cancelled' } });
      expect(await frame.evaluate(() => (window as { hits?: number }).hits ?? 0)).toBe(0);
      await page.close();
    },
    60_000,
  );

  it('reads an icon-only button through its actionable ancestor', async () => {
    const page = await browser.newPage();
    await page.setContent(
      `<button aria-label="删除项目" style="width:120px;height:60px" onclick="window.hits=1"><svg width="40" height="40"><rect width="40" height="40"/></svg></button>`,
    );
    const { gate, park } = gateFor(page);
    await gate({ tool: 'click_at', x: 60, y: 30 }, 'before');
    expect(park).toHaveBeenCalledWith(expect.stringContaining('删除项目'), 'browser_action');
    expect(await page.evaluate(() => (window as { hits?: number }).hits ?? 0)).toBe(0);
    await page.close();
  }, 60_000);

  it('asks for confirmation when the target cannot be read', async () => {
    const page = await browser.newPage();
    await page.setContent('<p>空白页面</p>');
    // Outside the viewport: no element can be identified at the point.
    const { gate, park } = gateFor(page);
    const decision = await gate({ tool: 'click_at', x: 5_000, y: 5_000 }, 'before');
    expect(park).toHaveBeenCalledWith(expect.stringContaining('无法识别'), 'browser_action');
    expect(decision).toMatchObject({ kind: 'stop' });
    await page.close();
  }, 60_000);

  it('lets an ordinary readable click through without asking', async () => {
    const page = await browser.newPage();
    await page.setContent('<button onclick="window.hits=1">搜索</button>');
    const { gate, park } = gateFor(page);
    const ref = await refOf(page, /button "搜索"/);
    expect(await gate({ tool: 'click', ref }, 'before')).toEqual({ kind: 'proceed' });
    expect(park).not.toHaveBeenCalled();
    await page.close();
  }, 60_000);
});

describe('implicit form submission (Enter)', () => {
  const submitCase = async (html: string, field: RegExp) => {
    const page = await browser.newPage();
    await page.setContent(html);
    const ref = await refOf(page, field);
    const { gate, park } = gateFor(page);
    const decision = await gate({ tool: 'type', ref, text: '1', submit: true }, 'before');
    const submits = await page.evaluate(() => (window as { submits?: number }).submits ?? 0);
    await page.close();
    return { decision, park, submits };
  };
  const counter = `onsubmit="event.preventDefault();window.submits=(window.submits||0)+1"`;

  it('parks Enter in a button-less payment form (action=/payment)', async () => {
    const { decision, park, submits } = await submitCase(
      `<form action="/payment" ${counter}><label>金额<input type="text"></label></form>`,
      /textbox "金额"/,
    );
    expect(park).toHaveBeenCalledWith(expect.stringContaining('付款'), 'browser_action');
    expect(decision).toMatchObject({ kind: 'stop' });
    expect(submits).toBe(0);
  }, 60_000);

  it('parks Enter in a form with no submit control and no signals', async () => {
    const { decision, park } = await submitCase(
      `<form ${counter}><input aria-label="内容"></form>`,
      /textbox "内容"/,
    );
    expect(park).toHaveBeenCalledWith(
      expect.stringContaining('无法确认回车会提交什么'),
      'browser_action',
    );
    expect(decision).toMatchObject({ kind: 'stop' });
  }, 60_000);

  it('parks Enter when the form has an amount field even with a neutral button', async () => {
    const { park } = await submitCase(
      `<form action="/next" ${counter}><label>转账金额<input type="number"></label><button>下一步</button></form>`,
      /spinbutton "转账金额"/,
    );
    expect(park).toHaveBeenCalledTimes(1);
  }, 60_000);

  it('lets a search box submit without asking', async () => {
    const { decision, park } = await submitCase(
      `<form role="search" action="/search" ${counter}><input type="search" aria-label="搜索商品"></form>`,
      /searchbox "搜索商品"/,
    );
    expect(park).not.toHaveBeenCalled();
    expect(decision).toEqual({ kind: 'proceed' });
  }, 60_000);
});

describe('confirmation never outranks a cancel', () => {
  const DELETE = `<button style="position:absolute;left:10px;top:10px;width:180px;height:80px" onclick="window.deletes=(window.deletes||0)+1">删除项目</button>`;

  it('does not run a confirmed action when the task was cancelled while parked', async () => {
    const page = await browser.newPage();
    await page.setContent(DELETE);
    const controller = new AbortController();
    let effects = 0;
    const gate = createUnifiedActionGate({
      page,
      onBeforeAction: classifyRuntimeAction,
      labelForRef: () => null,
      park: async () => {
        controller.abort();
        return '确认执行';
      },
      aborted: () => controller.signal.aborted,
    });
    const outcome = await runUnifiedBrowserLoop({
      intent: 'synthetic',
      maxSteps: 1,
      signal: controller.signal,
      adapter: {
        metadata: { provider: 'anthropic', model: 'fixed' },
        create: async () => ({
          id: '1',
          metadata: { provider: 'anthropic', model: 'fixed' },
          content: [{ type: 'tool_use', id: 'a', name: 'click_at', input: { x: 20, y: 20 } }],
          stopReason: 'tool_use',
          usage: {
            inputTokens: 1,
            outputTokens: 1,
            cacheReadInputTokens: null,
            cacheCreationInputTokens: null,
            complete: true,
          },
        }),
      },
      gateAction: gate,
      execute: async () => {
        effects += 1;
        await page.mouse.click(20, 20);
        return { ok: true, text: 'effect' };
      },
    });
    expect(outcome.status).toBe('cancelled');
    expect(effects).toBe(0);
    expect(await page.evaluate(() => (window as { deletes?: number }).deletes ?? 0)).toBe(0);
    await page.close();
  }, 60_000);

  it('re-checks task liveness (lease/cancel) after the confirmation', async () => {
    const page = await browser.newPage();
    await page.setContent(DELETE);
    const gate = createUnifiedActionGate({
      page,
      onBeforeAction: classifyRuntimeAction,
      labelForRef: () => null,
      park: async () => '确认执行',
      aborted: () => false,
      stillLive: async () => false,
    });
    expect(await gate({ tool: 'click_at', x: 20, y: 20 }, 'before')).toMatchObject({
      kind: 'stop',
      outcome: { status: 'cancelled' },
    });
    await page.close();
  }, 60_000);

  it('does not run a confirmation for a target that changed while parked', async () => {
    const page = await browser.newPage();
    await page.setContent(DELETE);
    const gate = createUnifiedActionGate({
      page,
      onBeforeAction: classifyRuntimeAction,
      labelForRef: () => null,
      park: async () => {
        await page.setContent(
          '<button style="position:absolute;left:10px;top:10px;width:180px;height:80px">清空回收站</button>',
        );
        return '确认执行';
      },
      aborted: () => false,
    });
    expect(await gate({ tool: 'click_at', x: 20, y: 20 }, 'before')).toMatchObject({
      kind: 'skip',
      message: expect.stringContaining('页面已变化'),
    });
    await page.close();
  }, 60_000);

  it('runs the confirmed action when nothing changed', async () => {
    const page = await browser.newPage();
    await page.setContent(DELETE);
    const { gate, park } = gateFor(page, '确认执行');
    expect(await gate({ tool: 'click_at', x: 20, y: 20 }, 'before')).toEqual({ kind: 'proceed' });
    expect(park).toHaveBeenCalledTimes(1);
    await page.close();
  }, 60_000);
});

describe('shadow DOM targets (PR #248 review 2, P1-1)', () => {
  const host = (mode: 'open' | 'closed', inner: string) =>
    `<div id="host" style="position:absolute;left:10px;top:10px;width:300px;height:80px"></div>
     <script>document.querySelector('#host').attachShadow({mode:'${mode}'}).innerHTML=${JSON.stringify(inner)}</script>`;
  const PAY = `<button style='width:300px;height:80px' onclick='window.effects=1'>确认支付</button>`;

  it.each(['open', 'closed'] as const)(
    'reads the real "确认支付" button inside a %s shadow root and parks',
    async (mode) => {
      const page = await browser.newPage();
      await page.setContent(host(mode, PAY));
      const { gate, park } = gateFor(page);
      const decision = await gate({ tool: 'click_at', x: 30, y: 30 }, 'before');
      expect(park).toHaveBeenCalledWith(expect.stringContaining('确认支付'), 'browser_action');
      expect(decision).toMatchObject({ kind: 'stop' });
      expect(await page.evaluate(() => (window as { effects?: number }).effects ?? 0)).toBe(0);
      await page.close();
    },
    60_000,
  );

  it('reads through nested shadow roots and climbs out of them to the actionable host', async () => {
    const page = await browser.newPage();
    // An icon in an inner shadow root, inside a button that lives in an outer one.
    await page.setContent(
      host(
        'open',
        `<button aria-label="删除项目" style="width:300px;height:80px"><x-icon id="i"></x-icon></button>`,
      ),
    );
    await page.evaluate(() => {
      const outer = document.querySelector('#host')?.shadowRoot;
      const icon = outer?.querySelector('#i');
      icon
        ?.attachShadow({ mode: 'closed' })
        .append(Object.assign(document.createElement('span'), { textContent: '🗑' }));
    });
    const { gate, park } = gateFor(page);
    await gate({ tool: 'click_at', x: 30, y: 30 }, 'before');
    expect(park).toHaveBeenCalledWith(expect.stringContaining('删除项目'), 'browser_action');
    await page.close();
  }, 60_000);

  it('treats a custom element whose internals cannot be read as unverified', async () => {
    const page = await browser.newPage();
    await page.setContent('<x-pay style="display:block;width:300px;height:80px"></x-pay>');
    const description = await describeUnifiedAction(
      page,
      { tool: 'click_at', x: 30, y: 30 },
      () => null,
    );
    expect(description.unverified).toContain('无法读取内部内容');
    await page.close();
  }, 60_000);
});

describe('a confirmation is bound to the real node and object (PR #248 review 2, P1-2)', () => {
  it('does not run the confirmation for a same-position, same-name replacement', async () => {
    const page = await browser.newPage();
    await page.setContent(
      `<button id="a" style="position:absolute;left:10px;top:10px;width:300px;height:80px" onclick="window.effects=1">删除项目</button>`,
    );
    const gate = createUnifiedActionGate({
      page,
      onBeforeAction: classifyRuntimeAction,
      labelForRef: () => null,
      aborted: () => false,
      park: async () => {
        await page.evaluate(() => {
          const old = document.querySelector('button');
          if (old)
            old.outerHTML = `<button id="b" style="position:absolute;left:10px;top:10px;width:300px;height:80px" onclick="window.effects=2">删除项目</button>`;
        });
        return '确认执行';
      },
    });
    expect(await gate({ tool: 'click_at', x: 30, y: 30 }, 'before')).toMatchObject({
      kind: 'skip',
      message: expect.stringContaining('页面已变化'),
    });
    expect(await page.evaluate(() => (window as { effects?: number }).effects ?? 0)).toBe(0);
    await page.close();
  }, 60_000);

  it('does not run it when the same link node now points elsewhere', async () => {
    const page = await browser.newPage();
    await page.setContent(
      `<a id="l" href="/project/1/delete" style="position:absolute;left:10px;top:10px;width:300px;height:80px;display:block">删除项目</a>`,
    );
    const ref = await refOf(page, /link "删除项目"/);
    const gate = createUnifiedActionGate({
      page,
      onBeforeAction: classifyRuntimeAction,
      labelForRef: () => null,
      aborted: () => false,
      park: async () => {
        await page.evaluate(() =>
          document.querySelector('#l')?.setAttribute('href', '/project/2/delete'),
        );
        return '确认执行';
      },
    });
    expect(await gate({ tool: 'click', ref }, 'before')).toMatchObject({ kind: 'skip' });
    await page.close();
  }, 60_000);

  it('does not run an Enter whose form action changed while parked', async () => {
    const page = await browser.newPage();
    await page.setContent(
      `<form id="f" action="/payment/1"><label>金额<input type="text"></label></form>`,
    );
    const ref = await refOf(page, /textbox "金额"/);
    const gate = createUnifiedActionGate({
      page,
      onBeforeAction: classifyRuntimeAction,
      labelForRef: () => null,
      aborted: () => false,
      park: async () => {
        await page.evaluate(() =>
          document.querySelector('#f')?.setAttribute('action', '/payment/2'),
        );
        return '确认执行';
      },
    });
    expect(await gate({ tool: 'type', ref, text: '1', submit: true }, 'before')).toMatchObject({
      kind: 'skip',
    });
    await page.close();
  }, 60_000);

  it('still runs a confirmed action whose node and object are unchanged', async () => {
    const page = await browser.newPage();
    await page.setContent(
      `<a id="l" href="/project/1/delete" style="position:absolute;left:10px;top:10px;width:300px;height:80px;display:block">删除项目</a>`,
    );
    const ref = await refOf(page, /link "删除项目"/);
    const { gate, park } = gateFor(page, '确认执行');
    expect(await gate({ tool: 'click', ref }, 'before')).toEqual({ kind: 'proceed' });
    expect(park).toHaveBeenCalledTimes(1);
    await page.close();
  }, 60_000);
});
