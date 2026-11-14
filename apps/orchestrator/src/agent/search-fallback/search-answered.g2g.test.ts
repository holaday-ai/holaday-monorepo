import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RunSupercarOptions, SupercarOutcome } from '../supercar/index.js';
import { runSearchWithFallback } from './search-engine-fallback.js';
import {
  ChainSearchProvider,
  type SearchProvider,
  StubSearchProvider,
  searchAnswered,
} from './search-provider.js';

/**
 * G2g D16 (DEPLOY-R4 tsk_dLFkGqzz2oqRXvhRB9GgQ): the answer opened 「本次搜索使用 Brave 搜索接口」 over a
 * results page another provider (通义千问联网搜索) had answered. The chain's `label` is whichever search
 * on it answered last; read after other awaits, it can name another search's provider. Which
 * provider answered now comes back with the results.
 */
function named(id: string, label: string, answers: (query: string) => boolean): SearchProvider {
  const stub = new StubSearchProvider();
  return {
    id,
    label,
    search: async (query, options) => (answers(query) ? stub.search(query, options) : []),
  };
}

const chain = () =>
  new ChainSearchProvider([
    named('search-api:brave', 'Brave 搜索接口', (q) => q.includes('HOLA')),
    named('search-api:qwen-cn', '通义千问联网搜索接口（大陆）', () => true),
  ]);

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
});
afterAll(async () => {
  await browser.close();
});

describe('G2g D16: the notice names the provider that answered that search', () => {
  it('searchAnswered returns the provider of this search, whatever the chain answered since', async () => {
    const provider = chain();
    const first = searchAnswered(provider, 'HOLA DAY AI', { count: 3 });
    const second = searchAnswered(provider, 'weather', { count: 3 });
    const [a, b] = await Promise.all([first, second]);
    expect(a.label).toBe('Brave 搜索接口');
    expect(a.id).toBe('search-api:brave');
    expect(b.label).toBe('通义千问联网搜索接口（大陆）');
    expect(provider.label).toBe('通义千问联网搜索接口（大陆）');
  });

  it('another search on the same chain while the first is recorded does not rename its results', async () => {
    const provider = chain();
    const context = await browser.newContext();
    const page = await context.newPage();
    const events: string[] = [];
    let interleaved = false;
    const done: SupercarOutcome = {
      status: 'completed',
      summary: 'ok',
      iterations: 1,
      toolsUsed: [],
    };
    const intent = '请使用云端浏览器，Google 搜索「HOLA DAY AI」返回前5条标题和链接';
    const outcome = await runSearchWithFallback(
      {
        taskId: 'g2g-d16',
        intent,
        executor: { getPage: async () => page },
        onEvidence: async (ev: { sourceDetail?: string }) => {
          events.push(ev.sourceDetail ?? '');
          // Another search on the shared chain, answered by the second provider, lands while
          // the first one's results are still being recorded.
          if (!interleaved) {
            interleaved = true;
            await provider.search('weather in Hangzhou', { count: 3 });
          }
        },
      } as unknown as RunSupercarOptions,
      {
        originalIntent: intent,
        searchProvider: provider,
        searchApiFirst: true,
        stop: () => true,
        run: async () => done,
      },
    );
    await context.close();
    expect(outcome.summary).toMatch(/^本次搜索使用 Brave 搜索接口（不是 Google 结果页）。/);
    expect(outcome.summary).not.toContain('通义千问');
    expect(events.every((detail) => detail === 'search API result (search-api:brave)')).toBe(true);
  });
});
