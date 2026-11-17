/// <reference path="../../../../../packages/browser-driver/node_modules/@types/chrome/index.d.ts" />
import { createHash } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import {
  type SelectedChromeSessionCommand,
  USER_BROWSER_PROTOCOL,
  selectedChromeDownloadCommandSchema,
  selectedChromeSessionCommandSchema,
} from '@holaday/shared-types';
import { type Browser, type CDPSession, type Page, chromium } from 'playwright';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlaywrightCrxAdapter } from '../../../../../packages/browser-driver/src/crx-adapter.js';
import {
  SelectedChromeSession,
  type SessionReply,
} from '../../../../extension/src/background/selected-chrome-session.js';
import { env } from '../../config/env.js';
import { createBrowserTaskFileScope } from '../../files/browser-task-file-scope.js';
import { browserOutputFixture } from '../../files/testing/browser-output-fixture.js';
import { renderFile } from '../../files/writers.js';
import type { MessagesAdapter } from '../../llm/messages-adapter.js';
import type { ExtensionToolCallOptions, ExtensionToolCallOutcome } from '../../ws/server.js';
import type { TableAggregate } from '../browser-tools/browser-task-table.js';
import { BrowserControl } from './browser-control.js';
import { SelectedChromeClient } from './selected-chrome-client.js';
import { runSelectedChromeTask } from './selected-chrome-runner.js';

const boundary = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../../../../../packages/browser-driver/node_modules/playwright-crx', () => ({
  crx: { get: boundary.get },
}));
let browser: Browser;
let page: Page;
let cdp: CDPSession;
let origin: string;
let send: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
const sessions: SelectedChromeSession[] = [];
const clients: SelectedChromeClient[] = [];
const capability = 'task_file_download_v1';
const content = 'sku,qty\nORIGINAL-731,31\n';
const hash = createHash('sha256').update(content).digest('hex');
const token = '22222222-2222-4222-8222-222222222222';
const action = {
  kind: 'click' as const,
  selector: {
    description: 'Export report',
    strategies: [{ kind: 'css' as const, value: '#export' }],
    scope: { timeoutMs: 2000 },
    selfHeal: false,
  },
};
const fixture = `<button id="export">Export report</button><script>document.querySelector('#export').onclick=()=>{document.body.dataset.clicks=String(Number(document.body.dataset.clicks||0)+1);const file=new Blob([${JSON.stringify(content)}],{type:'text/csv'});const a=document.createElement('a');a.href=window.URL.createObjectURL(file);a.download='report.csv';a.click();};</script>`;
const server = createServer((_request, response) => {
  response.setHeader('Content-Type', 'text/html');
  response.end('<body></body>');
});
async function harness(enabled = true) {
  let owner = 'alice';
  const drivers: PlaywrightCrxAdapter[] = [];
  const session = new SelectedChromeSession({
    owner: () => owner,
    makeDriver: (tabId, options) => {
      const driver = new PlaywrightCrxAdapter({
        attachToTabId: tabId,
        userBrowserRoutingV2: options?.v2,
        allowedOrigins: options?.origins,
      });
      drivers.push(driver);
      return driver;
    },
  });
  sessions.push(session);
  const opened = await session.open({
    taskId: 'task-download',
    tabId: 731,
    validate: async () => {},
    protocol: {
      ...USER_BROWSER_PROTOCOL,
      capabilities: [...USER_BROWSER_PROTOCOL.capabilities, ...(enabled ? [capability] : [])],
    },
    grantedOrigins: [origin],
  });
  if (!opened.ok) throw new Error(opened.error);
  const described = await session.describe('task-download', opened.sessionId, action, 1);
  if (!described.ok || !described.target) throw new Error('actual description missing');
  return {
    session,
    opened,
    driver: drivers[0]!,
    setOwner: (next: string) => {
      owner = next;
    },
    command: {
      op: 'download_open' as const,
      sessionId: opened.sessionId,
      action,
      binding: {
        token: described.target.token,
        observationRevision: described.target.observationRevision,
      },
    },
  };
}
async function clientHarness(open = true) {
  const control = new BrowserControl();
  const session = new SelectedChromeSession({
    owner: () => 'alice',
    makeDriver: (tabId, options) =>
      new PlaywrightCrxAdapter({
        attachToTabId: tabId,
        userBrowserRoutingV2: options?.v2,
        allowedOrigins: options?.origins,
      }),
  });
  sessions.push(session);
  const commands: SelectedChromeSessionCommand[] = [];
  let lost: string | undefined;
  let tamper = false;
  let humanOnChunk = false;
  const client = new SelectedChromeClient({
    userId: 'alice',
    taskId: 'task-download',
    extensionClientId: 'chrome-a',
    routingV2: true,
    taskFilesV1: true,
    control,
    send: async (
      _user: string,
      input: ExtensionToolCallOptions,
    ): Promise<ExtensionToolCallOutcome> => {
      const command = selectedChromeSessionCommandSchema.parse(input.args?.session);
      commands.push(command);
      let reply: SessionReply | { ok: boolean; closed: boolean };
      if (command.op === 'open')
        reply = await session.open({
          taskId: 'task-download',
          tabId: command.target.tabId,
          validate: async () => {},
          protocol: command.protocol,
          grantedOrigins: command.grantedOrigins,
        });
      else if (command.op === 'describe')
        reply = await session.describe(
          'task-download',
          command.sessionId,
          command.action,
          command.observationRevision,
        );
      else if (command.op === 'close')
        reply = { ...(await session.close('task-download', command.sessionId)), closed: true };
      else if (command.op === 'observe')
        reply = await session.observe('task-download', command.sessionId);
      else
        reply = await session.download(
          'task-download',
          selectedChromeDownloadCommandSchema.parse(command),
        );
      if (lost === command.op) {
        lost = undefined;
        return { ok: false, error: { code: 'timeout', message: 'controlled lost original reply' } };
      }
      if (command.op === 'download_read') {
        if (humanOnChunk) control.noteHumanInput('insertText');
        if (tamper && reply.ok && 'downloadChunk' in reply && reply.downloadChunk)
          reply.downloadChunk.data = Buffer.alloc(24).toString('base64');
      }
      return { ok: reply.ok, result: reply };
    },
  });
  clients.push(client);
  if (open)
    expect((await client.open({ tabId: 731, expectedUrl: origin, selectionId: token })).ok).toBe(
      true,
    );
  return {
    client,
    control,
    commands,
    lose: (op: string) => {
      lost = op;
    },
    tamper: () => {
      tamper = true;
    },
    humanOnChunk: () => {
      humanOnChunk = true;
    },
  };
}
beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  browser = await chromium.launch({ args: ['--renderer-process-limit=2'] });
});
beforeEach(async () => {
  page = await browser.newPage({ acceptDownloads: true });
  await page.goto(origin);
  await page.setContent(fixture);
  cdp = await page.context().newCDPSession(page);
  await cdp.send('Page.enable');
  await cdp.send('Network.enable');
  send = (method, params) => cdp.send(method as never, params as never) as Promise<unknown>;
  boundary.get.mockResolvedValue({
    on: () => {},
    off: () => {},
    attach: async () => page,
    detach: async () => {},
  });
  const listeners = new Set<(source: { tabId: number }, method: string, params: object) => void>();
  for (const method of [
    'Network.requestWillBeSent',
    'Fetch.requestPaused',
    'Page.downloadWillBegin',
    'Page.downloadProgress',
  ])
    cdp.on(method as never, (params) => {
      for (const listener of listeners) listener({ tabId: 731 }, method, params as object);
    });
  vi.stubGlobal('chrome', {
    debugger: {
      sendCommand: (_target: unknown, method: string, params?: Record<string, unknown>) =>
        send(method, params),
      onEvent: {
        addListener: (listener: never) => listeners.add(listener),
        removeListener: (listener: never) => listeners.delete(listener),
      },
    },
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const client of clients.splice(0)) await client.close();
  for (const session of sessions.splice(0)) await session.stopTask('task-download');
  await page.context().close();
  vi.unstubAllGlobals();
});
afterAll(async () => {
  await browser?.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('optional original-download session capability', () => {
  it('rejects expired bytes while acknowledging release of the known expired source', async () => {
    const h = await harness();
    const opened = await h.session.download('task-download', h.command);
    if (!opened.ok || opened.downloadState?.status !== 'captured')
      throw new Error('missing native file');
    const id = opened.downloadState.downloadId;
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 120_001);
    expect(
      await h.session.download('task-download', {
        op: 'download_read',
        sessionId: h.opened.sessionId,
        downloadId: id,
        offset: 0,
        length: 24,
      }),
    ).toMatchObject({ ok: false, error: 'download_unavailable' });
    expect(
      await h.session.download('task-download', {
        op: 'download_release',
        sessionId: h.opened.sessionId,
        downloadId: id,
      }),
    ).toMatchObject({ ok: true, downloadReleased: id });
  });
  it('stops file admission immediately while close waits for the real capture cleanup', async () => {
    const h = await harness();
    const native = send;
    let paused!: () => void;
    let resume!: () => void;
    const restoring = new Promise<void>((resolve) => {
      paused = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      resume = resolve;
    });
    let held = false;
    send = async (method, params) => {
      const reply = await native(method, params);
      if (method === 'Fetch.disable' && !held) {
        held = true;
        paused();
        await gate;
      }
      return reply;
    };
    const pending = h.session.download('task-download', h.command);
    await restoring;
    h.session.stopUploadAdmission('task-download');
    let closed = false;
    const closing = h.session.stopTask('task-download').then(() => {
      closed = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(closed).toBe(false);
    resume();
    const result = await pending;
    await closing;
    expect(result).toMatchObject({ ok: false, actionOutcome: 'applied' });
    expect('downloadState' in result).toBe(false);
    expect(await page.locator('body').getAttribute('data-clicks')).toBe('1');
  });
  it('accepts bounded file operations and refuses extra addresses, paths, bytes and oversized reads', () => {
    const open = {
      op: 'download_open',
      sessionId: token,
      action,
      binding: { token, observationRevision: 1 },
    };
    const read = {
      op: 'download_read',
      sessionId: token,
      downloadId: token,
      offset: 0,
      length: 256 * 1024,
    };
    expect(selectedChromeSessionCommandSchema.safeParse(open).success).toBe(true);
    expect(selectedChromeSessionCommandSchema.safeParse(read).success).toBe(true);
    for (const extra of [
      { url: 'https://outside.invalid/file' },
      { path: '/private/file' },
      { bytes: 'payload' },
      { eval: 'document.cookie' },
    ])
      expect(selectedChromeSessionCommandSchema.safeParse({ ...open, ...extra }).success).toBe(
        false,
      );
    expect(
      selectedChromeSessionCommandSchema.safeParse({ ...read, length: 256 * 1024 + 1 }).success,
    ).toBe(false);
  });
  it('does not advertise or dispatch a download when the client did not request it', async () => {
    const h = await harness(false);
    expect(h.opened.protocol?.capabilities).not.toContain(capability);
    expect(await h.session.download('task-download', h.command)).toMatchObject({
      ok: false,
      error: 'capability_missing',
      actionOutcome: 'not_applied',
    });
    expect(await page.locator('body').getAttribute('data-clicks')).toBeNull();
  });
  it('returns immutable original chunks without repeating the click and releases idempotently', async () => {
    const h = await harness();
    expect(h.opened.protocol?.capabilities).toContain(capability);
    const opened = await h.session.download('task-download', h.command);
    if (!opened.ok || opened.downloadState?.status !== 'captured')
      throw new Error(JSON.stringify(opened));
    const id = opened.downloadState.downloadId;
    expect(opened.downloadState.metadata).toMatchObject({ sizeBytes: 24, sha256: hash });
    const read = (offset: number, length: number) =>
      h.session.download('task-download', {
        op: 'download_read',
        sessionId: h.opened.sessionId,
        downloadId: id,
        offset,
        length,
      });
    const first = await read(0, 8);
    const repeated = await read(0, 8);
    const last = await read(8, 16);
    if (!first.ok || !repeated.ok || !last.ok) throw new Error('real chunks missing');
    expect(first.downloadChunk).toEqual(repeated.downloadChunk);
    expect(
      Buffer.concat([
        Buffer.from(first.downloadChunk!.data, 'base64'),
        Buffer.from(last.downloadChunk!.data, 'base64'),
      ]).toString(),
    ).toBe(content);
    expect(last.downloadChunk!.eof).toBe(true);
    const release = {
      op: 'download_release' as const,
      sessionId: h.opened.sessionId,
      downloadId: id,
    };
    expect(await h.session.download('task-download', release)).toMatchObject({
      ok: true,
      downloadReleased: id,
    });
    expect(await h.session.download('task-download', release)).toMatchObject({
      ok: true,
      downloadReleased: id,
    });
    expect(await read(0, 24)).toMatchObject({ ok: false, error: 'download_unavailable' });
    expect(await page.locator('body').getAttribute('data-clicks')).toBe('1');
  });
  it('rejects another task, session or opaque file ID without granting bytes', async () => {
    const h = await harness();
    const result = await h.session.download('task-download', h.command);
    if (!result.ok || result.downloadState?.status !== 'captured')
      throw new Error('missing native file');
    const read = {
      op: 'download_read' as const,
      sessionId: h.opened.sessionId,
      downloadId: result.downloadState.downloadId,
      offset: 0,
      length: 24,
    };
    expect(await h.session.download('another-task', read)).toMatchObject({ ok: false });
    expect(await h.session.download('task-download', { ...read, sessionId: token })).toMatchObject({
      ok: false,
    });
    expect(await h.session.download('task-download', { ...read, downloadId: token })).toMatchObject(
      { ok: false },
    );
  });
  it('does not return an already-read chunk after the authenticated owner changes', async () => {
    const h = await harness();
    const result = await h.session.download('task-download', h.command);
    if (!result.ok || result.downloadState?.status !== 'captured')
      throw new Error('missing native file');
    const original = h.driver.readDownloadChunk.bind(h.driver);
    vi.spyOn(h.driver, 'readDownloadChunk').mockImplementation(async (...args) => {
      const reply = await original(...args);
      h.setOwner('bob');
      return reply;
    });
    const reply = await h.session.download('task-download', {
      op: 'download_read',
      sessionId: h.opened.sessionId,
      downloadId: result.downloadState.downloadId,
      offset: 0,
      length: 24,
    });
    expect(reply).toMatchObject({ ok: false, error: 'session_unavailable' });
    expect(JSON.stringify(reply)).not.toContain(Buffer.from(content).toString('base64'));
  });
  it('quarantines all later task input after uncertain restoration and drains close without repeating export', async () => {
    const h = await harness();
    const native = send;
    let failed = false;
    send = async (method, params) => {
      if (method === 'Fetch.disable' && !failed) {
        failed = true;
        throw new Error('controlled restore failure');
      }
      return native(method, params);
    };
    expect(await h.session.download('task-download', h.command)).toMatchObject({
      ok: false,
      error: 'download_restore_unconfirmed',
      actionOutcome: 'applied',
    });
    expect(
      await h.session.tabs('task-download', h.opened.sessionId, { operation: 'new', url: origin }),
    ).toMatchObject({ ok: false, error: 'input_outcome_unknown' });
    expect(
      await h.session.execute('task-download', h.opened.sessionId, {
        kind: 'goto',
        payload: { url: origin },
      }),
    ).toMatchObject({ ok: false });
    expect(await page.locator('body').getAttribute('data-clicks')).toBe('1');
    await h.session.stopTask('task-download');
  });
});

describe('task download tool uses the shared action gate and actual file service', () => {
  it.each(['saved', 'analyzed', 'store-unknown', 'permission-denied'])(
    'keeps truthful file delivery when %s',
    async (mode) => {
      const priorFlag = env.BROWSER_TASK_FILES_V1;
      if (mode === 'analyzed') env.BROWSER_TASK_FILES_V1 = true;
      let table: TableAggregate | undefined;
      let generatedId: string | undefined;
      await page.goto(
        `${origin}/?ticket=PRIVATE-DOWNLOAD-731&range=7&X-Amz-Signature=PRIVATE-DOWNLOAD-731`,
      );
      await page.setContent(fixture);
      const disk = await browserOutputFixture();
      disk.taskRecords.push({
        id: 11,
        externalId: 'task-download',
        userId: 7,
        status: 'executing',
        origin: 'user',
      });
      const scope = createBrowserTaskFileScope({
        db: disk.db,
        files: disk.service,
        taskId: 'task-download',
        userId: 7,
        origin: 'user',
        inputs: [],
      });
      const h = await clientHarness(false);
      const metadata: MessagesAdapter['metadata'] = {
        provider: 'alibaba-model-studio',
        model: 'synthetic',
        region: 'cn',
        deploymentScope: 'china_mainland',
        endpointKind: 'public',
        protocol: 'messages',
      };
      let calls = 0;
      let stores = 0;
      let offered = false;
      const modelRequests: string[] = [];
      const published: Array<{ fileId: string; filename: string; sizeBytes: number }> = [];
      const adapter: MessagesAdapter = {
        metadata,
        create: async (request) => {
          modelRequests.push(JSON.stringify(request));
          offered = request.tools?.some((tool) => tool.name === 'browser_download_file') ?? false;
          expect(offered).toBe(true);
          const first = ++calls === 1;
          let name = first ? 'browser_download_file' : 'browser_finish';
          let input: Record<string, unknown> = first
            ? { selector: action.selector }
            : { status: 'completed', summary: '已下载 report.csv', evidenceText: 'Export report' };
          if (mode === 'analyzed' && !first) {
            expect(request.tools?.map((tool) => tool.name)).toContain('read_task_file');
            const fileId = scope.references()[0]!.fileId;
            if (calls === 2) {
              name = 'read_task_file';
              input = { fileId };
            } else if (calls === 3) {
              const text = JSON.stringify(request.messages);
              expect(text).toContain('ORIGINAL-731');
              name = 'analyze_task_table';
              input = { fileId, mode: 'aggregate', metrics: [{ op: 'sum', column: 'B' }] };
            } else if (calls === 4) {
              const last = request.messages
                .flatMap((message) => (Array.isArray(message.content) ? message.content : []))
                .filter((block) => block.type === 'tool_result')
                .at(-1);
              if (!last || last.type !== 'tool_result' || typeof last.content !== 'string')
                throw new Error('no table receipt');
              table = JSON.parse(last.content) as TableAggregate;
              expect(table.overall[0]?.value).toBe('31');
              expect(table.complete).toBe(true);
              name = 'create_file';
              input = {
                filename: 'analysis.csv',
                format: 'csv',
                content: `metric,value\nquantity,${table.overall[0]!.value}\n`,
              };
            } else {
              input = {
                status: 'completed',
                summary: '已读取原报表、核对统计并交付分析文件。',
                evidenceText: 'Export report',
                fields: table!.overall.map((metric) => ({
                  name: metric.name,
                  value: metric.value,
                  fileId,
                  tableFactId: metric.id,
                })),
              };
            }
          }
          return {
            id: `download-${calls}`,
            metadata,
            stopReason: 'tool_use',
            content: [
              {
                type: 'tool_use',
                id: `download-tool-${calls}`,
                name,
                input,
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
        },
      };
      try {
        const result = await runSelectedChromeTask({
          taskId: 'task-download',
          intent:
            mode === 'analyzed'
              ? '导出 report.csv，读取并统计，再生成 analysis.csv 交给我'
              : '导出 report.csv 并交给我',
          messagesAdapter: adapter,
          client: h.client,
          control: h.control,
          target: { tabId: 731, expectedUrl: origin, selectionId: token },
          browserTaskFiles: scope,
          maxIterations: mode === 'analyzed' ? 6 : 3,
          timeoutMs: 10000,
          ...(mode === 'analyzed'
            ? {
                createFileFormats: ['csv'],
                onCreateFile: async ({
                  filename,
                  content,
                }: { filename: string; content: string }) => {
                  const rendered = await renderFile('csv', content);
                  const row = await disk.service.storeOutput({
                    userIdInternal: 7,
                    userExternalId: 'usr_alice',
                    taskIdInternal: 11,
                    filename,
                    mimetype: rendered.mimetype,
                    buffer: rendered.buffer,
                  });
                  generatedId = row.externalId;
                  return {
                    fileId: row.externalId,
                    filename: row.filename,
                    size: row.sizeBytes,
                    downloadUrl: `/api/files/${row.externalId}/download`,
                  };
                },
              }
            : {}),
          ...(mode === 'permission-denied'
            ? {
                onBeforeAction: async () => ({
                  allowed: false,
                  reason: 'fixture denied business action',
                }),
                park: async () => null,
              }
            : {}),
          onBrowserDownload: async ({ filename, buffer, sha256, mimetype }) => {
            stores++;
            if (mode === 'store-unknown') throw new Error('controlled unknown storage receipt');
            const row = await disk.service.storeOutput({
              userIdInternal: 7,
              userExternalId: 'usr_alice',
              taskIdInternal: 11,
              filename,
              mimetype: mimetype ?? 'application/octet-stream',
              buffer,
            });
            return {
              fileId: row.externalId,
              filename: row.filename,
              sizeBytes: row.sizeBytes,
              sha256,
              downloadUrl: `/api/files/${row.externalId}/download`,
              mimetype: row.mimetype,
              expiresAt: row.expiresAt?.toISOString(),
            };
          },
          onBrowserDownloadSaved: (receipt) => {
            published.push(receipt);
          },
        });
        expect(offered).toBe(true);
        expect(modelRequests.join('\n')).not.toContain('PRIVATE-DOWNLOAD-731');
        expect(modelRequests.join('\n')).toContain('range=7');
        expect(page.url()).toBe(
          `${origin}/?ticket=PRIVATE-DOWNLOAD-731&range=7&X-Amz-Signature=PRIVATE-DOWNLOAD-731`,
        );
        expect(stores).toBe(mode === 'permission-denied' ? 0 : 1);
        expect(await page.locator('body').getAttribute('data-clicks')).toBe(
          mode === 'permission-denied' ? null : '1',
        );
        if (mode === 'saved' || mode === 'analyzed') {
          expect(result.status, JSON.stringify(result)).toBe('completed');
          expect(published).toHaveLength(1);
          const loaded = await disk.service.loadMany([published[0]!.fileId], 7);
          expect(loaded[0]!.buffer.toString()).toBe(content);
          expect(loaded[0]!.row.mimetype).toBe('text/csv');
          expect(scope.references()).toHaveLength(1);
          expect(scope.source(published[0]!.fileId)).toMatchObject({
            kind: 'browser_download',
            origin,
          });
          if (mode === 'analyzed') {
            expect(generatedId).toBeDefined();
            const output = await disk.service.loadMany([generatedId!], 7);
            expect(
              output[0]!.buffer
                .toString()
                .replace(/^\uFEFF/, '')
                .replace(/\r\n/g, '\n'),
            ).toBe('metric,value\nquantity,31\n');
            if (result.status === 'completed') expect(result.summary).toContain(generatedId!);
          }
        } else {
          expect(result.status).not.toBe('completed');
          expect(published).toHaveLength(0);
        }
        expect(h.commands.filter((command) => command.op === 'download_open')).toHaveLength(
          mode === 'permission-denied' ? 0 : 1,
        );
      } finally {
        env.BROWSER_TASK_FILES_V1 = priorFlag;
        await rm(disk.root, { recursive: true, force: true });
      }
    },
  );
});

describe('server client reads the original download without exporting again', () => {
  const open = async (client: SelectedChromeClient) => {
    const target = await client.describe(action, client.revision);
    expect(target.ok).toBe(true);
    return client.openFileDownload(action, client.revision);
  };
  it('negotiates, captures once and verifies the actual native file before returning bytes', async () => {
    const h = await clientHarness();
    expect(h.client.fileDownloadsEnabled).toBe(true);
    const result = await open(h.client);
    if (!result.ok || result.downloadState?.status !== 'captured')
      throw new Error(JSON.stringify(result));
    const file = await h.client.readDownload(result.downloadState.downloadId);
    expect(file.ok).toBe(true);
    if (!file.ok) throw new Error(file.error);
    expect(file.file.buffer.toString()).toBe(content);
    expect(file.file.metadata.sha256).toBe(hash);
    expect((await h.client.releaseDownload(result.downloadState.downloadId)).ok).toBe(true);
    expect(h.commands.filter((command) => command.op === 'download_open')).toHaveLength(1);
  });
  it('does not replay an applied click whose original reply was lost', async () => {
    const h = await clientHarness();
    h.lose('download_open');
    expect(await open(h.client)).toMatchObject({ ok: false, actionOutcome: 'unknown' });
    expect(h.control.snapshot().phase).toBe('closed');
    expect(h.commands.filter((command) => command.op === 'download_open')).toHaveLength(1);
    expect(await page.locator('body').getAttribute('data-clicks')).toBe('1');
  });
  it('retries only a lost readonly chunk with the identical file ID and offset', async () => {
    const h = await clientHarness();
    const result = await open(h.client);
    if (!result.ok || result.downloadState?.status !== 'captured')
      throw new Error('missing download');
    h.lose('download_read');
    const file = await h.client.readDownload(result.downloadState.downloadId);
    expect(file.ok).toBe(true);
    const reads = h.commands.filter((command) => command.op === 'download_read');
    expect(reads).toHaveLength(2);
    expect(reads[0]).toEqual(reads[1]);
    expect(h.commands.filter((command) => command.op === 'download_open')).toHaveLength(1);
  });
  it('refuses equal-length forged bytes whose full digest differs', async () => {
    const h = await clientHarness();
    const result = await open(h.client);
    if (!result.ok || result.downloadState?.status !== 'captured')
      throw new Error('missing download');
    h.tamper();
    expect(await h.client.readDownload(result.downloadState.downloadId)).toMatchObject({
      ok: false,
      error: 'download_digest_mismatch',
    });
    expect(await page.locator('body').getAttribute('data-clicks')).toBe('1');
  });
  it('does not hand bytes to the task after user input arrives with the last chunk', async () => {
    const h = await clientHarness();
    const result = await open(h.client);
    if (!result.ok || result.downloadState?.status !== 'captured')
      throw new Error('missing download');
    h.humanOnChunk();
    const file = await h.client.readDownload(result.downloadState.downloadId);
    expect(file).toMatchObject({ ok: false, error: 'replan_required' });
    expect('file' in file).toBe(false);
  });
});
