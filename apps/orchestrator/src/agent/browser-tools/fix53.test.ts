import { describe, expect, it } from 'vitest';
import type { MessagesAdapter } from '../../llm/messages-adapter.js';
import { cutWhole, wellFormedJson } from '../whole-text.js';
import { anchoredLogPost, bestBuySensorShape, keyedLogCheck } from './cloud-observation.js';
import { iframeContentGap } from './completion-coverage.js';
import { assessCompletionFacts } from './completion-fields.js';
import { runUnifiedBrowserLoop, userClearClaims } from './unified-browser-loop.js';

const scripted = (calls: Array<{ name: string; input: Record<string, unknown> }>) => {
  let turn = 0;
  const seen: string[] = [];
  const adapter: MessagesAdapter = {
    metadata: { provider: 'anthropic', model: 'fixture' },
    async create(request) {
      seen.push(JSON.stringify(request.messages.at(-1)));
      const call = calls[Math.min(turn++, calls.length - 1)]!;
      return {
        id: String(turn),
        metadata: { provider: 'anthropic', model: 'fixture' },
        content: [{ type: 'tool_use', id: String(turn), ...call }],
        stopReason: 'tool_use',
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          cacheReadInputTokens: null,
          cacheCreationInputTokens: null,
          complete: true,
        },
      };
    },
  };
  return { adapter, seen };
};
const wall = {
  reason: 'captcha' as const,
  message: '页面遇到机器人验证或验证码',
  evidence: { rule: 'captcha:title:安全验证', scope: 'document' as const, visible: true },
};

describe('FIX-53 #1 · a wall that went away by itself is not the user’s doing', () => {
  const CLAIM = '用户手动完成了人机验证后，页面已恢复。';
  const READ = '页面一级标题是 Item，价格 12 元。';
  const run = async (handed: true | 'cleared') => {
    let up = true;
    const { adapter, seen } = scripted([
      { name: 'navigate', input: { url: 'https://shop.test/item' } },
      { name: 'snapshot', input: {} },
      { name: 'finish', input: { status: 'completed', summary: `${CLAIM}${READ}` } },
    ]);
    const outcome = await runUnifiedBrowserLoop({
      intent: '打开 https://shop.test/item 读价格',
      adapter,
      maxSteps: 6,
      execute: async () => ({
        ok: true,
        text: 'heading "Item" [level=1]\n- text: 价格 12 元',
        url: 'https://shop.test/item',
      }),
      probeBlocker: async () => (up ? (wall as never) : null),
      captchaHandoff: async () => {
        up = false;
        return handed;
      },
    });
    return { outcome, seen: seen.join('\n') };
  };

  it('tells the model nobody cleared it, sends the claim back once, then takes it out', async () => {
    const { outcome, seen } = await run('cleared');
    expect(seen).toContain('不是用户完成的');
    expect(seen).not.toContain('用户已完成验证');
    expect(seen).toContain('不能写用户完成了验证');
    expect(outcome).toMatchObject({ status: 'completed' });
    const summary = (outcome as { summary?: string }).summary ?? '';
    expect(summary).not.toMatch(/用户手动完成/);
    expect(summary).toContain('价格 12 元');
  });

  it('a wait the person acted in still says they cleared it, and the answer may too', async () => {
    const { outcome, seen } = await run(true);
    expect(seen).toContain('用户已完成验证');
    expect(seen).not.toContain('不能写用户完成了验证');
    expect((outcome as { summary?: string }).summary ?? '').toContain('用户手动完成');
  });

  it.each([
    '用户已完成验证，页面恢复正常。',
    '您已手动通过安全验证。',
    '验证码已由用户手动完成。',
    'The user completed the captcha, then the page loaded.',
  ])('reads a claim: %s', (text) => {
    expect(userClearClaims(text)).toHaveLength(1);
  });

  it.each([
    '页面要求人机验证，任务已暂停交给用户。',
    '需要用户完成验证后才能继续。',
    '等待用户完成验证码已超时，任务未完成。',
  ])('no claim: %s', (text) => {
    expect(userClearClaims(text)).toEqual([]);
  });
});

describe('FIX-53 #2 · core-04: the heading and the next sentence', () => {
  const VIDEO_INTENT = '请使用云端浏览器，在 YouTube 搜索 Playwright tutorial，给出前 5 个视频标题';
  const pages = [
    {
      text: 'What is Playwright? Playwright Beginner Tutorials playlist',
      sourceURL: 'https://www.youtube.com/results?search_query=Playwright+tutorial',
      links: [
        { text: 'What is Playwright?', url: 'https://www.youtube.com/watch?v=1', kind: 'video' },
        {
          text: 'Playwright Beginner Tutorials',
          url: 'https://www.youtube.com/playlist?list=1',
          kind: 'playlist',
        },
      ],
    },
  ];
  const check = (summary: string) =>
    assessCompletionFacts({ summary, pages, intent: VIDEO_INTENT }).contradictions.join();
  const X = '"Playwright Beginner Tutorials"';

  it.each([
    ['C1', `第一个视频：已过滤广告 ${X}`],
    ['C2', `第1个视频：已剔除 Shorts ${X}`],
    ['B6', `已剔除 ${X}。它其实是最热门的结果。`],
    ['B6 on the next line', `说明：（已剔除：${X}）\n该条其实排在第一。`],
  ])('%s is caught as online: %s', (_id, summary) => {
    expect(check(summary)).toContain('播放列表/频道');
  });

  it.each([
    ['A3', `第一个视频：（已剔除：广告、${X}）`],
    ['the next sentence about the rest', `说明：（已剔除：${X}）。上述5条均为单个视频。`],
  ])('%s passes: %s', (_id, summary) => {
    expect(check(`1. What is Playwright?\n\n${summary}`)).toBe('');
  });
});

describe('FIX-53 #3 #8 · 高德 collapsar: uploadTime and version, and ids that are verbs', () => {
  const AMAP = 'https://collapsar.amap.com/alc/h5/upload';
  // As online (Deploy-53 b-m01): the listed keys plus uploadTime and version, 717 B.
  const body = (fields: Record<string, string> = {}) =>
    new URLSearchParams({
      adiu: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6',
      buildVersion: '2.3.1',
      channel: 'amap_h5',
      content: 'H4sIAAAAAAAAA'.padEnd(520, 'Zx9Qv7Lm2Np4Rt6'),
      diu: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6',
      env: 'production',
      h5Version: '1.0.0',
      idfa: '',
      imei: '',
      md5: '9e107d9d372bb6826bd81d3542a419d6',
      miniProgramVersion: '',
      mode: 'h5',
      uploadTime: '1793696244531',
      version: '1.2.0',
      ...fields,
    }).toString();

  it('the Deploy-53 log passes', () => {
    expect(keyedLogCheck(new URL(AMAP), body())).toBeNull();
    expect(anchoredLogPost(new URL(AMAP), 'POST', body())).toBe(true);
  });

  it.each([
    ['uploadTime that is not a number', { uploadTime: '2026-11-03' }, 'uploadTime:not-a-number'],
    ['a version with free text', { version: '1.2 下单' }, 'version:not-a-version'],
    ['a version that is a verb', { version: 'submit' }, 'version:not-a-version'],
    ['a uid that is a verb', { uid: 'confirm_pay' }, 'uid:not-an-id'],
    ['a tid that is a verb', { tid: 'delete' }, 'tid:not-an-id'],
  ])('%s pauses: %s', (_label, fields, why) => {
    expect(keyedLogCheck(new URL(AMAP), body(fields))).toBe(why);
    expect(anchoredLogPost(new URL(AMAP), 'POST', body(fields))).toBe(false);
  });

  it('a pause names every key off the list, not only the first eight', () => {
    const extra = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`k${i}`, 'x']));
    expect(keyedLogCheck(new URL(AMAP), body(extra))).toBe(`key:${Object.keys(extra).join('+')}`);
  });
});

describe('FIX-53 #5 · text for the database is cut on whole characters', () => {
  // The Deploy-53 d1 answer: 「🎭」 sat across the 200th unit of `modelFinalText`.
  const answer = `${'在 YouTube 搜索「Playwright tutorial」后，前5个视频标题如下：'.padEnd(198, '。')}🎭 What is Playwright?`;
  const wellFormed = (s: string) =>
    !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s);

  it('the old cut left half a pair, the new one does not', () => {
    expect(answer.charCodeAt(198)).toBe(0xd83c);
    expect(wellFormed(answer.slice(0, 199))).toBe(false);
    expect(cutWhole(answer, 199)).toBe(answer.slice(0, 198));
    expect(wellFormed(cutWhole(answer, 199))).toBe(true);
    expect(cutWhole(answer, 200)).toBe(answer.slice(0, 200));
    expect(cutWhole('短', 200)).toBe('短');
  });

  it('JSON for MySQL never carries half a pair, nested or not', () => {
    const result = {
      summary: answer,
      metadata: { modelFinalText: answer.slice(0, 199), list: [answer.slice(0, 199)] },
      tickCount: 0,
    };
    const fixed = wellFormedJson(result);
    expect(JSON.stringify(fixed)).not.toMatch(/\\ud83c(?!\\udf)/i);
    expect(fixed.summary).toBe(answer);
    expect(fixed.metadata.modelFinalText.endsWith('�')).toBe(true);
    expect(fixed.tickCount).toBe(0);
  });
});

describe('FIX-53 #8 · BestBuy: a word set off inside a segment still counts as a word', () => {
  const OPAQUE = 'a1B2'.repeat(980);
  const body = `{"body":"${OPAQUE}"}`;
  const RANDOM = 'rKEj/0r0/lXG4i2D5pFY/u71OSmi5zu1tcG/Fht-GR0iXgM/O0d/MeHswRig';
  it.each(['yg-cart-HAYYlo', 'x9Cart7', 'xCARTy9', 'add-to-cart9', 'Q7_checkout_x2', 'AddToCart9'])(
    '%s is a word, so the post still pauses',
    (segment) => {
      const url = new URL(`https://www.bestbuy.com/${segment}/${RANDOM}`);
      expect(bestBuySensorShape(url, 'POST', body)).toBe(false);
    },
  );
  it('letters run into a random string (Deploy-52 `9wcartY`) stay random, as FIX-52 decided', () => {
    const url = new URL(
      'https://www.bestbuy.com/ZbNw/sBB0/d/H/CUq4bgxg/1LfENmG7YhO9wcartY/U3FqJk0lAg/aQ/ZnF3sdSAU',
    );
    expect(bestBuySensorShape(url, 'POST', `{"sensor_data":"${OPAQUE}"}`)).toBe(true);
  });
});

describe('FIX-53 #7 · iframe: the old holes', () => {
  const INTENT = '请使用云端浏览器，the-internet.herokuapp.com 的 iframe 与 JavaScript alerts';
  const FRAME = {
    key: 'frame_1',
    sourceURL: 'about:srcdoc',
    text: '- generic "Rich Text Area. Press ALT-0 for help." [active] [ref=f1e1]:\n  - paragraph [ref=f1e2]: Your content goes here.',
  };
  const PARENT = `https://the-internet.herokuapp.com/iframe
- heading "An iFrame containing the TinyMCE WYSIWYG Editor" [level=3] [ref=e8]
- menubar [ref=e12]:
  - menuitem "File" [ref=e13]
  - menuitem "Edit" [ref=e15]
- toolbar "formatting" [ref=e40]:
  - button "Bold" [ref=e41]
- iframe [ref=e77]:
- button "Close" [ref=e90]
- link "Elemental Selenium" [ref=e99]`;
  const ALERTS =
    'https://the-internet.herokuapp.com/javascript_alerts heading "JavaScript Alerts" button "Click for JS Alert" Result: You successfully clicked an alert\nI am a JS Alert';
  const kind = (answer: string) =>
    iframeContentGap(INTENT, answer, [FRAME], true, [PARENT, ALERTS])?.kind ?? null;
  const Q = 'iframe 内容为 "Your content goes here."';

  it.each([
    ['laterClauses: iframe 之外', `${Q}。iframe 之外，页面上还有管理员登录链接。`],
    ['thingName: 用来…的按钮', `${Q}，下方还有用来提交订单的按钮`],
    ['negatedAt: 无需登录…可见', `${Q}，无需登录管理员后台可见`],
    ['LEAD_VERB_RE: 呈现', 'iframe 呈现欢迎光临，正文为 "Your content goes here."'],
    ['LEAD_VERB_RE: 展示了', 'iframe 展示了管理员公告，正文为 "Your content goes here."'],
    ['LEAD_VERB_RE: 标题为', 'iframe 标题为管理员后台，正文为 "Your content goes here."'],
    ['LEAD_VERB_RE: across sentences', 'iframe 显示欢迎光临。正文为 "Your content goes here."'],
    ['placedGap: 页面顶部有', `${Q}，页面顶部有 Elemental Selenium 链接`],
  ])('%s is caught', (_label, answer) => {
    expect(kind(answer)).toBe('mismatch');
  });

  it.each([
    [`${Q}，页面顶部有 File、Edit 菜单`],
    [`${Q}，无需登录即可查看`],
    ['iframe 呈现的正文为 "Your content goes here."'],
    [
      '已访问 iframe 页面（标题为 "An iFrame containing the TinyMCE WYSIWYG Editor"）并读取到 iframe 内的内容为 "Your content goes here."',
    ],
  ])('still passes: %s', (answer) => {
    expect(kind(answer)).toBeNull();
  });
});
