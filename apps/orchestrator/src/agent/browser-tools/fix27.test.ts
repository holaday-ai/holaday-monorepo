import { readFileSync } from 'node:fs';
import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MessagesAdapter } from '../../llm/messages-adapter.js';
import { admitsAutoplay, claimsNoPlayback, forbidsPlayback } from './playback-guard.js';
import type { PlaybackReceipt } from './playback-guard.js';
import { createPlaywrightUnifiedExecutor } from './playwright-unified-executor.js';
import type { UnifiedToolResult } from './playwright-unified-executor.js';
import { runUnifiedBrowserLoop } from './unified-browser-loop.js';

/** FIX-27 — Deploy-26 core-03: the video autoplayed and the answer said 未播放. */
const deploy26 = JSON.parse(
  readFileSync(new URL('./fixtures/deploy26-core03.json', import.meta.url), 'utf8'),
) as {
  prompt: string;
  url: string;
  answer: string;
  backgroundRequests: Array<{ url: string; method: string; action: string; branch: string }>;
};

describe('the wording', () => {
  it.each([
    [deploy26.prompt, true],
    ['请使用云端浏览器，打开视频页，不要播放', true],
    ['open the video page without playing it', true],
    ['请使用云端浏览器，YouTube 搜索「Playwright tutorial」返回前5个视频标题', false],
  ])('%s forbids playback: %s', (intent, expected) => {
    expect(forbidsPlayback(intent)).toBe(expected);
  });
  it('tells a claim of no playback from an honest autoplay admission', () => {
    expect(claimsNoPlayback(deploy26.answer)).toBe(true);
    expect(admitsAutoplay(deploy26.answer)).toBe(false);
    const honest = '未主动播放；页面曾自动播放约 12 秒，已暂停。';
    expect(claimsNoPlayback(honest) && admitsAutoplay(honest)).toBe(true);
    expect(admitsAutoplay('已禁止自动播放，未播放')).toBe(false);
  });
});

describe('the playback guard on a real autoplaying video', () => {
  let browser: Browser;
  let server: Server;
  let base: string;
  // A muted autoplay video fed by a canvas stream, plus a page script that calls play().
  const html = `<!doctype html><body><video id="v" autoplay muted playsinline width="160" height="90"></video>
<script>
const c = document.createElement('canvas'); c.width = 160; c.height = 90;
const g = c.getContext('2d'); let n = 0;
setInterval(() => { g.fillStyle = n++ % 2 ? '#c00' : '#00c'; g.fillRect(0, 0, 160, 90); }, 50);
const v = document.getElementById('v'); v.srcObject = c.captureStream(20);
setTimeout(() => v.play().catch(() => {}), 300);
</script></body>`;
  beforeAll(async () => {
    server = createServer((_req, res) => {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end(html);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/watch`;
    browser = await chromium.launch({
      headless: true,
      args: ['--autoplay-policy=no-user-gesture-required'],
    });
  });
  afterAll(async () => {
    await browser?.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const visit = async (intent: string) => {
    const page = await (await browser.newContext()).newPage();
    const tools = createPlaywrightUnifiedExecutor(page, {
      observationV2: true,
      taskIntent: intent,
    });
    try {
      await tools.execute({ tool: 'navigate', url: base } as never);
      await page.waitForTimeout(1500);
      return await tools.playbackReceipt();
    } finally {
      tools.dispose();
      await page.context().close();
    }
  };
  it('with 不播放, the video stays paused and the receipt shows ~0 s played', async () => {
    const receipt = (await visit(deploy26.prompt))!;
    expect(receipt.guarded).toBe(true);
    expect(receipt.media).toHaveLength(1);
    expect(receipt.media[0]).toMatchObject({ kind: 'video', paused: true, everPlayed: false });
    expect(receipt.playing).toBe(false);
    expect(receipt.playedSeconds).toBeLessThan(1);
  });
  it('without the constraint, nothing is touched and the video plays', async () => {
    const receipt = (await visit('请使用云端浏览器，打开这个视频页读标题'))!;
    expect(receipt.guarded).toBe(false);
    expect(receipt.playing).toBe(true);
    expect(receipt.media[0]!.currentTime).toBeGreaterThan(0.5);
  });
});

describe('a "未播放" answer is checked against the receipt and pings', () => {
  const READ = `heading "Rick Astley - Never Gonna Give You Up (Official Video) (4K Remaster)"\nRick Astley\n1.8B views\n16y ago`;
  const run = (
    answers: string[],
    receipt: PlaybackReceipt | null,
    pings: UnifiedToolResult['effect'] | undefined = undefined,
  ) => {
    let turn = 0;
    const seen: string[] = [];
    const calls = [
      { name: 'navigate', input: { url: deploy26.url } },
      { name: 'read_page', input: {} },
      ...answers.map((summary) => ({ name: 'finish', input: { status: 'completed', summary } })),
    ];
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
    return runUnifiedBrowserLoop({
      intent: deploy26.prompt,
      adapter,
      maxSteps: 8,
      execute: (async (action: { tool: string }) =>
        action.tool === 'navigate'
          ? { ok: true, text: '已打开', url: deploy26.url, ...(pings ? { effect: pings } : {}) }
          : { ok: true, text: READ, url: deploy26.url }) as never,
      currentPageUrl: () => deploy26.url,
      playbackReceipt: async () => receipt,
    }).then((outcome) => ({ outcome, seen: seen.join('\n') }));
  };
  const paused: PlaybackReceipt = {
    guarded: true,
    media: [{ kind: 'video', paused: true, currentTime: 0, playedSeconds: 0, everPlayed: false }],
    playedSeconds: 0,
    playing: false,
  };
  const autoplayed: PlaybackReceipt = {
    guarded: false,
    media: [
      { kind: 'video', paused: true, currentTime: 12.4, playedSeconds: 12.4, everPlayed: true },
    ],
    playedSeconds: 12.4,
    playing: false,
  };
  const deploy26Effect = {
    formChanged: false,
    domChanged: true,
    urlChanged: true,
    unexpected: false,
    networkCategories: ['GET:document'],
    backgroundRequests: deploy26.backgroundRequests,
  } as UnifiedToolResult['effect'];

  it('Deploy-26: the production answer with its playback pings is sent back, then fails if repeated', async () => {
    const { outcome, seen } = await run([deploy26.answer, deploy26.answer], null, deploy26Effect);
    expect(seen).toContain('有 YouTube 播放统计请求');
    expect(seen).toContain('不能写「未播放」');
    expect(outcome).toMatchObject({ status: 'failed', failureSource: 'task' });
  });
  it('a receipt showing 12 s played: the honest rewrite completes', async () => {
    const { outcome, seen } = await run(
      [
        deploy26.answer,
        '未主动播放；页面曾自动播放约 12 秒，已暂停。标题：Rick Astley - Never Gonna Give You Up (Official Video) (4K Remaster)',
      ],
      autoplayed,
    );
    expect(seen).toContain('约 12 秒');
    expect(outcome).toMatchObject({ status: 'completed' });
  });
  it('a paused receipt with nothing played proves "未播放"', async () => {
    const { outcome, seen } = await run([deploy26.answer], paused);
    expect(seen).not.toContain('不能写「未播放」');
    expect(outcome).toMatchObject({ status: 'completed' });
  });
  it('no receipt at all: "未播放" cannot be delivered as completed', async () => {
    const { outcome } = await run([deploy26.answer, deploy26.answer], null);
    expect(outcome.status).toBe('failed');
  });
  it('an answer that makes no playback claim is not checked', async () => {
    const { outcome, seen } = await run(
      ['标题：Rick Astley - Never Gonna Give You Up (Official Video) (4K Remaster)'],
      null,
    );
    expect(seen).not.toContain('不能写「未播放」');
    expect(outcome).toMatchObject({ status: 'completed' });
  });
});
