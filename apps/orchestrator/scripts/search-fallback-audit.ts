/** Scripted model, production dispatcher wrapper and browser loop. No paid model calls. */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import type { MessagesAdapter, NeutralMessagesRequest } from '../src/llm/messages-adapter.js';

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i < 0 ? undefined : process.argv[i + 1];
};
const output = resolve(arg('--out') ?? join(tmpdir(), 'search-fallback-audit'));
const live = process.argv.includes('--live');
const ddgErrorFixture = !live && process.argv.includes('--ddg-error');
const selected = arg('--case')?.split(',');
const isolated = await mkdtemp(join(tmpdir(), 'search-fallback-runtime-'));
process.chdir(isolated);
Object.assign(process.env, {
  NODE_ENV: 'test',
  LOG_LEVEL: 'info',
  JWT_SECRET: 'fallback-audit-placeholder-0000000000000',
  DATABASE_URL: 'mysql://disabled:disabled@127.0.0.1:9/disabled',
  REDIS_URL: 'redis://127.0.0.1:9',
  BROWSER_DOMAIN_PROXY_ENABLED: 'false',
  BROWSER_EXECUTOR: 'unified',
});
const load = (path: string) => import(pathToFileURL(join(here, '../src', path)).href);
const { runSearchWithFallback } = await load('agent/search-fallback/search-engine-fallback.ts');
const { runSupercarTask, supercarAbort } = await load('agent/supercar/index.ts');
const {
  initExecution,
  recordEvidence,
  verifyAndFinalize,
  browserCompletionVerdict,
  disposeExecution,
} = await load('execution/execution-pipeline.ts');
const { setFeatureFlagsForTest } = await load('execution/feature-flags.ts');
setFeatureFlagsForTest({
  EVIDENCE_LEDGER: true,
  EXECUTION_CONTRACT: true,
  EXECUTION_VERIFIER: true,
});
await mkdir(output, { recursive: true });
const corpus = JSON.parse(
  await readFile(join(here, 'browser-eval/route-audit-corpus.json'), 'utf8'),
) as { bench1Prefix: string; bench1Core: string[] };
const d16 =
  '请使用云端浏览器，【Deploy-16 核心验收 01】使用真实浏览器打开 https://www.google.com/search?q=HOLA+DAY+AI ，读取 Google 搜索「HOLA DAY AI」前5条自然搜索结果，逐条返回标题和实际链接，并保留步骤截图。只读，不提交表单、不购买、不登录、不播放视频；如果遇到真实登录墙或验证码，明确说明当前页面证据并暂停交给用户，禁止绕过，也不要把导航链接中的登录按钮误当成登录墙。';
const prompts = [
  { id: 'core-01', intent: `${corpus.bench1Prefix}${corpus.bench1Core[0]}`, query: 'HOLA DAY AI' },
  { id: 'core-02', intent: `${corpus.bench1Prefix}${corpus.bench1Core[1]}`, query: '新加坡 天气' },
  { id: 'D16', intent: d16, query: 'HOLA DAY AI' },
];
type Link = { text: string; url: string };
type Reply = { items?: Link[]; tree?: string; text?: string; [key: string]: unknown };
type Command = { name: string; input: Record<string, unknown> };
function reply(request: NeutralMessagesRequest): Reply {
  const last = request.messages.at(-1)?.content;
  if (!Array.isArray(last)) return {};
  const result = last.find((x) => x.type === 'tool_result');
  if (!result || result.type !== 'tool_result') return {};
  if (result.isError) throw Error(String(result.content).slice(0, 250));
  try {
    return JSON.parse(String(result.content));
  } catch {
    return { text: String(result.content) };
  }
}
function resultDestination(raw: string): URL | null {
  try {
    const url = new URL(raw);
    if (/(^|\.)bing\.com$/.test(url.hostname) && url.pathname === '/ck/a') {
      const encoded = url.searchParams.get('u');
      if (!encoded?.startsWith('a1')) return null;
      return new URL(Buffer.from(encoded.slice(2), 'base64url').toString('utf8'));
    }
    return url;
  } catch {
    return null;
  }
}
function resultLinks(items: Link[] = []): Link[] {
  const seen = new Set<string>();
  return items
    .filter((x) => {
      let url: URL;
      try {
        const destination = resultDestination(x.url);
        if (!destination) return false;
        url = destination;
      } catch {
        return false;
      }
      if (
        !/^https?:$/.test(url.protocol) ||
        x.text.trim().length < 8 ||
        /https?:\/\/|›/.test(x.text) ||
        seen.has(x.url)
      )
        return false;
      if (
        /(?:^|\.)(?:bing|microsoft|microsoftonline|live|duckduckgo|google)\.com$/.test(url.hostname)
      )
        return false;
      if (
        /^(?:shopping|news|images|videos|maps|all|more)$/i.test(x.text.trim()) ||
        /privacy|terms of|feedback|sign in|settings|隐私|条款|登录|设置/i.test(x.text)
      )
        return false;
      seen.add(x.url);
      return true;
    })
    .slice(0, 5);
}
const browser = await chromium.launch({
  headless: true,
  args: ['--renderer-process-limit=2', '--autoplay-policy=user-gesture-required'],
});
const rows: Record<string, unknown>[] = [];
try {
  for (const target of ['Bing', 'DuckDuckGo'])
    for (const item of prompts) {
      const id = `${item.id}-${target}`;
      if (selected && !selected.includes(id) && !selected.includes(item.id)) continue;
      const context = await browser.newContext();
      const page = await context.newPage();
      if (!live) await context.route('**/*', (route) => route.abort('blockedbyclient'));
      const initial =
        target === 'Bing'
          ? 'https://www.google.com/sorry/index'
          : `https://www.bing.com/search?q=${encodeURIComponent(item.query)}`;
      await page.route(initial, (route) =>
        route.fulfill({
          contentType: 'text/html; charset=utf-8',
          body: '<html><title>Unusual traffic</title><h1>Our systems have detected unusual traffic from your computer network</h1><div class="g-recaptcha">Verify you are human</div></html>',
        }),
      );
      if (!live)
        await page.route(
          target === 'Bing'
            ? 'https://www.bing.com/search**'
            : /^https:\/\/(?:html|lite)\.duckduckgo\.com\//,
          (route) =>
            route.fulfill({
              contentType: 'text/html; charset=utf-8',
              body: `<h1>Search results</h1><p>Singapore weather 30°C Cloudy</p>${[1, 2, 3, 4, 5].map((n) => `<a href="https://example.com/${n}">${item.query} result ${n}</a>`).join('<br>')}`,
            }),
        );
      if (ddgErrorFixture && target === 'DuckDuckGo')
        await page.route('https://html.duckduckgo.com/**', (route) =>
          route.fulfill({
            contentType: 'text/html; charset=utf-8',
            body: '<h1>Unexpected error. Please try again.</h1>',
          }),
        );
      const ticks: unknown[] = [];
      const events: unknown[] = [];
      const calls: Command[] = [];
      let attempts = 0;
      let links: Link[] = [];
      let weather = '';
      let weatherSource = '';
      let weatherKind: 'temperature' | 'link' = 'temperature';
      let scriptError = '';
      const reads: Array<{ url: string; text: string }> = [];
      const started = Date.now();
      const taskId = `search-fallback-${id}`;
      const timer = setTimeout(() => supercarAbort(taskId), 90000);
      try {
        initExecution({ taskId, intent: item.intent, executionMode: 'browser' });
        const outcome = await runSearchWithFallback(
          {
            taskId,
            intent: item.intent,
            executor: { getPage: async () => page },
            timeoutMs: 85000,
            maxIterations: 18,
            browserCapabilities: {
              viewportV2: true,
              observationV2: true,
              replayV1: false,
              routingV2: false,
            },
            onEvidence: (entry: unknown) => recordEvidence(taskId, entry),
            onTick: async (tick: unknown) => {
              ticks.push(tick);
            },
            onAwaitingUser: async () => {
              supercarAbort(taskId);
            },
          },
          {
            stop: supercarAbort,
            onFallback: async (event: unknown) => {
              events.push(event);
            },
            run: async (options: { intent: string }) => {
              attempts++;
              const attempt = attempts;
              async function* scenario(): AsyncGenerator<Command, void, Reply> {
                if (attempt === 1) {
                  yield { name: 'navigate', input: { url: initial } };
                  throw Error('The simulated wall was not detected');
                }
                const fallback = options.intent.match(/从 (https:\/\/\S+) 开始/)?.[1];
                if (!fallback) throw Error('Missing fallback URL');
                yield { name: 'navigate', input: { url: fallback } };
                let text = '';
                let seenLinks: Link[] = [];
                for (let tries = 0; tries < 3; tries++) {
                  await new Promise((r) => setTimeout(r, 1000));
                  const pageRead = yield { name: 'read_page', input: {} };
                  text = String(pageRead.tree ?? pageRead.text ?? '');
                  reads.push({ url: page.url(), text: text.slice(0, 16000) });
                  if (/unexpected error|anonymized error code/i.test(text))
                    throw Error('Search endpoint returned a site error');
                  const linkRead = yield { name: 'links', input: { limit: 100 } };
                  seenLinks = linkRead.items ?? [];
                  links = resultLinks(seenLinks);
                  if (links.length === 5) break;
                }
                const temperature = (value: string) =>
                  value.match(/[^\n]{0,50}\d{1,2}\s*°[CF]?[^\n]{0,70}/)?.[0] ?? '';
                if (item.id === 'core-02') {
                  const selectWeather = () => {
                    weather = temperature(text);
                    if (weather) {
                      weatherSource = page.url();
                      weatherKind = 'temperature';
                      return;
                    }
                    const candidate = resultLinks(seenLinks).find((x) =>
                      /weather|forecast|meteorological|天气|气象|预报/i.test(
                        `${x.text} ${resultDestination(x.url)?.href ?? ''}`,
                      ),
                    );
                    if (candidate) {
                      weather = candidate.text.trim();
                      weatherSource = candidate.url;
                      weatherKind = 'link';
                    }
                  };
                  selectWeather();
                  if (!weather) {
                    // Equivalent query on the same engine, preserving the weather request.
                    const refined = new URL(fallback);
                    refined.searchParams.set('q', 'Singapore weather');
                    yield { name: 'navigate', input: { url: refined.href } };
                    for (let n = 0; n < 3; n++) {
                      await new Promise((r) => setTimeout(r, 1000));
                      const read = yield { name: 'read_page', input: {} };
                      text = String(read.tree ?? read.text ?? '');
                      reads.push({ url: page.url(), text: text.slice(0, 16000) });
                      const found = yield { name: 'links', input: { limit: 100 } };
                      seenLinks = found.items ?? [];
                      links = resultLinks(seenLinks);
                      selectWeather();
                      if (weather) break;
                    }
                  }
                  if (!weather)
                    throw Error(
                      'No observed weather information or weather link on the alternate engine',
                    );
                }
                if (item.id !== 'core-02' && links.length < 5)
                  throw Error(`Only ${links.length}/5 observed result links`);
                const description =
                  item.id === 'core-02'
                    ? `备用来源的天气信息（非 Google 天气卡片）。${weatherKind === 'link' ? `未读取到温度，提供页面实际可见的天气网站链接：[${weather}](${weatherSource})` : `页面天气文字：${weather}\n天气来源：${weatherSource}`}\n\n`
                    : '';
                if (item.id === 'D16') yield { name: 'screenshot', input: {} };
                yield {
                  name: 'finish',
                  input: {
                    status: 'completed',
                    summary:
                      description +
                      links.map((x, n) => `${n + 1}. [${x.text.trim()}](${x.url})`).join('\n'),
                    evidence: links[0]?.text.trim() ?? weather,
                    fields: [
                      ...(weather ? [{ name: '天气摘录', value: weather }] : []),
                      ...links.flatMap((x) => [
                        { name: '搜索结果标题', value: x.text.trim() },
                        { name: '搜索结果链接', value: x.url },
                      ]),
                    ],
                  },
                };
              }
              const generator = scenario();
              const adapter: MessagesAdapter = {
                metadata: { provider: 'anthropic', model: 'scripted-fallback-audit' },
                async create(request) {
                  let next: Awaited<ReturnType<typeof generator.next>>;
                  try {
                    next = await generator.next(reply(request));
                  } catch (error) {
                    scriptError = String(error).slice(0, 500);
                    throw error;
                  }
                  if (next.done) throw Error('Script finished early');
                  calls.push(next.value);
                  return {
                    id: String(calls.length),
                    metadata: this.metadata,
                    content: [{ type: 'tool_use', id: String(calls.length), ...next.value }],
                    stopReason: 'tool_use',
                    usage: {
                      inputTokens: 0,
                      outputTokens: 0,
                      cacheReadInputTokens: null,
                      cacheCreationInputTokens: null,
                      complete: true,
                    },
                  };
                },
              };
              return runSupercarTask({ ...options, messagesAdapter: adapter });
            },
          },
        );
        const answer = outcome.summary ?? outcome.question ?? outcome.reason ?? '';
        const verified = await verifyAndFinalize({
          taskId,
          answerText: answer,
          finalUrl: page.url(),
          semanticAdapter: null,
        });
        const verdict = browserCompletionVerdict({
          runnerStatus: outcome.status,
          verification: verified.verification,
          verifiedText: verified.finalText,
          originalText: answer,
        });
        const finalStatus = verdict.status;
        const pass =
          finalStatus === 'completed' &&
          outcome.status === 'completed' &&
          attempts === (ddgErrorFixture && target === 'DuckDuckGo' ? 3 : 2) &&
          (item.id === 'core-02' || links.length === 5) &&
          verdict.text.includes(`改用 ${target}`) &&
          (item.id !== 'core-02' || Boolean(weather));
        rows.push({
          id,
          pass,
          source: live ? 'live_alternate_with_simulated_initial_wall' : 'local_fixture',
          initialEngine: target === 'Bing' ? 'Google' : 'Bing',
          alternate: target,
          attempts,
          runnerStatus: outcome.status,
          finalStatus,
          answer: verdict.text,
          links,
          weather,
          weatherSource,
          weatherKind,
          scriptError,
          events,
          verification: verified.verification,
          elapsedMs: Date.now() - started,
          modelCalls: 0,
        });
      } catch (error) {
        rows.push({
          id,
          pass: false,
          reason: String(error).slice(0, 600),
          events,
          attempts,
          modelCalls: 0,
        });
      } finally {
        clearTimeout(timer);
        await page.screenshot({ path: join(output, `${id}.png`) }).catch(() => {});
        await writeFile(
          join(output, `${id}-trace.json`),
          JSON.stringify({ ticks, events, calls, reads }, null, 2),
        );
        disposeExecution(taskId);
        await context.close();
      }
      await writeFile(join(output, 'results.json'), JSON.stringify(rows, null, 2));
      console.log(`${id}: ${rows.at(-1)?.pass ? 'PASS' : 'FAIL'}`);
    }
} finally {
  await browser.close();
  await rm(isolated, { recursive: true, force: true });
}
if (rows.some((r) => !r.pass)) process.exitCode = 1;
