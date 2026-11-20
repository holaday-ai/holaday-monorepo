import { rm, writeFile } from 'node:fs/promises';
import { expect, it, vi } from 'vitest';
import { env } from '../../config/env.js';
import { createBrowserTaskFileScope } from '../../files/browser-task-file-scope.js';
import { browserOutputFixture } from '../../files/testing/browser-output-fixture.js';
import { renderFile } from '../../files/writers.js';
import { type MessagesAdapter, MessagesAdapterError } from '../../llm/messages-adapter.js';
import { BrowserTaskFiles } from './browser-task-files.js';
import { BrowserTaskOutputs } from './browser-task-output.js';
import {
  createTaskFileContract,
  isExplicitFileOnlyRequest,
  isTaskFileContract,
  taskFileInputSupported,
} from './task-file-contract.js';
import { runUnifiedBrowserLoop } from './unified-browser-loop.js';
import { runUnifiedSupercarTask, unifiedSupercarAbort } from './unified-supercar-runner.js';

const intent =
  '仅处理我提供的CSV附件，完整读取并统计金额合计，生成“summary.csv”，完整读回新CSV，最后交付附件原件和新文件共两份下载链接。不要访问网页。';
it.each([
  ['data.csv', 'text/csv', true],
  ['data.json', 'application/json', true],
  ['scan.png', 'image/png', false],
  ['sound.mp3', 'audio/mpeg', false],
  ['video.csv', 'video/mp4', false],
  ['book.xlsx', 'application/octet-stream', false],
] as const)('keeps unsupported material %s on its existing route', (name, mimeType, expected) => {
  expect(taskFileInputSupported({ name, mimeType })).toBe(expected);
});
it.each([
  '只分析已提供的附件，输出摘要。',
  intent,
  'Only analyze the attached CSV files. Do not visit websites.',
])('recognizes an explicit material-only request: %s', (text) => {
  expect(isExplicitFileOnlyRequest(text)).toBe(true);
});
it.each([
  '分析附件，再打开GitHub检查PR。',
  '仅处理附件，但还要访问 https://example.com/report。',
  '只分析附件，上传到表格并发送邮件。',
  '只处理附件，搜索最新价格。',
  '不要只处理附件，还要打开网页。',
  'Only analyze attached files, then visit github.com.',
  '仅分析附件，并在GitHub检查PR。',
  '只处理附件，不是不要打开网页。',
  '仅处理附件，不要访问网页但要搜索最新价格。',
  'Only analyze attached files. Do not browse but search for latest rates.',
  '只处理附件，再帮我支付订单。',
  'Only analyze attached files, then book a flight.',
  '仅处理附件，填入模板并保留原有样式。',
  '打开网页读取报表。',
  '读取附件。',
])('keeps mixed, ambiguous and non-material requests outside the contract: %s', (text) => {
  expect(isExplicitFileOnlyRequest(text)).toBe(false);
});

async function fixture(requestIntent = intent) {
  const f = await browserOutputFixture();
  const row = await f.service.storeUpload({
    userIdInternal: 7,
    userExternalId: 'usr_alice',
    filename: 'source.csv',
    mimetype: 'text/csv',
    buffer: Buffer.from('amount\n0.25\n1.25\n'),
  });
  const inputs = BrowserTaskFiles.validatedReferences(
    await f.service.loadMany([row.externalId], 7),
    7,
  );
  const files = createBrowserTaskFileScope({
    db: f.db,
    files: f.service,
    taskId: 'tsk_alice',
    userId: 7,
    origin: 'user',
    inputs,
  });
  const outputs = new BrowserTaskOutputs({
    formats: ['csv'],
    current: () => files.isActive(),
    store: async ({ filename, format, content }) => {
      if (format !== 'csv') throw new Error('Only CSV is available in this fixture');
      const rendered = await renderFile(format, content);
      const generated = await f.service.storeOutput({
        userIdInternal: 7,
        userExternalId: 'usr_alice',
        taskIdInternal: 9,
        requireLiveTask: true,
        filename,
        mimetype: rendered.mimetype,
        buffer: rendered.buffer,
      });
      return {
        fileId: generated.externalId,
        filename,
        size: generated.sizeBytes,
        downloadUrl: `/api/files/${generated.externalId}/download`,
      };
    },
  });
  const controller = new AbortController();
  const contract = await createTaskFileContract({
    intent: requestIntent,
    files,
    outputs,
    signal: controller.signal,
  });
  expect(contract).toBeTruthy();
  return { ...f, row, files, outputs, controller, contract: contract! };
}

it('rejects the real missing-column CSV before saving, then permits a corrected file without filling blanks', async () => {
  const f = await fixture(
    '仅处理我提供的CSV附件，生成“summary.csv”，列为measurement,phase,files,total,passed,failed,pending；未提供的值留空。',
  );
  try {
    await expect(
      f.contract.create({
        filename: 'summary.csv',
        format: 'csv',
        content:
          'measurement,phase,files,total,passed,failed,pending\ncore_recheck/backend,,236,235,1,\n',
      }),
    ).rejects.toThrow(/7列.*6列/);
    expect(f.files.generatedReferences()).toHaveLength(0);
    const corrected =
      'measurement,phase,files,total,passed,failed,pending\ncore_recheck,backend,,236,235,1,\nfocused_unit,mixed_unit,,51,51,0,\n';
    const made = await f.contract.create({
      filename: 'summary.csv',
      format: 'csv',
      content: corrected,
    });
    expect(made.ok).toBe(true);
    if (!made.ok) throw Error('corrected CSV missing');
    const read = await f.contract.read({ fileId: made.file.fileId });
    expect(read.text).toBe(corrected);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

it('counts quoted commas and newlines as cell content while preserving empty records', async () => {
  const f = await fixture('仅处理我提供的CSV附件，生成“summary.csv”，列为metric,value。');
  try {
    const made = await f.contract.create({
      filename: 'summary.csv',
      format: 'csv',
      content: 'metric,value\n"a,b","line1\nline2"\n\n"quoted ""name""",\n',
    });
    expect(made.ok).toBe(true);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

it('does not invent a fixed output width when the original request has no explicit columns', async () => {
  const f = await fixture();
  try {
    expect(
      (
        await f.contract.create({
          filename: 'summary.csv',
          format: 'csv',
          content: 'metric,value\nnotes\n',
        })
      ).ok,
    ).toBe(true);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

it('validates rendered CSV when create_file accepts JSON object rows', async () => {
  const f = await fixture('仅处理我提供的CSV附件，生成“summary.csv”，列为metric,value。');
  try {
    const made = await f.contract.create({
      filename: 'summary.csv',
      format: 'csv',
      content: JSON.stringify([{ metric: 'a,b', value: 1 }]),
    });
    expect(made.ok).toBe(true);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

async function complete(f: Awaited<ReturnType<typeof fixture>>) {
  await f.contract.read({ fileId: f.row.externalId });
  await f.contract.analyze({
    fileId: f.row.externalId,
    mode: 'aggregate',
    metrics: [{ op: 'sum', column: 'A' }],
  });
  const made = await f.contract.create({
    filename: 'summary.csv',
    format: 'csv',
    content: 'metric,value\nsum,1.5\n',
  });
  if (!made.ok) throw Error('fixture output missing');
  await f.contract.read({ fileId: made.file.fileId });
  await f.contract.analyze({
    fileId: made.file.fileId,
    mode: 'aggregate',
    metrics: [{ op: 'count_rows' }],
  });
  expect(await f.contract.completionGap()).toBeNull();
}

it('requires full source reads, exact statistics and output readback, and attaches actual originals separately', async () => {
  const f = await fixture();
  try {
    expect(isTaskFileContract(f.contract)).toBe(true);
    expect(isTaskFileContract({ ...f.contract })).toBe(false);
    expect(f.contract.toolNames).toEqual([
      'read_task_file',
      'analyze_task_table',
      'create_file',
      'finish',
    ]);
    expect(await f.contract.completionGap()).toBeTruthy();
    await f.contract.read({ fileId: f.row.externalId, maxChars: 4 });
    expect(await f.contract.completionGap()).toBeTruthy();
    await f.contract.read({ fileId: f.row.externalId });
    expect(await f.contract.completionGap()).toBeTruthy();
    const result = await f.contract.analyze({
      fileId: f.row.externalId,
      mode: 'aggregate',
      metrics: [{ op: 'sum', column: 'A' }],
    });
    expect(result).toMatchObject({ complete: true, overall: [{ value: '1.5' }] });
    const created = await f.contract.create({
      filename: 'summary.csv',
      format: 'csv',
      content: 'metric,value\nsum,1.5\n',
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw Error('missing output');
    expect(await f.contract.completionGap()).toBeTruthy();
    await f.contract.read({ fileId: created.file.fileId });
    await f.contract.analyze({
      fileId: created.file.fileId,
      mode: 'aggregate',
      metrics: [{ op: 'count_rows' }],
    });
    expect(await f.contract.completionGap()).toBeNull();
    const text = f.contract.attach('done');
    expect(text).toContain(f.row.externalId);
    expect(text).toContain(created.file.fileId);
    expect(text).toContain('summary.csv：来源 任务生成文件；统计扫描');
    expect(f.files.source(f.row.externalId)).toEqual({ kind: 'user_attachment' });
    await expect(f.contract.read({ fileId: 'other_task_file' })).rejects.toThrow();
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

it.each(['cancelled', 'owner', 'task', 'bytes', 'unknown-save'] as const)(
  'refuses completion after %s',
  async (fault) => {
    const f = await fixture();
    try {
      await complete(f);
      if (fault === 'cancelled') f.controller.abort();
      if (fault === 'owner') f.faults.ownerStatus = 'disabled';
      if (fault === 'task') f.taskRecords[0]!.status = 'completed';
      if (fault === 'bytes') await writeFile(f.row.storagePath, 'amount\n9.25\n9.25\n');
      if (fault === 'unknown-save') {
        f.faults.insert = 'unknown';
        expect(
          await f.contract.create({
            filename: 'another.csv',
            format: 'csv',
            content: 'metric,value\nsum,1.5\n',
          }),
        ).toMatchObject({ ok: false, fatal: true });
      }
      expect(await f.contract.completionGap()).toBeTruthy();
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  },
);

it('keeps a failed saved-output admission unresolved even when an earlier output was complete', async () => {
  const f = await fixture();
  try {
    await complete(f);
    const admission = vi
      .spyOn(f.files, 'admitGenerated')
      .mockRejectedValue(new Error('wrong task output'));
    await expect(
      f.contract.create({
        filename: 'another.csv',
        format: 'csv',
        content: 'metric,value\nsum,1.5\n',
      }),
    ).rejects.toThrow();
    expect(await f.contract.completionGap()).toBeTruthy();
    admission.mockRestore();
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

it('does not let generated numbers replace the requested calculation on the original input', async () => {
  const f = await fixture();
  try {
    await f.contract.read({ fileId: f.row.externalId });
    await f.contract.analyze({
      fileId: f.row.externalId,
      mode: 'aggregate',
      metrics: [{ op: 'count_rows' }],
    });
    const made = await f.contract.create({
      filename: 'summary.csv',
      format: 'csv',
      content: 'metric,value\nsum,999\n',
    });
    if (!made.ok) throw Error('missing output');
    await f.contract.read({ fileId: made.file.fileId });
    await f.contract.analyze({
      fileId: made.file.fileId,
      mode: 'aggregate',
      metrics: [{ op: 'sum', column: 'B' }],
    });
    expect(await f.contract.completionGap()).toBeTruthy();
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

it.each(['行数', 'data_rows', 'row count', '最大值'])(
  'requires actual statistics when the requested metric is %s without a statistics keyword',
  async (metric) => {
    const f = await fixture();
    try {
      const contract = await createTaskFileContract({
        intent: `仅处理附件，告诉我${metric}。`,
        files: f.files,
        outputs: f.outputs,
      });
      expect(contract).not.toBeNull();
      await contract!.read({ fileId: f.row.externalId });
      expect(await contract!.completionGap()).toBeTruthy();
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  },
);

it('cannot establish a material contract without actual admitted inputs', async () => {
  const files = new BrowserTaskFiles({
    taskId: 'empty',
    userId: 7,
    files: { loadMany: async () => [] },
    active: async () => true,
  });
  const outputs = new BrowserTaskOutputs({ current: async () => true });
  expect(await createTaskFileContract({ intent, files, outputs })).toBeNull();
  expect(isTaskFileContract({ toolNames: ['finish'], completionGap: async () => null })).toBe(
    false,
  );
});

it('completes the real file loop without a page and exposes only the contract tools', async () => {
  const f = await fixture();
  const execute = vi.fn(async () => {
    throw Error('browser execution forbidden');
  });
  let turn = 0;
  let generated = '';
  let facts: Array<{ id: string; name: string; value: string; fileId: string }> = [];
  const metadata = { provider: 'anthropic', model: 'scripted-contract' } as const;
  const adapter: MessagesAdapter = {
    metadata,
    async create(request) {
      turn++;
      expect(request.tools?.every((tool) => f.contract.toolNames.includes(tool.name))).toBe(true);
      const content = request.messages.at(-1)?.content;
      const raw = Array.isArray(content)
        ? content.find((block) => block.type === 'tool_result')
        : undefined;
      const value =
        raw?.type === 'tool_result' && typeof raw.content === 'string' ? raw.content : '';
      const json = value
        ? JSON.parse(value.slice(value.startsWith('{') ? 0 : value.indexOf('\n{') + 1))
        : null;
      let name: string;
      let input: Record<string, unknown>;
      if (turn === 1) {
        name = 'read_task_file';
        input = { fileId: f.row.externalId };
      } else if (turn === 2) {
        name = 'analyze_task_table';
        input = {
          fileId: f.row.externalId,
          mode: 'aggregate',
          metrics: [{ op: 'sum', column: 'A' }],
        };
      } else if (turn === 3) {
        facts = json.overall;
        name = 'create_file';
        input = {
          filename: 'summary.csv',
          format: 'csv',
          content: `metric,value\nsum,${facts[0]!.value}\n`,
        };
      } else if (turn === 4) {
        generated = json.file.fileId;
        name = 'read_task_file';
        input = { fileId: generated };
      } else if (turn === 5) {
        name = 'analyze_task_table';
        input = { fileId: generated, mode: 'aggregate', metrics: [{ op: 'count_rows' }] };
      } else {
        expect(turn).toBe(6);
        name = 'finish';
        input = {
          status: 'completed',
          summary: '已完成附件统计与文件读回。',
          fields: facts.map((fact) => ({
            name: fact.name,
            value: fact.value,
            fileId: fact.fileId,
            tableFactId: fact.id,
          })),
        };
      }
      return {
        id: `material-${turn}`,
        metadata,
        content: [{ type: 'tool_use', id: `tool-${turn}`, name, input }],
        stopReason: 'tool_use',
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          cacheReadInputTokens: null,
          cacheCreationInputTokens: null,
          complete: true,
        },
      };
    },
  };
  try {
    const result = await runUnifiedBrowserLoop({
      intent,
      adapter,
      execute,
      requireBrowserEvidence: true,
      taskFileContract: f.contract,
      maxSteps: 7,
    });
    expect(result, JSON.stringify(result)).toMatchObject({ status: 'completed' });
    expect(execute).not.toHaveBeenCalled();
    expect(turn).toBe(6);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

it.each(['navigate', 'upload', 'web_search', 'request_human'])(
  'does not execute a model-invented %s call',
  async (tool) => {
    const f = await fixture();
    const execute = vi.fn();
    const webSearch = vi.fn();
    let turn = 0;
    const metadata = { provider: 'anthropic', model: 'scripted-denied' } as const;
    const adapter: MessagesAdapter = {
      metadata,
      async create() {
        turn++;
        return {
          id: `denied-${turn}`,
          metadata,
          content: [
            {
              type: 'tool_use',
              id: `call-${turn}`,
              name: turn === 1 ? tool : 'finish',
              input:
                turn === 1
                  ? { url: 'https://example.com' }
                  : { status: 'failed', summary: '请求的操作不在文件处理范围内。' },
            },
          ],
          stopReason: 'tool_use',
          usage: {
            inputTokens: 1,
            outputTokens: 1,
            cacheReadInputTokens: null,
            cacheCreationInputTokens: null,
            complete: true,
          },
        };
      },
    };
    try {
      const result = await runUnifiedBrowserLoop({
        intent,
        adapter,
        execute,
        webSearch,
        taskFileContract: f.contract,
        maxSteps: 2,
      });
      expect(result.status).toBe('failed');
      expect(execute).not.toHaveBeenCalled();
      expect(webSearch).not.toHaveBeenCalled();
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  },
);

it('rejects a forged contract before a model or browser is called', async () => {
  const f = await fixture();
  const create = vi.fn();
  const execute = vi.fn();
  try {
    const result = await runUnifiedBrowserLoop({
      intent,
      adapter: { metadata: { provider: 'anthropic', model: 'unused' }, create },
      execute,
      taskFileContract: { ...f.contract },
    });
    expect(result.status).toBe('failed');
    expect(create).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

it('enters material-only execution without acquiring a browser page', async () => {
  const f = await fixture();
  const previous = env.BROWSER_TASK_FILES_V1;
  const getPage = vi.fn(async () => {
    throw Error('file task must not acquire a page');
  });
  const metadata = { provider: 'anthropic', model: 'scripted-entry' } as const;
  const create = vi.fn(async (request: Parameters<MessagesAdapter['create']>[0]) => {
    expect(request.tools?.every((tool) => f.contract.toolNames.includes(tool.name))).toBe(true);
    return {
      id: 'entry-failure',
      metadata,
      stopReason: 'tool_use' as const,
      content: [
        {
          type: 'tool_use' as const,
          id: 'finish',
          name: 'finish',
          input: { status: 'failed', summary: '材料处理尚未完成。' },
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
  Object.assign(env, { BROWSER_TASK_FILES_V1: true });
  try {
    const result = await runUnifiedSupercarTask({
      taskId: f.files.taskId,
      intent,
      userRequest: intent,
      browserTaskFiles: f.files,
      executor: { getPage } as never,
      messagesAdapter: { metadata, create },
      createFileFormats: ['csv'],
    });
    expect(getPage).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      status: 'failed',
      reason: '材料处理尚未完成。',
      failureSource: 'task',
    });
  } finally {
    Object.assign(env, { BROWSER_TASK_FILES_V1: previous });
    await rm(f.root, { recursive: true, force: true });
  }
});

it.each(['id', 'value'] as const)('does not complete with a false statistic %s', async (fault) => {
  const f = await fixture();
  const request = '只分析提供的CSV附件，完整读取并统计金额合计。';
  const contract = await createTaskFileContract({
    intent: request,
    files: f.files,
    outputs: f.outputs,
  });
  let turn = 0;
  let fact: { id: string; name: string; value: string; fileId: string } | undefined;
  const metadata = { provider: 'anthropic', model: 'scripted-false-stat' } as const;
  const adapter: MessagesAdapter = {
    metadata,
    async create(input) {
      turn++;
      let name = 'finish';
      let args: Record<string, unknown>;
      if (turn === 1) {
        name = 'read_task_file';
        args = { fileId: f.row.externalId };
      } else if (turn === 2) {
        name = 'analyze_task_table';
        args = {
          fileId: f.row.externalId,
          mode: 'aggregate',
          metrics: [{ op: 'sum', column: 'A' }],
        };
      } else if (turn === 3) {
        const raw = input.messages.at(-1)!.content;
        const b = Array.isArray(raw) ? raw.find((b) => b.type === 'tool_result') : undefined;
        if (b?.type !== 'tool_result' || typeof b.content !== 'string')
          throw Error('missing receipt');
        fact = JSON.parse(b.content.slice(b.content.indexOf('\n{') + 1)).overall[0];
        args = {
          status: 'completed',
          summary: '金额合计999。',
          fields: [
            {
              name: fact!.name,
              value: fault === 'value' ? '999' : fact!.value,
              fileId: fact!.fileId,
              tableFactId: fault === 'id' ? 'tbf_00000000000000000000000000000000' : fact!.id,
            },
          ],
        };
      } else {
        expect(JSON.stringify(input.messages.at(-1))).toMatch(/统计|回执|矛盾/);
        args = { status: 'failed', summary: '统计尚未核对完成。' };
      }
      return {
        id: `stat-${turn}`,
        metadata,
        stopReason: 'tool_use',
        content: [{ type: 'tool_use', id: `stat-tool-${turn}`, name, input: args }],
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          cacheReadInputTokens: null,
          cacheCreationInputTokens: null,
          complete: true,
        },
      };
    },
  };
  try {
    const result = await runUnifiedBrowserLoop({
      intent: request,
      adapter,
      taskFileContract: contract!,
      execute: vi.fn(),
      maxSteps: 4,
    });
    expect(result.status).toBe('failed');
    expect(turn).toBe(4);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

it.each(['cancelled', 'timeout'] as const)(
  'preserves %s semantics during a pending file model call',
  async (mode) => {
    const f = await fixture();
    const previous = env.BROWSER_TASK_FILES_V1;
    Object.assign(env, { BROWSER_TASK_FILES_V1: true });
    let began!: () => void;
    const started = new Promise<void>((yes) => {
      began = yes;
    });
    const metadata = { provider: 'anthropic', model: 'pending-file-model' } as const;
    const create = vi.fn<MessagesAdapter['create']>(
      async (_request, options) =>
        new Promise((_yes, no) => {
          const abort = () => no(new MessagesAdapterError('REQUEST_ABORTED', 'aborted'));
          options?.signal?.addEventListener('abort', abort, { once: true });
          if (options?.signal?.aborted) abort();
          began();
        }),
    );
    try {
      const pending = runUnifiedSupercarTask({
        taskId: f.files.taskId,
        intent,
        browserTaskFiles: f.files,
        executor: null,
        messagesAdapter: { metadata, create },
        timeoutMs: 1000,
      });
      await started;
      if (mode === 'cancelled') expect(unifiedSupercarAbort(f.files.taskId)).toBe(true);
      const outcome = await pending;
      expect(outcome.status).toBe(mode);
      expect(create).toHaveBeenCalledOnce();
      expect(unifiedSupercarAbort(f.files.taskId)).toBe(false);
    } finally {
      Object.assign(env, { BROWSER_TASK_FILES_V1: previous });
      await rm(f.root, { recursive: true, force: true });
    }
  },
);
