import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { MessagesAdapter } from '../../llm/messages-adapter.js';
import { createPlaywrightUnifiedExecutor } from './playwright-unified-executor.js';
import { runUnifiedSupercarTask } from './unified-supercar-runner.js';
let browser: Browser;
let base: string;
const server = createServer((req, res) => {
  res.setHeader('content-type', 'text/html');
  if (req.method === 'POST') {
    res.end('ok');
    return;
  }
  if (req.url === '/frames') {
    res.end(
      `<iframe src="/frame"></iframe><iframe src="http://localhost:${(server.address() as AddressInfo).port}/frame"></iframe>`,
    );
    return;
  }
  if (req.url === '/frame') {
    res.end(
      '<button onclick="this.textContent=\'Read frame successfully\'">Frame control</button>',
    );
    return;
  }
  if (req.url === '/cached') {
    res.end(
      `<script>const savedFetch=fetch.bind(window);</script><button onclick="savedFetch('/custom-write',{method:'POST'})">Saved write</button>`,
    );
    return;
  }
  if (req.url === '/autosave') {
    res.end(
      `<label>Choice<select onchange="fetch('/custom-write',{method:'POST'})"><option>A</option><option>B</option></select></label>`,
    );
    return;
  }
  res.end(`<main>Public text</main><button onclick="fetch('/custom-write',{method:'POST'})">Write</button>
  <button onclick="setTimeout(()=>fetch('/late-write',{method:'POST'}),1200)">Delayed</button>
  <button onclick="(async()=>{await new Promise(r=>setTimeout(r,1200));await fetch('/async-write',{method:'POST'})})()">Async</button>
  <button onclick="window.background=setTimeout(()=>fetch('/background',{method:'POST'}),100)">Start background</button>
  <button onclick="void 0">Read only</button>
  <script>if(location.pathname==='/boot')fetch('/telemetry',{method:'POST'});</script>`);
});
beforeAll(async () => {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  browser = await chromium.launch({ headless: true });
});
afterAll(async () => {
  await browser?.close();
  await new Promise<void>((r) => server.close(() => r()));
});

it('records navigation POSTs without pausing a read-only navigation', async () => {
  const page = await browser.newPage();
  const tools = createPlaywrightUnifiedExecutor(page, { observationV2: true });
  try {
    const result = await tools.execute({ tool: 'navigate', url: `${base}/boot` });
    expect(result.interruption).toBeUndefined();
    expect(result.effect?.networkCategories).toContain('POST:fetch');
    expect(result.effect?.backgroundRequests).toContainEqual(
      expect.objectContaining({ method: 'POST', url: `${base}/telemetry`, action: 'navigate' }),
    );
  } finally {
    tools.dispose();
    await page.close();
  }
});

it('keeps writes observable when the site caches fetch during page initialization', async () => {
  const page = await browser.newPage();
  const tools = createPlaywrightUnifiedExecutor(page, { observationV2: true });
  try {
    await tools.execute({ tool: 'navigate', url: `${base}/cached` });
    const snap = JSON.parse((await tools.execute({ tool: 'read_page' })).text);
    const ref = snap.tree
      .split('\n')
      .find((line: string) => line.includes('"Saved write"'))
      ?.match(/ref=(e\d+)/)?.[1];
    const result = await tools.execute({ tool: 'click', ref, ...snap });
    expect(result.interruption).toMatchObject({ reason: 'unexpected_effect' });
  } finally {
    tools.dispose();
    await page.close();
  }
});

it('attributes Playwright select change events to the exact operated control', async () => {
  const page = await browser.newPage();
  const tools = createPlaywrightUnifiedExecutor(page, { observationV2: true });
  try {
    await tools.execute({ tool: 'navigate', url: `${base}/autosave` });
    const state = JSON.parse((await tools.execute({ tool: 'read_page' })).text);
    const ref = state.tree.match(/combobox[^\n]*ref=(e\d+)/)?.[1];
    const result = await tools.execute({ tool: 'select', ref, value: 'B', ...state });
    expect(result.interruption).toMatchObject({ reason: 'unexpected_effect' });
  } finally {
    tools.dispose();
    await page.close();
  }
});

it.each(['Write', 'Delayed', 'Async'])(
  'still blocks a write caused by our %s click',
  async (name) => {
    const page = await browser.newPage();
    await page.goto(base);
    const tools = createPlaywrightUnifiedExecutor(page, { observationV2: true });
    try {
      const snap = JSON.parse((await tools.execute({ tool: 'read_page' })).text);
      const ref = snap.tree
        .split('\n')
        .find((l: string) => l.includes(`"${name}"`))
        ?.match(/ref=(e\d+)/)?.[1];
      expect(ref).toBeTruthy();
      const result = await tools.execute({ tool: 'click', ref, ...snap });
      await page.waitForTimeout(1400);
      expect(result.interruption ?? tools.observation?.interruption()).toMatchObject({
        reason: 'unexpected_effect',
      });
      expect(
        result.effect?.triggers?.length || tools.observation?.pendingEffect()?.triggers?.length,
      ).toBeGreaterThan(0);
    } finally {
      tools.dispose();
      await page.close();
    }
  },
);

it('does not blame a concurrent background POST on a harmless click', async () => {
  const page = await browser.newPage();
  await page.goto(base);
  const tools = createPlaywrightUnifiedExecutor(page, { observationV2: true });
  try {
    const snap = JSON.parse((await tools.execute({ tool: 'read_page' })).text);
    // The timer is scheduled independently of the tool's trusted event.
    await page.evaluate(() => setTimeout(() => fetch('/background', { method: 'POST' }), 100));
    const ref = snap.tree
      .split('\n')
      .find((l: string) => l.includes('"Read only"'))
      ?.match(/ref=(e\d+)/)?.[1];
    const result = await tools.execute({ tool: 'click', ref, ...snap });
    expect(result.interruption).toBeUndefined();
    expect(result.effect?.networkCategories).toContain('POST:fetch');
  } finally {
    tools.dispose();
    await page.close();
  }
});

it('retains the original causal action when its delayed write arrives after another click', async () => {
  const page = await browser.newPage();
  await page.goto(base);
  const tools = createPlaywrightUnifiedExecutor(page, { observationV2: true });
  const click = async (label: string) => {
    const state = JSON.parse((await tools.execute({ tool: 'read_page' })).text);
    const ref = state.tree
      .split('\n')
      .find((line: string) => line.includes(`"${label}"`))
      .match(/ref=(e\d+)/)[1];
    return tools.execute({ tool: 'click', ref, ...state });
  };
  try {
    await click('Delayed');
    await click('Read only');
    await page.waitForTimeout(800);
    expect(tools.observation?.interruption()).toMatchObject({ reason: 'unexpected_effect' });
  } finally {
    tools.dispose();
    await page.close();
  }
});

it('exposes same-origin iframe references with their own context, not cross-origin references', async () => {
  const page = await browser.newPage();
  await page.goto(`${base}/frames`);
  const tools = createPlaywrightUnifiedExecutor(page, { observationV2: true });
  try {
    const snap = JSON.parse((await tools.execute({ tool: 'read_page' })).text);
    const frame = snap.frames.find((f: { tree?: string }) => f.tree?.includes('Frame control'));
    expect(frame?.observationRevision).toBeTruthy();
    const ref = frame.tree
      .split('\n')
      .find((line: string) => line.includes('"Frame control"'))
      ?.match(/ref=((?:f\d+)?e\d+)/)?.[1];
    expect(
      await tools.observation!.locator(page.frames()[1]!, ref).count(),
      JSON.stringify(frame),
    ).toBe(1);
    const clicked = await tools.execute({
      tool: 'click',
      ref,
      tabId: snap.tabId,
      frameId: frame.frameId,
      observationRevision: frame.observationRevision,
    });
    expect(clicked.ok, JSON.stringify(clicked)).toBe(true);
    expect(await page.frames()[1]?.locator('button').textContent()).toBe('Read frame successfully');
    const cross = snap.frames.find((f: { sourceURL: string }) => f.sourceURL.includes('localhost'));
    expect(cross?.limitation).toContain('跨源');
    expect(cross?.tree).toBeUndefined();
  } finally {
    tools.dispose();
    await page.close();
  }
});

it('persists pending request details when the full runner exits before the next tool', async () => {
  const page = await browser.newPage();
  await page.goto(base);
  const ticks: Array<{ execution?: { actionKind?: string; effect?: { triggers?: unknown[] } } }> =
    [];
  let turn = 0;
  const adapter: MessagesAdapter = {
    metadata: { provider: 'anthropic', model: 'scripted' },
    async create(request) {
      turn++;
      let tool = { name: 'read_page', input: {} };
      if (turn === 2) {
        const content = request.messages.at(-1)?.content;
        const block = Array.isArray(content) ? content.find((b) => b.type === 'tool_result') : null;
        const state = JSON.parse(
          block && block.type === 'tool_result' ? String(block.content) : '{}',
        );
        const ref = state.tree
          .split('\n')
          .find((s: string) => s.includes('"Delayed"'))
          .match(/ref=(e\d+)/)[1];
        tool = {
          name: 'click',
          input: {
            ref,
            tabId: state.tabId,
            frameId: state.frameId,
            observationRevision: state.observationRevision,
          },
        };
      }
      if (turn === 3) await new Promise((r) => setTimeout(r, 1500));
      return {
        id: String(turn),
        metadata: this.metadata,
        content: [{ type: 'tool_use', id: String(turn), ...tool }],
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
    const result = await runUnifiedSupercarTask({
      taskId: 'pending-effect-audit',
      intent: '点击 Delayed',
      executor: { getPage: async () => page } as never,
      messagesAdapter: adapter,
      maxIterations: 3,
      browserCapabilities: {
        viewportV2: true,
        observationV2: true,
        replayV1: false,
        routingV2: false,
      },
      onTick: (tick) => {
        ticks.push(tick);
      },
    });
    expect(result.status).toBe('awaiting_user');
    expect(
      ticks.find((t) => t.execution?.actionKind === 'browser_effect')?.execution?.effect?.triggers,
    ).toContainEqual(expect.objectContaining({ method: 'POST', url: `${base}/late-write` }));
  } finally {
    await page.close();
  }
});
