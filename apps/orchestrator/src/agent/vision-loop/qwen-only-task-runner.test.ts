import { type Browser, chromium } from 'playwright';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import type { MessagesAdapter } from '../../llm/messages-adapter.js';
import { startVisionLoopTask } from './qwen-only-task-runner.js';

const reuse = vi.hoisted(() => vi.fn(async () => null));
vi.mock('../../playbook/evolution/executor-hooks.js', () => ({
  tryPlaybookReuse: reuse,
  createTaskCaptureRecorder: () => ({ recordToolCall: vi.fn(), recordOutcome: vi.fn() }),
}));
let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
});
afterAll(async () => {
  await browser.close();
});
afterEach(() => {
  reuse.mockReset();
});

it.each(['blank', 'wall', 'unsupported-download', 'reuse-blank', 'reuse-wall'])(
  'keeps the vision unified entry honest: %s',
  async (mode) => {
    const page = await browser.newPage();
    try {
      if (mode.includes('wall')) {
        await page.route('https://fixture.browser.test/', (route) =>
          route.fulfill({
            contentType: 'text/html; charset=utf-8',
            body: '<p>Sign in to confirm you’re not a bot</p>',
          }),
        );
        await page.goto('https://fixture.browser.test/');
      }
      if (mode.startsWith('reuse-')) reuse.mockResolvedValue({ handled: true } as never);
      let offered: string[] = [];
      const adapter: MessagesAdapter = {
        metadata: { provider: 'anthropic', model: 'fixed-test' },
        async create(request) {
          offered = request.tools?.map((tool) => tool.name) ?? [];
          return {
            id: 'finish',
            metadata: this.metadata,
            content: [
              {
                type: 'tool_use',
                id: 'finish',
                name: 'finish',
                input: {
                  status: 'completed',
                  summary: 'invented',
                  evidence: 'invented',
                },
              },
            ],
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
      const result = await startVisionLoopTask({
        taskId: `vision-${mode}`,
        userId: 'test-user',
        intent: 'Read with browser',
        commander: {} as never,
        playwrightExecutor: { getPage: async () => page } as never,
        messagesAdapter: adapter,
        maxSteps: 1,
        ...(mode.startsWith('reuse-')
          ? {
              evolution: {
                db: {} as never,
                taskDbId: 1,
                generateAdapter: null,
                logger: {} as never,
              },
            }
          : {}),
      });
      if (mode === 'unsupported-download') {
        expect(offered).not.toContain('download');
        expect(offered).not.toContain('upload');
      } else expect(result.status).toBe(mode.includes('wall') ? 'paused' : 'failed');
    } finally {
      await page.close();
    }
  },
);

it('recovers a zero-step answer through real navigation and then completes the vision entry', async () => {
  const page = await browser.newPage();
  try {
    await page.route('https://fixture.browser.test/', (route) =>
      route.fulfill({
        contentType: 'text/html; charset=utf-8',
        body: '<h1>Read result</h1>',
      }),
    );
    let turn = 0;
    const adapter: MessagesAdapter = {
      metadata: { provider: 'anthropic', model: 'fixed-test' },
      async create() {
        const steps = [
          ['finish', { status: 'completed', summary: 'invented', evidence: 'invented' }],
          ['navigate', { url: 'https://fixture.browser.test/' }],
          ['snapshot', {}],
          ['finish', { status: 'completed', summary: 'Read result', evidence: 'Read result' }],
        ] as const;
        const [name, input] = steps[turn++]!;
        return {
          id: String(turn),
          metadata: this.metadata,
          content: [{ type: 'tool_use', id: String(turn), name, input }],
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
    const result = await startVisionLoopTask({
      taskId: 'vision-read',
      userId: 'test-user',
      intent: 'Read with browser',
      commander: {} as never,
      playwrightExecutor: { getPage: async () => page } as never,
      messagesAdapter: adapter,
      maxSteps: 4,
    });
    expect(result).toMatchObject({ status: 'completed', summary: 'Read result' });
    expect(page.url()).toBe('https://fixture.browser.test/');
  } finally {
    await page.close();
  }
});

it('does not reuse a playbook or fall back to commander when browser roles are configured', async () => {
  const readonly: MessagesAdapter = {
    metadata: {
      provider: 'alibaba-model-studio',
      model: 'test-role',
      region: 'cn',
      deploymentScope: 'china_mainland',
      endpointKind: 'public',
      protocol: 'messages',
    },
    async create() {
      throw new Error('planned test failure');
    },
  };
  const adapter = { ...readonly, browserBrain: { planning: readonly, verification: readonly } };
  const common = {
    taskId: 'role-task',
    userId: 'test-user',
    intent: 'Read Alpha',
    commander: {} as never,
    messagesAdapter: adapter,
  };
  expect((await startVisionLoopTask(common)).status).toBe('failed');
  const page = await browser.newPage();
  try {
    reuse.mockResolvedValue({ handled: true } as never);
    const result = await startVisionLoopTask({
      ...common,
      playwrightExecutor: { getPage: async () => page } as never,
      evolution: {
        db: {} as never,
        taskDbId: 1,
        generateAdapter: {} as never,
        logger: {} as never,
      },
    });
    expect(result.status).toBe('failed');
    expect(reuse).not.toHaveBeenCalled();
  } finally {
    await page.close();
  }
});
