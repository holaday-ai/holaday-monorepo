import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createMessage } = vi.hoisted(() => ({
  createMessage: vi.fn(),
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class AnthropicMock {
    beta = {
      messages: {
        create: createMessage,
      },
    };
  },
}));

import type { PlaywrightExecutor } from '../vision-loop/playwright-executor.js';
import {
  hasParkedSupercarHandle,
  runSupercarTask,
  supercarAbort,
  supercarReply,
} from './agent-loop.js';

function response(content: unknown[], stopReason: string) {
  return {
    id: `msg_${Math.random()}`,
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-4-6',
    stop_reason: stopReason,
    stop_sequence: null,
    content,
    usage: {
      input_tokens: 10,
      output_tokens: 10,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    },
  };
}

describe('runSupercarTask credential takeover', () => {
  beforeEach(() => {
    createMessage.mockReset();
  });

  it('does not replay the stale credential input after the user takes over', async () => {
    createMessage
      .mockResolvedValueOnce(
        response(
          [
            {
              type: 'tool_use',
              id: 'tool_password',
              name: 'computer',
              input: { action: 'type', text: 'never-type-this' },
            },
          ],
          'tool_use',
        ),
      )
      .mockResolvedValueOnce(
        response([{ type: 'text', text: '登录完成，继续执行任务。' }], 'end_turn'),
      );

    let currentUrl = 'https://example.com/login';
    const page = {
      url: () => currentUrl,
      title: vi.fn(async () => currentUrl.endsWith('/login') ? 'Sign in' : 'Dashboard'),
      evaluate: vi.fn(async () => ''),
      mouse: {
        move: vi.fn(async () => undefined),
        click: vi.fn(async () => undefined),
        down: vi.fn(async () => undefined),
        up: vi.fn(async () => undefined),
      },
      keyboard: {
        down: vi.fn(async () => undefined),
        up: vi.fn(async () => undefined),
      },
      waitForTimeout: vi.fn(async () => undefined),
    };
    const type = vi.fn(async () => ({ ok: true, message: 'typed' }));
    const executor = {
      resetPageForTask: vi.fn(async () => undefined),
      getPage: vi.fn(async () => page),
      screenshot: vi.fn(async () => ({
        base64: 'dGVzdA==',
        viewportWidth: 1280,
        viewportHeight: 720,
      })),
      captureTargetDescriptor: vi.fn(async () => ({
        type: 'password',
        tagName: 'INPUT',
        placeholder: '密码',
        url: 'https://example.com/login',
      })),
      type,
    } as unknown as PlaywrightExecutor;

    let signalAwaiting: (() => void) | null = null;
    const awaiting = new Promise<void>((resolve) => {
      signalAwaiting = resolve;
    });
    const taskId = 'tsk_takeover_no_replay';
    const run = runSupercarTask({
      taskId,
      intent: '登录后继续查询',
      executor,
      apiKey: 'test-key',
      maxIterations: 2,
      timeoutMs: 5_000,
      onBeforeAction: async (action) =>
        action.kind === 'type'
          ? {
              allowed: false,
              requiresTakeover: true,
              awaitingKind: 'login',
              reason: '请用户接管输入凭证',
            }
          : { allowed: true },
      onAwaitingUser: async () => {
        signalAwaiting?.();
      },
    });

    await awaiting;
    await vi.waitFor(() => {
      expect(hasParkedSupercarHandle(taskId)).toBe(true);
    });
    currentUrl = 'https://example.com/dashboard';
    expect(supercarReply(taskId, '我已完成登录')).toBe(true);

    const outcome = await run;

    expect(outcome.status).toBe('completed');
    expect(type).not.toHaveBeenCalled();
    expect(createMessage).toHaveBeenCalledTimes(2);
    const secondRequest = createMessage.mock.calls[1]?.[0] as {
      messages: Array<{
        role: string;
        content: Array<{ type: string; text?: string }>;
      }>;
    };
    // The loop appends the second assistant response to the same messages
    // array after the mocked request resolves, so the resumed user turn is
    // immediately before that final assistant entry.
    const resumedTurn = secondRequest.messages.at(-2);
    expect(resumedTurn?.role).toBe('user');
    expect(resumedTurn?.content[0]?.type).toBe('tool_result');
    expect(resumedTurn?.content.at(-1)).toMatchObject({
      type: 'text',
      text: '我已完成登录',
    });
  });

  it('keeps a post-navigation login reply behind the pending tool result', async () => {
    createMessage
      .mockResolvedValueOnce(
        response(
          [
            {
              type: 'tool_use',
              id: 'tool_navigate_login',
              name: 'navigate',
              input: { url: 'https://93.184.216.34/login' },
            },
          ],
          'tool_use',
        ),
      )
      .mockResolvedValueOnce(
        response([{ type: 'text', text: '已进入工作台。' }], 'end_turn'),
      );

    let currentUrl = 'about:blank';
    const page = {
      url: () => currentUrl,
      goto: vi.fn(async (url: string) => {
        currentUrl = url;
      }),
      title: vi.fn(async () => currentUrl.endsWith('/login') ? 'Sign in' : 'Dashboard'),
      evaluate: vi.fn(async (fn: unknown) => {
        if (String(fn).includes('textLength')) {
          return { textLength: 20, images: 0, iframes: 0, inputs: 1, buttons: 1 };
        }
        return currentUrl.endsWith('/login') ? 'Sign in to continue' : 'Dashboard';
      }),
      mouse: {
        move: vi.fn(async () => undefined),
        click: vi.fn(async () => undefined),
        down: vi.fn(async () => undefined),
        up: vi.fn(async () => undefined),
      },
      keyboard: {
        down: vi.fn(async () => undefined),
        up: vi.fn(async () => undefined),
      },
      waitForTimeout: vi.fn(async () => undefined),
    };
    const executor = {
      resetPageForTask: vi.fn(async () => undefined),
      getPage: vi.fn(async () => page),
      screenshot: vi.fn(async () => ({
        base64: 'dGVzdA==',
        viewportWidth: 1280,
        viewportHeight: 720,
      })),
    } as unknown as PlaywrightExecutor;

    let signalAwaiting: (() => void) | null = null;
    const awaitingKinds: string[] = [];
    const awaiting = new Promise<void>((resolve) => {
      signalAwaiting = resolve;
    });
    const taskId = 'tsk_post_navigation_takeover';
    const run = runSupercarTask({
      taskId,
      intent: '打开工作台并继续查询',
      executor,
      apiKey: 'test-key',
      maxIterations: 2,
      timeoutMs: 5_000,
      onAwaitingUser: async (event) => {
        awaitingKinds.push(event.awaitingKind);
        signalAwaiting?.();
      },
    });

    await awaiting;
    await vi.waitFor(() => {
      expect(hasParkedSupercarHandle(taskId)).toBe(true);
    });
    currentUrl = 'https://93.184.216.34/dashboard';
    expect(supercarReply(taskId, '登录完成')).toBe(true);

    const outcome = await run;

    expect(outcome.status).toBe('completed');
    expect(awaitingKinds).toEqual(['login']);
    const secondRequest = createMessage.mock.calls[1]?.[0] as {
      messages: Array<{
        role: string;
        content: Array<{ type: string; text?: string }>;
      }>;
    };
    const resumedTurn = secondRequest.messages.at(-2);
    expect(resumedTurn?.content[0]?.type).toBe('tool_result');
    expect(resumedTurn?.content.at(-1)).toMatchObject({
      type: 'text',
      text: '登录完成',
    });
  });

  it('honours cancellation fired while the takeover notice is being delivered', async () => {
    createMessage.mockResolvedValueOnce(
      response(
        [
          {
            type: 'tool_use',
            id: 'tool_password_abort',
            name: 'computer',
            input: { action: 'type', text: 'never-type-this' },
          },
        ],
        'tool_use',
      ),
    );

    const page = {
      url: () => 'https://example.com/login',
      title: vi.fn(async () => 'Sign in'),
      evaluate: vi.fn(async () => ''),
      mouse: {
        move: vi.fn(async () => undefined),
        click: vi.fn(async () => undefined),
        down: vi.fn(async () => undefined),
        up: vi.fn(async () => undefined),
      },
      keyboard: {
        down: vi.fn(async () => undefined),
        up: vi.fn(async () => undefined),
      },
      waitForTimeout: vi.fn(async () => undefined),
    };
    const type = vi.fn(async () => ({ ok: true, message: 'typed' }));
    const executor = {
      resetPageForTask: vi.fn(async () => undefined),
      getPage: vi.fn(async () => page),
      screenshot: vi.fn(async () => ({
        base64: 'dGVzdA==',
        viewportWidth: 1280,
        viewportHeight: 720,
      })),
      captureTargetDescriptor: vi.fn(async () => ({
        type: 'password',
        tagName: 'INPUT',
        placeholder: '密码',
        url: 'https://example.com/login',
      })),
      type,
    } as unknown as PlaywrightExecutor;

    const taskId = 'tsk_takeover_abort_race';
    const outcome = await runSupercarTask({
      taskId,
      intent: '登录后继续查询',
      executor,
      apiKey: 'test-key',
      maxIterations: 1,
      timeoutMs: 5_000,
      onBeforeAction: async () => ({
        allowed: false,
        requiresTakeover: true,
        awaitingKind: 'login',
        reason: '请用户接管输入凭证',
      }),
      onAwaitingUser: async () => {
        expect(supercarAbort(taskId)).toBe(true);
      },
    });

    expect(outcome.status).toBe('cancelled');
    expect(type).not.toHaveBeenCalled();
  });

  it('accepts a takeover reply emitted while the notice is being delivered', async () => {
    createMessage
      .mockResolvedValueOnce(
        response(
          [
            {
              type: 'tool_use',
              id: 'tool_password_immediate_reply',
              name: 'computer',
              input: { action: 'type', text: 'never-type-this' },
            },
          ],
          'tool_use',
        ),
      )
      .mockResolvedValueOnce(
        response([{ type: 'text', text: '登录完成，继续执行任务。' }], 'end_turn'),
      );

    let currentUrl = 'https://example.com/login';
    const page = {
      url: () => currentUrl,
      title: vi.fn(async () => currentUrl.endsWith('/login') ? 'Sign in' : 'Dashboard'),
      evaluate: vi.fn(async () => ''),
      mouse: {
        move: vi.fn(async () => undefined),
        click: vi.fn(async () => undefined),
        down: vi.fn(async () => undefined),
        up: vi.fn(async () => undefined),
      },
      keyboard: {
        down: vi.fn(async () => undefined),
        up: vi.fn(async () => undefined),
      },
      waitForTimeout: vi.fn(async () => undefined),
    };
    const type = vi.fn(async () => ({ ok: true, message: 'typed' }));
    const executor = {
      resetPageForTask: vi.fn(async () => undefined),
      getPage: vi.fn(async () => page),
      screenshot: vi.fn(async () => ({
        base64: 'dGVzdA==',
        viewportWidth: 1280,
        viewportHeight: 720,
      })),
      captureTargetDescriptor: vi.fn(async () => ({
        type: 'password',
        tagName: 'INPUT',
        placeholder: '密码',
        url: currentUrl,
      })),
      type,
    } as unknown as PlaywrightExecutor;

    const taskId = 'tsk_takeover_immediate_reply';
    const outcome = await runSupercarTask({
      taskId,
      intent: '登录后继续查询',
      executor,
      apiKey: 'test-key',
      maxIterations: 2,
      timeoutMs: 5_000,
      onBeforeAction: async () => ({
        allowed: false,
        requiresTakeover: true,
        awaitingKind: 'login',
        reason: '请用户接管输入凭证',
      }),
      onAwaitingUser: async () => {
        currentUrl = 'https://example.com/dashboard';
        expect(supercarReply(taskId, '登录完成')).toBe(true);
      },
    });

    expect(outcome.status).toBe('completed');
    expect(type).not.toHaveBeenCalled();
  });

  it('accepts an immediate reply when a text-only turn requests browser takeover', async () => {
    createMessage
      .mockResolvedValueOnce(
        response(
          [{ type: 'text', text: '请接管浏览器完成登录，然后回来继续。' }],
          'end_turn',
        ),
      )
      .mockResolvedValueOnce(
        response([{ type: 'text', text: '已进入工作台。' }], 'end_turn'),
      );

    let currentUrl = 'https://example.com/login';
    const page = {
      url: () => currentUrl,
      title: vi.fn(async () => currentUrl.endsWith('/login') ? 'Sign in' : 'Dashboard'),
      evaluate: vi.fn(async () => currentUrl.endsWith('/login') ? 'Sign in' : 'Dashboard'),
    };
    const executor = {
      resetPageForTask: vi.fn(async () => undefined),
      getPage: vi.fn(async () => page),
      screenshot: vi.fn(async () => ({
        base64: 'dGVzdA==',
        viewportWidth: 1280,
        viewportHeight: 720,
      })),
    } as unknown as PlaywrightExecutor;

    const taskId = 'tsk_text_takeover_immediate_reply';
    const outcome = await runSupercarTask({
      taskId,
      intent: '登录后继续查询',
      executor,
      apiKey: 'test-key',
      maxIterations: 2,
      timeoutMs: 5_000,
      onAwaitingUser: async () => {
        currentUrl = 'https://example.com/dashboard';
        expect(supercarReply(taskId, '登录完成')).toBe(true);
      },
    });

    expect(outcome.status).toBe('completed');
    expect(createMessage).toHaveBeenCalledTimes(2);
  });

  it('accepts an immediate confirmation before executing a pending action', async () => {
    createMessage
      .mockResolvedValueOnce(
        response(
          [
            {
              type: 'tool_use',
              id: 'tool_confirmed_type',
              name: 'computer',
              input: { action: 'type', text: '公开留言' },
            },
          ],
          'tool_use',
        ),
      )
      .mockResolvedValueOnce(
        response([{ type: 'text', text: '操作已完成。' }], 'end_turn'),
      );

    const page = {
      url: () => 'https://example.com/editor',
      title: vi.fn(async () => 'Editor'),
      evaluate: vi.fn(async () => 'Editor'),
      mouse: {
        move: vi.fn(async () => undefined),
        click: vi.fn(async () => undefined),
        down: vi.fn(async () => undefined),
        up: vi.fn(async () => undefined),
      },
      keyboard: {
        down: vi.fn(async () => undefined),
        up: vi.fn(async () => undefined),
      },
      waitForTimeout: vi.fn(async () => undefined),
    };
    const type = vi.fn(async () => ({ ok: true, message: 'typed' }));
    const executor = {
      resetPageForTask: vi.fn(async () => undefined),
      getPage: vi.fn(async () => page),
      screenshot: vi.fn(async () => ({
        base64: 'dGVzdDI=',
        viewportWidth: 1280,
        viewportHeight: 720,
      })),
      captureTargetDescriptor: vi.fn(async () => ({
        type: 'text',
        tagName: 'TEXTAREA',
        placeholder: '留言',
        url: 'https://example.com/editor',
      })),
      type,
    } as unknown as PlaywrightExecutor;

    const taskId = 'tsk_immediate_confirmation';
    const outcome = await runSupercarTask({
      taskId,
      intent: '填写留言',
      executor,
      apiKey: 'test-key',
      maxIterations: 2,
      timeoutMs: 5_000,
      onBeforeAction: async () => ({
        allowed: false,
        requiresConfirmation: true,
        question: '即将填写公开内容，是否继续？',
        reason: '需要用户确认',
      }),
      onAwaitingUser: async () => {
        expect(supercarReply(taskId, '确认执行')).toBe(true);
      },
    });

    expect(outcome.status).toBe('completed');
    expect(type).toHaveBeenCalledTimes(1);
  });
});
