import { type Browser, type Page, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { classifyRuntimeAction } from '../supercar/runtime-action-policy.js';
import { assessCompletionFacts } from './completion-fields.js';
import { createUnifiedActionGate } from './unified-action-gate.js';

/**
 * GOAL2 H4 — FIX-62 候选:
 * - Q-6 #3: a consent box drawn as a plain element, with no checkbox semantics and no text of its
 *   own (the agreement sentence sits beside it), was clicked through the consent gate.
 * - G2i bbc: 「标题是：X」 was read as 是 then the value 「：X」, a false 未核实 line.
 */
const PAGE = `<!doctype html><meta charset="utf-8"><title>Sign up</title>
<style>i{display:inline-block;width:16px;height:16px;border:1px solid #333;margin-right:6px}</style>
<div class="agree-row"><i id="agree" class="agree-check"></i><span>我已阅读并同意《用户协议》和《隐私政策》</span></div>
<div class="agree-row"><i id="ticked" class="agree-check checked"></i><span>我已阅读并同意《会员服务协议》</span></div>
<div class="filter"><i id="stock" class="check-icon"></i><span>只看有货</span></div>
<div class="news"><span id="news" class="ui-checkbox"></span><span>订阅优惠信息</span></div>
<div class="row is-checked"><i id="rowticked" class="agree-check"></i><span>我已阅读并同意《用户协议》</span></div>
<div class="buy"><i id="checkout" class="checkout-icon"></i><span>同意《购买须知》后结算</span></div>
<div class="cookie-banner">We use cookies. <span id="cookieclose" class="consent-close">×</span></div>
<div class="login-panel active"><div class="agree-row"><i id="panelactive" class="agree-check"></i><span>我已阅读并同意《用户协议》</span></div></div>
<div class="agree-row"><i id="unchecked" class="icon-unchecked"></i><span>我已阅读并同意《隐私政策》</span></div>
<div class="cookie-bar">We use cookies <span id="cookieagree" class="cookie-consent-btn">同意</span></div>
<div class="terms"><span id="agreebtn" class="agree-btn">同意</span><span>不同意</span><span>《用户协议》</span></div>
<div class="agree-row"><i id="glyph" class="iconfont agree-check">&#xe60f;</i><span>我已阅读并同意《用户协议》</span></div>
<div class="agree-row"><i id="zw" class="agree-check">&#x200b;</i><span>我已阅读并同意《隐私政策》</span></div>`;

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
});
afterAll(async () => {
  await browser?.close();
});

async function clickAt(page: Page, css: string, userIntent: string) {
  const gate = createUnifiedActionGate({
    page,
    onBeforeAction: classifyRuntimeAction,
    labelForRef: () => null,
    park: vi.fn(async () => '已完成'),
    aborted: () => false,
    userIntent,
  });
  const box = (await page.locator(css).boundingBox())!;
  return gate({ tool: 'click_at', x: box.x + box.width / 2, y: box.y + box.height / 2 }, 'before');
}

describe('H4 · a consent box drawn without checkbox semantics is the user’s', () => {
  it('the empty box beside 「我已阅读并同意《用户协议》」 and a subscribe box are refused', async () => {
    const page = await browser.newPage();
    try {
      await page.setContent(PAGE);
      const intent = '打开注册页，把表单填好但不要提交';
      // 复审 #3-4/5/6: a panel's 「active」 is no tick; 「icon-unchecked」; 「同意」 buttons with text.
      for (const css of [
        '#agree',
        '#news',
        '#panelactive',
        '#unchecked',
        '#cookieagree',
        '#agreebtn',
        // 复审 #4-1: an icon-font glyph or a zero-width space is no text.
        '#glyph',
        '#zw',
      ])
        expect(await clickAt(page, css, intent)).toMatchObject({
          kind: 'skip',
          message: expect.stringContaining('没有执行'),
        });
      // Unticking one already ticked, and an ordinary filter box, go ahead.
      // 复审 #2-7: ticked on the row, a 「checkout」 icon, a cookie banner's ×: not consent boxes.
      for (const css of ['#ticked', '#stock', '#rowticked', '#checkout', '#cookieclose'])
        expect(await clickAt(page, css, intent)).toMatchObject({ kind: 'proceed' });
      // The user asking to agree in so many words lets the terms box be ticked.
      expect(await clickAt(page, '#agree', '勾选同意用户协议')).toMatchObject({ kind: 'proceed' });
    } finally {
      await page.close();
    }
  });
});

describe('H4 · 「标题是：X」 is the value X', () => {
  it('no false 未核实 line for a title read word for word', () => {
    const facts = assessCompletionFacts({
      summary: '页面标题是：BBC Home - Breaking News, World News, US News, Sports',
      pages: [
        { text: '- heading "BBC Home - Breaking News, World News, US News, Sports" [level=1]' },
      ],
      intent: '打开 bbc.com 告诉我页面标题',
    });
    expect(facts.unverified.join('\n')).not.toContain('：BBC');
    expect(facts.contradictions).toEqual([]);
  });
});

describe('H4 复审 #2-6 · a label ending its line heads a list', () => {
  it('「页面标题是：」 then a list: no 「：」 value', () => {
    const facts = assessCompletionFacts({
      summary: '页面标题是：\n1. 西湖\n2. 断桥',
      pages: [{ text: '- heading "西湖" [level=1]\n- heading "断桥" [level=2]' }],
      intent: '读页面标题',
    });
    expect(facts.unverified.join('\n')).not.toMatch(/「：」/);
  });
});
