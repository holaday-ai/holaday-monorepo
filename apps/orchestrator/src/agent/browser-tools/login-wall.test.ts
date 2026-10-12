import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createPlaywrightUnifiedExecutor } from './playwright-unified-executor.js';

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
});
afterAll(async () => {
  await browser?.close();
});
const results =
  '<main><h1>Playwright tutorials</h1><article><a href="/watch?v=one">Playwright with TypeScript</a><p>Setup Environment and Writing tests. Playwright Built-in Locators. View full course.</p></article><article><a href="/watch?v=two">Playwright Beginner Tutorials</a><p>What is Playwright, installation and writing your first automated browser test.</p></article></main>';
const cases = [
  [
    'public YouTube search',
    'https://www.youtube.com/results?search_query=Playwright',
    `<title>Playwright tutorial - YouTube</title><header><a>Sign in</a></header>${results}",\n    null,\n  ],\n  [\n    'hidden login iframe',\n    'https://www.youtube.com/results',\n    "${results}<iframe style="display:none" src="https://accounts.google.com/ServiceLogin?token=private"></iframe>",\n    null,\n  ],\n  [\n    'tiny auxiliary login iframe',\n    'https://www.youtube.com/results',\n    "${results}<iframe width="30" height="30" src="https://accounts.google.com/ServiceLogin"></iframe>",\n    null,\n  ],\n  [\n    'news with header login and consent banner',\n    'https://news.test/article',\n    "<header><a>登录</a></header>${results}<aside role="dialog">Cookie preferences. Please sign in for personalized settings.<button>Accept all</button></aside>",\n    null,\n  ],\n  [\n    'nonmodal optional sign-in card',\n    'https://news.test/article',\n    "${results}<div role="dialog" style="width:200px;height:150px">Please sign in to continue commenting</div>",\n    null,\n  ],\n  [\n    'article about captcha',\n    'https://news.test/article',\n    "<title>How to verify an account</title><main><article><h1>CAPTCHA explained</h1><p>reCAPTCHA is used by websites. This article explains unusual traffic and security check messages with examples and discusses login required errors.</p></article></main>",\n    null,\n  ],\n  [\n    'YouTube player bot wall with public metadata',\n    'https://www.youtube.com/watch?v=one',\n    "<title>Tutorial - YouTube</title><div id="movie_player" style="width:900px;height:500px">Sign in to confirm you’re not a bot</div>${results}",\n    'captcha',\n  ],\n  [\n    'Google unusual traffic',\n    'https://www.google.com/sorry/index',\n    "<title>Google</title><p>Our systems have detected unusual traffic from your computer network.</p><iframe width="320" height="150" src="https://www.google.com/recaptcha"></iframe>",\n    'captcha',\n  ],\n  [\n    'visible captcha iframe',\n    'https://www.google.com/search',\n    "<iframe width="800" height="400" src="https://www.google.com/recaptcha"></iframe>",\n    'captcha',\n  ],\n  [\n    'JD QR login',\n    'https://passport.jd.com/new/login.aspx?token=private',\n    "<title>京东-欢迎登录</title><main><h1>扫码登录</h1><p>请使用手机京东扫描二维码登录</p></main>",\n    'login',\n  ],\n  [\n    'main login redirect',\n    'https://accounts.google.com/ServiceLogin?token=private',\n    "<title>Sign in</title><h1>Sign in to continue</h1><label>Password<input type="password"></label>",\n    'login',\n  ],\n  [\n    'visible blocking login dialog',\n    'https://news.test/article',\n    "${results}<div role="dialog" aria-modal="true" style="position:fixed;inset:0;background:white"><h1>Please sign in</h1><label>Password<input type="password"></label></div>`,
    'login',
  ],
] as const;
it.each(cases)(
  '%s has the correct blocking decision and sanitized source',
  async (_name, url, html, expected) => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.route('**/*', (route) =>
      route.fulfill({
        contentType: 'text/html; charset=utf-8',
        body:
          route.request().isNavigationRequest() && route.request().frame() !== page.mainFrame()
            ? '<title>Sign in</title><h1>Please sign in</h1>'
            : html,
      }),
    );
    try {
      await page.goto(url);
      const tools = createPlaywrightUnifiedExecutor(page, { observationV2: true });
      const found = await tools.blocker();
      expect(found?.reason ?? null).toBe(expected);
      if (expected) {
        expect(found).toMatchObject({
          evidence: {
            visible: true,
            rule: expect.any(String),
            frameHost: expect.any(String),
            framePath: expect.stringMatching(/^\//),
          },
        });
        expect(JSON.stringify(found)).not.toMatch(/token=|private|Password<input/);
      }
      tools.dispose();
    } finally {
      await page.close();
    }
  },
);
