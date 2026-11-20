import { type Browser, type Page, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { classifyRuntimeAction } from '../supercar/runtime-action-policy.js';
import { createUnifiedActionGate } from './unified-action-gate.js';

/**
 * FIX-35 (BENCH-1 p02 rerun): the model clicked amazon's 「Continue shopping」 interstitial,
 * which posted {token, continueClick} to /checkpoint/validate before the pause. A click or
 * Enter that would submit to the site's own verification step is handed over before it runs.
 */

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
}, 60_000);
afterAll(async () => {
  await browser?.close();
});

function gateFor(page: Page, reply: string | null = '已验证') {
  const park = vi.fn(async (_question: string, _kind: string) => reply);
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

const FORM = (action: string) => `
  <form method="post" action="${action}" onsubmit="window.sent=(window.sent||0)+1;return false">
    <input type="hidden" name="token" value="t">
    <input name="field-keywords" aria-label="Type characters">
    <button type="submit" name="continueClick">Continue shopping</button>
  </form>`;

const sent = (page: Page) => page.evaluate(() => (window as { sent?: number }).sent ?? 0);

describe('FIX-35 verification step is handed over before the action runs', () => {
  it('hands over a click on the checkpoint 「Continue shopping」 button without submitting', async () => {
    const page = await browser.newPage();
    await page.setContent(FORM('https://www.amazon.com/checkpoint/validate'));
    const { gate, park } = gateFor(page);
    const decision = await gate(
      { tool: 'click', ref: await refOf(page, /Continue shopping/) },
      'before',
    );
    expect(park).toHaveBeenCalledTimes(1);
    expect(park.mock.calls[0]?.[1]).toBe('captcha');
    expect(park.mock.calls[0]?.[0]).toContain('amazon.com');
    expect(decision).toMatchObject({ kind: 'skip' });
    expect(await sent(page)).toBe(0);
    await page.close();
  });

  it('resolves a relative form action against the amazon page (as served there)', async () => {
    const page = await browser.newPage();
    // Served locally under the real address; nothing goes out.
    await page.route('https://www.amazon.com/**', (route) =>
      route.fulfill({ contentType: 'text/html', body: FORM('/checkpoint/validate') }),
    );
    await page.goto('https://www.amazon.com/s?k=usb+c+cable');
    const { gate, park } = gateFor(page);
    const decision = await gate(
      { tool: 'click', ref: await refOf(page, /Continue shopping/) },
      'before',
    );
    expect(park.mock.calls[0]?.[1]).toBe('captcha');
    expect(decision).toMatchObject({ kind: 'skip' });
    expect(await sent(page)).toBe(0);
    await page.close();
  });

  it('hands over Enter in a field whose form posts to validateCaptcha', async () => {
    const page = await browser.newPage();
    await page.setContent(FORM('https://www.amazon.sg/errors/validateCaptcha'));
    const { gate, park } = gateFor(page);
    const decision = await gate(
      { tool: 'type', ref: await refOf(page, /Type characters/), text: 'abc', submit: true },
      'before',
    );
    expect(park.mock.calls[0]?.[1]).toBe('captcha');
    expect(decision).toMatchObject({ kind: 'skip' });
    expect(await sent(page)).toBe(0);
    await page.close();
  });

  it('stops as awaiting_user when nobody takes over', async () => {
    const page = await browser.newPage();
    await page.setContent(FORM('https://www.amazon.com/checkpoint/validate'));
    const { gate } = gateFor(page, null);
    const decision = await gate(
      { tool: 'click', ref: await refOf(page, /Continue shopping/) },
      'before',
    );
    expect(decision).toMatchObject({ kind: 'stop', outcome: { status: 'awaiting_user' } });
    await page.close();
  });

  it('does not treat an ordinary amazon form (search) as a verification step', async () => {
    const page = await browser.newPage();
    await page.setContent(FORM('https://www.amazon.com/s'));
    const { gate, park } = gateFor(page);
    await gate({ tool: 'click', ref: await refOf(page, /Continue shopping/) }, 'before');
    expect(park.mock.calls.some((call) => call[1] === 'captcha')).toBe(false);
    await page.close();
  });

  it('only judges before the action, never after it', async () => {
    const page = await browser.newPage();
    await page.setContent(FORM('https://www.amazon.com/checkpoint/validate'));
    const { gate, park } = gateFor(page);
    const decision = await gate(
      { tool: 'click', ref: await refOf(page, /Continue shopping/) },
      'after',
    );
    expect(park).not.toHaveBeenCalled();
    expect(decision).toMatchObject({ kind: 'proceed' });
    await page.close();
  });

  it('hands over a link to amazon’s own validateCaptcha step', async () => {
    const page = await browser.newPage();
    await page.setContent(
      '<a href="https://www.amazon.com/errors/validateCaptcha?amzn=x" onclick="window.sent=1;return false">Try different image</a>',
    );
    const { gate, park } = gateFor(page);
    await gate({ tool: 'click', ref: await refOf(page, /Try different image/) }, 'before');
    expect(park.mock.calls[0]?.[1]).toBe('captcha');
    expect(await sent(page)).toBe(0);
    await page.close();
  });

  it('hands over an amazon.cn /ap/cvf/ verification form', async () => {
    const page = await browser.newPage();
    await page.setContent(FORM('https://www.amazon.cn/ap/cvf/verify'));
    const { gate, park } = gateFor(page);
    await gate({ tool: 'click', ref: await refOf(page, /Continue shopping/) }, 'before');
    expect(park.mock.calls[0]?.[1]).toBe('captcha');
    await page.close();
  });

  it('hands over a POST form that names a generic /captcha/ action', async () => {
    const page = await browser.newPage();
    await page.setContent(FORM('https://example.org/captcha/verify'));
    const { gate, park } = gateFor(page);
    await gate({ tool: 'click', ref: await refOf(page, /Continue shopping/) }, 'before');
    expect(park.mock.calls[0]?.[1]).toBe('captcha');
    await page.close();
  });
});

describe('复审 #1: ordinary pages whose path says challenge / captcha are not a verification step', () => {
  const noCaptcha = (park: ReturnType<typeof gateFor>['park']) =>
    expect(park.mock.calls.some((call) => call[1] === 'captcha')).toBe(false);

  it('a link to github.com/topics/challenge', async () => {
    const page = await browser.newPage();
    await page.setContent(
      '<a href="https://github.com/topics/challenge" onclick="return false">challenge topic</a>',
    );
    const { gate, park } = gateFor(page);
    await gate({ tool: 'click', ref: await refOf(page, /challenge topic/) }, 'before');
    noCaptcha(park);
    await page.close();
  });

  it('a GET form whose action is a /captcha/ path', async () => {
    const page = await browser.newPage();
    await page.setContent(
      '<form method="get" action="https://example.org/captcha/search" onsubmit="return false"><input aria-label="Search docs"><button>Search</button></form>',
    );
    const { gate, park } = gateFor(page);
    await gate({ tool: 'click', ref: await refOf(page, /button "Search"/) }, 'before');
    noCaptcha(park);
    await page.close();
  });

  it('a POST form with no action on a /challenge page (it submits to the page itself)', async () => {
    const page = await browser.newPage();
    await page.route('https://github.com/**', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<form method="post" onsubmit="return false"><input aria-label="Comment"><button>Comment</button></form>',
      }),
    );
    await page.goto('https://github.com/topics/challenge');
    const { gate, park } = gateFor(page);
    await gate({ tool: 'click', ref: await refOf(page, /button "Comment"/) }, 'before');
    noCaptcha(park);
    await page.close();
  });

  it('a link to a lookalike host', async () => {
    const page = await browser.newPage();
    await page.setContent(
      '<a href="https://www.amazon.com.evil.example/checkpoint/validate" onclick="return false">continue</a>',
    );
    const { gate, park } = gateFor(page);
    await gate({ tool: 'click', ref: await refOf(page, /continue/) }, 'before');
    noCaptcha(park);
    await page.close();
  });
});

describe('复审 #2: the submit button’s own formmethod decides the request method', () => {
  const page2 = (formMethod: string, buttonMethod: string) =>
    `<form method="${formMethod}" action="https://example.org/captcha/verify" onsubmit="window.sent=1;return false"><button formmethod="${buttonMethod}">Verify</button></form>`;
  it('a GET form whose button says formmethod=post is a POST to /captcha/ → handed over', async () => {
    const page = await browser.newPage();
    await page.setContent(page2('get', 'post'));
    const { gate, park } = gateFor(page);
    await gate({ tool: 'click', ref: await refOf(page, /button "Verify"/) }, 'before');
    expect(park.mock.calls[0]?.[1]).toBe('captcha');
    expect(await sent(page)).toBe(0);
    await page.close();
  });
  it('a POST form whose button says formmethod=get is a GET → not a verification step', async () => {
    const page = await browser.newPage();
    await page.setContent(page2('post', 'get'));
    const { gate, park } = gateFor(page);
    await gate({ tool: 'click', ref: await refOf(page, /button "Verify"/) }, 'before');
    expect(park.mock.calls.some((call) => call[1] === 'captcha')).toBe(false);
    await page.close();
  });
});

/**
 * G7 hotfix (INBOX Q-13; G7 A/B new-amazon-sg / reg-new-amazon-sg): amazon.sg serves the
 * 「Continue shopping」 bot check at the home page's own URL; the button posts nowhere a form
 * check can see (the page verifies through a background POST /_sec/verify). The page is judged.
 */
const INTERSTITIAL = `<!doctype html><title>Amazon.sg</title><body>
  <div>Click the button below to continue shopping</div>
  <button type="button" onclick="window.sent=(window.sent||0)+1">Continue shopping</button>
  <div>© 1996-2025, Amazon.com, Inc. or its affiliates</div></body>`;

describe('G7 hotfix: a bot-check page is handed over, whatever its button posts to', () => {
  it('amazon.sg home-page 「Continue shopping」 (served at /, no form): handed over, not clicked', async () => {
    const page = await browser.newPage();
    await page.route('https://www.amazon.sg/**', (route) =>
      route.fulfill({ contentType: 'text/html', body: INTERSTITIAL }),
    );
    await page.goto('https://www.amazon.sg/');
    const { gate, park } = gateFor(page);
    const decision = await gate(
      { tool: 'click', ref: await refOf(page, /Continue shopping/) },
      'before',
    );
    expect(park).toHaveBeenCalledTimes(1);
    expect(park.mock.calls[0]?.[1]).toBe('captcha');
    expect(decision).toMatchObject({ kind: 'skip' });
    expect(await sent(page)).toBe(0);
    await page.close();
  });

  it('the type-the-characters page: its 「Continue shopping」 submit is handed over', async () => {
    const page = await browser.newPage();
    await page.route('https://www.amazon.sg/**', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: `<title>Amazon.sg</title><h4>Enter the characters you see below</h4>
          <p>Sorry, we just need to make sure you're not a robot.</p>
          <form method="get" action="/s" onsubmit="window.sent=(window.sent||0)+1;return false">
            <input name="field-keywords" aria-label="Type characters"><button type="submit">Continue shopping</button></form>`,
      }),
    );
    await page.goto('https://www.amazon.sg/');
    const { gate, park } = gateFor(page);
    const decision = await gate(
      { tool: 'click', ref: await refOf(page, /Continue shopping/) },
      'before',
    );
    expect(park.mock.calls[0]?.[1]).toBe('captcha');
    expect(decision).toMatchObject({ kind: 'skip' });
    expect(await sent(page)).toBe(0);
    await page.close();
  });

  it('a normal amazon page’s 「Continue shopping」 (cart, no bot-check wording) is not a verification step', async () => {
    const page = await browser.newPage();
    await page.route('https://www.amazon.sg/**', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: `<title>Amazon.sg Shopping Cart</title><h1>Shopping Cart</h1><p>Your cart is empty.</p>
          <button type="button" onclick="window.sent=(window.sent||0)+1">Continue shopping</button>`,
      }),
    );
    await page.goto('https://www.amazon.sg/gp/cart/view.html');
    const { gate, park } = gateFor(page);
    await gate({ tool: 'click', ref: await refOf(page, /Continue shopping/) }, 'before');
    expect(park.mock.calls.some((call) => call[1] === 'captcha')).toBe(false);
    await page.close();
  });

  it('on a bot-check page an unrelated control (a footer link) is not taken for the check', async () => {
    const page = await browser.newPage();
    await page.route('https://www.amazon.sg/**', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: `${INTERSTITIAL}<a href="https://www.amazon.sg/gp/help/customer/display.html">Conditions of Use</a>`,
      }),
    );
    await page.goto('https://www.amazon.sg/');
    const { gate, park } = gateFor(page);
    await gate({ tool: 'click', ref: await refOf(page, /Conditions of Use/) }, 'before');
    expect(park.mock.calls.some((call) => call[1] === 'captcha')).toBe(false);
    await page.close();
  });
});

describe('G7 hotfix 复审', () => {
  const serve = async (page: Page, url: string, body: string) => {
    await page.route(`${new URL(url).origin}/**`, (route) =>
      route.fulfill({ contentType: 'text/html; charset=utf-8', body }),
    );
    await page.goto(url);
  };
  const gateWithLabel = (page: Page, label: string) => {
    const park = vi.fn(async (_question: string, _kind: string) => '已验证');
    return {
      park,
      gate: createUnifiedActionGate({
        page,
        onBeforeAction: classifyRuntimeAction,
        // As the runtime gives it: 「button "Continue"」.
        labelForRef: () => label,
        park,
        aborted: () => false,
      }),
    };
  };
  const ROBOT_PAGE = (button: string) =>
    `<title>Robot Check</title><p>Sorry, we just need to make sure you're not a robot.</p>
     <button type="button" onclick="window.sent=(window.sent||0)+1">${button}</button>`;

  it('P1: a one-word 「Continue」 with the runtime label 「button "Continue"」 is handed over', async () => {
    const page = await browser.newPage();
    await serve(page, 'https://www.amazon.sg/_sec/verify-page', ROBOT_PAGE('Continue'));
    const { gate, park } = gateWithLabel(page, 'button "Continue"');
    const decision = await gate({ tool: 'click', ref: await refOf(page, /Continue/) }, 'before');
    expect(park.mock.calls[0]?.[1]).toBe('captcha');
    expect(decision).toMatchObject({ kind: 'skip' });
    expect(await sent(page)).toBe(0);
    await page.close();
  });

  for (const button of ['Try again', 'Proceed', 'Start verification', '继续', 'Verify']) {
    it(`P2 wording: 「${button}」 on a bot-check page is handed over`, async () => {
      const page = await browser.newPage();
      await serve(page, 'https://www.amazon.sg/', ROBOT_PAGE(button));
      const { gate, park } = gateFor(page);
      await gate({ tool: 'click', ref: await refOf(page, new RegExp(button)) }, 'before');
      expect(park.mock.calls[0]?.[1]).toBe('captcha');
      expect(await sent(page)).toBe(0);
      await page.close();
    });
  }

  it('P2: typing the characters and pressing Enter on the type-the-characters page is handed over', async () => {
    const page = await browser.newPage();
    await serve(
      page,
      'https://www.amazon.sg/',
      `<title>Amazon.sg</title><h4>Enter the characters you see below</h4>
       <form method="get" action="/s" onsubmit="window.sent=(window.sent||0)+1;return false">
         <input name="field-keywords" aria-label="Type characters"><button type="submit">Continue shopping</button></form>`,
    );
    const { gate, park } = gateFor(page);
    const decision = await gate(
      { tool: 'type', ref: await refOf(page, /Type characters/), text: 'abc', submit: true },
      'before',
    );
    expect(park.mock.calls[0]?.[1]).toBe('captcha');
    expect(decision).toMatchObject({ kind: 'skip' });
    expect(await sent(page)).toBe(0);
    await page.close();
  });

  it('复核 P2: a password typed on a short /signin/challenge login page keeps the login rule', async () => {
    const page = await browser.newPage();
    await serve(
      page,
      'https://accounts.example.com/signin/challenge/pwd',
      // No action (FIX-35's own rule hands over a POST naming a /challenge action): only the page rule.
      `<title>Sign in</title><form method="post" onsubmit="window.sent=(window.sent||0)+1;return false">
        <input type="password" name="Passwd" aria-label="Enter your password"><button type="submit">Next</button></form>`,
    );
    const { gate, park } = gateFor(page);
    await gate(
      { tool: 'type', ref: await refOf(page, /Enter your password/), text: 'x', submit: true },
      'before',
    );
    expect(park.mock.calls.some((call) => call[1] === 'captcha')).toBe(false);
    expect(await sent(page)).toBe(0);
    await page.close();
  });

  it('复核 P2: a link that merely contains 「验证」 on a short page about captchas is not the check', async () => {
    const page = await browser.newPage();
    await serve(
      page,
      'https://example.cn/notes',
      `<title>验证码笔记</title><p>关于验证码的一点笔记。</p><a href="https://example.cn/more">邮箱验证的原理</a>`,
    );
    const { gate, park } = gateFor(page);
    await gate({ tool: 'click', ref: await refOf(page, /邮箱验证的原理/) }, 'before');
    expect(park.mock.calls.some((call) => call[1] === 'captcha')).toBe(false);
    await page.close();
  });

  it('P2 no false hand-over: a Baidu results page for 「图形验证码」 and a result link about it', async () => {
    const page = await browser.newPage();
    await serve(
      page,
      'https://www.baidu.com/s?wd=%E5%9B%BE%E5%BD%A2%E9%AA%8C%E8%AF%81%E7%A0%81',
      `<title>图形验证码_百度搜索</title><a href="https://example.com/a">图形验证码是什么</a><p>${'结果摘要。'.repeat(20)}</p>`,
    );
    const { gate, park } = gateFor(page);
    await gate({ tool: 'click', ref: await refOf(page, /图形验证码是什么/) }, 'before');
    expect(park.mock.calls.some((call) => call[1] === 'captcha')).toBe(false);
    await page.close();
  });

  it('P2 no false hand-over: a long readable page under /challenges with a Submit button', async () => {
    const page = await browser.newPage();
    await serve(
      page,
      'https://www.hackerrank.com/challenges/solve-me-first/problem',
      `<title>Solve Me First | HackerRank</title><article>${'Complete the function solveMeFirst to compute the sum of two integers. '.repeat(60)}</article>
       <button type="button" onclick="window.sent=(window.sent||0)+1">Submit</button>`,
    );
    const { gate, park } = gateFor(page);
    await gate({ tool: 'click', ref: await refOf(page, /Submit/) }, 'before');
    expect(park.mock.calls.some((call) => call[1] === 'captcha')).toBe(false);
    await page.close();
  });
});
