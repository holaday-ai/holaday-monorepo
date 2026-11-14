import { type Browser, type Page, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { classifyRuntimeAction } from '../supercar/runtime-action-policy.js';
import {
  consentButton,
  consentKindOf,
  contactField,
  userAskedToConsent,
  userGaveValue,
} from './consent-guard.js';
import { createUnifiedActionGate, describeUserBrowserAction } from './unified-action-gate.js';
import { UNIFIED_BROWSER_SYSTEM_PROMPT } from './unified-browser-loop.js';
import type { UnifiedBrowserAction } from './unified-tools.js';

/**
 * G2i (coordinator ruling Q-4, DEPLOY-R5 core-08): the B side ticked large_form's
 * 「I accept the terms」 while filling the form. Agreeing is the user's: a consent / terms /
 * privacy / subscribe / marketing box is never ticked unless the request asks for it; mailbox
 * and phone boxes are typed only with a value the user gave. Ordinary fields still fill.
 */

const CORE_08 =
  '请使用云端浏览器，httpbin.org/forms/post 或 the-internet.herokuapp.com 填表单与日期控件，只填不提交并截图';

/** A large_form-like page: Account (with a password), Details, Interests, terms, newsletter. */
const FORM = `<main>
<form id="large-form" action="/large_form" method="post">
  <fieldset><legend>Account</legend>
    <label for="first-name">First name</label><input type="text" id="first-name" name="first_name">
    <label for="last-name">Last name</label><input type="text" id="last-name" name="last_name">
    <label for="email">Email</label><input type="email" id="email" name="email">
    <label for="password">Password</label><input type="password" id="password" name="password">
  </fieldset>
  <fieldset><legend>Details</legend>
    <label for="birthday">Birthday</label><input type="date" id="birthday" name="birthday">
    <label for="bio">About you</label><textarea id="bio" name="bio"></textarea>
    <p>Interests</p>
    <label><input type="checkbox" id="testing" name="interests" value="testing"> Testing</label>
    <label><input type="checkbox" id="free-shipping" name="filter"> Free shipping</label>
    <input type="checkbox" id="terms" name="terms"><label for="terms">I accept the terms</label>
    <label><input type="checkbox" id="newsletter" name="newsletter"> Subscribe to our newsletter</label>
    <label><input type="checkbox" id="promo" name="promo" checked> 接收营销推广短信</label>
    <div><input type="checkbox" id="agree-cn" name="agree"><span>我已阅读并同意《用户协议》和《隐私政策》</span></div>
  </fieldset>
  <button type="submit" id="submit">Submit</button>
</form>
<form id="contact" action="/contact" method="post">
  <label for="c-name">Name</label><input id="c-name" name="name">
  <label for="c-mail">Email</label><input type="email" id="c-mail" name="contact_email">
  <label for="c-tel">Telephone</label><input type="tel" id="c-tel" name="tel">
</form>
<form role="search" action="/search"><input type="search" id="q" aria-label="Search"></form>
</main>
<div id="cookies" style="position:fixed;bottom:0;left:0;right:0;background:#eee">
  <p>We use cookies to improve your experience.</p>
  <button id="accept-all">Accept all</button>
  <button id="reject-all">Reject all</button>
  <button id="necessary">仅必要</button>
</div>`;

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
}, 60_000);
afterAll(async () => {
  await browser?.close();
});

async function formPage(): Promise<Page> {
  const page = await browser.newPage();
  await page.route('https://the-internet.herokuapp.com/**', (route) =>
    route.fulfill({ contentType: 'text/html; charset=utf-8', body: FORM }),
  );
  await page.goto('https://the-internet.herokuapp.com/large_form');
  return page;
}

async function refOf(page: Page, css: string): Promise<string> {
  // Tag the node, read the ai snapshot, find the tagged node's ref through aria-ref.
  const tree = await page.locator('body').ariaSnapshot({ mode: 'ai' } as never);
  for (const ref of tree.matchAll(/\[ref=(\w+)\]/g)) {
    const same = await page
      .locator(`aria-ref=${ref[1]}`)
      .evaluate((node, sel) => node === document.querySelector(sel), css)
      .catch(() => false);
    if (same) return ref[1]!;
  }
  throw new Error(`no ref for ${css}`);
}

function gateFor(page: Page, userIntent: string | null) {
  const park = vi.fn(async (_question: string, _kind: string) => '已完成');
  return {
    park,
    gate: createUnifiedActionGate({
      page,
      onBeforeAction: classifyRuntimeAction,
      labelForRef: () => null,
      park,
      aborted: () => false,
      userIntent,
    }),
  };
}

/** Gate, then (only on proceed) act — what the runner does. Returns the gate's decision. */
async function act(
  page: Page,
  gate: ReturnType<typeof gateFor>['gate'],
  action: UnifiedBrowserAction,
) {
  const decision = await gate(action, 'before');
  if (decision.kind === 'proceed') {
    if (action.tool === 'click') await page.locator(`aria-ref=${action.ref}`).click();
    if (action.tool === 'click_at') await page.mouse.click(action.x, action.y);
    if (action.tool === 'type') await page.locator(`aria-ref=${action.ref}`).fill(action.text);
  }
  return decision;
}

const checked = (page: Page, css: string) => page.locator(css).isChecked();

describe('G2i · core-08: consent boxes are the user’s', () => {
  it('core-08 prompt: terms / newsletter / 用户协议 ticks are refused and never sent; the form still fills', async () => {
    const page = await formPage();
    const { gate, park } = gateFor(page, CORE_08);
    try {
      for (const css of ['#terms', '#newsletter', '#agree-cn']) {
        const decision = await act(page, gate, { tool: 'click', ref: await refOf(page, css) });
        expect(decision).toMatchObject({
          kind: 'skip',
          message: expect.stringContaining('没有执行'),
        });
        expect(await checked(page, css)).toBe(false);
      }
      // The box by coordinates, its label, and the text of a wrapping label are the same tick.
      for (const css of ['#terms', 'label[for=terms]', 'label:has(#newsletter)']) {
        const box = (await page.locator(css).boundingBox())!;
        expect(
          await act(page, gate, {
            tool: 'click_at',
            x: box.x + Math.min(box.width / 2, 60),
            y: box.y + box.height / 2,
          }),
        ).toMatchObject({ kind: 'skip', message: expect.stringContaining('没有执行') });
      }
      expect(await checked(page, '#terms')).toBe(false);

      // Ordinary fields and ordinary checkboxes fill.
      for (const [css, text] of [
        ['#first-name', 'John'],
        ['#last-name', 'Doe'],
        ['#birthday', '1990-05-20'],
        ['#bio', 'I am a tester.'],
        ['#c-name', 'John Doe'],
        ['#q', 'date picker'],
      ] as const)
        expect(
          await act(page, gate, { tool: 'type', ref: await refOf(page, css), text }),
        ).toMatchObject({ kind: 'proceed' });
      expect(await page.locator('#first-name').inputValue()).toBe('John');
      expect(await page.locator('#birthday').inputValue()).toBe('1990-05-20');
      for (const css of ['#testing', '#free-shipping']) {
        expect(await act(page, gate, { tool: 'click', ref: await refOf(page, css) })).toMatchObject(
          { kind: 'proceed' },
        );
        expect(await checked(page, css)).toBe(true);
      }
      // Unticking a pre-ticked marketing box lowers consent: allowed.
      expect(
        await act(page, gate, { tool: 'click', ref: await refOf(page, '#promo') }),
      ).toMatchObject({ kind: 'proceed' });
      expect(await checked(page, '#promo')).toBe(false);
      expect(park).not.toHaveBeenCalled();
    } finally {
      await page.close();
    }
  });

  it('Email / Telephone / Password are not filled with values the user did not give', async () => {
    const page = await formPage();
    const { gate } = gateFor(page, CORE_08);
    try {
      for (const [css, text] of [
        ['#email', 'john@example.com'],
        ['#c-mail', 'john@example.com'],
        ['#c-tel', '+1 555 0100'],
      ] as const) {
        const decision = await act(page, gate, { tool: 'type', ref: await refOf(page, css), text });
        expect(decision).toMatchObject({
          kind: 'skip',
          message: expect.stringContaining('不代填'),
        });
        expect(await page.locator(css).inputValue()).toBe('');
      }
      // The password box keeps its takeover (FIX-36): never typed by the assistant.
      const pw = await act(page, gate, {
        tool: 'type',
        ref: await refOf(page, '#password'),
        text: 'secret123',
      });
      expect(pw.kind).not.toBe('proceed');
      expect(await page.locator('#password').inputValue()).toBe('');
    } finally {
      await page.close();
    }
  });

  it('reverse: an explicit 「勾选同意条款」 ticks the terms box (and only that kind)', async () => {
    const page = await formPage();
    const { gate } = gateFor(page, `${CORE_08}，并勾选同意条款`);
    try {
      expect(
        await act(page, gate, { tool: 'click', ref: await refOf(page, '#terms') }),
      ).toMatchObject({ kind: 'proceed' });
      expect(await checked(page, '#terms')).toBe(true);
      expect(
        await act(page, gate, { tool: 'click', ref: await refOf(page, '#newsletter') }),
      ).toMatchObject({ kind: 'skip' });
      expect(await checked(page, '#newsletter')).toBe(false);
    } finally {
      await page.close();
    }
  });

  it('reverse: a mailbox value the user gave is typed', async () => {
    const page = await formPage();
    const { gate } = gateFor(page, '在联系表单里填姓名 Tom，邮箱填 tom@example.com，不提交');
    try {
      expect(
        await act(page, gate, {
          tool: 'type',
          ref: await refOf(page, '#c-mail'),
          text: 'tom@example.com',
        }),
      ).toMatchObject({ kind: 'proceed' });
      expect(await page.locator('#c-mail').inputValue()).toBe('tom@example.com');
      // A made-up phone number is still refused.
      expect(
        await act(page, gate, { tool: 'type', ref: await refOf(page, '#c-tel'), text: '123456' }),
      ).toMatchObject({ kind: 'skip' });
    } finally {
      await page.close();
    }
  });

  it('cookie banner: 「Accept all」 is refused; 「Reject all」「仅必要」 are clicked', async () => {
    const page = await formPage();
    const { gate, park } = gateFor(page, '打开 the-internet.herokuapp.com/large_form 读页面标题');
    try {
      expect(
        await act(page, gate, { tool: 'click', ref: await refOf(page, '#accept-all') }),
      ).toMatchObject({ kind: 'skip', message: expect.stringContaining('拒绝') });
      for (const css of ['#reject-all', '#necessary'])
        expect(await act(page, gate, { tool: 'click', ref: await refOf(page, css) })).toMatchObject(
          { kind: 'proceed' },
        );
      expect(park).not.toHaveBeenCalled();
      // Asked for: accepted.
      const asked = gateFor(page, '打开页面后接受所有 cookie 再读标题').gate;
      expect(
        await asked({ tool: 'click', ref: await refOf(page, '#accept-all') }, 'before'),
      ).toMatchObject({ kind: 'proceed' });
    } finally {
      await page.close();
    }
  });
});

describe('G2i · the rules themselves', () => {
  it.each([
    ['I accept the terms', 'terms'],
    ['我已阅读并同意《用户协议》', 'terms'],
    ['Privacy policy consent', 'terms'],
    ['Subscribe to our newsletter', 'marketing'],
    ['接收营销推广短信', 'marketing'],
    ['Allow cookies', 'cookie'],
    ['Testing', null],
    ['Free shipping', null],
    ['Remember me', null],
    ['不同意', null],
    ['I do not accept the terms', null],
  ])('%s → %s', (label, kind) => {
    expect(consentKindOf(label)).toBe(kind);
  });

  it.each([
    ['Accept all', 'cookie'],
    ['接受全部', 'cookie'],
    ['同意', 'terms'],
    ['I agree', 'terms'],
    ['Reject all', null],
    ['Manage preferences', null],
    ['不同意', null],
    ['Accept only necessary cookies', null],
    ['Add to cart', null],
    ['Submit', null],
  ])('button %s → %s', (label, kind) => {
    expect(consentButton([label])?.kind ?? null).toBe(kind);
  });

  it.each([
    ['请勾选同意条款后填表', 'terms', true],
    ['fill the form and accept the terms and conditions', 'terms', true],
    ['勾选「I accept the terms」', 'terms', true],
    ['填好表单，订阅 newsletter', 'marketing', true],
    ['accept all cookies first', 'cookie', true],
    ['只填不提交，勾选同意条款', 'terms', true],
    [CORE_08, 'terms', false],
    ['不要勾选同意条款', 'terms', false],
    ["don't accept the terms", 'terms', false],
    ['check the return policy and buy a ticket for the terms', 'terms', false],
    ['勾选同意条款', 'marketing', false],
  ] as const)('%s asks for %s → %s', (intent, kind, asked) => {
    expect(userAskedToConsent(intent, kind)).toBe(asked);
  });

  it('contact boxes and given values', () => {
    expect(contactField({ inputType: 'email' })).toBe('email');
    expect(contactField({ inputType: 'tel' })).toBe('phone');
    expect(contactField({ label: '手机号' })).toBe('phone');
    expect(contactField({ label: 'First name' })).toBeNull();
    expect(contactField({ inputType: 'search', label: 'Search email' })).toBeNull();
    expect(userGaveValue('邮箱填 Tom@Example.com', 'tom@example.com')).toBe(true);
    expect(userGaveValue(CORE_08, 'john@example.com')).toBe(false);
  });

  it('the browser prompt tells the model the same rule', () => {
    expect(UNIFIED_BROWSER_SYSTEM_PROMPT).toContain('同意条款 / 我已阅读 / 隐私 / 订阅');
    expect(UNIFIED_BROWSER_SYSTEM_PROMPT).toContain('邮箱、电话框只在用户给了具体值时才填');
  });

  it('user browser: a terms checkbox click carries the consent; a plain button does not', () => {
    const target = (element: Record<string, unknown>) =>
      ({
        elementId: '00000000-0000-4000-8000-000000000000',
        objectDigest: 'a'.repeat(64),
        tabId: 1,
        frameId: '0',
        origin: 'https://example.com',
        observationRevision: 1,
        capturedAt: 1,
        element: {
          role: null,
          visibleText: null,
          ariaLabel: null,
          title: null,
          placeholder: null,
          name: null,
          inputType: null,
          tagName: 'input',
          ...element,
        },
        page: { url: 'https://example.com/signup', transactional: false },
        form: null,
      }) as never;
    const click = { kind: 'click' } as never;
    expect(
      describeUserBrowserAction(click, target({ inputType: 'checkbox', name: 'accept_terms' }))
        .consent,
    ).toMatchObject({ kind: 'terms' });
    expect(
      describeUserBrowserAction(click, target({ tagName: 'button', visibleText: 'Search' }))
        .consent,
    ).toBeNull();
  });
});
