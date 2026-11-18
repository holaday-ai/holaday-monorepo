import { type SelectedChromeSessionCommand, USER_BROWSER_PROTOCOL } from '@holaday/shared-types';
import { describe, expect, it, vi } from 'vitest';
import { parseFileForPrompt } from '../../files/parsers.js';
import type { MessagesAdapter, NeutralMessagesResponse } from '../../llm/messages-adapter.js';
import { createExternalBrowserPark } from './agent-loop.js';
import { BrowserControl } from './browser-control.js';
import { supercarHandoffToGenerate, supercarReply } from './qwen-only-agent-loop.js';
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
                  elementId: '22222222-2222-4222-8222-222222222222',
                  objectDigest: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                  tabId: 3,
                  frameId: 'main',
                  origin: target.expectedUrl,
                  page: { url: `${target.expectedUrl}/`, transactional: false },
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
  it('re-observes after clarification instead of applying the remaining old plan', async () => {
    const h = fixture('Search');
    let calls = 0;
    const requests: unknown[] = [];
    vi.spyOn(h.adapter, 'create').mockImplementation(async (request) => {
      requests.push(structuredClone(request));
      return {
        id: `turn-${++calls}`,
        metadata,
        stopReason: 'tool_use',
        content:
          calls === 1
            ? [
                {
                  type: 'tool_use',
                  id: 'human',
                  name: 'request_human',
                  input: { reason: 'clarification', message: 'Which report?' },
                },
                {
                  type: 'tool_use',
                  id: 'old-click',
                  name: 'browser_act',
                  input: {
                    action: {
                      kind: 'click',
                      selector: {
                        description: 'Search',
                        strategies: [{ kind: 'css', value: '#go' }],
                      },
                    },
                  },
                },
                {
                  type: 'tool_use',
                  id: 'old-finish',
                  name: 'browser_finish',
                  input: { status: 'completed', summary: 'Saved', evidenceText: 'Saved' },
                },
              ]
            : [
                {
                  type: 'tool_use',
                  id: 'finish',
                  name: 'browser_finish',
                  input: { status: 'completed', summary: 'Draft', evidenceText: 'Draft' },
                },
              ],
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          cacheReadInputTokens: null,
          cacheCreationInputTokens: null,
          complete: true,
        },
      };
    });
    const outcome = await runSelectedChromeTask({
      taskId: 'v2-test',
      intent: 'Inspect the report',
      target,
      messagesAdapter: h.adapter,
      client: h.client,
      control: h.control,
      onAwaitingUser: async () => {
        expect(supercarReply('v2-test', 'Use report 731')).toBe(true);
      },
    });
    expect(outcome.status).toBe('completed');
    expect(calls).toBe(2);
    expect(h.effects()).toBe(0);
    expect(JSON.stringify(requests[1])).toContain('Use report 731');
    expect(JSON.stringify(requests[1])).toContain('replan_required');
  });

  it('rejects a material handoff from the actual action confirmation wait', async () => {
    const h = fixture('确认支付');
    let accepted: boolean | undefined;
    const outcome = await runSelectedChromeTask({
      taskId: 'v2-test',
      intent: 'Inspect the page',
      target,
      messagesAdapter: h.adapter,
      client: h.client,
      control: h.control,
      signal: h.cancellation.signal,
      onAwaitingUser: async ({ awaitingKind }) => {
        expect(awaitingKind).toBe('browser_action');
        accepted = supercarHandoffToGenerate('v2-test', 'Analyze my data', [
          { type: 'text', text: 'NOT-ADMITTED-731' },
        ]);
        h.cancellation.abort();
      },
    });
    expect(accepted).toBe(false);
    expect(outcome.status).toBe('cancelled');
    expect(outcome.handoffAttachments).toBeUndefined();
    expect(h.effects()).toBe(0);
  });

  it('bounds initial plus accepted reply images cumulatively and retains the wait on rejection', async () => {
    const image = (size: number) => ({
      type: 'image' as const,
      source: { type: 'base64' as const, media_type: 'image/png' as const, data: 'A'.repeat(size) },
    });
    const parking = createExternalBrowserPark({
      taskId: 'cumulative-images',
      intent: 'Inspect reports',
      attachments: [image(2_000_000)],
      aborted: () => false,
    });
    try {
      const first = parking.park('First report?', 'clarification');
      expect(supercarReply('cumulative-images', 'First', [image(1_500_000)])).toBe(true);
      await first;
      parking.takeReply();
      const second = parking.park('Second report?', 'clarification');
      expect(supercarReply('cumulative-images', 'Too much', [image(1_000_000)])).toBe(false);
      expect(
        supercarReply('cumulative-images', 'Smaller', [{ type: 'text', text: 'SMALLER-731' }]),
      ).toBe(true);
      expect(await second).toBe('Smaller');
      expect(JSON.stringify(parking.takeReply())).toContain('SMALLER-731');
    } finally {
      parking.close();
    }
  });

  it('keeps the initial parsed attachment in the selected task model context', async () => {
    const h = fixture('Search');
    const initial = await parseFileForPrompt(
      Buffer.from('name,qty\nINITIAL-531,31\n'),
      'report.csv',
      'text/csv',
    );
    const requests: unknown[] = [];
    vi.spyOn(h.adapter, 'create').mockImplementation(async (request) => {
      requests.push(structuredClone(request));
      return {
        id: 'finish',
        metadata,
        stopReason: 'tool_use',
        content: [
          {
            type: 'tool_use',
            id: 'finish',
            name: 'browser_finish',
            input: { status: 'completed', summary: 'Draft', evidenceText: 'Draft' },
          },
        ],
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          cacheReadInputTokens: null,
          cacheCreationInputTokens: null,
          complete: true,
        },
      };
    });
    const outcome = await runSelectedChromeTask({
      taskId: 'v2-test',
      intent: 'Read the attached material and inspect this page',
      attachments: initial.blocks,
      target,
      messagesAdapter: h.adapter,
      client: h.client,
      control: h.control,
    });
    expect(outcome.status).toBe('completed');
    expect(JSON.stringify(requests)).toContain('INITIAL-531');
    expect(h.effects()).toBe(0);
  });

  it.each(['handoff', 'cancel', 'unconfirmed-close'] as const)(
    'retains accepted external reply materials through %s',
    async (ending) => {
      const h = fixture('Search');
      const initial = await parseFileForPrompt(
        Buffer.from('name,qty\nINITIAL-531,31\n'),
        'initial.csv',
        'text/csv',
      );
      const first = await parseFileForPrompt(
        Buffer.from('name,qty\nFIRST-731,31\n'),
        'first.csv',
        'text/csv',
      );
      const image = await parseFileForPrompt(
        Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1ioAAAAASUVORK5CYII=',
          'base64',
        ),
        'chart.png',
        'image/png',
      );
      const requests: unknown[] = [];
      let waits = 0;
      vi.spyOn(h.adapter, 'create').mockImplementation(async (request) => {
        requests.push(structuredClone(request));
        return {
          id: `human-${requests.length}`,
          metadata,
          stopReason: 'tool_use',
          content: [
            {
              type: 'tool_use',
              id: `human-${requests.length}`,
              name: 'request_human',
              input: {
                reason: 'clarification',
                message: 'Please provide the missing report material.',
              },
            },
          ],
          usage: {
            inputTokens: 1,
            outputTokens: 1,
            cacheReadInputTokens: null,
            cacheCreationInputTokens: null,
            complete: true,
          },
        };
      });
      if (ending === 'unconfirmed-close')
        vi.spyOn(h.client, 'close').mockResolvedValue({
          ok: false,
          error: 'target_extension_unavailable',
        });
      const outcome = await runSelectedChromeTask({
        taskId: 'v2-test',
        intent: 'Read reports, then analyze supplied data if I explicitly change to that',
        attachments: initial.blocks,
        target,
        messagesAdapter: h.adapter,
        client: h.client,
        control: h.control,
        signal: h.cancellation.signal,
        maxIterations: 3,
        onAwaitingUser: async ({ awaitingKind }) => {
          expect(awaitingKind).toBe('clarification');
          if (++waits === 1) {
            expect(supercarReply('v2-test', 'FIRST-REPLY-451', first.blocks)).toBe(true);
          } else {
            const tooLarge = [
              {
                type: 'image' as const,
                source: {
                  type: 'base64' as const,
                  media_type: 'image/png' as const,
                  data: 'a'.repeat(4_000_001),
                },
              },
            ];
            expect(supercarReply('v2-test', 'REJECTED-MATERIAL', tooLarge)).toBe(false);
            expect(supercarHandoffToGenerate('v2-test', 'REJECTED-HANDOFF', tooLarge)).toBe(false);
            expect(
              supercarHandoffToGenerate(
                'v2-test',
                'Stop browsing. Use my uploaded data to analyze the results.',
                image.blocks,
              ),
            ).toBe(true);
            if (ending === 'cancel') h.cancellation.abort();
          }
        },
      });
      expect(waits).toBe(2);
      expect(requests).toHaveLength(2);
      expect(JSON.stringify(requests[1])).toContain('INITIAL-531');
      expect(JSON.stringify(requests[1])).toContain('FIRST-731');
      expect(JSON.stringify(requests[1])).toContain('FIRST-REPLY-451');
      expect(JSON.stringify(requests)).not.toContain('REJECTED-MATERIAL');
      expect(h.effects()).toBe(0);
      if (ending === 'handoff') {
        expect(outcome.status).toBe('handoff_to_generate');
        expect(outcome.question).toContain('FIRST-REPLY-451');
        expect(outcome.question).toContain('Stop browsing.');
        expect(JSON.stringify(outcome.handoffAttachments)).toContain('FIRST-731');
        expect(JSON.stringify(outcome.handoffAttachments)).toContain('media_type');
        expect(JSON.stringify(outcome.handoffAttachments)).not.toContain('INITIAL-531');
        expect(h.commands.at(-1)?.op).toBe('close');
      } else {
        expect(outcome.status).toBe(ending === 'cancel' ? 'cancelled' : 'failed');
        expect(outcome.handoffAttachments).toBeUndefined();
      }
    },
  );

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
