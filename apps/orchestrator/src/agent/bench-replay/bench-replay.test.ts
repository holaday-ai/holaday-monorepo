/**
 * REBUILD-3 fixed-sample replay: the recorder (fake executor) and the replay executor over a
 * small synthetic fixture, then one whole replay with a scripted model. No site, no browser.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { MessagesAdapter, NeutralOutputContentBlock } from '../../llm/messages-adapter.js';
import type { UnifiedToolResult } from '../browser-tools/playwright-unified-executor.js';
import { type BenchFixture, listFixtureDirs, readFixture } from './fixture.js';
import { benchRecorderFromEnv, createBenchRecorder } from './recorder.js';
import { NOT_IN_FIXTURE, createReplayExecutor } from './replay-executor.js';
import { replayFixture } from './replay.js';

const INTENT = '在亚马逊新加坡站搜 usb c cable，列出前两个的名称和价格';
const URL = 'https://www.amazon.sg/s?k=usb+c+cable';
const TREE = [
  '- list [ref=e3]:',
  '  - listitem [ref=e10]:',
  '    - link "UGREEN USB C Cable 100W, 1M" [ref=e11] [cursor=pointer]:',
  '      - /url: /dp/B0AAA11111',
  '    - generic [ref=e12]: S$10.92',
  '  - listitem [ref=e20]:',
  '    - link "Anker USB C Cable 240W, 6ft" [ref=e21] [cursor=pointer]:',
  '      - /url: /dp/B0BBB22222',
  '    - generic [ref=e22]: S$12.45',
].join('\n');

const dirs: string[] = [];
const tempRoot = () => {
  const dir = mkdtempSync(join(tmpdir(), 'bench-replay-'));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A fake executor standing in for the browser during a "real" run. */
function fakeExecutor() {
  let url = 'about:blank';
  return async (action: { tool: string; url?: string }): Promise<UnifiedToolResult> => {
    if (action.tool === 'navigate') {
      url = action.url!;
      return { ok: true, text: '已打开', url };
    }
    if (action.tool === 'screenshot')
      return { ok: true, text: '截图', url, image: { mediaType: 'image/jpeg', data: 'AAEC' } };
    return { ok: true, text: `URL: ${url}\n标题: usb c cable\n${TREE}`, url };
  };
}

async function recordSynthetic(root: string): Promise<string> {
  let clock = 1_000;
  const recorder = createBenchRecorder({
    root,
    id: 'tsk/synthetic amazon',
    intent: INTENT,
    userIntent: INTENT,
    now: () => {
      clock += 10;
      return clock;
    },
  });
  const execute = recorder.wrapExecute(fakeExecutor());
  const search = recorder.wrapWebSearch(async (query: string) => [
    { title: `${query} - Amazon.sg`, url: URL },
  ]);
  await search('usb c cable amazon.sg');
  await execute({ tool: 'navigate', url: URL, expect: '打开搜索页' } as never);
  await execute({ tool: 'snapshot' });
  await execute({ tool: 'screenshot' });
  recorder.finish({ url: URL, title: 'Amazon.sg : usb c cable', outcome: { status: 'completed' } });
  return recorder.dir;
}

describe('bench recorder', () => {
  it('writes each call and the result the loop received, screenshots as files', async () => {
    const root = tempRoot();
    const dir = await recordSynthetic(root);
    expect(dir).toBe(join(root, 'tsk_synthetic_amazon'));
    const fixture = readFixture(dir);
    expect(fixture.steps.map((s) => s.tool)).toEqual([
      'web_search',
      'navigate',
      'snapshot',
      'screenshot',
    ]);
    expect(fixture.steps[1]).toMatchObject({
      input: { url: URL, expect: '打开搜索页' },
      result: { ok: true, url: URL },
    });
    expect(fixture.steps[2]!.result.text).toContain('[ref=e10]');
    expect(fixture.steps[3]!.result.image).toBe('step-3.jpg');
    expect(readFileSync(join(dir, 'step-3.jpg'))).toEqual(Buffer.from('AAEC', 'base64'));
    expect(JSON.stringify(fixture)).not.toContain('AAEC');
    expect(fixture.final).toEqual({ url: URL, title: 'Amazon.sg : usb c cable' });
    expect(listFixtureDirs(root)).toEqual([dir]);
  });

  it('is off without BENCH_RECORD_DIR, and a write failure never fails the task', async () => {
    expect(benchRecorderFromEnv({ id: 't', intent: 'x' }, {})).toBeNull();
    const file = join(tempRoot(), 'not-a-dir');
    writeFileSync(file, 'x');
    const recorder = createBenchRecorder({ root: file, id: 't', intent: 'x' });
    const execute = recorder.wrapExecute(fakeExecutor());
    await expect(execute({ tool: 'snapshot' })).resolves.toMatchObject({ ok: true });
    expect(existsSync(join(file, 't'))).toBe(false);
  });
});

describe('replay executor', () => {
  it('serves recorded results in order; reads repeat the latest; unknown calls are not in fixture', async () => {
    const dir = await recordSynthetic(tempRoot());
    const replay = createReplayExecutor(readFixture(dir), { dir });
    expect(replay.currentUrl()).toBe('about:blank');
    expect(await replay.webSearch('usb c cable amazon.sg')).toEqual([
      { title: 'usb c cable amazon.sg - Amazon.sg', url: URL },
    ]);
    // `expect` is the model's own words: not part of the match.
    expect(await replay.execute({ tool: 'navigate', url: URL, expect: '别的说法' })).toMatchObject({
      ok: true,
      url: URL,
    });
    expect(replay.currentUrl()).toBe(URL);
    const first = await replay.execute({ tool: 'snapshot' });
    expect(first.text).toContain('S$10.92');
    expect((await replay.execute({ tool: 'snapshot' })).text).toBe(first.text);
    expect((await replay.execute({ tool: 'screenshot' })).image).toEqual({
      mediaType: 'image/jpeg',
      data: 'AAEC',
    });
    const click = await replay.execute({ tool: 'click', ref: 'e11' });
    expect(click).toMatchObject({ ok: false, errorCode: NOT_IN_FIXTURE });
    expect(click.text).toMatch(/^not in fixture: click/);
    const elsewhere = await replay.execute({ tool: 'navigate', url: 'https://www.lazada.sg/' });
    expect(elsewhere.errorCode).toBe(NOT_IN_FIXTURE);
    expect(replay.misses).toHaveLength(2);
    expect(replay.served).toEqual([0, 1, 2, 2, 3]);
  });
});

describe('replay of one fixture (scripted model)', () => {
  const finish = {
    status: 'completed',
    summary: '前两款的价格。',
    price_result: {
      language: 'zh',
      items: [
        {
          name: 'UGREEN USB C Cable 100W, 1M',
          variant: null,
          price: 'S$10.92',
          currency: 'SGD',
          source_url: null,
          quote: 'S$10.92',
          block_ref: 'e10',
        },
        {
          name: 'Anker USB C Cable 240W, 6ft',
          variant: null,
          price: 'S$12.45',
          currency: 'SGD',
          source_url: null,
          quote: 'S$12.45',
          block_ref: 'e20',
        },
      ],
      missing: [],
      note: null,
    },
  };
  const turns: NeutralOutputContentBlock[][] = [
    [{ type: 'tool_use', id: 'n', name: 'navigate', input: { url: URL } }],
    [{ type: 'tool_use', id: 's', name: 'snapshot', input: {} }],
    [{ type: 'tool_use', id: 'f', name: 'finish', input: finish }],
  ];
  const adapter = (): MessagesAdapter => {
    let i = 0;
    return {
      metadata: { provider: 'anthropic', model: 'scripted' },
      async create() {
        const content = turns[Math.min(i++, turns.length - 1)]!;
        return {
          id: `r${i}`,
          metadata: { provider: 'anthropic', model: 'scripted' },
          content,
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
  };

  it('reads the recorded page, answers, checks and renders — no site, well under a minute', async () => {
    const dir = await recordSynthetic(tempRoot());
    const fixture: BenchFixture = readFixture(dir);
    const started = Date.now();
    const result = await replayFixture({ fixture, dir, adapter: adapter(), answerContract: true });
    expect(Date.now() - started).toBeLessThan(60_000);
    expect(result.priceContract).toBe(true);
    expect(result.misses).toEqual([]);
    expect(result.outcome).toMatchObject({ status: 'completed', answerContract: 'price' });
    if (result.outcome.status === 'completed')
      expect(result.outcome.summary).toBe(
        [
          '1. UGREEN USB C Cable 100W, 1M：S$10.92',
          '   来源：https://www.amazon.sg/dp/B0AAA11111',
          '2. Anker USB C Cable 240W, 6ft：S$12.45',
          '   来源：https://www.amazon.sg/dp/B0BBB22222',
        ].join('\n'),
      );
  });

  it('with the contract off the same replay takes the legacy finish path', async () => {
    const dir = await recordSynthetic(tempRoot());
    const result = await replayFixture({
      fixture: readFixture(dir),
      dir,
      adapter: adapter(),
      answerContract: false,
    });
    expect(result.priceContract).toBe(false);
    expect(result.outcome.status).toBe('completed');
    if (result.outcome.status === 'completed')
      expect(result.outcome.answerContract).toBeUndefined();
  });
});
