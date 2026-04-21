import type Anthropic from '@anthropic-ai/sdk';
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import type { LlmCallRecord, LlmCallRecorder } from '../llm-call-recorder.js';
import {
  type AccessibilityLoopContext,
  AnthropicVisionLoopCommander,
  VISION_SYSTEM_PROMPT,
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
    model: 'claude-sonnet-4-6',
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
    model: 'claude-sonnet-4-6',
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
    expect(req?.model).toBe('claude-sonnet-4-6');
    expect(req?.max_tokens).toBe(1_024);
    expect(req?.tool_choice).toEqual({ type: 'any' });
    expect(Array.isArray(req?.tools)).toBe(true);
    expect(req?.tools?.length).toBe(9);
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

  it('sliding screenshot window: elides images older than VISION_SCREENSHOT_WINDOW', async () => {
    // Fabricate 5 prior turns + current = 6 observations. With
    // default window=3, only the last 3 should carry images; the
    // earlier 3 should be text placeholders.
    const cap: CapturedRequest = {};
    const client = fakeClient(
      () => toolUseResponse('computer_click', { x: 50, y: 60 }, { id: 'toolu_current' }),
      cap,
    );
    const c = new AnthropicVisionLoopCommander({ client });

    const histObs = await Promise.all(
      [0, 1, 2, 3, 4].map(async (i) => ({
        ...(await makeObservation(i)),
        url: `https://example.com/page-${i}`,
      })),
    );
    const history = histObs.map((obs, i) => ({
      observation: obs,
      action: { kind: 'click' as const, x: i, y: i },
      toolUseId: `toolu_${i}`,
      executionResult: { ok: true },
    }));

    await c.decideNextAction({
      intent: 'long running test',
      observation: await makeObservation(5),
      history,
      maxSteps: 30,
    });

    const req = cap.req;
    // Messages: [initial user, assistant_0, tr_1, assistant_1, tr_2,
    //            assistant_2, tr_3, assistant_3, tr_4, assistant_4, tr_5]
    // = 1 + (5 * 2) = 11 messages.
    expect(req?.messages).toHaveLength(11);

    const imageContentBlocks: Array<Anthropic.ImageBlockParam | Anthropic.TextBlockParam> = [];
    const elisionTexts: string[] = [];
    // Helper: gather image-or-elision blocks for each observation.
    function record(block: unknown) {
      const b = block as { type?: string; text?: string };
      if (b?.type === 'image') {
        imageContentBlocks.push(block as Anthropic.ImageBlockParam);
      } else if (
        b?.type === 'text' &&
        typeof b.text === 'string' &&
        b.text.includes('截图已省略')
      ) {
        elisionTexts.push(b.text);
      }
    }

    // Observation 0 lives in messages[0].content[0].
    const initialContent = req?.messages?.[0]?.content as Anthropic.ContentBlockParam[];
    record(initialContent[0]);
    // Observations 1..5 live in tool_result.content[0] of each user
    // message after an assistant (indices 2, 4, 6, 8, 10).
    for (const i of [2, 4, 6, 8, 10]) {
      const msg = req?.messages?.[i];
      const content = msg?.content as Anthropic.ContentBlockParam[];
      const tr = content[0];
      if (tr?.type === 'tool_result' && Array.isArray(tr.content)) {
        record(tr.content[0]);
      }
    }

    // totalObservations = 6, window = 3 → keep observations [3, 4, 5]
    // as images; observations [0, 1, 2] as placeholders.
    expect(imageContentBlocks).toHaveLength(3);
    expect(elisionTexts).toHaveLength(3);
    for (const text of elisionTexts) {
      expect(text).toMatch(/tick \d+ 截图已省略/);
    }
  });

  it('respects COMMANDER_SCREENSHOT_WINDOW env override', async () => {
    const prev = process.env.COMMANDER_SCREENSHOT_WINDOW;
    process.env.COMMANDER_SCREENSHOT_WINDOW = '1';
    try {
      const cap: CapturedRequest = {};
      const client = fakeClient(
        () => toolUseResponse('computer_click', { x: 1, y: 1 }, { id: 'toolu_now' }),
        cap,
      );
      const c = new AnthropicVisionLoopCommander({ client });
      const history = [
        {
          observation: await makeObservation(0),
          action: { kind: 'click' as const, x: 0, y: 0 },
          toolUseId: 'toolu_0',
          executionResult: { ok: true },
        },
      ];
      await c.decideNextAction({
        intent: 'test',
        observation: await makeObservation(1),
        history,
        maxSteps: 30,
      });
      // Window=1 with 2 observations → only observation 1 (the
      // current tick's) stays as an image. Observation 0 elides.
      const initialContent = cap.req?.messages?.[0]?.content as Anthropic.ContentBlockParam[];
      expect(initialContent[0]?.type).toBe('text');
      const toolResultContent = cap.req?.messages?.[2]?.content as Anthropic.ContentBlockParam[];
      const tr = toolResultContent[0];
      if (tr?.type === 'tool_result' && Array.isArray(tr.content)) {
        expect(tr.content[0]?.type).toBe('image');
      }
    } finally {
      process.env.COMMANDER_SCREENSHOT_WINDOW = prev ?? '';
    }
  });

  it('writes an llm_calls row per decideNextAction when a recorder + userId are provided', async () => {
    const records: LlmCallRecord[] = [];
    const recorder: LlmCallRecorder = {
      record: async (c) => {
        records.push(c);
      },
    };
    const client = fakeClient(() =>
      toolUseResponse('computer_click', { x: 1, y: 2 }, { id: 'toolu_rec' }),
    );
    const c = new AnthropicVisionLoopCommander({ client, recorder });
    const ctx = await freshContext({
      userId: 'usr_test',
      taskExternalId: 'tsk_test',
    });
    await c.decideNextAction(ctx);
    expect(records).toHaveLength(1);
    const row = records[0];
    expect(row?.userExternalId).toBe('usr_test');
    expect(row?.taskExternalId).toBe('tsk_test');
    expect(row?.provider).toBe('anthropic');
    expect(row?.purpose).toBe('commander.vision');
    expect(row?.status).toBe('ok');
    expect(row?.inputTokens).toBe(1_500);
    expect(row?.outputTokens).toBe(42);
    expect(row?.requestMeta).toMatchObject({
      toolName: 'computer_click',
      actionKind: 'click',
    });
  });

  it('writes an llm_calls row with status=error when the API throws', async () => {
    const records: LlmCallRecord[] = [];
    const recorder: LlmCallRecorder = {
      record: async (c) => {
        records.push(c);
      },
    };
    const client = fakeClient(() => {
      throw new Error('rate limited');
    });
    const c = new AnthropicVisionLoopCommander({ client, recorder });
    await c.decideNextAction(await freshContext({ userId: 'usr_test' }));
    expect(records).toHaveLength(1);
    const row = records[0];
    expect(row?.status).toBe('error');
    expect(row?.inputTokens).toBe(0);
    expect(row?.errorMessage).toMatch(/rate limited/);
  });

  it('skips persistence when no userId is in the context (tests / misc calls)', async () => {
    const records: LlmCallRecord[] = [];
    const recorder: LlmCallRecorder = {
      record: async (c) => {
        records.push(c);
      },
    };
    const client = fakeClient(() => toolUseResponse('computer_click', { x: 1, y: 2 }));
    const c = new AnthropicVisionLoopCommander({ client, recorder });
    // freshContext defaults intent/observation/history/maxSteps; we
    // explicitly omit userId here.
    await c.decideNextAction(await freshContext());
    expect(records).toHaveLength(0);
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

// ---------------------------------------------------------------------------
// decideNextActionAccessibility — parallel coverage to decideNextAction
// ---------------------------------------------------------------------------

const SAMPLE_A11Y_SNAPSHOT = [
  '- generic:',
  '  - textbox "搜索" [ref=e1]',
  '  - button "百度一下" [ref=e2]',
  '  - link "新闻" [ref=e3]:',
  '    - /url: "http://news.baidu.com"',
].join('\n');

function freshA11yContext(
  overrides: Partial<AccessibilityLoopContext> = {},
): AccessibilityLoopContext {
  return {
    intent: '在百度搜今天天气',
    snapshot: SAMPLE_A11Y_SNAPSHOT,
    refs: [
      { ref: 'e1', role: 'textbox', name: '搜索' },
      { ref: 'e2', role: 'button', name: '百度一下' },
      { ref: 'e3', role: 'link', name: '新闻' },
    ],
    url: 'https://www.baidu.com/',
    title: '百度一下，你就知道',
    tickIndex: 0,
    history: [],
    maxSteps: 30,
    ...overrides,
  };
}

describe('AnthropicVisionLoopCommander.decideNextActionAccessibility', () => {
  it('decodes a11y_click_ref into a click_ref action; no image in request', async () => {
    const cap: CapturedRequest = {};
    const client = fakeClient(
      () => toolUseResponse('a11y_click_ref', { ref: 'e2' }, { id: 'toolu_a001' }),
      cap,
    );
    const c = new AnthropicVisionLoopCommander({ client });
    const decision = await c.decideNextActionAccessibility(freshA11yContext());

    expect(decision.action).toEqual({ kind: 'click_ref', ref: 'e2' });
    expect(decision.toolUseId).toBe('toolu_a001');
    expect(decision.inputTokens).toBe(1_500);

    // Request: one user message, text-only content (NO image block).
    const req = cap.req;
    expect(req?.messages).toHaveLength(1);
    const content =
      (req?.messages?.[0]?.content as Anthropic.ContentBlockParam[] | undefined) ?? [];
    expect(content).toHaveLength(1);
    expect(content[0]?.type).toBe('text');
    if (content[0]?.type === 'text') {
      expect(content[0].text).toContain('在百度搜今天天气');
      expect(content[0].text).toContain('[ref=e1]');
      expect(content[0].text).toContain('https://www.baidu.com/');
    }
    // tools must be the a11y_* set, not computer_*.
    const toolNames = (req?.tools ?? []).map((t) => (t as unknown as { name: string }).name);
    expect(toolNames).toContain('a11y_click_ref');
    expect(toolNames).toContain('a11y_task_done');
    expect(toolNames).not.toContain('computer_click');
  });

  it('decodes a11y_type_in_ref into a type_in_ref action', async () => {
    const client = fakeClient(() =>
      toolUseResponse('a11y_type_in_ref', { ref: 'e1', text: '今天天气' }, { id: 'toolu_a002' }),
    );
    const c = new AnthropicVisionLoopCommander({ client });
    const decision = await c.decideNextActionAccessibility(freshA11yContext());
    expect(decision.action).toEqual({ kind: 'type_in_ref', ref: 'e1', text: '今天天气' });
  });

  it('a11y_task_done → done action with summary', async () => {
    const client = fakeClient(() =>
      toolUseResponse('a11y_task_done', { summary: '搜索完成' }, { id: 'toolu_a003' }),
    );
    const c = new AnthropicVisionLoopCommander({ client });
    const decision = await c.decideNextActionAccessibility(freshA11yContext());
    expect(decision.action).toEqual({ kind: 'done', summary: '搜索完成' });
  });

  it('Anthropic API errors become a give_up action (never throw)', async () => {
    const client = fakeClient(() => {
      throw new Error('simulated 429');
    });
    const c = new AnthropicVisionLoopCommander({ client });
    const decision = await c.decideNextActionAccessibility(freshA11yContext());
    expect(decision.action.kind).toBe('give_up');
    if (decision.action.kind === 'give_up') {
      expect(decision.action.reason).toMatch(/Anthropic API error.*simulated 429/);
    }
  });

  it('no tool_use → give_up with stop_reason exposed', async () => {
    const client = fakeClient(() => emptyResponse());
    const c = new AnthropicVisionLoopCommander({ client });
    const decision = await c.decideNextActionAccessibility(freshA11yContext());
    expect(decision.action.kind).toBe('give_up');
    if (decision.action.kind === 'give_up') {
      expect(decision.action.reason).toMatch(/no tool_use.*stop_reason=end_turn/);
    }
  });

  it('history round-trips: prior a11y_click_ref becomes assistant tool_use + user tool_result', async () => {
    const cap: CapturedRequest = {};
    const client = fakeClient(
      () => toolUseResponse('a11y_task_done', { summary: 'done' }, { id: 'toolu_final' }),
      cap,
    );
    const c = new AnthropicVisionLoopCommander({ client });
    const ctx = freshA11yContext({
      tickIndex: 1,
      history: [
        {
          snapshot: SAMPLE_A11Y_SNAPSHOT,
          url: 'https://www.baidu.com/',
          title: '百度一下，你就知道',
          action: { kind: 'click_ref', ref: 'e2' },
          toolUseId: 'toolu_prior',
          executionResult: { ok: true, message: 'clicked button e2' },
        },
      ],
    });
    await c.decideNextActionAccessibility(ctx);

    const msgs = cap.req?.messages ?? [];
    // 1 initial user + 1 assistant tool_use replay + 1 user tool_result = 3.
    expect(msgs).toHaveLength(3);
    expect(msgs[1]?.role).toBe('assistant');
    const assistantContent = msgs[1]?.content as Anthropic.ContentBlockParam[];
    expect(assistantContent[0]?.type).toBe('tool_use');
    if (assistantContent[0]?.type === 'tool_use') {
      expect(assistantContent[0].name).toBe('a11y_click_ref');
      expect(assistantContent[0].id).toBe('toolu_prior');
    }
    expect(msgs[2]?.role).toBe('user');
    const userContent = msgs[2]?.content as Anthropic.ContentBlockParam[];
    expect(userContent[0]?.type).toBe('tool_result');
    if (userContent[0]?.type === 'tool_result') {
      expect(userContent[0].tool_use_id).toBe('toolu_prior');
    }
  });

  it('retries on transient Anthropic 500 then succeeds (F1)', async () => {
    let calls = 0;
    const client = fakeClient(() => {
      calls += 1;
      if (calls < 2) {
        const err: Error & { status?: number } = new Error('Anthropic 500');
        err.status = 500;
        throw err;
      }
      return toolUseResponse('a11y_task_done', { summary: 'retried ok' });
    });
    const c = new AnthropicVisionLoopCommander({ client });
    const decision = await c.decideNextActionAccessibility(freshA11yContext());
    expect(decision.action.kind).toBe('done');
    expect(calls).toBe(2);
  });

  it('does NOT retry on 400 (non-retryable) — gives up immediately', async () => {
    let calls = 0;
    const client = fakeClient(() => {
      calls += 1;
      const err: Error & { status?: number } = new Error('bad request');
      err.status = 400;
      throw err;
    });
    const c = new AnthropicVisionLoopCommander({ client });
    const decision = await c.decideNextActionAccessibility(freshA11yContext());
    expect(decision.action.kind).toBe('give_up');
    expect(calls).toBe(1);
  });

  it('writes an llm_calls row with purpose=commander.accessibility', async () => {
    const records: LlmCallRecord[] = [];
    const recorder: LlmCallRecorder = {
      record: async (r) => {
        records.push(r);
      },
    };
    const client = fakeClient(() =>
      toolUseResponse('a11y_click_ref', { ref: 'e2' }, { id: 'toolu_a004' }),
    );
    const c = new AnthropicVisionLoopCommander({ client, recorder });
    await c.decideNextActionAccessibility(
      freshA11yContext({ userId: 'usr_test', taskExternalId: 'tsk_test' }),
    );
    expect(records).toHaveLength(1);
    expect(records[0]?.purpose).toBe('commander.accessibility');
    expect(records[0]?.status).toBe('ok');
    expect(records[0]?.inputTokens).toBe(1_500);
  });
});

describe('VISION_SYSTEM_PROMPT — anti-hallucination guardrail', () => {
  // Reason: models love to "be helpful" by answering from training data
  // when the page is stuck on about:blank. Lock the refusal clause into
  // the prompt so a reviewer that accidentally deletes it fails CI, not
  // prod. If the Chinese wording changes, update these tokens too.
  it('tells the model to stop navigating when the page stays blank', () => {
    expect(VISION_SYSTEM_PROMPT).toMatch(/立即停止尝试导航/);
  });

  it("forbids answering from the model's own knowledge when the browser is blank", () => {
    expect(VISION_SYSTEM_PROMPT).toMatch(/不可以用你自己的知识/);
  });

  it('requires task_give_up with a blank-page reason rather than fabrication', () => {
    expect(VISION_SYSTEM_PROMPT).toMatch(/浏览器无法加载目标页面/);
  });
});
