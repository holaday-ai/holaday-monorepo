import { beforeEach, describe, expect, it, vi } from 'vitest';
const { createMessage } = vi.hoisted(() => ({ createMessage: vi.fn() }));
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    beta = { messages: { create: createMessage } };
  },
}));
import { env } from '../../config/env.js';
import type { MessagesAdapter, NeutralMessagesRequest } from '../../llm/messages-adapter.js';
import { MessagesAdapterError, createQwenMessagesAdapter } from '../../llm/messages-adapter.js';
import type { PlaywrightExecutor } from '../vision-loop/playwright-executor.js';
import { runSupercarTask, supercarAbort, supercarReply } from './agent-loop.js';
import { BrowserControlSessions } from './browser-control-sessions.js';
import { BrowserControl } from './browser-control.js';
import {
  supercarAbort as abortProductionBrowser,
  runSupercarTask as runProductionBrowser,
} from './qwen-only-agent-loop.js';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function response(content: unknown[], stopReason = 'tool_use') {
  return {
    id: 'response',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-4-6',
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: {
      input_tokens: 10,
      output_tokens: 10,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    },
  };
}
function fixture(onNavigate: (url: string) => Promise<void>) {
  let url = 'https://93.184.216.34/';
  const page = {
    url: () => url,
    title: async () => 'Test page',
    evaluate: async () => ({ bodyTextLen: 100, images: 0, inputs: 0, buttons: 0 }),
    goto: async (next: string) => {
      await onNavigate(next);
      url = next;
    },
    mouse: {
      move: async () => {},
      click: async () => {},
      down: async () => {},
      up: async () => {},
    },
    keyboard: { down: async () => {}, up: async () => {} },
    waitForTimeout: async () => {},
  };
  return {
    page,
    manualNavigate: (next: string) => {
      url = next;
    },
    executor: {
      resetPageForTask: async () => {},
      getPage: async () => page,
      screenshot: async () => ({
        base64: Buffer.from(url).toString('base64'),
        viewportWidth: 1280,
        viewportHeight: 720,
      }),
    } as unknown as PlaywrightExecutor,
  };
}

function qwenTransport(fetchImpl: typeof fetch) {
  return createQwenMessagesAdapter({
    environment: {
      ...env,
      QWEN_MESSAGES_ADAPTER_ENABLED: true,
      DASHSCOPE_CN_API_KEY: 'synthetic-key',
      DASHSCOPE_CN_WORKSPACE_ID: '',
      DASHSCOPE_CN_ANTHROPIC_BASE_URL: 'https://dashscope.aliyuncs.com/apps/anthropic',
      QWEN_VISION_MODEL: 'qwen3-vl-plus',
    },
    region: 'cn',
    purpose: 'vision',
    fetchImpl,
  });
}

describe('Supercar browser ownership checkpoints', () => {
  it.each([
    { provider: 'qwen', coordinate: [500, 500], pixels: [640, 360] },
    { provider: 'anthropic', coordinate: [500, 500], pixels: [500, 500] },
  ])(
    'executes $provider coordinates without rewriting model history',
    async ({ provider, coordinate, pixels }) => {
      const browser = fixture(async () => {});
      const click = vi.fn(async () => ({ ok: true }));
      const capture = vi.fn(async () => null);
      Object.assign(browser.executor, { click, captureTargetDescriptor: capture });
      const action = {
        type: 'tool_use',
        id: 'coordinate-click',
        name: 'computer',
        input: { action: 'left_click', coordinate },
      };
      const bodies: Array<{ messages: Array<{ role: string; content: unknown }> }> = [];
      const final = response([{ type: 'text', text: '已完成操作。' }], 'end_turn');
      const adapter = qwenTransport(async (_url, init) => {
        bodies.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify(bodies.length === 1 ? response([action]) : final));
      });
      createMessage.mockResolvedValueOnce(response([action])).mockResolvedValue(final);
      const onAction = vi.fn();
      const outcome = await runSupercarTask({
        taskId: `coordinate-${provider}`,
        intent: '点击按钮',
        executor: browser.executor,
        apiKey: 'test-key',
        messagesAdapter: provider === 'qwen' ? adapter : undefined,
        onAction,
      });
      expect(outcome.status).toBe('completed');
      expect(click).toHaveBeenCalledWith(browser.page, ...pixels, 'left');
      expect(capture).toHaveBeenCalledWith(browser.page, ...pixels, expect.any(Object));
      expect(onAction).toHaveBeenCalledWith(
        expect.objectContaining({ coordinate: { x: pixels[0], y: pixels[1] } }),
      );
      if (provider === 'qwen') {
        expect(bodies[1]?.messages).toContainEqual({ role: 'assistant', content: [action] });
        expect(JSON.stringify(bodies[0])).not.toContain('坐标系以当前截图的像素为基准');
      }
      expect(action.input.coordinate).toEqual([500, 500]);
    },
  );

  it('rejects out-of-range Qwen coordinates before capture or execution and returns a tool error', async () => {
    const browser = fixture(async () => {});
    const click = vi.fn(async () => ({ ok: true }));
    const capture = vi.fn(async () => null);
    Object.assign(browser.executor, { click, captureTargetDescriptor: capture });
    const bodies: Array<{ messages: unknown[] }> = [];
    const adapter = qwenTransport(async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(
        JSON.stringify(
          bodies.length === 1
            ? response([
                {
                  type: 'tool_use',
                  id: 'invalid-click',
                  name: 'computer',
                  input: { action: 'left_click', coordinate: [1001, 500] },
                },
              ])
            : response([{ type: 'text', text: '坐标需要重新观察。' }], 'end_turn'),
        ),
      );
    });
    await runProductionBrowser({
      taskId: 'invalid-coordinate',
      intent: '点击按钮',
      messagesAdapter: adapter,
      executor: browser.executor,
      onAction: vi.fn(),
    });
    expect(click).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
    expect(bodies[1]?.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'user',
          content: expect.arrayContaining([
            expect.objectContaining({
              type: 'tool_result',
              tool_use_id: 'invalid-click',
              is_error: true,
              content: expect.stringContaining('coordinate'),
            }),
          ]),
        }),
      ]),
    );
  });

  it('uses each observed viewport for subsequent Qwen actions and preserves drag endpoints', async () => {
    const browser = fixture(async () => {});
    const click = vi.fn(async () => ({ ok: true }));
    const move = vi.fn(async () => {});
    browser.page.mouse.move = move;
    const sizes = [
      [1280, 720],
      [800, 600],
      [800, 600],
    ];
    let shots = 0;
    Object.assign(browser.executor, {
      click,
      screenshot: async () => {
        const size = sizes[Math.min(shots++, 2)];
        if (!size) throw new Error('Missing viewport fixture');
        const [viewportWidth, viewportHeight] = size;
        return {
          base64: Buffer.from(`frame-${shots}`).toString('base64'),
          viewportWidth,
          viewportHeight,
        };
      },
    });
    const actions = [
      {
        type: 'tool_use',
        id: 'first-size',
        name: 'computer',
        input: { action: 'left_click', coordinate: [500, 500] },
      },
      {
        type: 'tool_use',
        id: 'second-size',
        name: 'computer',
        input: { action: 'left_click_drag', start_coordinate: [250, 750], coordinate: [750, 250] },
      },
    ];
    let calls = 0;
    const adapter = qwenTransport(
      async () =>
        new Response(
          JSON.stringify(
            calls < actions.length
              ? response([actions[calls++]])
              : response([{ type: 'text', text: '已完成操作。' }], 'end_turn'),
          ),
        ),
    );
    expect(
      await runProductionBrowser({
        taskId: 'coordinate-resize',
        intent: '点击后拖拽',
        messagesAdapter: adapter,
        executor: browser.executor,
      }),
    ).toMatchObject({ status: 'completed' });
    expect(click).toHaveBeenCalledWith(browser.page, 640, 360, 'left');
    expect(move.mock.calls).toEqual([
      [200, 450],
      [600, 150],
    ]);
    expect(actions[1]?.input.start_coordinate).toEqual([250, 750]);
  });

  it('does not execute a queued coordinate action after the viewport changed', async () => {
    const browser = fixture(async () => {});
    const click = vi.fn(async () => ({ ok: true }));
    let shots = 0;
    Object.assign(browser.executor, {
      click,
      screenshot: async () => ({
        base64: Buffer.from(`frame-${shots}`).toString('base64'),
        viewportWidth: shots++ === 0 ? 1280 : 800,
        viewportHeight: 600,
      }),
    });
    const bodies: Array<{ messages: unknown[] }> = [];
    const adapter = qwenTransport(async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(
        JSON.stringify(
          bodies.length === 1
            ? response([
                {
                  type: 'tool_use',
                  id: 'resize',
                  name: 'computer',
                  input: { action: 'left_click', coordinate: [500, 500] },
                },
                {
                  type: 'tool_use',
                  id: 'stale',
                  name: 'computer',
                  input: { action: 'left_click', coordinate: [750, 500] },
                },
              ])
            : response([{ type: 'text', text: '需要重新观察。' }], 'end_turn'),
        ),
      );
    });
    await runProductionBrowser({
      taskId: 'coordinate-batch-resize',
      intent: '点击两个按钮',
      messagesAdapter: adapter,
      executor: browser.executor,
    });
    expect(click).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(bodies[1])).toContain('viewport changed');
  });

  it('classifies Qwen transport timeout as timeout rather than generic failure', async () => {
    const adapter = qwenTransport(async () => {
      throw new Error('unused network boundary');
    });
    adapter.create = async () => {
      throw new MessagesAdapterError('REQUEST_TIMEOUT', 'Qwen request timeout');
    };
    const outcome = await runProductionBrowser({
      taskId: 'qwen-timeout',
      intent: '核对网页',
      messagesAdapter: adapter,
      executor: fixture(async () => {}).executor,
    });
    expect(outcome.status).toBe('timeout');
  });
  beforeEach(() => {
    createMessage.mockReset();
  });

  it('reobserves manual changes through the Qwen wire and discards the stale model action', async () => {
    const control = new BrowserControl();
    const release = deferred();
    const effects: string[] = [];
    const browser = fixture(async (url) => {
      effects.push(url);
    });
    const bodies: string[] = [];
    const adapter = qwenTransport(async (_url, init) => {
      bodies.push(String(init?.body));
      if (bodies.length === 1) {
        await release.promise;
        return new Response(
          JSON.stringify(
            response([
              {
                type: 'tool_use',
                id: 'stale-nav',
                name: 'navigate',
                input: { url: 'https://93.184.216.34/stale' },
              },
            ]),
          ),
        );
      }
      return new Response(
        JSON.stringify(response([{ type: 'text', text: '已根据接管后的页面继续。' }], 'end_turn')),
      );
    });
    const run = runProductionBrowser({
      taskId: 'qwen-handback',
      intent: '核对网页',
      messagesAdapter: adapter,
      executor: browser.executor,
      browserControl: control,
    });
    try {
      await vi.waitFor(() => expect(bodies).toHaveLength(1));
      control.requestHuman();
      release.resolve();
      await vi.waitFor(() => expect(control.snapshot().phase).toBe('human'));
      browser.manualNavigate('https://93.184.216.34/manual');
      control.returnToAgent(control.snapshot().lease ?? '');
      expect(await run).toMatchObject({ status: 'completed' });
      expect(effects).toEqual([]);
      expect(bodies).toHaveLength(2);
      expect(bodies[1]).toContain(Buffer.from('https://93.184.216.34/manual').toString('base64'));
      expect(bodies[1]).not.toContain('stale-nav');
      expect(createMessage).not.toHaveBeenCalled();
    } finally {
      release.resolve();
      abortProductionBrowser('qwen-handback');
      await run;
    }
  });

  it('cancels a pending Qwen network call through the public production handle', async () => {
    let signal: AbortSignal | undefined;
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      signal = init?.signal ?? undefined;
      return new Promise((_resolve, reject) =>
        signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {
          once: true,
        }),
      );
    });
    const run = runProductionBrowser({
      taskId: 'qwen-abort',
      intent: '核对网页',
      messagesAdapter: qwenTransport(fetchImpl),
      executor: fixture(async () => {}).executor,
    });
    await vi.waitFor(() => expect(signal).toBeDefined());
    expect(abortProductionBrowser('qwen-abort')).toBe(true);
    expect(await run).toMatchObject({ status: 'cancelled' });
    expect(signal?.aborted).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('runs a Qwen visual task without Anthropic and returns correlated screenshots after navigation', async () => {
    const effects: string[] = [];
    const requests: NeutralMessagesRequest[] = [];
    const browser = fixture(async (url) => {
      effects.push(url);
    });
    const metadata = {
      provider: 'alibaba-model-studio',
      model: 'qwen-vision-fixture',
      region: 'cn',
      deploymentScope: 'china_mainland',
      endpointKind: 'public',
      protocol: 'messages',
    } as const;
    const adapter: MessagesAdapter = {
      metadata,
      async create(request) {
        requests.push(request);
        return {
          id: 'qwen-reply',
          metadata,
          content:
            requests.length === 1
              ? [
                  {
                    type: 'tool_use',
                    id: 'navigate-1',
                    name: 'navigate',
                    input: { url: 'https://93.184.216.34/new' },
                  },
                ]
              : [{ type: 'text', text: '完成。' }],
          stopReason: requests.length === 1 ? 'tool_use' : 'end_turn',
          usage: {
            inputTokens: 10,
            outputTokens: 10,
            cacheReadInputTokens: null,
            cacheCreationInputTokens: null,
            complete: true,
          },
        };
      },
    };
    const outcome = await runSupercarTask({
      taskId: 'qwen-browser',
      intent: '查看网页',
      apiKey: '',
      executor: browser.executor,
      messagesAdapter: adapter,
      maxIterations: 3,
    });
    expect(outcome.status).toBe('completed');
    expect(effects).toEqual(['https://93.184.216.34/new']);
    expect(createMessage).not.toHaveBeenCalled();
    expect(requests[0]?.tools?.find((tool) => tool.name === 'computer')?.inputSchema).toMatchObject(
      { required: ['action'] },
    );
    expect(requests[0]?.tools?.some((tool) => tool.name === 'web_search')).toBe(false);
    expect(requests[1]?.messages.at(-2)?.content).toEqual([
      expect.objectContaining({
        type: 'tool_result',
        toolUseId: 'navigate-1',
        content: expect.any(String),
      }),
    ]);
    const last = requests[1]?.messages.at(-1)?.content;
    expect(last).toEqual(
      expect.arrayContaining([
        { type: 'text', text: '工具 navigate-1 返回的页面截图：' },
        expect.objectContaining({
          type: 'image',
          source: expect.objectContaining({
            data: Buffer.from('https://93.184.216.34/new').toString('base64'),
          }),
        }),
      ]),
    );
  });

  it('registers and settles a fresh browser binding for each run', async () => {
    const sessions = new BrowserControlSessions();
    const instance = { taskId: 'bound-run', userId: 'owner' };
    const browser = fixture(async () => undefined);
    const phases: string[] = [];
    createMessage.mockImplementation(async () => {
      phases.push(
        sessions.get(instance, 'owner', 'bound-run')?.control.snapshot().phase ?? 'missing',
      );
      return response([{ type: 'text', text: '完成。' }], 'end_turn');
    });
    for (let attempt = 0; attempt < 2; attempt++) {
      await runSupercarTask({
        taskId: 'bound-run',
        intent: '读取',
        apiKey: 'test-key',
        executor: browser.executor,
        browserControlFactory: () => sessions.start(instance),
      });
      expect(sessions.get(instance, 'owner', 'bound-run')?.active).toBe(false);
    }
    expect(phases).toEqual(['agent', 'agent']);
  });

  it.each(['login', 'confirmation', 'question'] as const)(
    'honors takeover during an existing %s wait and holds the reply until handback',
    async (kind) => {
      const control = new BrowserControl();
      const awaiting = deferred();
      const effects: string[] = [];
      const browser = fixture(async () => {
        effects.push('stale-action');
      });
      createMessage
        .mockResolvedValueOnce(
          kind === 'question'
            ? response(
                [{ type: 'text', text: '请先登录后回复继续。[AWAITING_USER_INPUT]' }],
                'end_turn',
              )
            : response([
                {
                  type: 'tool_use',
                  id: 'nav',
                  name: 'navigate',
                  input: { url: 'https://93.184.216.34/old' },
                },
              ]),
        )
        .mockImplementation(async () => {
          effects.push('replan');
          return response([{ type: 'text', text: '完成。' }], 'end_turn');
        });
      const taskId = `wait-control-${kind}`;
      const run = runSupercarTask({
        taskId,
        intent: '查看网页',
        executor: browser.executor,
        apiKey: 'test-key',
        browserControl: control,
        maxIterations: 4,
        onAwaitingUser: async () => {
          awaiting.resolve();
        },
        onBeforeAction: async () =>
          kind === 'login'
            ? { allowed: false, requiresTakeover: true, awaitingKind: 'login' }
            : { allowed: false, requiresConfirmation: true },
      });
      try {
        await awaiting.promise;
        control.requestHuman();
        await vi.waitFor(() => expect(control.snapshot().phase).toBe('human'));
        expect(supercarReply(taskId, '确认执行')).toBe(true);
        await Promise.resolve();
        expect(effects).toEqual([]);
        control.returnToAgent(control.snapshot().lease ?? '');
        expect(await run).toMatchObject({ status: 'completed' });
        expect(effects).toEqual(['replan']);
      } finally {
        supercarAbort(taskId);
        control.close();
        await run;
      }
    },
  );

  it.each(['navigate', 'computer'] as const)(
    'discards a pending %s if resize arrives during asynchronous preflight',
    async (tool) => {
      const control = new BrowserControl();
      const effects: string[] = [];
      const browser = fixture(async () => {
        effects.push('stale-navigation');
      });
      let width = 1280;
      let height = 720;
      const modelSizes: unknown[] = [];
      Object.assign(browser.executor, {
        screenshot: async () => ({
          base64: Buffer.from(browser.page.url()).toString('base64'),
          viewportWidth: width,
          viewportHeight: height,
        }),
        click: async () => {
          effects.push('stale-click');
          return { ok: true };
        },
      });
      let calls = 0;
      createMessage.mockImplementation(async (input) => {
        const computer = input.tools.find((tool: { name: string }) => tool.name === 'computer');
        modelSizes.push([computer.display_width_px, computer.display_height_px]);
        calls++;
        if (calls > 1) {
          expect(JSON.stringify(input.messages)).toContain(
            Buffer.from('https://93.184.216.34/resized').toString('base64'),
          );
          effects.push('replanned');
          return response([{ type: 'text', text: '完成。' }], 'end_turn');
        }
        return response([
          {
            type: 'tool_use',
            id: 'old',
            name: tool,
            input:
              tool === 'navigate'
                ? { url: 'https://93.184.216.34/stale' }
                : { action: 'left_click', coordinate: [10, 20] },
          },
        ]);
      });
      const result = await runSupercarTask({
        taskId: `resize-preflight-${tool}`,
        intent: '核对网页',
        executor: browser.executor,
        apiKey: 'test-key',
        browserControl: control,
        maxIterations: 3,
        onBeforeAction: async () => {
          control.queueViewport(async () => {
            effects.push('resized');
            width = 800;
            height = 600;
            browser.manualNavigate('https://93.184.216.34/resized');
          });
          return { allowed: true };
        },
      });
      expect(result.status).toBe('completed');
      expect(effects).toEqual(['resized', 'replanned']);
      expect(modelSizes).toEqual([
        [1280, 720],
        [800, 600],
      ]);
    },
  );

  it.each(['navigate', 'computer'] as const)(
    'does not start %s when takeover arrives during its asynchronous veto',
    async (tool) => {
      const control = new BrowserControl();
      const enteredVeto = deferred();
      const finishVeto = deferred();
      const effects: string[] = [];
      const browser = fixture(async () => {
        effects.push('navigate');
      });
      Object.assign(browser.executor, {
        click: async () => {
          effects.push('click');
          return { ok: true };
        },
      });
      createMessage
        .mockResolvedValueOnce(
          response([
            {
              type: 'tool_use',
              id: 'pending',
              name: tool,
              input:
                tool === 'navigate'
                  ? { url: 'https://93.184.216.34/should-not-open' }
                  : { action: 'left_click', coordinate: [10, 20] },
            },
          ]),
        )
        .mockResolvedValue(response([{ type: 'text', text: '核对完成。' }], 'end_turn'));
      const taskId = `browser-control-veto-${tool}`;
      const run = runSupercarTask({
        taskId,
        intent: '核对页面',
        executor: browser.executor,
        apiKey: 'test-key',
        browserControl: control,
        maxIterations: 3,
        onBeforeAction: async () => {
          enteredVeto.resolve();
          await finishVeto.promise;
          return { allowed: true };
        },
      });
      try {
        await enteredVeto.promise;
        control.requestHuman();
        finishVeto.resolve();
        await vi.waitFor(() => expect(control.snapshot().phase).toBe('human'));
        expect(effects).toEqual([]);
        control.returnToAgent(control.snapshot().lease ?? '');
        expect(await run).toMatchObject({ status: 'completed' });
        expect(effects).toEqual([]);
      } finally {
        finishVeto.resolve();
        control.close();
        supercarAbort(taskId);
        await run;
      }
    },
  );

  it('waits for the current navigation, discards its stale sibling, then observes the manual page', async () => {
    const control = new BrowserControl();
    const started = deferred();
    const finish = deferred();
    const navigations: string[] = [];
    const browser = fixture(async (url) => {
      navigations.push(url);
      if (navigations.length === 1) {
        started.resolve();
        await finish.promise;
      }
    });
    const modelInputs: unknown[] = [];
    createMessage.mockImplementation(async (input) => {
      modelInputs.push(JSON.parse(JSON.stringify(input.messages)));
      return modelInputs.length === 1
        ? response([
            {
              type: 'tool_use',
              id: 'nav_first',
              name: 'navigate',
              input: { url: 'https://93.184.216.34/first' },
            },
            {
              type: 'tool_use',
              id: 'nav_stale',
              name: 'navigate',
              input: { url: 'https://93.184.216.34/stale' },
            },
          ])
        : response([{ type: 'text', text: '页面已核对，完成。' }], 'end_turn');
    });
    const taskId = 'browser-control-between-tools';
    const run = runSupercarTask({
      taskId,
      intent: '核对网页',
      executor: browser.executor,
      apiKey: 'test-key',
      browserControl: control,
      maxIterations: 4,
    });
    try {
      await started.promise;
      control.requestHuman();
      expect(control.snapshot().phase).toBe('requested');
      expect(control.snapshot().lease).toBeNull();
      finish.resolve();
      await vi.waitFor(() => expect(control.snapshot().phase).toBe('human'));
      const token = control.snapshot().lease ?? '';
      await control.runHuman(token, async () => {
        browser.manualNavigate('https://93.184.216.34/manual');
      });
      control.returnToAgent(token);
      expect(await run).toMatchObject({ status: 'completed' });
      expect(navigations).toEqual(['https://93.184.216.34/first']);
      const nextInput = JSON.stringify(modelInputs[1]);
      expect(nextInput).toContain('nav_stale'); // Every tool_use still has its result.
      expect(nextInput).toContain('https://93.184.216.34/manual');
      expect(nextInput).toContain(Buffer.from('https://93.184.216.34/manual').toString('base64'));
      expect(control.snapshot().phase).toBe('closed');
    } finally {
      finish.resolve();
      control.close();
      supercarAbort(taskId);
      await run;
    }
  });

  it('does not run an old model response after handoff requested during model latency', async () => {
    const control = new BrowserControl();
    const thinking = deferred();
    const finishThinking = deferred();
    const navigations: string[] = [];
    const browser = fixture(async (url) => {
      navigations.push(url);
    });
    const modelInputs: unknown[] = [];
    createMessage.mockImplementation(async (input) => {
      modelInputs.push(JSON.parse(JSON.stringify(input.messages)));
      if (modelInputs.length === 1) {
        thinking.resolve();
        await finishThinking.promise;
        return response([
          {
            type: 'tool_use',
            id: 'old',
            name: 'navigate',
            input: { url: 'https://93.184.216.34/old' },
          },
        ]);
      }
      return response([{ type: 'text', text: '核对完成。' }], 'end_turn');
    });
    const taskId = 'browser-control-during-model';
    const run = runSupercarTask({
      taskId,
      intent: '核对网页',
      executor: browser.executor,
      apiKey: 'test-key',
      browserControl: control,
      maxIterations: 4,
    });
    try {
      await thinking.promise;
      control.requestHuman();
      finishThinking.resolve();
      await vi.waitFor(() => expect(control.snapshot().phase).toBe('human'));
      const token = control.snapshot().lease ?? '';
      await control.runHuman(token, async () => {
        browser.manualNavigate('https://93.184.216.34/new');
      });
      control.returnToAgent(token);
      expect(await run).toMatchObject({ status: 'completed' });
      expect(navigations).toEqual([]);
      expect(JSON.stringify(modelInputs[1])).toContain('https://93.184.216.34/new');
    } finally {
      finishThinking.resolve();
      control.close();
      supercarAbort(taskId);
      await run;
    }
  });

  it('aborts a manually parked task without waiting for a user return', async () => {
    const control = new BrowserControl();
    const browser = fixture(async () => {});
    control.requestHuman();
    createMessage.mockResolvedValue(response([{ type: 'text', text: '完成。' }], 'end_turn'));
    const taskId = 'browser-control-abort';
    const run = runSupercarTask({
      taskId,
      intent: '核对网页',
      executor: browser.executor,
      apiKey: 'test-key',
      browserControl: control,
    });
    try {
      await vi.waitFor(() => expect(control.snapshot().phase).toBe('human'));
      expect(supercarAbort(taskId)).toBe(true);
      expect(await run).toMatchObject({ status: 'cancelled' });
      expect(control.snapshot().phase).toBe('closed');
    } finally {
      control.close();
      supercarAbort(taskId);
      await run;
    }
  });

  it('does not spend the AI execution deadline while the user owns the browser', async () => {
    let now = 1_000;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    const control = new BrowserControl();
    const browser = fixture(async () => {});
    control.requestHuman();
    createMessage.mockResolvedValue(response([{ type: 'text', text: '核对完成。' }], 'end_turn'));
    const taskId = 'browser-control-wait-budget';
    const run = runSupercarTask({
      taskId,
      intent: '核对网页',
      executor: browser.executor,
      apiKey: 'test-key',
      browserControl: control,
      timeoutMs: 1_000,
    });
    try {
      await vi.waitFor(() => expect(control.snapshot().phase).toBe('human'));
      now = 61_000;
      control.returnToAgent(control.snapshot().lease ?? '');
      expect(await run).toMatchObject({ status: 'completed' });
    } finally {
      control.close();
      supercarAbort(taskId);
      await run;
      clock.mockRestore();
    }
  });
});
