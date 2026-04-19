import type Anthropic from '@anthropic-ai/sdk';
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  AnthropicVisionLoopCommander,
  type VisionLoopContext,
  type VisionObservation,
} from './commander.js';

beforeAll(() => {
  process.env.JWT_SECRET ??= 'test-secret-must-be-at-least-32-characters-long-yes';
  process.env.DATABASE_URL ??= 'mysql://test:test@127.0.0.1:3306/test';
  process.env.REDIS_URL ??= 'redis://127.0.0.1:6379/0';
});

/**
 * Unit tests for AnthropicVisionLoopCommander.decideNextAction.
 *
 * Strategy: inject a fake Anthropic client whose `messages.create` is
 * a test-supplied handler. The handler both (a) returns a canned
 * response and (b) captures the request so we can assert the messages[]
 * array Commander built was shaped correctly. No network hits.
 */

interface CapturedRequest {
  req?: Anthropic.MessageCreateParams;
}

function fakeClient(
  handler: (req: Anthropic.MessageCreateParams) => Anthropic.Message,
  capture?: CapturedRequest,
): Anthropic {
  const client = {
    messages: {
      create: async (req: Anthropic.MessageCreateParams) => {
        if (capture) capture.req = req;
        return handler(req);
      },
    },
  };
  return client as unknown as Anthropic;
}

function toolUseResponse(
  toolName: string,
  input: unknown,
  opts: { id?: string; precedingText?: string } = {},
): Anthropic.Message {
  const content: Anthropic.ContentBlock[] = [];
  if (opts.precedingText) {
    content.push({ type: 'text', text: opts.precedingText } as Anthropic.ContentBlock);
  }
  content.push({
    type: 'tool_use',
    id: opts.id ?? 'toolu_test',
    name: toolName,
    input,
  } as unknown as Anthropic.ContentBlock);
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-4-20250514',
    content,
    stop_reason: 'tool_use',
    stop_sequence: null,
    usage: {
      input_tokens: 1_500,
      output_tokens: 42,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  } as unknown as Anthropic.Message;
}

function emptyResponse(): Anthropic.Message {
  // Model returned only text, no tool_use — simulates a model refusal.
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-4-20250514',
    content: [{ type: 'text', text: 'I will not take an action.' } as Anthropic.ContentBlock],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: 1_000,
      output_tokens: 12,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  } as unknown as Anthropic.Message;
}

async function makeObservation(tickIndex = 0): Promise<VisionObservation> {
  // Tiny 800×600 JPEG (well under 1568 long edge → passthrough).
  const buf = await sharp({
    create: { width: 800, height: 600, channels: 3, background: { r: 200, g: 50, b: 50 } },
  })
    .jpeg({ quality: 80 })
    .toBuffer();
  return {
    screenshotBase64: buf.toString('base64'),
    viewportWidth: 800,
    viewportHeight: 600,
    url: 'https://example.com/',
    title: 'Example',
    tickIndex,
  };
}

async function freshContext(
  overrides: Partial<VisionLoopContext> = {},
): Promise<VisionLoopContext> {
  return {
    intent: '在 example.com 搜 HOLA DAY',
    observation: await makeObservation(0),
    history: [],
    maxSteps: 30,
    ...overrides,
  };
}

describe('AnthropicVisionLoopCommander.decideNextAction', () => {
  it('first tick: returns a click action decoded from tool_use + image descriptor', async () => {
    const cap: CapturedRequest = {};
    const client = fakeClient(
      () => toolUseResponse('computer_click', { x: 123, y: 456 }, { id: 'toolu_001' }),
      cap,
    );
    const c = new AnthropicVisionLoopCommander({ client });
    const ctx = await freshContext();

    const decision = await c.decideNextAction(ctx);

    expect(decision.action).toEqual({ kind: 'click', x: 123, y: 456, button: 'left' });
    expect(decision.toolUseId).toBe('toolu_001');
    expect(decision.inputTokens).toBe(1_500);
    expect(decision.outputTokens).toBe(42);
    // image descriptor must accompany the decision so the caller can
    // translate model-space click coords back to real viewport px.
    expect(decision.image.originalWidth).toBe(800);
    expect(decision.image.originalHeight).toBe(600);
    expect(decision.image.scaleX).toBe(1); // passthrough (≤ 1568)
    expect(decision.image.scaleY).toBe(1);

    // Request shape: one user message with [image, text] and the tools.
    const req = cap.req;
    expect(req?.model).toBe('claude-sonnet-4-20250514');
    expect(req?.max_tokens).toBe(1_024);
    expect(req?.tool_choice).toEqual({ type: 'any' });
    expect(Array.isArray(req?.tools)).toBe(true);
    expect(req?.tools?.length).toBe(8);
    expect(req?.messages).toHaveLength(1);
    const content =
      (req?.messages?.[0]?.content as Anthropic.ContentBlockParam[] | undefined) ?? [];
    expect(content[0]?.type).toBe('image');
    expect(content[1]?.type).toBe('text');
    if (content[1]?.type === 'text') {
      expect(content[1].text).toContain('在 example.com 搜 HOLA DAY');
      expect(content[1].text).toContain('https://example.com/');
    }
  });

  it('decodes computer_type into a type action', async () => {
    const client = fakeClient(() =>
      toolUseResponse('computer_type', { text: 'HOLA DAY' }, { id: 'toolu_002' }),
    );
    const c = new AnthropicVisionLoopCommander({ client });
    const decision = await c.decideNextAction(await freshContext());
    expect(decision.action).toEqual({ kind: 'type', text: 'HOLA DAY' });
  });

  it('task_done → done action with summary', async () => {
    const client = fakeClient(() =>
      toolUseResponse('task_done', { summary: 'Posted the comment.' }),
    );
    const c = new AnthropicVisionLoopCommander({ client });
    const decision = await c.decideNextAction(await freshContext());
    expect(decision.action).toEqual({ kind: 'done', summary: 'Posted the comment.' });
  });

  it('task_give_up → give_up action with reason', async () => {
    const client = fakeClient(() =>
      toolUseResponse('task_give_up', { reason: 'login wall detected' }),
    );
    const c = new AnthropicVisionLoopCommander({ client });
    const decision = await c.decideNextAction(await freshContext());
    expect(decision.action).toEqual({ kind: 'give_up', reason: 'login wall detected' });
  });

  it('preserves narrative text the model emits before the tool_use as `reasoning`', async () => {
    const client = fakeClient(() =>
      toolUseResponse(
        'computer_click',
        { x: 10, y: 20 },
        { precedingText: "I'll click the search box." },
      ),
    );
    const c = new AnthropicVisionLoopCommander({ client });
    const decision = await c.decideNextAction(await freshContext());
    expect(decision.reasoning).toBe("I'll click the search box.");
  });

  it('Anthropic API errors become a give_up action (never throw)', async () => {
    const client = fakeClient(() => {
      throw new Error('network timeout');
    });
    const c = new AnthropicVisionLoopCommander({ client });
    const decision = await c.decideNextAction(await freshContext());
    expect(decision.action.kind).toBe('give_up');
    if (decision.action.kind === 'give_up') {
      expect(decision.action.reason).toMatch(/network timeout/);
    }
    // Usage zeros on error — we didn't successfully bill any tokens.
    expect(decision.inputTokens).toBe(0);
    expect(decision.outputTokens).toBe(0);
  });

  it('no tool_use in response → give_up with stop_reason exposed', async () => {
    const client = fakeClient(() => emptyResponse());
    const c = new AnthropicVisionLoopCommander({ client });
    const decision = await c.decideNextAction(await freshContext());
    expect(decision.action.kind).toBe('give_up');
    if (decision.action.kind === 'give_up') {
      expect(decision.action.reason).toMatch(/no tool_use/);
      expect(decision.action.reason).toMatch(/end_turn/);
    }
  });

  it('history: prior turns round-trip as tool_use / tool_result pairs', async () => {
    const cap: CapturedRequest = {};
    const client = fakeClient(
      () => toolUseResponse('computer_click', { x: 50, y: 60 }, { id: 'toolu_2' }),
      cap,
    );
    const c = new AnthropicVisionLoopCommander({ client });

    const firstObs = await makeObservation(0);
    const secondObs: VisionObservation = {
      ...(await makeObservation(1)),
      url: 'https://example.com/results',
    };

    const decision = await c.decideNextAction({
      intent: '在 example.com 搜 HOLA DAY',
      observation: secondObs,
      history: [
        {
          observation: firstObs,
          action: { kind: 'click', x: 10, y: 20 },
          toolUseId: 'toolu_1',
          executionResult: { ok: true },
        },
      ],
      maxSteps: 30,
    });

    expect(decision.action.kind).toBe('click');
    const req = cap.req;
    // Expect 3 messages: initial user, assistant tool_use (replay of
    // prior turn), user tool_result (wrapping the second observation).
    expect(req?.messages).toHaveLength(3);
    expect(req?.messages?.[0]?.role).toBe('user');
    expect(req?.messages?.[1]?.role).toBe('assistant');
    expect(req?.messages?.[2]?.role).toBe('user');

    const assistantContent = req?.messages?.[1]?.content as Anthropic.ContentBlockParam[];
    expect(assistantContent[0]?.type).toBe('tool_use');
    if (assistantContent[0]?.type === 'tool_use') {
      expect(assistantContent[0].id).toBe('toolu_1');
      expect(assistantContent[0].name).toBe('computer_click');
    }

    const toolResultContent = req?.messages?.[2]?.content as Anthropic.ContentBlockParam[];
    expect(toolResultContent[0]?.type).toBe('tool_result');
    if (toolResultContent[0]?.type === 'tool_result') {
      expect(toolResultContent[0].tool_use_id).toBe('toolu_1');
    }
  });

  it('honours the COMMANDER_MODEL env override', async () => {
    const prev = process.env.COMMANDER_MODEL;
    process.env.COMMANDER_MODEL = 'claude-opus-4-7';
    try {
      const cap: CapturedRequest = {};
      const client = fakeClient(() => toolUseResponse('computer_click', { x: 1, y: 2 }), cap);
      const c = new AnthropicVisionLoopCommander({ client });
      await c.decideNextAction(await freshContext());
      expect(cap.req?.model).toBe('claude-opus-4-7');
    } finally {
      // process.env assignments can't distinguish unset from "undefined"
      // without `delete`, so we just restore the prior value (or scrub
      // back to empty string if it wasn't set before this test).
      process.env.COMMANDER_MODEL = prev ?? '';
    }
  });
});
