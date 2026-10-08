import { type SelectedChromeSessionCommand, USER_BROWSER_PROTOCOL } from '@holaday/shared-types';
import { describe, expect, it, vi } from 'vitest';
import type { MessagesAdapter, NeutralMessagesResponse } from '../../llm/messages-adapter.js';
import { BrowserControl } from './browser-control.js';
import { SelectedChromeClient } from './selected-chrome-client.js';
import { runSelectedChromeTask } from './selected-chrome-runner.js';
const id = '00000000-0000-4000-8000-000000000001';
const target = { tabId: 3, expectedUrl: 'https://fixture.test', selectionId: id };
const metadata = {
  provider: 'alibaba-model-studio',
  model: 'synthetic',
  region: 'cn',
  deploymentScope: 'china_mainland',
  endpointKind: 'public',
  protocol: 'messages',
} as const;
function fixture(label: string, missing = false) {
  let revision = 0;
  let effects = 0;
  let modelCalls = 0;
  const commands: SelectedChromeSessionCommand[] = [];
  const control = new BrowserControl();
  const cancellation = new AbortController();
  const client = new SelectedChromeClient({
    userId: 'a',
    taskId: 'v2-test',
    extensionClientId: 'c',
    routingV2: true,
    control,
    send: async (_user, options) => {
      const command = options.args?.session;
      if (!command) throw new Error('missing session command');
      commands.push(command);
      if (command.op === 'close') return { ok: true, result: { ok: true, closed: true } };
      if (command.op === 'describe')
        return missing
          ? { ok: false, result: { ok: false, error: 'target_ambiguous' } }
          : {
              ok: true,
              result: {
                ok: true,
                sessionId: id,
                target: {
                  token: id,
                  tabId: 3,
                  frameId: 'main',
                  origin: target.expectedUrl,
                  observationRevision: revision,
                  capturedAt: 1,
                  element: {
                    role: 'button',
                    visibleText: label,
                    ariaLabel: null,
                    title: null,
                    placeholder: null,
                    name: null,
                    inputType: 'button',
                    tagName: 'button',
                  },
                  form: null,
                },
              },
            };
      if (command.op === 'act') {
        expect(command.binding).toEqual({ token: id, observationRevision: revision });
        effects++;
      }
      revision++;
      return {
        ok: true,
        result: {
          ok: true,
          sessionId: id,
          protocol: USER_BROWSER_PROTOCOL,
          observation: {
            tabId: 3,
            origin: target.expectedUrl,
            observationRevision: revision,
            title: 'Fixture',
            bodyText: effects ? 'Saved' : 'Draft',
            ariaSnapshot: '',
            truncated: false,
          },
          ...(command.op === 'act' ? { actionOutcome: 'applied' } : {}),
        },
      };
    },
  });
  const adapter: MessagesAdapter = {
    metadata,
    create: vi.fn(
      async (): Promise<NeutralMessagesResponse> => ({
        id: 'fixture',
        metadata,
        stopReason: 'tool_use',
        content: [
          {
            type: 'tool_use',
            id: `tool-${++modelCalls}`,
            name: modelCalls === 1 ? 'browser_act' : 'browser_finish',
            input:
              modelCalls === 1
                ? {
                    action: {
                      kind: 'click',
                      selector: {
                        description: 'Search',
                        strategies: [{ kind: 'css', value: '#go' }],
                      },
                    },
                  }
                : { summary: 'Saved', status: 'completed', evidenceText: 'Saved' },
          },
        ],
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          cacheReadInputTokens: null,
          cacheCreationInputTokens: null,
          complete: true,
        },
      }),
    ),
  };
  return { client, control, cancellation, commands, adapter, effects: () => effects };
}
describe('selected Chrome v2 actual runner/client/gate integration', () => {
  it('ungranted new task tab parks for origin selection without creating a tab', async () => {
    const h = fixture('搜索');
    vi.spyOn(h.adapter, 'create').mockResolvedValue({
      id: 'fixture',
      metadata,
      stopReason: 'tool_use',
      content: [
        {
          type: 'tool_use',
          id: 'new',
          name: 'browser_tabs',
          input: { operation: 'new', url: 'https://other.test' },
        },
      ],
      usage: {
        inputTokens: 1,
        outputTokens: 1,
        cacheReadInputTokens: null,
        cacheCreationInputTokens: null,
        complete: true,
      },
    });
    const outcome = await runSelectedChromeTask({
      taskId: 'v2-test',
      intent: '查询',
      target,
      messagesAdapter: h.adapter,
      client: h.client,
      control: h.control,
    });
    expect(outcome.status).toBe('awaiting_user');
    expect(h.commands.some((c) => c.op === 'tabs')).toBe(false);
    expect(h.effects()).toBe(0);
  });
  it('task tab navigation respects the same server onBeforeAction hook', async () => {
    const h = fixture('搜索');
    vi.spyOn(h.adapter, 'create').mockResolvedValue({
      id: 'fixture',
      metadata,
      stopReason: 'tool_use',
      content: [
        {
          type: 'tool_use',
          id: 'new',
          name: 'browser_tabs',
          input: { operation: 'new', url: target.expectedUrl },
        },
      ],
      usage: {
        inputTokens: 1,
        outputTokens: 1,
        cacheReadInputTokens: null,
        cacheCreationInputTokens: null,
        complete: true,
      },
    });
    const before = vi.fn(async () => ({ allowed: false, reason: 'server policy' }));
    const outcome = await runSelectedChromeTask({
      taskId: 'v2-test',
      intent: '查询',
      target,
      messagesAdapter: h.adapter,
      client: h.client,
      control: h.control,
      onBeforeAction: before,
    });
    expect(outcome.status).toBe('awaiting_user');
    expect(before).toHaveBeenCalledWith({ kind: 'navigate', url: target.expectedUrl });
    expect(h.commands.some((c) => c.op === 'tabs')).toBe(false);
  });
  it('ordinary host-verified button executes automatically despite hint', async () => {
    const h = fixture('搜索');
    const park = vi.fn(async () => null);
    const outcome = await runSelectedChromeTask({
      taskId: 'v2-test',
      intent: '搜索',
      target,
      messagesAdapter: h.adapter,
      client: h.client,
      control: h.control,
      park,
    });
    expect(outcome.status).toBe('completed');
    expect(h.effects()).toBe(1);
    expect(park).not.toHaveBeenCalled();
  });
  it.each(['确认支付', '删除项目', '提交订单', '删除', '提交'])(
    'real %s stops for confirmation with zero side effects',
    async (label) => {
      const h = fixture(label);
      const park = vi.fn(async () => null);
      const outcome = await runSelectedChromeTask({
        taskId: 'v2-test',
        intent: '查询',
        target,
        messagesAdapter: h.adapter,
        client: h.client,
        control: h.control,
        park,
      });
      expect(outcome.status).toBe('awaiting_user');
      expect(h.effects()).toBe(0);
      expect(park).toHaveBeenCalledTimes(1);
    },
  );
  it('confirmation during cancellation cannot dispatch an act', async () => {
    const h = fixture('确认支付');
    const outcome = await runSelectedChromeTask({
      taskId: 'v2-test',
      intent: '查询',
      target,
      messagesAdapter: h.adapter,
      client: h.client,
      control: h.control,
      signal: h.cancellation.signal,
      park: async () => {
        h.cancellation.abort();
        return '确认执行';
      },
    });
    expect(outcome.status).toBe('cancelled');
    expect(h.effects()).toBe(0);
  });
  it('ambiguous real target hands off without sending an input', async () => {
    const h = fixture('Search', true);
    const onThinking = vi.fn((text: string) => {
      if (text.includes('真实目标')) h.cancellation.abort();
    });
    const outcome = await runSelectedChromeTask({
      taskId: 'v2-test',
      intent: '查询',
      target,
      messagesAdapter: h.adapter,
      client: h.client,
      control: h.control,
      signal: h.cancellation.signal,
      onThinking,
      park: async () => null,
    });
    expect(outcome.status).toBe('cancelled');
    expect(onThinking).toHaveBeenCalledWith(expect.stringContaining('真实目标'));
    expect(h.effects()).toBe(0);
  });
});
