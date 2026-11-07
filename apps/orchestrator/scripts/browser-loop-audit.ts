import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
/** Scripted brain, real runner/loop/gates/ledger/verifier. No model credentials. */
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import type { MessagesAdapter, NeutralMessagesRequest } from '../src/llm/messages-adapter.js';

const here = dirname(fileURLToPath(import.meta.url));
const originalCwd = process.cwd();
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i < 0 ? undefined : process.argv[i + 1];
};
const live = process.argv.includes('--live');
const output = resolve(arg('--out') ?? join(tmpdir(), `holaday-loop-audit-${Date.now()}`));
const source = resolve(arg('--source') ?? join(here, '../src'));
const isolated = await mkdtemp(join(tmpdir(), 'holaday-loop-runtime-'));
// env.ts normally searches cwd for developer env files. This audit deliberately
// starts its imports from an empty directory, with invalid local-only services.
process.chdir(isolated);
Object.assign(process.env, {
  NODE_ENV: 'test',
  LOG_LEVEL: 'info',
  JWT_SECRET: 'loop-audit-placeholder-not-a-credential-000000',
  DATABASE_URL: 'mysql://disabled:disabled@127.0.0.1:9/disabled',
  REDIS_URL: 'redis://127.0.0.1:9',
  BROWSER_DOMAIN_PROXY_ENABLED: 'false',
  BROWSER_V2_CANARY_USER_IDS: '',
});
const load = (path: string) => import(pathToFileURL(join(source, path)).href);
const { runUnifiedSupercarTask } = await load('agent/browser-tools/unified-supercar-runner.ts');
const { initExecution, recordEvidence, verifyAndFinalize, deriveFinalStatus, disposeExecution } =
  await load('execution/execution-pipeline.ts');
const { setFeatureFlagsForTest } = await load('execution/feature-flags.ts');
setFeatureFlagsForTest({
  EVIDENCE_LEDGER: true,
  EXECUTION_CONTRACT: true,
  EXECUTION_VERIFIER: true,
});
await mkdir(output, { recursive: true });

const paragraph =
  'Public article evidence: deterministic content for reading and scrolling. '.repeat(45);
const titles = [
  'Getting started with Playwright',
  'Reliable browser tests',
  'Locators explained',
  'Browser traces',
  'Testing forms',
];
const server = createServer(async (req, res) => {
  const path = new URL(req.url ?? '/', 'http://localhost').pathname;
  if (path.startsWith('/vendor/')) {
    res.setHeader('content-type', 'text/javascript');
    res.end(await readFile(join(here, 'browser-eval/loop-fixtures', path)));
    return;
  }
  if (req.method !== 'GET') {
    res.end('recorded');
    return;
  }
  res.setHeader('content-type', 'text/html; charset=utf-8');
  const shell = (body: string) =>
    `<html><head><title>Browser loop audit</title></head><body>${body}</body></html>`;
  if (path === '/video')
    res.end(
      shell(
        '<h1>Public video title</h1><a href="/@public">Public channel</a><p>12345 views</p><p>Published 2026-01-02</p>',
      ),
    );
  else if (path === '/search')
    res.end(
      shell(
        `<a href="/watch?v=playlist&list=course">16 lessons</a>${titles.map((t, i) => `<a href="/watch?v=${i}">3:20 Now playing</a><a href="/watch?v=${i}">${t}</a>`).join('<br>')}`,
      ),
    );
  else if (path === '/article')
    res.end(
      shell(
        `<h1>Article</h1>${[1, 2, 3, 4].map((i) => `<h2>Section ${i}</h2><p>${i === 3 ? 'Third section discusses grounded browser verification. ' : ''}${paragraph}</p>`).join('')}`,
      ),
    );
  else if (path === '/tabs')
    res.end(
      shell(
        `<h1>Public links</h1>${titles
          .slice(0, 3)
          .map((t, i) => `<a href="/detail/${i}">${t}</a>`)
          .join('<br>')}`,
      ),
    );
  else if (path.startsWith('/detail/'))
    res.end(
      shell(
        `<h1>${titles[Number(path.split('/').at(-1))]}</h1><p>Verified public detail</p><script>fetch('/telemetry',{method:'POST'})</script>`,
      ),
    );
  else if (path === '/form')
    res.end(
      shell(
        '<form><label>Customer name<input name="custname"></label><label>Date<input type="date" name="date"></label><button>Submit order</button></form>',
      ),
    );
  else if (path === '/iframe') res.end(shell('<h1>An iframe</h1><iframe src="/frame"></iframe>'));
  else if (path === '/frame')
    res.end(shell('<p>Your content goes here.</p><button>Frame control</button>'));
  else if (path === '/javascript_alerts')
    res.end(
      shell(
        `<button onclick="alert('I am a JS Alert');document.getElementById('result').textContent='You successfully clicked an alert'">Click for JS Alert</button><p id="result"></p>`,
      ),
    );
  else if (path === '/infinite_scroll')
    res.end(
      shell(
        `<script src="/vendor/jquery-1.11.3.min.js"></script><h3>Infinite Scroll</h3><div class="scroll"><a href="/infinite_scroll/1">next page</a></div><script src="/vendor/jquery.jscroll.min.js"></script><script>$('.scroll').jscroll();</script>`,
      ),
    );
  else if (path.startsWith('/infinite_scroll/')) {
    const n = Number(path.split('/').at(-1));
    res.end(`<p>${n}: ${paragraph}</p><a href="/infinite_scroll/${n + 1}">next page</a>`);
  } else res.end(shell('<h1>Public page</h1>'));
});
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const local = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const browser = await chromium.launch({
  headless: true,
  args: ['--renderer-process-limit=2', '--autoplay-policy=user-gesture-required'],
});
type Reply = Record<string, any>;
type Command = { name: string; input: Record<string, unknown> };
type Script = AsyncGenerator<Command, void, Reply>;
const command = (name: string, input: Record<string, unknown> = {}): Command => ({ name, input });
const ref = (tree: string, match: RegExp) => {
  const line = tree.split('\n').find((l) => match.test(l) && l.includes('[ref='));
  const found = line?.match(/\[ref=((?:f\d+)?e\d+)\]/)?.[1];
  if (!found) throw Error(`Required observed control missing: ${match}`);
  return found;
};
const context = (s: Reply) => ({
  tabId: s.tabId,
  frameId: s.frameId,
  observationRevision: s.observationRevision,
});
const prompts: Record<string, string> = {
  'core-03': '请使用云端浏览器，YouTube 公开视频页读标题/频道/播放量/发布日期（不播放）',
  'core-04': '请使用云端浏览器，YouTube 搜索「Playwright tutorial」返回前5个视频标题',
  'core-06': '请使用云端浏览器，维基百科长页面，分段读取并总结第3节',
  'core-07': '请使用云端浏览器，从一个页面打开3个链接到新标签，分别读标题后回到第一个',
  'core-08':
    '请使用云端浏览器，httpbin.org/forms/post 或 the-internet.herokuapp.com 填表单与日期控件，只填不提交并截图',
  'core-10': '请使用云端浏览器，the-internet.herokuapp.com 的 iframe 与 JavaScript alerts',
  'core-11': '请使用云端浏览器，the-internet.herokuapp.com/infinite_scroll 滚动5次后读内容',
};
function response(request: NeutralMessagesRequest, retryStale = false): Reply {
  const last = request.messages.at(-1)?.content;
  if (!Array.isArray(last)) return {};
  const result = last.find((x) => x.type === 'tool_result');
  if (!result || result.type !== 'tool_result') return {};
  if (result.isError) {
    if (retryStale && /stale_|已失效/.test(String(result.content)))
      return { text: String(result.content), stale: true };
    throw Error(String(result.content).slice(0, 300));
  }
  try {
    return JSON.parse(String(result.content));
  } catch {
    return { text: String(result.content) };
  }
}

async function* scenario(id: string, base: string, facts: Reply): Script {
  let state: Reply;
  const finish = (summary: string, evidence: string) =>
    command('finish', { status: 'completed', summary, evidence });
  if (id === 'core-03') {
    yield command('navigate', {
      url: live ? 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' : `${base}/video`,
    });
    if (live) yield command('wait_for', { text: 'views', timeoutMs: 15000 });
    yield command('get_page_text', { maxChars: 16000 });
    const links = yield command('links', { limit: 100 });
    // Use a fresh snapshot after hydration, not the initial loading shell.
    state = yield command('read_page');
    facts.metadataLines = String(state.tree)
      .split('\n')
      .filter((line) => /views|ago|Published/.test(line))
      .slice(0, 24);
    const title = state.tree?.match(/heading "([^"]+)" \[level=1\]/)?.[1];
    const channel = links.items?.find((x: Reply) => /\/@|\/channel\//.test(x.url))?.text?.trim();
    // Accessibility labels describe the displayed number; raw innerText can
    // include every hidden digit in YouTube's animated counter.
    const metadata = facts.metadataLines.join('\n');
    const views = metadata.match(/[\d,.]+\s*[KMB]?\s*(?:views|次观看|次觀看)/i)?.[0];
    const dateLabel = facts.metadataLines.find((line: string) => /ago|Published/.test(line)) ?? '';
    const date = dateLabel.match(
      /(?:Published\s+)?\d{4}-\d{2}-\d{2}|[\d,.]+\s*(?:years?|months?|days?|hours?|y|mo|d|h) ago|\w+ \d{1,2}, \d{4}/i,
    )?.[0];
    if (![title, channel, views, date].every(Boolean))
      throw Error('All four public video fields were not observed');
    Object.assign(facts, { title, channel, views, date, dateLabel });
    yield finish(
      `公开视频标题：${title}；频道：${channel}；播放量：${views}；发布日期或页面相对日期：${date}。仅依据页面公开文字，未播放视频。`,
      title,
    );
    return;
  }
  if (id === 'core-04') {
    yield command('navigate', {
      url: live
        ? 'https://www.youtube.com/results?search_query=Playwright+tutorial'
        : `${base}/search`,
    });
    yield command('read_page');
    state = yield command('links', { limit: 100 });
    const videos = new Map<string, Reply>();
    for (const item of state.items ?? []) {
      const text = String(item.text ?? '')
        .replace(/\s+/g, ' ')
        .trim();
      if (!/\/watch\?v=/.test(item.url) || !text || /Now playing/i.test(text)) continue;
      const url = new URL(item.url);
      if (url.searchParams.has('list') || /^\d+\s+(?:lessons?|videos?)$/i.test(text)) continue;
      const id = url.searchParams.get('v')!;
      if (!videos.has(id)) videos.set(id, { ...item, text });
    }
    const items = [...videos.values()].slice(0, 5);
    if (items.length !== 5) throw Error('Five visible video titles not available');
    facts.items = items;
    yield finish(
      items.map((x: Reply, i: number) => `${i + 1}. ${x.text.trim()} — ${x.url}`).join('\n'),
      items[0].text.trim(),
    );
    return;
  }
  if (id === 'core-06') {
    yield command('navigate', {
      url: live ? 'https://en.wikipedia.org/wiki/Artificial_intelligence' : `${base}/article`,
    });
    state = yield command('read_page');
    const headings = (
      state.headings
        ? state.headings.filter((h: Reply) => h.level === 2)
        : [...String(state.tree).matchAll(/heading "([^"]+)" \[level=2\]/g)].map((x, i) => ({
            text: x[1],
            section: i + 1,
          }))
    ).filter((h: Reply) => !['Contents', 'Navigation menu'].includes(h.text));
    const target = headings[2];
    if (!target) throw Error('Third section heading not visible');
    const heading = target.text;
    let all = '';
    let page: Reply = {};
    let chunks = 0;
    do {
      page = yield command('get_page_text', {
        maxChars: chunks === 0 ? 400 : 1800,
        ...(page.cursor ? { cursor: page.cursor } : { section: target.section }),
      });
      all += page.text;
      chunks++;
    } while (page.cursor && chunks < 40);
    if (page.cursor || !page.end) throw Error('The requested section was not completely read');
    if (page.section !== target.section || !all.startsWith(heading))
      throw Error('Section identity not grounded');
    const excerpt = all.slice(heading.length, heading.length + 900).trim();
    if (excerpt.length < 40 || chunks < 2) throw Error('Third section was not read in chunks');
    Object.assign(facts, { heading, section: target.section, chunks, end: page.end, excerpt });
    yield finish(
      `第3节 ${heading} 的摘录式概要：\n${excerpt}\n以上内容来自分段读取，保留原文关键陈述。`,
      excerpt.slice(0, 160),
    );
    return;
  }
  if (id === 'core-07') {
    const url = live ? 'https://en.wikipedia.org/wiki/Science' : `${base}/tabs`;
    yield command('navigate', { url });
    const first = yield command('read_page');
    state = yield command('links', { limit: 100 });
    const urls = [
      ...new Set<string>(
        (state.items ?? [])
          .filter((item: Reply) => {
            try {
              ref(first.tree, new RegExp(item.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
              return true;
            } catch {
              return false;
            }
          })
          .map((x: Reply) => x.url)
          .filter((u: string) =>
            live
              ? /^https:\/\/en.wikipedia.org\/wiki\/[^:#]+$/.test(u) && u !== url
              : u.includes('/detail/'),
          ),
      ),
    ].slice(0, 3);
    if (urls.length !== 3) throw Error('Three actual links unavailable');
    const readTitles = [];
    const resolvedUrls: string[] = [];
    for (const u of urls) {
      let clicked = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        const source = yield command('switch_tab', { targetTabId: first.tabId });
        const sourceLink = (state.items ?? []).find((item: Reply) => item.url === u);
        if (!sourceLink) throw Error('Source link is not observed');
        const click = yield command('click', {
          ref: ref(source.tree, new RegExp(sourceLink.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))),
          newTab: true,
          ...context(source),
        });
        if (/未执行|失效|stale_/i.test(String(click.text))) continue;
        if (!String(click.text).includes('已点击链接并打开新标签'))
          throw Error('Missing actual new-tab click receipt');
        clicked = true;
        break;
      }
      if (!clicked) throw Error('Source link remained stale after three fresh observations');
      const s = yield command('read_page');
      const title = s.tree?.match(/heading "([^"]+)" \[level=1\]/)?.[1];
      if (!title || s.tabId === first.tabId || !/^https?:/.test(s.sourceURL))
        throw Error('Loaded child title missing');
      readTitles.push(title);
      resolvedUrls.push(s.sourceURL);
    }
    if (new Set(resolvedUrls).size !== 3) throw Error('Three distinct child links were not read');
    yield command('switch_tab', { targetTabId: first.tabId });
    const returned = yield command('read_page');
    if (returned.tabId !== first.tabId || returned.sourceURL !== first.sourceURL)
      throw Error('Did not return to the original tab and page');
    Object.assign(facts, {
      sourceLinks: urls,
      urls: resolvedUrls,
      titles: readTitles,
      returned: true,
    });
    yield finish(
      `已打开3个新标签并返回第一个页面。\n${readTitles.map((t, i) => `${i + 1}. ${t} — ${resolvedUrls[i]}`).join('\n')}`,
      readTitles[0],
    );
    return;
  }
  if (id === 'core-08') {
    yield command('navigate', { url: `${base}/form` });
    state = yield command('read_page');
    yield command('type', {
      ref: ref(state.tree, /Customer name/i),
      text: 'Browser audit',
      ...context(state),
    });
    state = yield command('read_page');
    const type = state.tree.includes('[type=date]') ? 'date' : 'time';
    yield command('type', {
      ref: ref(state.tree, new RegExp(`\\[type=${type}\\]`)),
      text: type === 'date' ? '2026-10-14' : '12:30',
      ...context(state),
    });
    state = yield command('read_page');
    yield command('screenshot');
    facts.filled = true;
    facts.temporalControl = type;
    yield finish(
      `表单姓名已填写为 Browser audit，${type}控件已填写。仅填写，未提交表单，并已截取当前页面截图，供复核。`,
      'Browser audit',
    );
    return;
  }
  if (id === 'core-10') {
    yield command('navigate', { url: `${base}/iframe` });
    state = yield command('read_page');
    const frame = state.frames?.find((f: Reply) => f.tree?.includes('Your content goes here'));
    if (!frame) throw Error('Same-origin iframe text/ref not exposed');
    const frameText = yield command('get_page_text', {
      frameId: frame.frameId,
      tabId: state.tabId,
      maxChars: 4000,
    });
    yield command('navigate', { url: `${base}/javascript_alerts` });
    state = yield command('read_page');
    yield command('click', { ref: ref(state.tree, /Click for JS Alert/), ...context(state) });
    state = yield command('read_page');
    if (!state.tree?.includes('You successfully clicked an alert'))
      throw Error('Alert result absent');
    facts.iframe = frameText.text;
    facts.alert = true;
    yield finish(
      `已通过 iframe 上下文读取：${frameText.text}。已点击 JS Alert 按钮并确认弹窗，页面回执：You successfully clicked an alert。`,
      'You successfully clicked an alert',
    );
    return;
  }
  yield command('navigate', { url: `${base}/infinite_scroll` });
  for (let i = 0; i < 5; i++) {
    state = yield command('read_page');
    yield command('scroll', { direction: 'down', amount: 2, ...context(state) });
  }
  state = yield command('get_page_text', { maxChars: 12000 });
  facts.text = state.text;
  yield finish(
    `已滚动5次，读取到实际新增内容：\n${String(state.text).slice(-900)}`,
    String(state.text).slice(-160),
  );
}

const rows: Reply[] = [];
try {
  for (const [id, intent] of Object.entries(prompts).filter(
    ([id]) => !arg('--case') || arg('--case')!.split(',').includes(id),
  )) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    ctx.setDefaultTimeout(12000);
    await ctx.route('**/*', (route) =>
      route.request().resourceType() === 'media' ? route.abort() : route.continue(),
    );
    const page = await ctx.newPage();
    page.on('dialog', (dialog) => dialog.accept());
    const facts: Reply = {};
    const ticks: Reply[] = [];
    const calls: Command[] = [];
    const receipts: Reply[] = [];
    const started = Date.now();
    const timer = setTimeout(() => void ctx.close(), 120000);
    const taskId = `loop-audit-${id}`;
    let site = local;
    let sourceKind = live ? 'live' : 'offline_fixture';
    // The local replica is a declared fallback, never relabelled as live.
    if (live && ['core-08', 'core-10', 'core-11'].includes(id)) {
      const target =
        id === 'core-08'
          ? 'https://httpbin.org/forms/post'
          : `https://the-internet.herokuapp.com/${id === 'core-10' ? 'iframe' : 'infinite_scroll'}`;
      try {
        await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await page.locator('body').waitFor({ timeout: 8000 });
        site = id === 'core-08' ? 'https://httpbin.org' : 'https://the-internet.herokuapp.com';
      } catch (error) {
        facts.availabilityFailure = String(error).slice(0, 300);
        sourceKind = 'local_replica';
      }
    }
    // FIX-24: the task names httpbin.org and fills elsewhere are not counted, so
    // the offline form is served at the named address (still labelled offline).
    if (id === 'core-08' && site === local) {
      await ctx.route('https://httpbin.org/forms/post', async (route) =>
        route.fulfill({ response: await route.fetch({ url: `${local}/form` }) }),
      );
      site = 'https://httpbin.org';
    }
    // The public form uses /forms/post instead of the local /form path.
    const actualScenario = scenario(id, site, facts);
    let failure: string | undefined;
    const adapter: MessagesAdapter = {
      metadata: { provider: 'anthropic', model: 'scripted-loop-audit' },
      async create(request) {
        let next: Awaited<ReturnType<Script['next']>>;
        try {
          next = await actualScenario.next(response(request, id === 'core-07'));
        } catch (error) {
          facts.scriptError = String(error).slice(0, 800);
          throw error;
        }
        if (next.done) throw Error('Script exhausted before completed');
        if (id === 'core-08' && site !== local && next.value.name === 'navigate')
          next.value.input.url = `${site}/forms/post`;
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
    try {
      initExecution({ taskId, intent, executionMode: 'browser' });
      const outcome = await runUnifiedSupercarTask({
        taskId,
        intent,
        executor: { getPage: async () => page },
        messagesAdapter: adapter,
        // The named sites are served from the loopback fixture above.
        unifiedLocalFixtures: !live,
        maxIterations: 45,
        timeoutMs: 100000,
        browserCapabilities: {
          viewportV2: true,
          observationV2: true,
          replayV1: false,
          routingV2: false,
        },
        onEvidence: (entry: Reply) => {
          recordEvidence(taskId, entry);
          if (entry.sourceDetail === 'browser_tool_receipt') {
            try {
              receipts.push(JSON.parse(entry.fact));
            } catch {}
          }
        },
        onTick: async (tick: Reply) => {
          ticks.push(tick);
          await writeFile(
            join(output, `${id}-progress.json`),
            JSON.stringify({
              id,
              at: new Date().toISOString(),
              steps: ticks.length,
              action: tick.execution?.actionKind,
            }),
          );
        },
      });
      const answer = outcome.summary ?? outcome.reason ?? outcome.question ?? '';
      const verified = await verifyAndFinalize({
        taskId,
        answerText: answer,
        finalUrl: page.url(),
        semanticAdapter: null,
      });
      const finalStatus = deriveFinalStatus(outcome.status, verified.verification);
      if (
        id === 'core-11' &&
        (receipts.filter((r) => r.scroll).length < 5 || !receipts.some((r) => r.scroll?.grew))
      )
        failure = 'Missing five scroll receipts or actual content growth';
      const pass =
        finalStatus === 'completed' && verified.verification?.passed === true && !failure;
      rows.push({
        id,
        pass,
        source: sourceKind,
        runnerStatus: outcome.status,
        finalStatus,
        answer: verified.finalText,
        verification: verified.verification,
        facts,
        failure,
        elapsedMs: Date.now() - started,
        modelCalls: 0,
      });
    } catch (error) {
      rows.push({
        id,
        pass: false,
        source: sourceKind,
        reason: String(error).slice(0, 500),
        facts,
        elapsedMs: Date.now() - started,
        modelCalls: 0,
      });
    } finally {
      clearTimeout(timer);
      await page.screenshot({ path: join(output, `${id}.png`), timeout: 4000 }).catch(() => {});
      await writeFile(
        join(output, `${id}-trace.json`),
        JSON.stringify({ calls, ticks, receipts }, null, 2),
      );
      disposeExecution(taskId);
      await ctx.close().catch(() => {});
      await writeFile(join(output, 'results.json'), JSON.stringify(rows, null, 2));
      console.log(`${id}: ${rows.at(-1)?.pass ? 'PASS' : 'FAIL'} (${sourceKind})`);
    }
  }
} finally {
  await browser.close();
  await new Promise<void>((r) => server.close(() => r()));
  process.chdir(originalCwd);
  await rm(isolated, { recursive: true, force: true });
}
console.log(
  `${rows.filter((r) => r.pass).length}/${rows.length} full-chain cases passed; model calls: 0; ${output}`,
);
if (rows.some((r) => !r.pass)) process.exitCode = 1;
