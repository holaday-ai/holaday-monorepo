import { describe, expect, it, vi } from 'vitest';
import type { RunSupercarOptions, SupercarOutcome } from '../supercar/index.js';
import { planSearchFallback, runSearchWithFallback } from './search-engine-fallback.js';
const intent = '请使用云端浏览器，Google 搜索「HOLA DAY AI」返回前5条标题和链接';
const wall = { url: 'https://www.google.com/sorry/index', captcha: true, visible: true };
const blocked: SupercarOutcome = {
  status: 'awaiting_user',
  question: '需要验证码',
  iterations: 2,
  toolsUsed: ['navigate'],
};
const completed: SupercarOutcome = {
  status: 'completed',
  summary: '1. Example — https://example.com/',
  iterations: 3,
  toolsUsed: ['read_page'],
};
const args = { taskId: 'same-task', intent } as RunSupercarOptions;
const captchaEvent = (url = wall.url) => ({
  question: '真实验证码',
  at: new Date(),
  awaitingKind: 'captcha' as const,
  currentUrl: url,
});
const tick = {
  iteration: 2,
  execution: {
    actionKind: 'browser_blocker',
    actionSummary: '验证墙',
    ok: false,
    errorCode: 'browser_captcha_wall',
    blockerEvidence: {
      frameHost: 'www.google.com',
      framePath: '/sorry/index',
      visible: true,
      rule: 'captcha:url:/sorry/',
      scope: 'document' as const,
    },
  },
  toolsInTurn: [],
  textPreamble: '',
  apiLatencyMs: 0,
};

describe('search fallback policy', () => {
  it('selects Bing for a confirmed Google search wall and retains only the query', () => {
    const p = planSearchFallback(intent, wall);
    expect(p).toMatchObject({ from: 'Google', to: 'Bing', query: 'HOLA DAY AI' });
    expect(p?.url).toBe('https://www.bing.com/search?q=HOLA+DAY+AI');
    expect(p?.notice).toContain('Google 要求人机验证，已改用 Bing 搜索');
  });
  it('labels the different source even when Google or its weather card was required', () => {
    const p = planSearchFallback('必须用 Google 搜索「新加坡 天气」读取 Google 天气卡片', wall);
    expect(p?.notice).toContain('不是 Google');
    expect(p?.query).toBe('新加坡 天气');
  });
  it.each([
    ['打开 Google 文档并搜索正文', { ...wall, url: 'https://docs.google.com/document/d/one' }],
    ['在 Google 搜索「test」', { ...wall, url: 'https://accounts.google.com/login' }],
    [intent, { ...wall, captcha: false }],
    [intent, { ...wall, visible: false }],
    [intent, { ...wall, url: 'https://google.com.attacker.test/sorry/' }],
    ['在 Google 搜索', wall],
  ])(
    'does not fall back for non-search, unconfirmed or unidentified queries: %s',
    (text, evidence) => {
      expect(planSearchFallback(text, evidence)).toBeNull();
    },
  );
  it('selects DuckDuckGo if Bing was the blocked original engine', () => {
    const p = planSearchFallback('Bing 搜索「Playwright」前5条结果', {
      ...wall,
      url: 'https://www.bing.com/search?q=Playwright',
    });
    expect(p?.to).toBe('DuckDuckGo');
  });
  it('extracts the D16 query from the original URL, not unrelated quoted prose', () => {
    const p = planSearchFallback(
      '使用真实浏览器打开 https://www.google.com/search?q=HOLA+DAY+AI ，读取 Google 搜索前5条自然搜索结果，只读不登录',
      wall,
    );
    expect(p?.query).toBe('HOLA DAY AI');
  });
});
describe('same-task bounded orchestration', () => {
  it('retries once, retains task identity, offsets steps and declares the source', async () => {
    const originalTick = vi.fn();
    const awaitUser = vi.fn();
    const events: unknown[] = [];
    const calls: RunSupercarOptions[] = [];
    const result = await runSearchWithFallback(
      { ...args, onTick: originalTick, onAwaitingUser: awaitUser },
      {
        stop: vi.fn(() => true),
        onFallback: async (e) => {
          events.push(e);
        },
        run: async (a) => {
          calls.push(a);
          if (calls.length === 1) {
            await a.onTick?.(tick);
            await a.onAwaitingUser?.(captchaEvent());
            return blocked;
          }
          await a.onTick?.({
            ...tick,
            iteration: 1,
            execution: undefined,
            toolsInTurn: ['read_page'],
          });
          return completed;
        },
      },
    );
    expect(calls).toHaveLength(2);
    expect(calls[1]!.taskId).toBe(args.taskId);
    expect(calls[1]!.intent).toContain('https://www.bing.com/search?q=HOLA+DAY+AI');
    expect(awaitUser).not.toHaveBeenCalled();
    expect(result.status).toBe('completed');
    expect(result.summary).toContain('Google 要求人机验证');
    expect(originalTick.mock.calls.at(-1)?.[0].iteration).toBe(3);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: 'Google', to: 'Bing', phase: 'started', attempt: 1 }),
      ]),
    );
  });
  it('does not try a third engine when the alternate is blocked', async () => {
    let calls = 0;
    const awaitUser = vi.fn();
    const result = await runSearchWithFallback(
      { ...args, onAwaitingUser: awaitUser },
      {
        stop: () => true,
        run: async (a) => {
          calls++;
          await a.onTick?.(tick);
          await a.onAwaitingUser?.(
            captchaEvent(calls === 1 ? wall.url : 'https://www.bing.com/search?q=test'),
          );
          return blocked;
        },
      },
    );
    expect(calls).toBe(2);
    expect(result.status).toBe('awaiting_user');
    expect(awaitUser).toHaveBeenCalledOnce();
  });
  it('never restarts a task with a write action or user cancellation', async () => {
    for (const cancelled of [false, true]) {
      let calls = 0;
      await runSearchWithFallback(
        { ...args, isTaskCancelled: async () => cancelled },
        {
          stop: () => true,
          run: async (a) => {
            calls++;
            await a.onTick?.({ ...tick, execution: { ...tick.execution, actionKind: 'type' } });
            await a.onAwaitingUser?.(captchaEvent());
            return blocked;
          },
        },
      );
      expect(calls).toBe(1);
    }
  });
});

it('handles a host-verified settled wall even when the runner returns without a park callback', async () => {
  let calls = 0;
  const result = await runSearchWithFallback(
    { ...args, executor: { getPage: async () => ({ url: () => wall.url }) } as never },
    {
      stop: () => true,
      run: async (a) => {
        calls++;
        if (calls === 1) {
          await a.onTick?.(tick);
          return blocked;
        }
        return completed;
      },
    },
  );
  expect(calls).toBe(2);
  expect(result.status).toBe('completed');
});
it('opens the alternate before the retry, so the replaced wall is not handed to the user', async () => {
  let current = wall.url;
  const gotos: string[] = [];
  const page = {
    url: () => current,
    goto: async (url: string) => {
      gotos.push(url);
      current = url;
    },
  };
  const seenAtStart: string[] = [];
  const result = await runSearchWithFallback(
    { ...args, executor: { getPage: async () => page } as never },
    {
      stop: () => true,
      run: async (a) => {
        seenAtStart.push(current);
        if (seenAtStart.length === 1) {
          await a.onTick?.(tick);
          return blocked;
        }
        return completed;
      },
    },
  );
  expect(result.status).toBe('completed');
  expect(gotos).toEqual(['https://www.bing.com/search?q=HOLA+DAY+AI']);
  // The retry starts on Bing, not on Google's /sorry page.
  expect(seenAtStart).toEqual([wall.url, 'https://www.bing.com/search?q=HOLA+DAY+AI']);
});
it('extracts an unquoted search query without including output instructions', () => {
  expect(
    planSearchFallback('请用 Google 搜索 Playwright tutorial，返回前5条标题和链接', wall)?.query,
  ).toBe('Playwright tutorial');
});
it('does not replay unstructured write tools or a cancelled search', async () => {
  for (const cancelled of [false, true]) {
    let calls = 0;
    await runSearchWithFallback(
      { ...args, isTaskCancelled: async () => cancelled },
      {
        stop: () => true,
        run: async (a) => {
          calls++;
          await a.onTick?.({
            ...tick,
            execution: undefined,
            toolsInTurn: cancelled ? ['navigate'] : ['type'],
          });
          await a.onAwaitingUser?.(captchaEvent());
          return blocked;
        },
      },
    );
    expect(calls).toBe(1);
  }
});
it.each([
  ['新加坡当前天气 30°C，多云，来源 https://weather.example.com/singapore', true],
  ['新加坡天气：多云，未读取到温度。', true],
  ['[Singapore Weather Forecast](https://weather.example.com/singapore)，未读取到温度。', true],
  ['新加坡百科链接 https://example.com/singapore', false],
])(
  'delivers available weather information without requiring a temperature: %s',
  async (summary, hasWeather) => {
    let calls = 0;
    const result = await runSearchWithFallback(
      { ...args, intent: 'Google 搜索「新加坡 天气」读出天气卡片' },
      {
        stop: () => true,
        run: async (a) => {
          calls++;
          if (calls === 1) {
            await a.onTick?.(tick);
            await a.onAwaitingUser?.(captchaEvent());
            return blocked;
          }
          return {
            ...completed,
            summary: String(summary),
          };
        },
      },
    );
    expect(result.status).toBe(hasWeather ? 'completed' : 'awaiting_user');
  },
);
it('uses the official HTML DuckDuckGo search page for the alternate', () => {
  expect(
    planSearchFallback('Bing 搜索「Playwright」', {
      ...wall,
      url: 'https://www.bing.com/search?q=Playwright',
    })?.url,
  ).toBe('https://html.duckduckgo.com/html/?q=Playwright');
});
it('pauses on an unavailable alternate engine rather than failing or switching forever', async () => {
  let calls = 0;
  const page = {
    url: () => (calls < 2 ? wall.url : 'https://html.duckduckgo.com/html/?q=test'),
    locator: () => ({
      innerText: async () => 'Unexpected error. If this persists, please email us.',
    }),
  };
  const result = await runSearchWithFallback(
    { ...args, intent: 'Bing 搜索「test」', executor: { getPage: async () => page } as never },
    {
      stop: () => true,
      run: async (a) => {
        calls++;
        if (calls === 1) {
          await a.onTick?.(tick);
          await a.onAwaitingUser?.(captchaEvent('https://www.bing.com/search?q=test'));
          return blocked;
        }
        return { ...blocked, status: 'failed', reason: 'No results' };
      },
    },
  );
  expect(calls).toBe(3);
  expect(result.status).toBe('awaiting_user');
  expect(result.question).toContain('未切换第三个引擎');
});

it('tries DDG lite once after an HTML error, retaining task, time budget, events and step order', async () => {
  const calls: RunSupercarOptions[] = [];
  const events: unknown[] = [];
  const observedSteps: number[] = [];
  const page = {
    url: () =>
      calls.length < 3
        ? 'https://html.duckduckgo.com/html/?q=test'
        : 'https://lite.duckduckgo.com/lite/?q=test',
    locator: () => ({
      innerText: async () => (calls.length < 3 ? 'Unexpected error. Please try again.' : 'Results'),
    }),
  };
  const result = await runSearchWithFallback(
    {
      ...args,
      intent: 'Bing 搜索「test」',
      timeoutMs: 20000,
      executor: { getPage: async () => page } as never,
      onTick: async (e) => {
        observedSteps.push(e.iteration);
      },
    },
    {
      stop: () => true,
      onFallback: async (e) => {
        events.push(e);
      },
      run: async (a) => {
        calls.push(a);
        if (calls.length === 1) {
          await a.onTick?.(tick);
          await a.onAwaitingUser?.(captchaEvent('https://www.bing.com/search?q=test'));
          return blocked;
        }
        await a.onTick?.({
          ...tick,
          iteration: 1,
          execution: undefined,
          toolsInTurn: ['read_page'],
        });
        return calls.length === 2
          ? { ...blocked, status: 'failed', reason: 'No results' }
          : completed;
      },
    },
  );
  expect(calls).toHaveLength(3);
  expect(calls[2]!.intent).toContain('从 https://lite.duckduckgo.com/lite/?q=test 开始');
  expect(calls.every((a) => a.taskId === args.taskId)).toBe(true);
  expect(calls[2]!.timeoutMs).toBeLessThanOrEqual(20000);
  expect(observedSteps).toEqual([2, 3, 5]);
  expect(result.status).toBe('completed');
  expect(events).toContainEqual(
    expect.objectContaining({
      reason: 'search_endpoint_unavailable',
      endpoint: 'lite',
      phase: 'started',
    }),
  );
});
it.each(['captcha', 'write', 'cancelled'])(
  'never retries the DDG endpoint after %s',
  async (reason) => {
    let calls = 0;
    const result = await runSearchWithFallback(
      {
        ...args,
        intent: 'Bing 搜索「test」',
        isTaskCancelled: async () => reason === 'cancelled' && calls >= 2,
        executor: {
          getPage: async () => ({
            url: () => 'https://html.duckduckgo.com/html/?q=test',
            locator: () => ({ innerText: async () => 'Unexpected error. Please try again.' }),
          }),
        } as never,
      },
      {
        stop: () => true,
        run: async (a) => {
          calls++;
          if (calls === 1) {
            await a.onTick?.(tick);
            await a.onAwaitingUser?.(captchaEvent('https://www.bing.com/search?q=test'));
            return blocked;
          }
          if (reason === 'captcha') {
            await a.onTick?.(tick);
            await a.onAwaitingUser?.(captchaEvent('https://html.duckduckgo.com/anomaly.js'));
            return blocked;
          }
          if (reason === 'write')
            await a.onTick?.({ ...tick, execution: undefined, toolsInTurn: ['type'] });
          return { ...blocked, status: 'failed', reason: 'No results' };
        },
      },
    );
    expect(calls).toBe(2);
    expect(result.status).not.toBe('completed');
  },
);
