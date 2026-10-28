import { readLoginContext } from '@holaday/shared-types';
import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { classifyRuntimeAction } from './supercar/runtime-action-policy.js';

/** the-internet.herokuapp.com/large_form as served on 2026-10-28 (Account and Details fieldsets, verbatim). */
const LARGE_FORM =
  '<form id="large-form" action="/large_form" method="post">\n    <fieldset>\n      <legend>Account</legend>\n      <label for="first-name">First name</label>\n      <input type="text" id="first-name" name="first_name">\n      <label for="last-name">Last name</label>\n      <input type="text" id="last-name" name="last_name">\n      <label>Email</label>\n      <input type="email" name="email">\n      <label>Password</label>\n      <input type="password" name="password">\n      <input type="text" name="nickname" placeholder="Nickname (optional)">\n    </fieldset>\n\n    <fieldset>\n      <legend>Details</legend>\n      <div class="row">\n        <div class="large-6 columns">\n          <label for="birthday">Birthday</label>\n          <input type="date" id="birthday" name="birthday">\n        </div>\n        <div class="large-6 columns">\n          <div>\n            <div>\n              <span>Age</span>\n              <input type="number" name="age" min="0" max="120">\n            </div>\n          </div>\n        </div>\n      </div>\n      <label for="country">Country</label>\n      <select id="country" name="country">\n        <option value="">Choose a country</option>\n        <option value="ar">Argentina</option>\n        <option value="de">Germany</option>\n        <option value="in">India</option>\n        <option value="us">United States</option>\n      </select>\n      <label>Languages</label>\n      <select name="languages[]" multiple>\n        <option>English</option>\n        <option>German</option>\n        <option>Hindi</option>\n        <option>Spanish</option>\n      </select>\n      <label for="bio">About you</label>\n      <textarea id="bio" name="bio" rows="3"></textarea>\n    </fieldset>\n\n    <button class="button radius" type="submit" id="submit">Submit</button>\n  </form>';
const MASK = (inner: string) =>
  `<main><h1>行情</h1><input id="kw" aria-label="搜索地点"></main><div style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center"><div style="width:340px;background:#fff">${inner}</div></div>`;

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
});
afterAll(async () => {
  await browser?.close();
});

async function fields(html: string, selectors: string[]) {
  const page = await browser.newPage();
  try {
    await page.setContent(html);
    const out: Record<string, boolean> = {};
    for (const css of selectors)
      out[css] = (await page.locator(css).evaluate(readLoginContext, false)).loginField;
    return out;
  } finally {
    await page.close();
  }
}

describe('FIX-45 #2 · core-08: only account, mailbox, password and code boxes are login fields', () => {
  it('large_form: First name, Last name, Birthday, Age, Country, About you are fillable', async () => {
    expect(
      await fields(LARGE_FORM, [
        '#first-name',
        '#last-name',
        '#birthday',
        'input[name=age]',
        '#country',
        '#bio',
      ]),
    ).toEqual({
      '#first-name': false,
      '#last-name': false,
      '#birthday': false,
      'input[name=age]': false,
      '#country': false,
      '#bio': false,
    });
  });

  it('reverse: its Email, Password and Nickname boxes are still refused (a nickname can be the account)', async () => {
    expect(
      await fields(LARGE_FORM, [
        'input[name=email]',
        'input[type=password]',
        'input[name=nickname]',
      ]),
    ).toEqual({
      'input[name=email]': true,
      'input[type=password]': true,
      'input[name=nickname]': true,
    });
  });

  it('reverse: coordinator fixture N3 is unchanged (username and e-mail refused; date, address not)', async () => {
    const N3 =
      '<form><input id="un" name="username"><input id="pw" type="password"><input id="em" type="email"><input id="bd" type="date" aria-label="Birthday"><input id="ad" aria-label="Address"><input id="c1"><input id="c2"><button id="sub">Submit</button></form>';
    expect(await fields(N3, ['#un', '#em', '#bd', '#ad'])).toEqual({
      '#un': true,
      '#em': true,
      '#bd': false,
      '#ad': false,
    });
  });

  it.each([
    [
      'an account box named only by the text beside it',
      MASK('<p>账号</p><input id="u"><input id="pw" type="password"><button>登录</button>'),
      '#u',
    ],
    [
      'a phone box of an SMS login',
      MASK(
        '<p>手机号登录</p><input id="u" placeholder="请输入手机号"><input placeholder="验证码"><button>获取验证码</button>',
      ),
      '#u',
    ],
    [
      'a sign-up box with no label',
      MASK(
        '<p>注册</p><input id="u" placeholder="字段0"><input type="password"><button>注册</button>',
      ),
      '#u',
    ],
    [
      'a nickname box that is also the account',
      MASK(
        '<p>登录</p><input id="u" placeholder="昵称/账号"><input type="password"><button>登录</button>',
      ),
      '#u',
    ],
  ])('reverse: %s in a login popup stays refused', async (_name, html, css) => {
    expect((await fields(html, [css]))[css]).toBe(true);
  });

  it('the refusal says the other boxes of the form can still be filled', () => {
    const verdict = classifyRuntimeAction({
      kind: 'type',
      credentialForm: true,
      label: 'First name',
    } as never);
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toContain('同一表单里的其他普通字段（姓名、日期、地址等）可以照常填写');
  });
});

describe('PR #309 review · a number box in a login block needs its own name to be plain', () => {
  it('an unnamed number box of a phone login stays a login field', async () => {
    const html = MASK(
      '<p>手机号登录</p><input id="n" type="number"><input type="password"><button>登录</button>',
    );
    expect((await fields(html, ['#n']))['#n']).toBe(true);
  });
  it('reverse: large_form Age (name="age") is still fillable', async () => {
    expect((await fields(LARGE_FORM, ['input[name=age]']))['input[name=age]']).toBe(false);
  });
});
