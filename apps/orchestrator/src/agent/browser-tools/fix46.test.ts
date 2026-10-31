import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { UNPLACED_POST_MESSAGE } from './cloud-observation.js';
import { createPlaywrightUnifiedExecutor } from './playwright-unified-executor.js';

const XHS = 'https://apm-fe.xiaohongshu.com/api/data';
/** Deploy-46 wall-xhs: the SDK record the late path paused on (keys as captured, values made up). */
const record = JSON.stringify({
  clientTime: 1793520000000,
  context_sdkSessionId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  context_pageSessionId: 'f0e1d2c3-b4a5-6789-0abc-def123456789',
  context_sdkSeqId: 1,
  context_nameTracker: 'wapT',
  context_platform: 'PC',
  context_appVersion: 'discovery-undefined',
  context_osVersion: 'unknown',
  context_deviceModel: 'Mac',
  context_deviceId: '',
  context_package: '',
  context_networkType: 'unknown',
  custom_c1: 'x',
  measurement_name: 'pageView',
});

describe('FIX-46 #1 · the late write path names an unplaced background POST, with the reason', () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  }, 60_000);
  afterAll(async () => {
    await browser?.close();
  });
  const delayed = (url: string, body: string) =>
    `setTimeout(()=>fetch('${url}',{method:'POST',mode:'no-cors',headers:{'Content-Type':'text/plain'},body:${JSON.stringify(body)}}),1200)`.replace(
      /"/g,
      '&quot;',
    );
  const run = async (target: string, body: string) => {
    const page = await browser.newPage();
    await page.route('https://**/*', (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({ status: 204, body: '' })
        : route.fulfill({
            contentType: 'text/html; charset=utf-8',
            body: `<!doctype html><meta charset="utf-8"><title>fixture</title><body><button onclick="${delayed(target, body)}">Later</button><button onclick="void 0">Read only</button></body>`,
          }),
    );
    const tools = createPlaywrightUnifiedExecutor(page, { observationV2: true });
    const click = async (label: string) => {
      const state = JSON.parse((await tools.execute({ tool: 'read_page' } as never)).text);
      const ref = state.tree.match(new RegExp(`button "${label}" \\[ref=(e\\d+)\\]`))![1];
      return tools.execute({
        tool: 'click',
        ref,
        observationRevision: state.observationRevision,
      } as never);
    };
    try {
      await tools.execute({ tool: 'navigate', url: 'https://www.xiaohongshu.com/404' } as never);
      await click('Later');
      await click('Read only');
      await page.waitForTimeout(1000);
      return {
        interruption: tools.observation?.interruption(),
        effect: tools.observation?.pendingEffect(),
      };
    } finally {
      tools.dispose();
      await page.close();
    }
  };

  it('Deploy-46 wall-xhs shape: the delayed apm-fe post pauses with the new wording and its check reason', async () => {
    const { interruption, effect } = await run(XHS, record);
    expect(interruption).toEqual({ reason: 'unexpected_effect', message: UNPLACED_POST_MESSAGE });
    const trigger = effect?.triggers?.[0] as { url: string; bodyShape?: string } | undefined;
    expect(trigger?.url).toBe(XHS);
    expect(trigger?.bodyShape).toMatch(/ check:key:custom_c1\+measurement_name$/);
  }, 30_000);

  it('reverse: a delayed real write (an order) keeps 「检测到写请求」', async () => {
    const { interruption } = await run('https://www.xiaohongshu.com/api/orders', '{"item":1}');
    expect(interruption?.reason).toBe('unexpected_effect');
    expect(interruption?.message).toContain('检测到写请求');
    expect(interruption?.message).not.toBe(UNPLACED_POST_MESSAGE);
  }, 30_000);
});

describe('FIX-46 #3 · wording', () => {
  it('Deploy-46 core-02 「（click newTab）」 reads in Chinese', async () => {
    const { humanizeToolMentions } = await import('../text-sanitizer.js');
    expect(
      humanizeToolMentions(
        '已从 Brave 搜索接口点击 AccuWeather 新加坡天气链接（click newTab），在真实打开的页面读取。',
      ),
    ).toBe(
      '已从 Brave 搜索接口点击 AccuWeather 新加坡天气链接（在新标签页打开），在真实打开的页面读取。',
    );
    expect(humanizeToolMentions('Jest 里调用 `click newTab` 即可')).toBe(
      'Jest 里调用 `click newTab` 即可',
    );
  });

  it.each([
    ['content snippet start', '内容片段开始'],
    ['start_date', '开始日期'],
  ])('field 「%s」 → 「%s」', async (name, label) => {
    const { fieldLabel } = await import('./completion-fields.js');
    expect(fieldLabel(name)).toBe(label);
  });
  it.each(['Alert message', 'Order total amount', 'Rich Text Area'])(
    'reverse: 「%s」 (a word with no entry) is kept',
    async (name) => {
      const { fieldLabel } = await import('./completion-fields.js');
      expect(fieldLabel(name)).toBe(name);
    },
  );

  it('Deploy-46 core-10: the dialog text the run handled is no 未核实 item', async () => {
    const { assessCompletionFacts } = await import('./completion-fields.js');
    const facts = (receipts: string) =>
      assessCompletionFacts({
        summary: '点击 "Click for JS Alert" 按钮后成功触发原生 alert 弹窗。',
        fields: [{ name: 'Alert message', value: 'I am a JS Alert' }],
        pages: [
          {
            text: 'heading "JavaScript Alerts" button "Click for JS Alert" Result: You successfully clicked an alert',
          },
        ],
        receipts,
        intent: '请使用云端浏览器，the-internet.herokuapp.com 的 iframe 与 JavaScript alerts',
      });
    expect(facts('I am a JS Alert').unverified).toEqual([]);
    expect(facts('').unverified.join('；')).toContain('I am a JS Alert');
  });

  it('Deploy-46 fc-mdn: a code term linked to the page read is unlinked; source links stay', async () => {
    const { unlinkCodeTermsToSource } = await import('../scrape-runner.js');
    const SRC = 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/404';
    const answer = `- 如果资源已被永久移除，服务器应改用 [\`410 Gone\`](${SRC}) 状态码。\n- 来源：[MDN](${SRC})`;
    expect(unlinkCodeTermsToSource(answer, [SRC])).toBe(
      `- 如果资源已被永久移除，服务器应改用 \`410 Gone\` 状态码。\n- 来源：[MDN](${SRC})`,
    );
    const other = 'see [`410 Gone`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/410)';
    expect(unlinkCodeTermsToSource(other, [SRC])).toBe(other);
  });
});

describe('DEPLOY-47 复审 #1 · only a known log endpoint is told as 「无法确认的后台请求」', () => {
  it.each([
    'https://www.bestbuy.com/cart/api/v1/addToCart',
    'https://www.bestbuy.com/identity/authenticate',
    'https://edith.xiaohongshu.com/api/sns/web/v1/note/like',
    'https://edith.xiaohongshu.com/api/sns/web/v1/note/collect',
    'https://edith.xiaohongshu.com/api/sns/web/v1/user/follow',
    'https://example.com/passport/login',
    'https://example.com/api/v1/subscribe',
  ])('reverse: an unknown POST to %s is told as a write', async (url) => {
    const { pauseMessage, UNPLACED_POST_MESSAGE } = await import('./cloud-observation.js');
    const message = pauseMessage([
      { branch: 'unknown_post', url, bodyShape: 'json{item,quantity} 120B' },
    ]);
    expect(message).toContain('检测到写请求');
    expect(message).not.toBe(UNPLACED_POST_MESSAGE);
  });
  it.each([
    ['apm-fe refused by its check', XHS, 'json{clientTime,custom_c1} 5941B check:key:custom_c1'],
    [
      'collapsar refused by its check',
      'https://collapsar.amap.com/alc/h5/upload',
      'form{adiu,mode} 3414B check:mode=mini',
    ],
    ['an anchored log host', 'https://t2.xiaohongshu.com/api/v2/collect', 'json{a} 900B'],
  ])('%s: told as an unplaced background request', async (_label, url, bodyShape) => {
    const { pauseMessage, UNPLACED_POST_MESSAGE } = await import('./cloud-observation.js');
    expect(pauseMessage([{ branch: 'unknown_post', url, bodyShape }])).toBe(UNPLACED_POST_MESSAGE);
  });
  it('a mix of a log post and a real write is told as a write', async () => {
    const { pauseMessage } = await import('./cloud-observation.js');
    expect(
      pauseMessage([
        { branch: 'unknown_post', url: XHS, bodyShape: 'json{a} 10B check:key:a' },
        { branch: 'unknown_post', url: 'https://www.bestbuy.com/cart/api/v1/addToCart' },
      ]),
    ).toContain('检测到写请求');
  });
});

describe('DEPLOY-47 复审 #1 · in the executor, both paths', () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  }, 60_000);
  afterAll(async () => {
    await browser?.close();
  });
  const send = (url: string, body: string, delayMs: number) => {
    const call = `fetch('${url}',{method:'POST',mode:'no-cors',headers:{'Content-Type':'text/plain'},body:${JSON.stringify(body)}})`;
    return (delayMs ? `setTimeout(()=>${call},${delayMs})` : call).replace(/"/g, '&quot;');
  };
  const run = async (host: string, url: string, body: string, delayMs: number) => {
    const page = await browser.newPage();
    await page.route('https://**/*', (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({ status: 204, body: '' })
        : route.fulfill({
            contentType: 'text/html; charset=utf-8',
            body: `<!doctype html><meta charset="utf-8"><title>fixture</title><body><button onclick="${send(url, body, delayMs)}">Go</button><button onclick="void 0">Read only</button></body>`,
          }),
    );
    const tools = createPlaywrightUnifiedExecutor(page, { observationV2: true });
    const click = async (label: string) => {
      const state = JSON.parse((await tools.execute({ tool: 'read_page' } as never)).text);
      const ref = state.tree.match(new RegExp(`button "${label}" \\[ref=(e\\d+)\\]`))![1];
      return tools.execute({
        tool: 'click',
        ref,
        observationRevision: state.observationRevision,
      } as never);
    };
    try {
      await tools.execute({ tool: 'navigate', url: `https://${host}/p` } as never);
      const first = await click('Go');
      if (delayMs) {
        await click('Read only');
        await page.waitForTimeout(delayMs);
        return tools.observation?.interruption()?.message;
      }
      return first.interruption?.message;
    } finally {
      tools.dispose();
      await page.close();
    }
  };
  it('immediate: a BestBuy addToCart JSON post is told as a write', async () => {
    const message = await run(
      'www.bestbuy.com',
      'https://www.bestbuy.com/cart/api/v1/addToCart',
      '{"items":[{"skuId":"1"}]}',
      0,
    );
    expect(message).toContain('检测到写请求');
    expect(message).not.toBe(UNPLACED_POST_MESSAGE);
  }, 30_000);
  it('late: a 小红书 note/like post is told as a write', async () => {
    const message = await run(
      'www.xiaohongshu.com',
      'https://edith.xiaohongshu.com/api/sns/web/v1/note/like',
      '{"note_oid":"1"}',
      1200,
    );
    expect(message).toContain('检测到写请求');
    expect(message).not.toBe(UNPLACED_POST_MESSAGE);
  }, 30_000);
});
