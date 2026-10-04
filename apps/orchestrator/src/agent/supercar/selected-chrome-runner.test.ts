import type { SelectedChromeSessionCommand } from '@holaday/shared-types';
import { describe, expect, it, vi } from 'vitest';
import type {
  MessagesAdapter,
  NeutralMessagesRequest,
  NeutralMessagesResponse,
} from '../../llm/messages-adapter.js';
import { MessagesAdapterError } from '../../llm/messages-adapter.js';
import type { ExtensionToolCallOptions, ExtensionToolCallOutcome } from '../../ws/server.js';
import type { LlmCallRecord, LlmCallRecorder } from '../llm-call-recorder.js';
import { friendlyTaskFailureReason } from '../task-failure-copy.js';
import { BrowserControl } from './browser-control.js';
import { SelectedChromeClient } from './selected-chrome-client.js';
import { runSelectedChromeTask, toCapturedToolCall } from './selected-chrome-runner.js';

const sessionId = 'a249b41c-fd70-47fb-883d-2b70f033234f';
const selectionId = '5d09732c-d41d-421b-a61f-287093fc440b';
const target = {
  tabId: 42,
  expectedUrl: 'https://work.example/projects',
  selectionId,
};
const metadata = {
  provider: 'alibaba-model-studio',
  model: 'qwen-browser-fixture',
  region: 'cn',
  deploymentScope: 'china_mainland',
  endpointKind: 'public',
  protocol: 'messages',
} as const;

function response(
  id: string,
  content: NeutralMessagesResponse['content'],
): NeutralMessagesResponse {
  return {
    id,
    metadata,
    content,
    stopReason: content.some((block) => block.type === 'tool_use') ? 'tool_use' : 'end_turn',
    usage: {
      inputTokens: 10,
      outputTokens: 4,
      cacheReadInputTokens: null,
      cacheCreationInputTokens: null,
      complete: true,
    },
  };
}

function createHarness(
  modelReplies: NeutralMessagesResponse[],
  config: {
    observeFailures?: number;
    observeDelaysMs?: number[];
    actGate?: Promise<void>;
    unknownAct?: boolean;
    notAppliedAct?: boolean;
    tabClosedAct?: boolean;
    appliedObservationFailure?: boolean;
    closeUnconfirmed?: boolean;
    closeGate?: Promise<void>;
  } = {},
) {
  let bodyText = 'Draft';
  let observeFailures = config.observeFailures ?? 0;
  const observeDelaysMs = [...(config.observeDelaysMs ?? [])];
  const requests: NeutralMessagesRequest[] = [];
  const commands: SelectedChromeSessionCommand[] = [];
  const control = new BrowserControl();
  const send = vi.fn(
    async (
      _userId: string,
      options: ExtensionToolCallOptions,
    ): Promise<ExtensionToolCallOutcome> => {
      const command = options.args?.session;
      if (!command) return { ok: false, error: { code: 'missing', message: 'missing' } };
      commands.push(command);
      if (command.op === 'close') {
        if (config.closeGate) await config.closeGate;
        return config.closeUnconfirmed
          ? { ok: false, error: { code: 'timeout', message: 'timeout' } }
          : { ok: true, result: { ok: true, closed: true } };
      }
      if (command.op === 'observe' && observeFailures > 0) {
        observeFailures--;
        return { ok: false, error: { code: 'timeout', message: 'read timeout' } };
      }
      if (command.op === 'observe') {
        const delayMs = observeDelaysMs.shift() ?? 0;
        if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      if (command.op === 'act' && config.actGate) await config.actGate;
      if (command.op === 'act' && config.unknownAct) {
        return {
          ok: false,
          result: { ok: false, error: 'transport_timeout', actionOutcome: 'unknown' },
        };
      }
      if (command.op === 'act' && config.tabClosedAct) {
        return {
          ok: false,
          result: { ok: false, error: 'tab_closed', actionOutcome: 'not_applied' },
        };
      }
      if (command.op === 'act' && !config.notAppliedAct) bodyText = 'Saved';
      if (command.op === 'act' && config.appliedObservationFailure) {
        return {
          ok: false,
          result: { ok: false, error: 'observation_failed', actionOutcome: 'applied' },
        };
      }
      return {
        ok: true,
        result: {
          ok: true,
          sessionId,
          observation: {
            tabId: 42,
            origin: 'https://work.example',
            title: 'Projects',
            bodyText,
            ariaSnapshot: bodyText === 'Draft' ? '- button "Save"' : '- status "Saved"',
            truncated: false,
          },
          ...(command.op === 'act'
            ? { actionOutcome: config.notAppliedAct ? 'not_applied' : 'applied' }
            : {}),
        },
      };
    },
  );
  const client = new SelectedChromeClient({
    userId: 'user-a',
    taskId: 'task-a',
    extensionClientId: 'chrome-a',
    control,
    send,
  });
  const modelCreate = vi.fn(async (request: NeutralMessagesRequest) => {
    requests.push(request);
    const reply = modelReplies.shift();
    if (!reply) throw new Error('unexpected model call');
    return reply;
  });
  const messagesAdapter: MessagesAdapter = {
    metadata,
    create: modelCreate,
  };
  return { client, control, send, commands, requests, messagesAdapter, modelCreate };
}

function finish(evidenceText: string, id = 'finish-1') {
  return response(id, [
    {
      type: 'tool_use',
      id,
      name: 'browser_finish',
      input: { summary: `Finished with ${evidenceText || 'no evidence'}.`, evidenceText },
    },
  ]);
}

function records(): { recorder: LlmCallRecorder; values: LlmCallRecord[] } {
  const values: LlmCallRecord[] = [];
  return {
    values,
    recorder: { record: vi.fn(async (record) => void values.push(record)) },
  };
}

describe('runSelectedChromeTask', () => {
  it.each([
    '给我一份 CSV 文件',
    'Please provide a CSV file',
    'Create a ZIP file',
    'Create a.csv and b.csv',
  ])(
    'does not satisfy an explicit file request with a single unrelated artifact: %s',
    async (intent) => {
      const h = createHarness([toolReply('create_file', fileInput), finish('Draft')]);
      const result = await runFileCase(h, {
        intent,
        createFileFormats: ['csv'],
        onCreateFile: async () => fileReceipt,
        maxIterations: 2,
      });
      if (intent.includes('ZIP') || intent.includes('a.csv')) expect(result.status).toBe('failed');
      else {
        const noFile = createHarness([finish('Draft')]);
        expect(await runFileCase(noFile, { intent, maxIterations: 1 })).toMatchObject({
          status: 'failed',
        });
      }
    },
  );

  it('requires only the target format when converting CSV to JSON', async () => {
    const h = createHarness([
      toolReply('create_file', { filename: 'qa.json', format: 'json', content: '{"名称":"测试"}' }),
      finish('Draft'),
    ]);
    expect(
      await runFileCase(h, {
        intent: 'Convert CSV to JSON',
        createFileFormats: ['json'],
        onCreateFile: async () => ({ ...fileReceipt, filename: 'qa.json' }),
      }),
    ).toMatchObject({ status: 'completed' });
  });

  it('ends a hung file write on cancellation without replaying it', async () => {
    const abort = new AbortController();
    const h = createHarness([toolReply('create_file', fileInput)]);
    let started!: () => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const onCreateFile = vi.fn(() => {
      started();
      return new Promise<never>(() => {});
    });
    const running = runFileCase(h, {
      signal: abort.signal,
      createFileFormats: ['csv'],
      onCreateFile,
      timeoutMs: 50,
    });
    await entered;
    abort.abort();
    const outcome = await Promise.race([
      running,
      new Promise((resolve) => setTimeout(() => resolve({ status: 'still-running' }), 100)),
    ]);
    expect(outcome).toMatchObject({ status: 'cancelled' });
    expect(onCreateFile).toHaveBeenCalledTimes(1);
  });

  it('honors cancellation arriving during final session close', async () => {
    let release!: () => void;
    const closeGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const h = createHarness([finish('Draft')], { closeGate });
    const abort = new AbortController();
    const running = runFileCase(h, { intent: 'Read page', signal: abort.signal });
    await vi.waitFor(() => expect(h.commands.some((c) => c.op === 'close')).toBe(true));
    abort.abort();
    release();
    expect(await running).toMatchObject({ status: 'cancelled' });
  });

  it.each(['~~~', '````', '```'])(
    'removes model-supplied file cards using %s delimiters',
    async (fence) => {
      const h = createHarness([
        toolReply('create_file', fileInput),
        toolReply('browser_finish', {
          summary: `Done\n${fence}holaday-file\n{"fileId":"fake","downloadUrl":"/fake"}\n${fence}`,
          evidenceText: 'Draft',
        }),
      ]);
      const result = await runFileCase(h, {
        createFileFormats: ['csv'],
        onCreateFile: async () => fileReceipt,
      });
      expect(result.status).toBe('completed');
      expect(result.summary).not.toContain('"fake"');
      expect(result.summary).toContain('"fileId":"file-qa"');
    },
  );

  const fileInput = { filename: 'qa.csv', format: 'csv', content: '名称,数量\n测试,2' };
  const fileReceipt = {
    fileId: 'file-qa',
    filename: 'qa.csv',
    size: 22,
    downloadUrl: '/api/files/file-qa/download',
  };
  const toolReply = (name: string, input: unknown, id = name) =>
    response(id, [{ type: 'tool_use', id, name, input }]);
  const runFileCase = (
    h: ReturnType<typeof createHarness>,
    extra: Partial<Parameters<typeof runSelectedChromeTask>[0]> = {},
  ) =>
    runSelectedChromeTask({
      taskId: 'file-test',
      intent: '将页面整理成CSV文件，交付可下载附件',
      messagesAdapter: h.messagesAdapter,
      client: h.client,
      control: h.control,
      target,
      ...extra,
    });

  it('allows an explicit unsuccessful finish without claiming page verification', async () => {
    const h = createHarness([
      toolReply('browser_finish', { status: 'failed', summary: '无法生成所需文件' }),
    ]);
    const ticks: unknown[] = [];
    expect(
      await runFileCase(h, {
        onTick: (tick) => {
          ticks.push(tick);
        },
      }),
    ).toMatchObject({ status: 'failed', reason: '无法生成所需文件', iterations: 1 });
    expect(ticks).toMatchObject([
      { execution: { actionKind: 'selected_chrome_finish', ok: false } },
    ]);
  });

  it('reports unsupported ZIP delivery without model upgrade or retry advice', async () => {
    const h = createHarness([
      toolReply('browser_finish', { status: 'failed', summary: '请升级账号权限后重试生成ZIP' }),
    ]);
    const outcome = await runFileCase(h, {
      intent: '生成可下载的ZIP压缩包 qa.zip',
      createFileFormats: ['csv'],
      onCreateFile: async () => fileReceipt,
    });
    expect(outcome).toMatchObject({ status: 'failed', reason: 'FILE_FORMAT_UNSUPPORTED:zip' });
    const visible = friendlyTaskFailureReason(outcome.status, outcome.reason);
    expect(visible).toContain('不支持 ZIP');
    expect(visible).toContain('升级套餐无法解决');
    expect(visible).not.toMatch(/简化|重试|请升级/);
    const fileTool = h.requests[0]?.tools?.find((tool) => tool.name === 'create_file');
    expect(fileTool?.description).not.toMatch(/升级 Pro|请改用可用格式/);
    expect(fileTool?.description).toContain('csv');
    expect(h.commands.filter((command) => command.op === 'act')).toHaveLength(0);
  });

  it.each(['读取ZIP文件的说明，不要生成文件', '生成一份PDF文件'])(
    'does not misclassify input mentions or plan-limited formats: %s',
    async (intent) => {
      const h = createHarness([
        toolReply('browser_finish', { status: 'failed', summary: '需要登录才能继续' }),
      ]);
      expect(await runFileCase(h, { intent, createFileFormats: ['csv'] })).toMatchObject({
        status: 'failed',
        reason: '需要登录才能继续',
      });
    },
  );

  it.each([
    '生成 PDF 报告，参考 input.zip',
    'Generate a PDF report using input.zip',
    '生成 CSV 文件，依据 input.zip 整理数据',
    '生成 CSV 文件，参考 input.v1.zip',
    'Generate a CSV file using input.tar.gz',
  ])('preserves the actual failure when ZIP is a source for another output: %s', async (intent) => {
    const h = createHarness([
      toolReply('browser_finish', { status: 'failed', summary: '需要登录才能继续' }),
    ]);
    expect(await runFileCase(h, { intent })).toMatchObject({
      status: 'failed',
      reason: '需要登录才能继续',
    });
  });

  it('can deliver a requested CSV when the reference filename is ZIP', async () => {
    const h = createHarness([toolReply('create_file', fileInput), finish('Draft')]);
    expect(
      await runFileCase(h, {
        intent: '生成 CSV 文件，参考 input.zip',
        createFileFormats: ['csv'],
        onCreateFile: async () => fileReceipt,
      }),
    ).toMatchObject({ status: 'completed' });
  });

  it('does not erase a ZIP output immediately following a source filename', async () => {
    const h = createHarness([toolReply('create_file', fileInput), finish('Draft')]);
    expect(
      await runFileCase(h, {
        intent: '生成CSV文件，参考input.zip再生成output.zip',
        createFileFormats: ['csv'],
        onCreateFile: async () => fileReceipt,
        maxIterations: 2,
      }),
    ).toMatchObject({ status: 'failed' });
  });

  it('does not accept page evidence as a substitute for a requested downloadable file', async () => {
    const h = createHarness([finish('Draft')]);
    expect(await runFileCase(h, { maxIterations: 1 })).toMatchObject({ status: 'failed' });
  });

  it('creates a file through the existing callback and appends its verified download card', async () => {
    const h = createHarness([toolReply('create_file', fileInput), finish('Draft')]);
    const onCreateFile = vi.fn(async () => fileReceipt);
    const result = await runFileCase(h, { createFileFormats: ['csv'], onCreateFile });
    expect(onCreateFile).toHaveBeenCalledTimes(1);
    expect(onCreateFile).toHaveBeenCalledWith(fileInput);
    expect(result.status).toBe('completed');
    expect(result.summary).toContain('```holaday-file\n');
    expect(result.summary).toContain('"fileId":"file-qa"');
    expect(h.commands.some((command) => command.op === 'act')).toBe(false);
    expect(h.requests[0]?.tools?.some((tool) => tool.name === 'create_file')).toBe(true);
  });

  it.each(['error', 'throw', 'wrong-format', 'malformed-receipt'] as const)(
    'cannot complete on an unfulfilled artifact: %s',
    async (scenario) => {
      const h = createHarness([
        toolReply('create_file', {
          ...fileInput,
          format: scenario === 'wrong-format' ? 'txt' : 'csv',
        }),
        finish('Draft'),
      ]);
      const onCreateFile = vi.fn(async () => {
        if (scenario === 'throw') throw new Error('storage failed');
        if (scenario === 'error') return { error: 'storage failed' };
        if (scenario === 'malformed-receipt') return { ...fileReceipt, fileId: '', size: 0 };
        return { ...fileReceipt, filename: 'qa.txt' };
      });
      expect(
        await runFileCase(h, { createFileFormats: ['csv', 'txt'], onCreateFile, maxIterations: 2 }),
      ).toMatchObject({ status: 'failed' });
    },
  );

  it('enforces the existing plan format allowlist even for an invented tool call', async () => {
    const h = createHarness([toolReply('create_file', fileInput)]);
    const onCreateFile = vi.fn(async () => fileReceipt);
    expect(
      await runFileCase(h, { createFileFormats: [], onCreateFile, maxIterations: 1 }),
    ).toMatchObject({ status: 'failed' });
    expect(onCreateFile).not.toHaveBeenCalled();
    expect(h.requests[0]?.tools?.some((tool) => tool.name === 'create_file')).toBe(false);
  });

  it('does not duplicate a successful file write when the model repeats the same tool input', async () => {
    const h = createHarness([
      toolReply('create_file', fileInput, 'file-1'),
      toolReply('create_file', fileInput, 'file-2'),
      finish('Draft'),
    ]);
    const onCreateFile = vi.fn(async () => fileReceipt);
    const result = await runFileCase(h, { createFileFormats: ['csv'], onCreateFile });
    expect(result.status).toBe('completed');
    expect(onCreateFile).toHaveBeenCalledTimes(1);
    expect(result.summary?.match(/```holaday-file/g)).toHaveLength(1);
  });

  it.each(['读取 report.csv，概括内容，不生成文件', 'Explain CSV format', '打开 PDF 文档并总结'])(
    'does not require a generated attachment for reading: %s',
    async (intent) => {
      const h = createHarness([finish('Draft')]);
      expect(await runFileCase(h, { intent })).toMatchObject({ status: 'completed' });
    },
  );

  it('cannot report completion when cancelled while storing a file', async () => {
    const abort = new AbortController();
    const h = createHarness([toolReply('create_file', fileInput), finish('Draft')]);
    const onCreateFile = vi.fn(async () => {
      abort.abort();
      return fileReceipt;
    });
    expect(
      await runFileCase(h, { createFileFormats: ['csv'], onCreateFile, signal: abort.signal }),
    ).toMatchObject({ status: 'cancelled' });
  });

  it('preserves file content whitespace byte-for-byte at the storage boundary', async () => {
    const content = '  名称,数量\n测试,2\n';
    const h = createHarness([toolReply('create_file', { ...fileInput, content }), finish('Draft')]);
    const onCreateFile = vi.fn(async () => fileReceipt);
    await runFileCase(h, { createFileFormats: ['csv'], onCreateFile });
    expect(onCreateFile).toHaveBeenCalledWith({ ...fileInput, content });
  });

  it.each(['给我一个可下载的 CSV 附件', '整理为 CSV 文件', 'Create a CSV and a JSON file'])(
    'requires all requested file formats: %s',
    async (intent) => {
      const h = createHarness([
        toolReply('create_file', { ...fileInput, format: 'txt', filename: 'qa.txt' }),
        finish('Draft'),
      ]);
      const onCreateFile = vi.fn(async () => ({ ...fileReceipt, filename: 'qa.txt' }));
      expect(
        await runFileCase(h, {
          intent,
          createFileFormats: ['txt'],
          onCreateFile,
          maxIterations: 2,
        }),
      ).toMatchObject({ status: 'failed' });
    },
  );

  it('does not count a single CSV as both requested CSV and JSON outputs', async () => {
    const h = createHarness([toolReply('create_file', fileInput), finish('Draft')]);
    expect(
      await runFileCase(h, {
        intent: 'Create a CSV and a JSON file',
        createFileFormats: ['csv'],
        onCreateFile: async () => fileReceipt,
        maxIterations: 2,
      }),
    ).toMatchObject({ status: 'failed' });
  });

  it('keeps cancellation authoritative when an in-flight file callback throws', async () => {
    const abort = new AbortController();
    const h = createHarness([toolReply('create_file', fileInput)]);
    expect(
      await runFileCase(h, {
        signal: abort.signal,
        createFileFormats: ['csv'],
        onCreateFile: async () => {
          abort.abort();
          throw new Error('write interrupted');
        },
      }),
    ).toMatchObject({ status: 'cancelled' });
  });

  it('preserves applied action success when its follow-up observation fails', async () => {
    const h = createHarness(
      [
        response('act', [
          {
            type: 'tool_use',
            id: 'act',
            name: 'browser_act',
            input: { action: { kind: 'key', payload: { key: 'Enter' } } },
          },
        ]),
        finish('Saved'),
      ],
      { appliedObservationFailure: true },
    );
    const ticks: unknown[] = [];
    expect(
      await runSelectedChromeTask({
        taskId: 'applied-read-failed',
        intent: 'Save draft',
        messagesAdapter: h.messagesAdapter,
        client: h.client,
        control: h.control,
        target,
        onTick: (tick) => {
          ticks.push(tick);
        },
      }),
    ).toMatchObject({ status: 'completed' });
    expect(ticks).toMatchObject([
      {
        execution: {
          actionKind: 'selected_chrome_action',
          ok: true,
          message: expect.stringContaining('observation_failed'),
        },
      },
      { execution: { actionKind: 'selected_chrome_finish', ok: true } },
    ]);
    expect(h.commands.filter((command) => command.op === 'act')).toHaveLength(1);
    expect(h.commands.map((command) => command.op)).toContain('observe');
  });

  it('discards an action blocked locally by takeover before dispatch', async () => {
    const h = createHarness([
      response('observe-act', [
        { type: 'tool_use', id: 'observe', name: 'browser_observe', input: {} },
        {
          type: 'tool_use',
          id: 'act',
          name: 'browser_act',
          input: { action: { kind: 'key', payload: { key: 'Enter' } } },
        },
      ]),
      finish('Draft'),
    ]);
    const ticks: import('./agent-loop.js').SupercarTickEvent[] = [];
    const running = runSelectedChromeTask({
      taskId: 'pre-dispatch-handoff',
      intent: 'Inspect draft',
      messagesAdapter: h.messagesAdapter,
      client: h.client,
      control: h.control,
      target,
      onTick: (tick) => {
        ticks.push(tick);
        if (tick.execution?.actionKind === 'selected_chrome_observe') h.control.requestHuman();
      },
    });
    await vi.waitFor(() => expect(h.control.snapshot().phase).toBe('human'));
    const lease = h.control.snapshot().lease;
    if (!lease) throw new Error('missing lease');
    h.control.returnToAgent(lease);
    expect(await running).toMatchObject({ status: 'completed' });
    expect(h.commands.filter((command) => command.op === 'act')).toHaveLength(0);
    expect(ticks.map((tick) => tick.execution?.actionKind)).toEqual([
      'selected_chrome_observe',
      'selected_chrome_plan_discarded',
      'selected_chrome_handoff',
      'selected_chrome_finish',
    ]);
    expect(JSON.stringify(h.requests.at(-1)?.messages)).toContain('human');
  });
  it.each(['click', 'wait'] as const)(
    'does not turn a %s not_applied receipt into a completed action',
    async (kind) => {
      const action =
        kind === 'wait'
          ? { kind, payload: { ms: 1 } }
          : {
              kind,
              selector: {
                description: 'Save',
                strategies: [{ kind: 'role', role: 'button', name: 'Save' }],
              },
            };
      const h = createHarness(
        [
          response('act', [
            { type: 'tool_use', id: 'act', name: 'browser_act', input: { action } },
          ]),
          finish('Draft'),
        ],
        { notAppliedAct: true },
      );
      const ticks: unknown[] = [];
      const outcome = await runSelectedChromeTask({
        taskId: 'not-applied',
        intent: 'Inspect draft',
        messagesAdapter: h.messagesAdapter,
        client: h.client,
        control: h.control,
        target,
        onTick: (tick) => {
          ticks.push(tick);
        },
      });
      expect(outcome.status).toBe('completed');
      expect(ticks).toMatchObject([
        {
          iteration: 1,
          execution: {
            actionKind: kind === 'wait' ? 'selected_chrome_observe' : 'selected_chrome_action',
            ok: kind === 'wait',
          },
        },
        { iteration: 2, execution: { actionKind: 'selected_chrome_finish', ok: true } },
      ]);
    },
  );

  it('stops with a clear reason when the selected tab was closed', async () => {
    const action = {
      kind: 'click',
      selector: {
        description: 'Save',
        strategies: [{ kind: 'role', role: 'button', name: 'Save' }],
      },
    };
    const h = createHarness(
      [response('act', [{ type: 'tool_use', id: 'act', name: 'browser_act', input: { action } }])],
      { tabClosedAct: true },
    );
    const outcome = await runSelectedChromeTask({
      taskId: 'tab-closed',
      intent: 'Save the draft',
      messagesAdapter: h.messagesAdapter,
      client: h.client,
      control: h.control,
      target,
    });
    expect(outcome).toMatchObject({
      status: 'failed',
      reason: expect.stringContaining('标签页已被关闭'),
    });
    // No further model round after the tab is gone.
    expect(h.modelCreate).toHaveBeenCalledTimes(1);
  });

  it('uses distinct receipt indexes for multiple tools in a single model round', async () => {
    const h = createHarness([
      response('combined', [
        { type: 'tool_use', id: 'observe', name: 'browser_observe', input: {} },
        { type: 'tool_use', id: 'unknown', name: 'not_a_tool', input: {} },
        {
          type: 'tool_use',
          id: 'finish',
          name: 'browser_finish',
          input: { summary: 'Draft visible', evidenceText: 'Draft' },
        },
      ]),
    ]);
    const ticks: unknown[] = [];
    const outcome = await runSelectedChromeTask({
      taskId: 'combined',
      intent: 'Inspect draft',
      messagesAdapter: h.messagesAdapter,
      client: h.client,
      control: h.control,
      target,
      onTick: (tick) => {
        ticks.push(tick);
      },
    });
    expect(outcome).toMatchObject({ status: 'completed', iterations: 1 });
    expect(ticks).toMatchObject([
      { iteration: 1, execution: { actionKind: 'selected_chrome_observe' } },
      { iteration: 2, execution: { actionKind: 'selected_chrome_plan_discarded' } },
      { iteration: 3, execution: { actionKind: 'selected_chrome_finish' } },
    ]);
  });
  it('does not publish a successful step before the actual action receipt', async () => {
    let release!: () => void;
    const h = createHarness(
      [
        response('click', [
          {
            type: 'tool_use',
            id: 'click',
            name: 'browser_act',
            input: {
              action: {
                kind: 'click',
                selector: {
                  description: 'Save',
                  strategies: [{ kind: 'role', role: 'button', name: 'Save' }],
                },
              },
            },
          },
        ]),
        finish('Saved'),
      ],
      {
        actGate: new Promise<void>((resolve) => {
          release = resolve;
        }),
      },
    );
    const ticks: unknown[] = [];
    const running = runSelectedChromeTask({
      taskId: 'truth',
      intent: 'Save',
      target,
      client: h.client,
      control: h.control,
      messagesAdapter: h.messagesAdapter,
      onTick: (event) => {
        ticks.push(event);
      },
    });
    await vi.waitFor(() => expect(h.commands.some((c) => c.op === 'act')).toBe(true));
    const beforeReceipt = [...ticks];
    release();
    expect((await running).status).toBe('completed');
    expect(beforeReceipt).toEqual([]);
    expect(ticks).toMatchObject([
      { iteration: 1, execution: { actionKind: 'selected_chrome_action', ok: true } },
      { iteration: 2, execution: { actionKind: 'selected_chrome_finish', ok: true } },
    ]);
  });

  it('records an unknown action outcome as failed rather than successful', async () => {
    const h = createHarness(
      [
        response('click', [
          {
            type: 'tool_use',
            id: 'click',
            name: 'browser_act',
            input: {
              action: {
                kind: 'click',
                selector: {
                  description: 'Save',
                  strategies: [{ kind: 'role', role: 'button', name: 'Save' }],
                },
              },
            },
          },
        ]),
      ],
      { unknownAct: true },
    );
    const ticks: unknown[] = [];
    const outcome = await runSelectedChromeTask({
      taskId: 'unknown-record',
      intent: 'Save',
      target,
      client: h.client,
      control: h.control,
      messagesAdapter: h.messagesAdapter,
      onTick: (event) => {
        ticks.push(event);
      },
    });
    expect(outcome.status).toBe('failed');
    expect(ticks).toMatchObject([
      { execution: { actionKind: 'selected_chrome_action', ok: false } },
    ]);
  });
  it('validates and executes the JSON-string action shape returned by live Qwen', async () => {
    const h = createHarness([
      response('qwen-string-action', [
        {
          type: 'tool_use',
          id: 'act-string',
          name: 'browser_act',
          input: {
            action:
              '{"kind":"click","selector":{"description":"Save button","strategies":[{"kind":"role","role":"button","name":"Save"}]}}',
          },
        },
      ]),
      finish('Saved'),
    ]);
    const outcome = await runSelectedChromeTask({
      taskId: 'string-action',
      intent: 'Save the draft',
      messagesAdapter: h.messagesAdapter,
      client: h.client,
      control: h.control,
      target,
    });
    expect(outcome.status).toBe('completed');
    expect(h.commands.filter((c) => c.op === 'act')).toMatchObject([
      expect.objectContaining({
        action: {
          kind: 'click',
          selector: {
            description: 'Save button',
            scope: { timeoutMs: 5000 },
            selfHeal: true,
            strategies: [{ kind: 'role', role: 'button', name: 'Save' }],
          },
        },
      }),
    ]);
  });

  it.each([
    'not json',
    'null',
    '[]',
    '"nested string"',
    '{"kind":"evaluate","payload":{"code":"1"}}',
    '{"kind":"click","selector":{"description":"Save"}}',
  ])('does not execute malformed or unsupported JSON-string action %s', async (action) => {
    const h = createHarness([
      response('bad-string-action', [
        { type: 'tool_use', id: 'bad', name: 'browser_act', input: { action } },
      ]),
      finish('Draft'),
    ]);
    await runSelectedChromeTask({
      taskId: 'bad-string',
      intent: 'Read draft',
      messagesAdapter: h.messagesAdapter,
      client: h.client,
      control: h.control,
      target,
    });
    expect(h.commands.filter((c) => c.op === 'act')).toHaveLength(0);
    expect(JSON.stringify(h.requests[1]?.messages)).toContain('invalid_tool_input');
  });

  it('rejects oversized serialized actions before dispatch even when JSON is valid', async () => {
    const action =
      '{"kind":"click","selector":{"description":"Save","strategies":[{"kind":"role","role":"button","name":"Save"}]}}'.padEnd(
        32_001,
        ' ',
      );
    const h = createHarness([
      response('oversized', [
        { type: 'tool_use', id: 'large', name: 'browser_act', input: { action } },
      ]),
      finish('Draft'),
    ]);
    await runSelectedChromeTask({
      taskId: 'oversized',
      intent: 'Read draft',
      messagesAdapter: h.messagesAdapter,
      client: h.client,
      control: h.control,
      target,
    });
    expect(h.commands.filter((c) => c.op === 'act')).toHaveLength(0);
    expect(JSON.stringify(h.requests[1]?.messages)).toContain('invalid_tool_input');
  });

  it('routes decoded string payment actions through the existing human handoff', async () => {
    const h = createHarness([
      response('string-payment', [
        {
          type: 'tool_use',
          id: 'pay',
          name: 'browser_act',
          input: {
            action:
              '{"kind":"click","selector":{"description":"Pay now","strategies":[{"kind":"role","role":"button","name":"Pay now"}]}}',
          },
        },
      ]),
      finish('Draft'),
    ]);
    const running = runSelectedChromeTask({
      taskId: 'string-payment',
      intent: 'Continue',
      messagesAdapter: h.messagesAdapter,
      client: h.client,
      control: h.control,
      target,
    });
    await vi.waitFor(() => expect(h.control.snapshot().phase).toBe('human'), { timeout: 200 });
    const lease = h.control.snapshot().lease;
    if (!lease) throw new Error('missing human lease');
    expect(h.commands.filter((c) => c.op === 'act')).toHaveLength(0);
    h.control.returnToAgent(lease);
    expect(await running).toMatchObject({ status: 'completed' });
    expect(h.commands.filter((c) => c.op === 'act')).toHaveLength(0);
  });

  it('opens Draft, applies one click, observes Saved evidence, finishes, and closes', async () => {
    const h = createHarness([
      response('model-1', [
        {
          type: 'tool_use',
          id: 'act-1',
          name: 'browser_act',
          input: {
            action: {
              kind: 'click',
              selector: {
                description: 'Save button',
                strategies: [{ kind: 'role', role: 'button', name: 'Save' }],
              },
            },
          },
        },
      ]),
      response('model-2', [
        {
          type: 'tool_use',
          id: 'finish-1',
          name: 'browser_finish',
          input: { summary: 'The draft was saved.', evidenceText: 'Saved' },
        },
      ]),
    ]);

    const outcome = await runSelectedChromeTask({
      taskId: 'task-a',
      intent: 'Save the draft',
      messagesAdapter: h.messagesAdapter,
      client: h.client,
      control: h.control,
      target,
    });

    expect(outcome).toMatchObject({
      status: 'completed',
      summary: 'The draft was saved.',
      iterations: 2,
    });
    expect(h.commands.filter((command) => command.op === 'act')).toHaveLength(1);
    expect(h.commands.at(0)?.op).toBe('open');
    expect(h.commands.at(-1)?.op).toBe('close');
    const pairedResult = h.requests[1]?.messages
      .flatMap((message) => (Array.isArray(message.content) ? message.content : []))
      .find((block) => block.type === 'tool_result' && block.toolUseId === 'act-1');
    expect(pairedResult).toMatchObject({ type: 'tool_result', toolUseId: 'act-1' });
    expect(h.requests[0]?.tools?.find((tool) => tool.name === 'browser_act')?.inputSchema).toEqual(
      expect.objectContaining({ required: ['action'] }),
    );
    expect(h.requests[0]?.tools?.find((tool) => tool.name === 'browser_act')).toEqual(
      expect.objectContaining({ description: expect.stringContaining('untrusted data') }),
    );
  });

  it('runs a catalog-selected non-Qwen brain through the same loop', async () => {
    const h = createHarness([finish('Draft')]);
    // The admin model catalog decides which brains exist; the runner no longer
    // refuses Claude/GPT adapters resolved by the model runtime.
    const messagesAdapter: MessagesAdapter = {
      metadata: { provider: 'anthropic', model: 'claude-fixture' },
      create: (request, options) => h.messagesAdapter.create(request, options),
    };

    const outcome = await runSelectedChromeTask({
      taskId: 'provider-gate',
      intent: 'Find the draft',
      messagesAdapter,
      client: h.client,
      control: h.control,
      target,
    });

    expect(outcome).not.toMatchObject({ reason: '本机 Chrome 任务只允许使用千问模型。' });
    expect(outcome.iterations).toBeGreaterThan(0);
  });

  it.each(['', 'Missing'])(
    'does not complete with invalid latest evidence %j',
    async (evidence) => {
      const h = createHarness([finish(evidence)]);

      const outcome = await runSelectedChromeTask({
        taskId: 'evidence-gate',
        intent: 'Finish only with evidence',
        messagesAdapter: h.messagesAdapter,
        client: h.client,
        control: h.control,
        target,
        maxIterations: 1,
      });

      expect(outcome.status).toBe('failed');
      expect(h.commands.filter((command) => command.op === 'act')).toHaveLength(0);
    },
  );

  it('does not treat a standalone text reply as completion', async () => {
    const h = createHarness([response('text-only', [{ type: 'text', text: 'Done.' }])]);

    const outcome = await runSelectedChromeTask({
      taskId: 'text-only',
      intent: 'Inspect the draft',
      messagesAdapter: h.messagesAdapter,
      client: h.client,
      control: h.control,
      target,
      maxIterations: 1,
    });

    expect(outcome).toMatchObject({ status: 'failed', iterations: 1 });
    expect(outcome.summary).toBeUndefined();
  });

  it('returns a paired recoverable result for malformed tool input', async () => {
    const h = createHarness([
      response('malformed-action', [
        {
          type: 'tool_use',
          id: 'bad-act',
          name: 'browser_act',
          input: { action: { kind: 'click', selector: { description: 'Save' } } },
        },
      ]),
      finish('Draft'),
    ]);

    const outcome = await runSelectedChromeTask({
      taskId: 'malformed-action',
      intent: 'Inspect',
      messagesAdapter: h.messagesAdapter,
      client: h.client,
      control: h.control,
      target,
    });

    expect(outcome.status).toBe('completed');
    expect(h.commands.filter((command) => command.op === 'act')).toHaveLength(0);
    const malformedPair = h.requests[1]?.messages
      .flatMap((message) => (Array.isArray(message.content) ? message.content : []))
      .find((block) => block.type === 'tool_result' && block.toolUseId === 'bad-act');
    expect(malformedPair).toMatchObject({ isError: true });
    expect(malformedPair?.content).toContain('invalid_tool_input');
  });

  it('terminates an unknown input outcome without replaying the action', async () => {
    const h = createHarness(
      [
        response('unknown-input', [
          {
            type: 'tool_use',
            id: 'act-unknown',
            name: 'browser_act',
            input: {
              action: {
                kind: 'key',
                payload: { key: 'Enter' },
              },
            },
          },
        ]),
      ],
      { unknownAct: true },
    );

    const outcome = await runSelectedChromeTask({
      taskId: 'unknown-input',
      intent: 'Press enter once',
      messagesAdapter: h.messagesAdapter,
      client: h.client,
      control: h.control,
      target,
      maxIterations: 3,
    });

    expect(outcome).toMatchObject({ status: 'failed', iterations: 1 });
    expect(outcome.reason).toContain('不会自动重放');
    expect(h.commands.filter((command) => command.op === 'act')).toHaveLength(1);
    expect(h.modelCreate).toHaveBeenCalledTimes(1);
  });

  it('discards a model action planned while Chrome is taken over and refreshes after handback', async () => {
    const h = createHarness([]);
    const accounting = records();
    const ticks: unknown[] = [];
    let resolveFirst!: (value: NeutralMessagesResponse) => void;
    h.modelCreate
      .mockImplementationOnce(
        (request) =>
          new Promise((resolve) => {
            h.requests.push(request);
            resolveFirst = resolve;
          }),
      )
      .mockImplementationOnce(async (request) => {
        h.requests.push(request);
        return finish('Draft', 'finish-after-handback');
      });

    const running = runSelectedChromeTask({
      taskId: 'handoff',
      intent: 'Inspect the draft',
      messagesAdapter: h.messagesAdapter,
      client: h.client,
      control: h.control,
      target,
      recorder: accounting.recorder,
      userExternalId: 'usr_handoff',
      onTick: (event) => {
        ticks.push(event);
      },
    });
    await vi.waitFor(() => expect(resolveFirst).toBeTypeOf('function'));
    h.control.requestHuman();
    resolveFirst(
      response('stale-model-action', [
        {
          type: 'tool_use',
          id: 'stale-act',
          name: 'browser_act',
          input: { action: { kind: 'goto', payload: { url: 'https://work.example/stale' } } },
        },
      ]),
    );
    await vi.waitFor(() => expect(h.control.snapshot().phase).toBe('human'));
    const lease = h.control.snapshot().lease;
    if (!lease) throw new Error('missing human lease');
    h.control.returnToAgent(lease);

    const outcome = await running;

    expect(outcome.status).toBe('completed');
    expect(h.commands.filter((command) => command.op === 'act')).toHaveLength(0);
    expect(h.modelCreate).toHaveBeenCalledTimes(2);
    expect(accounting.values).toHaveLength(2);
    const stalePair = h.requests[1]?.messages
      .flatMap((message) => (Array.isArray(message.content) ? message.content : []))
      .find((block) => block.type === 'tool_result' && block.toolUseId === 'stale-act');
    expect(stalePair).toMatchObject({ isError: true });
    expect(stalePair?.content).toContain('replan_required');
    expect(JSON.stringify(h.requests[1]?.messages)).toContain('not executed');
    expect(JSON.stringify(h.requests[1]?.messages)).toContain('human');
    expect(ticks).toMatchObject([
      { execution: { actionKind: 'selected_chrome_handoff' } },
      { execution: { actionKind: 'selected_chrome_plan_discarded' } },
      { execution: { actionKind: 'selected_chrome_finish' } },
    ]);
    expect(h.commands.filter((command) => command.op === 'observe').length).toBeGreaterThanOrEqual(
      3,
    );
  });

  it('aborts a pending model call, closes control, and closes the Chrome session', async () => {
    const h = createHarness([]);
    const abort = new AbortController();
    h.modelCreate.mockImplementation(
      (request) =>
        new Promise(() => {
          h.requests.push(request);
        }),
    );
    const running = runSelectedChromeTask({
      taskId: 'cancel',
      intent: 'Wait',
      messagesAdapter: h.messagesAdapter,
      client: h.client,
      control: h.control,
      target,
      signal: abort.signal,
    });
    await vi.waitFor(() => expect(h.modelCreate).toHaveBeenCalledOnce());
    abort.abort();

    expect(await running).toMatchObject({ status: 'cancelled' });
    expect(h.control.snapshot().phase).toBe('closed');
    expect(h.commands.at(-1)?.op).toBe('close');
  });

  it('enforces the whole-task timeout while the model is pending', async () => {
    const h = createHarness([]);
    let modelOptions: Parameters<MessagesAdapter['create']>[1];
    h.modelCreate.mockImplementation(
      (
        request: NeutralMessagesRequest,
        options?: Parameters<MessagesAdapter['create']>[1],
      ): Promise<NeutralMessagesResponse> =>
        new Promise<NeutralMessagesResponse>(() => {
          h.requests.push(request);
          modelOptions = options;
        }),
    );

    const outcome = await runSelectedChromeTask({
      taskId: 'timeout',
      intent: 'Wait',
      messagesAdapter: h.messagesAdapter,
      client: h.client,
      control: h.control,
      target,
      timeoutMs: 20,
    });

    expect(outcome).toMatchObject({ status: 'timeout' });
    expect(modelOptions?.timeoutMs).toBeGreaterThan(0);
    expect(modelOptions?.timeoutMs).toBeLessThanOrEqual(20);
    expect(modelOptions?.maxRetries).toBe(2);
    expect(h.control.snapshot().phase).toBe('closed');
    expect(h.commands.at(-1)?.op).toBe('close');
  });

  it('does not start or record a model turn after observation exhausts the task budget', async () => {
    const h = createHarness([], { observeDelaysMs: [30] });
    const accounting = records();

    const outcome = await runSelectedChromeTask({
      taskId: 'timeout-before-model',
      intent: 'Inspect',
      messagesAdapter: h.messagesAdapter,
      client: h.client,
      control: h.control,
      target,
      timeoutMs: 10,
      recorder: accounting.recorder,
      userExternalId: 'usr_timeout_before_model',
    });

    expect(outcome).toMatchObject({ status: 'timeout', iterations: 0 });
    expect(h.modelCreate).not.toHaveBeenCalled();
    expect(accounting.values).toHaveLength(0);
  });

  it('does not complete when the finish evidence read crosses the task deadline', async () => {
    const h = createHarness([finish('Draft')], { observeDelaysMs: [0, 30] });

    const outcome = await runSelectedChromeTask({
      taskId: 'timeout-during-finish',
      intent: 'Inspect',
      messagesAdapter: h.messagesAdapter,
      client: h.client,
      control: h.control,
      target,
      timeoutMs: 10,
    });

    expect(outcome).toMatchObject({ status: 'timeout', iterations: 1 });
    expect(outcome.summary).toBeUndefined();
  });

  it('re-observes after a read failure and can finish from the recovered observation', async () => {
    const h = createHarness([finish('Draft')], { observeFailures: 1 });

    const outcome = await runSelectedChromeTask({
      taskId: 'read-retry',
      intent: 'Inspect the draft',
      messagesAdapter: h.messagesAdapter,
      client: h.client,
      control: h.control,
      target,
    });

    expect(outcome.status).toBe('completed');
    expect(h.commands.filter((command) => command.op === 'observe').length).toBeGreaterThanOrEqual(
      3,
    );
  });

  it('records successful and failed real model calls exactly once', async () => {
    const successful = createHarness([finish('Draft')]);
    const successfulAccounting = records();
    expect(
      await runSelectedChromeTask({
        taskId: 'record-ok',
        intent: 'Inspect',
        messagesAdapter: successful.messagesAdapter,
        client: successful.client,
        control: successful.control,
        target,
        recorder: successfulAccounting.recorder,
        userExternalId: 'usr_record_ok',
      }),
    ).toMatchObject({ status: 'completed' });

    const failing = createHarness([]);
    const failingAccounting = records();
    failing.modelCreate.mockRejectedValue(
      new MessagesAdapterError('INVALID_RESPONSE', 'private provider body'),
    );
    expect(
      await runSelectedChromeTask({
        taskId: 'record-error',
        intent: 'Inspect',
        messagesAdapter: failing.messagesAdapter,
        client: failing.client,
        control: failing.control,
        target,
        recorder: failingAccounting.recorder,
        userExternalId: 'usr_record_error',
      }),
    ).toMatchObject({ status: 'failed' });

    expect(successfulAccounting.values.map((record) => record.status)).toEqual(['ok']);
    expect(failingAccounting.values.map((record) => record.status)).toEqual(['error']);
    expect(JSON.stringify(failingAccounting.values)).not.toContain('private provider body');
  });

  it('hands a guarded password action to the user and never replays it', async () => {
    const h = createHarness([
      response('password-action', [
        {
          type: 'tool_use',
          id: 'password-type',
          name: 'browser_act',
          input: {
            action: {
              kind: 'type',
              selector: {
                description: 'Password field',
                strategies: [{ kind: 'placeholder', value: 'Password' }],
              },
              payload: { text: 'never-send-this' },
            },
          },
        },
      ]),
      finish('Draft', 'finish-after-password'),
    ]);
    const thinking: string[] = [];
    const running = runSelectedChromeTask({
      taskId: 'guarded-input',
      intent: 'Continue securely',
      messagesAdapter: h.messagesAdapter,
      client: h.client,
      control: h.control,
      target,
      onThinking: (text) => void thinking.push(text),
    });
    await vi.waitFor(() => expect(h.control.snapshot().phase).toBe('human'));
    const lease = h.control.snapshot().lease;
    if (!lease) throw new Error('missing human lease');
    h.control.returnToAgent(lease);

    expect(await running).toMatchObject({ status: 'completed' });
    expect(h.commands.filter((command) => command.op === 'act')).toHaveLength(0);
    expect(thinking.join('\n')).toContain('Chrome');
  });

  it('passes visible label strategy hints to the existing irreversible-action policy', async () => {
    const h = createHarness([
      response('payment-action', [
        {
          type: 'tool_use',
          id: 'payment-click',
          name: 'browser_act',
          input: {
            action: {
              kind: 'click',
              selector: {
                description: 'Primary button',
                strategies: [
                  { kind: 'label', value: 'Continue' },
                  { kind: 'label', value: 'Pay now' },
                ],
              },
            },
          },
        },
      ]),
      finish('Draft', 'finish-after-payment-handoff'),
    ]);
    const running = runSelectedChromeTask({
      taskId: 'guarded-payment',
      intent: 'Continue',
      messagesAdapter: h.messagesAdapter,
      client: h.client,
      control: h.control,
      target,
    });
    await vi.waitFor(() => expect(h.control.snapshot().phase).toBe('human'), { timeout: 200 });
    const lease = h.control.snapshot().lease;
    if (!lease) throw new Error('missing human lease');
    h.control.returnToAgent(lease);

    expect(await running).toMatchObject({ status: 'completed' });
    expect(h.commands.filter((command) => command.op === 'act')).toHaveLength(0);
  });

  it('cancellation releases a manual checkpoint and closes without replaying its action', async () => {
    const h = createHarness([
      response('password-action-cancelled', [
        {
          type: 'tool_use',
          id: 'password-type-cancelled',
          name: 'browser_act',
          input: {
            action: {
              kind: 'type',
              selector: {
                description: 'Password',
                strategies: [{ kind: 'placeholder', value: 'Password' }],
              },
              payload: { text: 'never-send-this' },
            },
          },
        },
      ]),
    ]);
    const abort = new AbortController();
    const running = runSelectedChromeTask({
      taskId: 'cancel-manual-checkpoint',
      intent: 'Continue securely',
      messagesAdapter: h.messagesAdapter,
      client: h.client,
      control: h.control,
      target,
      signal: abort.signal,
    });
    await vi.waitFor(() => expect(h.control.snapshot().phase).toBe('human'));
    abort.abort();

    expect(await running).toMatchObject({ status: 'cancelled', iterations: 1 });
    expect(h.commands.filter((command) => command.op === 'act')).toHaveLength(0);
    expect(h.commands.at(-1)?.op).toBe('close');
  });

  it('waits for an admitted action receipt before closing on cancellation', async () => {
    let releaseAction!: () => void;
    const actGate = new Promise<void>((resolve) => {
      releaseAction = resolve;
    });
    const h = createHarness(
      [
        response('pending-action', [
          {
            type: 'tool_use',
            id: 'pending-click',
            name: 'browser_act',
            input: {
              action: {
                kind: 'click',
                selector: {
                  description: 'Save button',
                  strategies: [{ kind: 'text', value: 'Save' }],
                },
              },
            },
          },
        ]),
      ],
      { actGate },
    );
    const abort = new AbortController();
    let settled = false;
    const running = runSelectedChromeTask({
      taskId: 'cancel-pending-action',
      intent: 'Save once',
      messagesAdapter: h.messagesAdapter,
      client: h.client,
      control: h.control,
      target,
      signal: abort.signal,
      maxIterations: 1,
    }).finally(() => {
      settled = true;
    });
    await vi.waitFor(() =>
      expect(h.commands.filter((command) => command.op === 'act')).toHaveLength(1),
    );
    abort.abort();
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(h.commands.some((command) => command.op === 'close')).toBe(false);
    releaseAction();

    expect(await running).toMatchObject({ status: 'cancelled', iterations: 1 });
    expect(h.commands.filter((command) => command.op === 'act')).toHaveLength(1);
    expect(h.commands.at(-1)?.op).toBe('close');
  });

  it('returns timeout after a pending action receipt on the final iteration', async () => {
    let releaseAction!: () => void;
    const actGate = new Promise<void>((resolve) => {
      releaseAction = resolve;
    });
    const h = createHarness(
      [
        response('pending-action-timeout', [
          {
            type: 'tool_use',
            id: 'pending-click-timeout',
            name: 'browser_act',
            input: {
              action: {
                kind: 'click',
                selector: {
                  description: 'Save button',
                  strategies: [{ kind: 'text', value: 'Save' }],
                },
              },
            },
          },
        ]),
      ],
      { actGate },
    );
    const running = runSelectedChromeTask({
      taskId: 'timeout-pending-action',
      intent: 'Save once',
      messagesAdapter: h.messagesAdapter,
      client: h.client,
      control: h.control,
      target,
      timeoutMs: 20,
      maxIterations: 1,
    });
    await vi.waitFor(() =>
      expect(h.commands.filter((command) => command.op === 'act')).toHaveLength(1),
    );
    await vi.waitFor(() => expect(h.control.snapshot().phase).toBe('closed'));
    releaseAction();

    expect(await running).toMatchObject({ status: 'timeout', iterations: 1 });
    expect(h.commands.filter((command) => command.op === 'act')).toHaveLength(1);
    expect(h.commands.at(-1)?.op).toBe('close');
  });

  it('executes only the first mutating tool in one response and pairs the rest', async () => {
    const click = (id: string) => ({
      type: 'tool_use' as const,
      id,
      name: 'browser_act',
      input: {
        action: {
          kind: 'click',
          selector: {
            description: 'Save button',
            strategies: [{ kind: 'text', value: 'Save' }],
          },
        },
      },
    });
    const h = createHarness([
      response('parallel-actions', [click('first-act'), click('second-act')]),
      finish('Saved'),
    ]);

    const outcome = await runSelectedChromeTask({
      taskId: 'one-mutation',
      intent: 'Save once',
      messagesAdapter: h.messagesAdapter,
      client: h.client,
      control: h.control,
      target,
    });

    expect(outcome.status).toBe('completed');
    expect(h.commands.filter((command) => command.op === 'act')).toHaveLength(1);
    const resultBlocks = h.requests[1]?.messages
      .flatMap((message) => (Array.isArray(message.content) ? message.content : []))
      .filter((block) => block.type === 'tool_result');
    expect(resultBlocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ toolUseId: 'first-act' }),
        expect.objectContaining({ toolUseId: 'second-act', isError: true }),
      ]),
    );
  });

  it('does not return completed when the close receipt is unconfirmed', async () => {
    const h = createHarness([finish('Draft')], { closeUnconfirmed: true });

    const outcome = await runSelectedChromeTask({
      taskId: 'close-unconfirmed',
      intent: 'Inspect',
      messagesAdapter: h.messagesAdapter,
      client: h.client,
      control: h.control,
      target,
    });

    expect(outcome.status).toBe('failed');
    expect(outcome.reason).toContain('关闭未确认');
  });
});

describe('toCapturedToolCall (extension capture)', () => {
  const selector = (strategies: Record<string, unknown>[], nth?: number) =>
    ({
      description: 'd',
      strategies,
      scope: { timeoutMs: 5_000, ...(nth ? { nth } : {}) },
      selfHeal: true,
    }) as never;

  it('turns a role strategy into a role+name replay locator', () => {
    expect(
      toCapturedToolCall(
        {
          kind: 'click',
          selector: selector(
            [
              { kind: 'css', value: '#x' },
              { kind: 'role', role: 'button', name: '搜索' },
            ],
            2,
          ),
        },
        'https://shop.example',
      ),
    ).toEqual({
      op: 'click',
      locator: { role: 'button', name: '搜索', nth: 2 },
      pageUrl: 'https://shop.example',
    });
  });

  it('maps a labelled field to a named textbox and keeps the typed text for redaction', () => {
    expect(
      toCapturedToolCall(
        {
          kind: 'type',
          selector: selector([{ kind: 'label', value: '邮箱' }]),
          payload: { text: 'a@example.com' },
        },
        undefined,
      ),
    ).toEqual({ op: 'type', locator: { role: 'textbox', name: '邮箱' }, text: 'a@example.com' });
  });

  it('records navigation and skips non-replayable actions', () => {
    expect(
      toCapturedToolCall({ kind: 'goto', payload: { url: 'https://a.example/' } }, undefined),
    ).toEqual({ op: 'navigate', url: 'https://a.example/' });
    expect(toCapturedToolCall({ kind: 'wait', payload: { ms: 10 } }, undefined)).toBeNull();
  });
});
