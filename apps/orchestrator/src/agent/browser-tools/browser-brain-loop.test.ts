import { describe, expect, it } from 'vitest';
import type {
  MessagesAdapter,
  NeutralMessagesRequest,
  NeutralOutputContentBlock,
} from '../../llm/messages-adapter.js';
import type { LlmCallRecord } from '../llm-call-recorder.js';
import { recordedBrowserAdapter } from '../supercar/recorded-browser-adapter.js';
import { runUnifiedBrowserLoop } from './unified-browser-loop.js';
const text = (value: string): NeutralOutputContentBlock => ({ type: 'text', text: value });
const finish: NeutralOutputContentBlock = {
  type: 'tool_use',
  id: 'f',
  name: 'finish',
  input: { status: 'completed', summary: 'Alpha found', evidence: 'Alpha' },
};
const snapshot: NeutralOutputContentBlock = {
  type: 'tool_use',
  id: 's',
  name: 'snapshot',
  input: {},
};
function model(
  name: string,
  turns: NeutralOutputContentBlock[][],
  requests: NeutralMessagesRequest[] = [],
): MessagesAdapter {
  return {
    metadata: { provider: 'openai', model: name },
    async create(request, options) {
      if (options?.signal?.aborted) throw new Error('aborted');
      requests.push(request);
      const content = turns.shift();
      if (!content) throw new Error('exhausted');
      return {
        id: name,
        metadata: this.metadata,
        content,
        stopReason: content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn',
        usage: {
          inputTokens: 10,
          outputTokens: 5,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
          complete: true,
        },
      };
    },
  };
}
describe('browser role loop', () => {
  // BROWSER-AUTOPILOT-1: the verification role no longer judges answers (integrity is
  // checked deterministically in the loop); it is never called.
  it('runs a read-only planner and the executor, never the verification role', async () => {
    const plans: NeutralMessagesRequest[] = [];
    const reviews: NeutralMessagesRequest[] = [];
    const actions: string[] = [];
    const calls: LlmCallRecord[] = [];
    const base = model('execute', [[snapshot], [finish]]);
    const adapter = recordedBrowserAdapter(
      {
        ...base,
        browserBrain: {
          planning: model('plan', [[text('Read Alpha then finish')]], plans),
          verification: model('verify', [[text('{"approved":true,"reason":"observed"}')]], reviews),
        },
      },
      {
        recorder: {
          async record(r) {
            calls.push(r);
          },
        },
        userExternalId: 'usr_a',
        taskId: 'task_a',
        iteration: 1,
        onRecordError() {},
      },
    );
    const result = await runUnifiedBrowserLoop({
      intent: 'Read Alpha',
      adapter,
      execute: async (a) => {
        actions.push(a.tool);
        return { ok: true, text: 'Alpha', url: 'https://example.org' };
      },
    });
    expect(result.status).toBe('completed');
    expect(actions).toEqual(['snapshot']);
    expect(plans[0]?.tools ?? []).toEqual([]);
    expect(reviews).toHaveLength(0);
    expect(calls.map((c) => c.requestMeta?.role)).toEqual(['planning', 'execution', 'execution']);
    expect(calls.every((c) => c.taskExternalId === 'task_a')).toBe(true);
  });
  it.each(['{"approved":false,"reason":"missing data"}', 'not json'])(
    'a verification verdict no longer decides completion: %s',
    async (verdict) => {
      const adapter = {
        ...model('exec', [[snapshot], [finish]]),
        browserBrain: {
          planning: model('plan', [[text('read')]]),
          verification: model('verify', [[text(verdict)]]),
        },
      };
      const out = await runUnifiedBrowserLoop({
        intent: 'Read Alpha',
        adapter,
        execute: async () => ({ ok: true, text: 'Alpha' }),
      });
      expect(out.status).toBe('completed');
    },
  );
  // BROWSER-AUTOPILOT-1: planning is advice. A planner that tries to act is
  // ignored (its tool call never runs) and the executor carries on.
  it('never runs planner tools, ignores the bad plan, and records provider failure without invented usage', async () => {
    const calls: LlmCallRecord[] = [];
    const raw = {
      ...model('exec', [[snapshot], [finish]]),
      browserBrain: {
        planning: model('plan', [[snapshot]]),
        verification: model('verify', [[text('{"approved":true}')]]),
      },
    };
    const adapter = recordedBrowserAdapter(raw, {
      recorder: {
        async record(r) {
          calls.push(r);
        },
      },
      userExternalId: 'usr_a',
      taskId: 'task_a',
      iteration: 1,
      onRecordError() {},
    });
    const executed: string[] = [];
    const out = await runUnifiedBrowserLoop({
      intent: 'Read',
      adapter,
      execute: async (action) => {
        executed.push(action.tool);
        return { ok: true, text: 'Alpha' };
      },
    });
    // Only the executor's own snapshot ran; the planner's tool call never did.
    expect(executed).toEqual(['snapshot']);
    expect(out.status).toBe('completed');
    expect(calls[0]?.requestMeta?.role).toBe('planning');
    const failing = recordedBrowserAdapter(model('down', []), {
      recorder: {
        async record(r) {
          calls.push(r);
        },
      },
      userExternalId: 'usr_a',
      taskId: 'task_a',
      iteration: 1,
      onRecordError() {},
    });
    await expect(
      failing.create({ maxTokens: 10, messages: [{ role: 'user', content: 'x' }] }),
    ).rejects.toThrow();
    expect(calls.at(-1)).toMatchObject({
      status: 'error',
      inputTokens: null,
      outputTokens: null,
      requestMeta: { role: 'execution' },
    });
  });
  it('keeps default single-model call count unchanged', async () => {
    const requests: NeutralMessagesRequest[] = [];
    const out = await runUnifiedBrowserLoop({
      intent: 'Read Alpha',
      adapter: model('default', [[snapshot], [finish]], requests),
      execute: async () => ({ ok: true, text: 'Alpha' }),
    });
    expect(out.status).toBe('completed');
    expect(requests).toHaveLength(2);
  });
});
