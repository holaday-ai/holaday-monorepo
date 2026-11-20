import { createHash } from 'node:crypto';
import { rm } from 'node:fs/promises';
import type { SelectedChromeSessionCommand } from '@holaday/shared-types';
import { LocalChromeTaskSessions } from '../../agent/supercar/local-chrome-task-session.js';
import { supercarReply } from '../../agent/supercar/qwen-only-agent-loop.js';
import { runSelectedChromeTask } from '../../agent/supercar/selected-chrome-runner.js';
import type { MessagesAdapter } from '../../llm/messages-adapter.js';
import type { ExtensionToolCallOptions, ExtensionToolCallOutcome } from '../../ws/server.js';
import { createBrowserTaskFileScope } from '../browser-task-file-scope.js';
import { browserOutputFixture } from './browser-output-fixture.js';

/** One public tsx scoped import keeps the real FileService and private task
 * receipt brand in the same graph. Auth/SQL/model/WS delivery are fixtures. */
export async function runChromeDownloadCandidate(options: {
  mode:
    | 'owned'
    | 'roundtrip'
    | 'cached'
    | 'denied'
    | 'lost-open'
    | 'corrupt-chunk'
    | 'store-unknown';
  taskId: string;
  confirmPost?: boolean;
  confirmTransfer?: boolean;
  target: Extract<SelectedChromeSessionCommand, { op: 'open' }>['target'];
  send(user: string, options: ExtensionToolCallOptions): Promise<ExtensionToolCallOutcome>;
}) {
  const fixture = await browserOutputFixture();
  fixture.taskRecords[0]!.externalId = options.taskId;
  const scope = createBrowserTaskFileScope({
    db: fixture.db,
    files: fixture.service,
    taskId: options.taskId,
    userId: 7,
    origin: 'user',
    inputs: [],
  });
  const sessions = new LocalChromeTaskSessions();
  const commands: SelectedChromeSessionCommand[] = [];
  const modelRequests: string[] = [];
  let calls = 0;
  let stores = 0;
  let lost = false;
  const questions: string[] = [];
  const published: Array<{ fileId: string; filename: string; sizeBytes: number }> = [];
  try {
    const session = sessions.start(
      'usr_alice',
      options.taskId,
      { ...options.target, extensionClientId: 'e2e-active-extension' },
      async (user, input) => {
        const command = input.args?.session;
        if (command) commands.push(command);
        const reply = await options.send(user, input);
        if (options.mode === 'lost-open' && command?.op === 'download_open' && !lost) {
          lost = true;
          return {
            ok: false,
            error: { code: 'timeout', message: 'controlled lost original export reply' },
          };
        }
        if (options.mode === 'corrupt-chunk' && command?.op === 'download_read' && reply.ok) {
          const cloned = structuredClone(reply);
          const result = cloned.result as { downloadChunk?: { data: string } };
          if (result.downloadChunk) result.downloadChunk.data = Buffer.alloc(24).toString('base64');
          return cloned;
        }
        return reply;
      },
      undefined,
      { viewportV2: false, observationV2: false, replayV1: false, routingV2: true },
      { taskFilesV1: true },
    );
    const metadata: MessagesAdapter['metadata'] = {
      provider: 'alibaba-model-studio',
      model: 'synthetic',
      region: 'cn',
      deploymentScope: 'china_mainland',
      endpointKind: 'public',
      protocol: 'messages',
    };
    const adapter: MessagesAdapter = {
      metadata,
      create: async (request) => {
        modelRequests.push(JSON.stringify(request));
        if (!request.tools?.some((tool) => tool.name === 'browser_download_file'))
          throw new Error('actual download capability missing');
        calls++;
        const receipts = request.messages
          .flatMap((message) => (Array.isArray(message.content) ? message.content : []))
          .flatMap((block) => {
            if (block.type !== 'tool_result') return [];
            try {
              return [
                JSON.parse(String(block.content)) as {
                  ok?: boolean;
                  file?: { fileId?: string };
                  upload?: { status?: string };
                },
              ];
            } catch {
              return [];
            }
          });
        const saved = receipts.find((result) => result.ok === true && Boolean(result.file?.fileId));
        const first = !saved;
        const uploading =
          options.mode === 'roundtrip' &&
          Boolean(saved) &&
          !receipts.some((result) => result.upload?.status === 'handed_to_page');
        return {
          id: `candidate-download-${calls}`,
          metadata,
          stopReason: 'tool_use',
          content: [
            {
              type: 'tool_use',
              id: `tool-${calls}`,
              name: first
                ? 'browser_download_file'
                : uploading
                  ? 'browser_upload'
                  : 'browser_finish',
              input: first
                ? {
                    selector: {
                      description: 'Export report',
                      strategies: [{ kind: 'css', value: '#export' }],
                      selfHeal: false,
                    },
                  }
                : uploading
                  ? {
                      selector: {
                        description: 'Report',
                        strategies: [{ kind: 'css', value: '#report' }],
                        selfHeal: false,
                      },
                      fileIds: [saved!.file!.fileId],
                    }
                  : {
                      status: 'completed',
                      summary: '已保存网站原始 report.csv；未声称办理外部业务。',
                      evidenceText:
                        options.mode === 'roundtrip' ? 'Received report.csv' : 'Export report',
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
      },
    };
    const outcome = await runSelectedChromeTask({
      taskId: options.taskId,
      intent:
        options.mode === 'roundtrip'
          ? `导出网站原始 report.csv，再上传到 ${new URL(options.target.expectedUrl).origin} 网页的报告控件，核对实际接收；不要提交业务表单。`
          : '导出网站原始 report.csv 并交给我',
      browserTaskFiles: scope,
      messagesAdapter: adapter,
      client: session.client,
      control: session.control,
      target: options.target,
      maxIterations: 3,
      timeoutMs: 30000,
      onAwaitingUser: async (event) => {
        questions.push(event.question);
        const transfer =
          options.confirmTransfer &&
          event.question.includes('report.csv') &&
          event.question.includes(new URL(options.target.expectedUrl).origin);
        if (
          (!options.confirmPost && !transfer) ||
          !supercarReply(
            options.taskId,
            transfer
              ? '确认将 report.csv 交给当前网站的文件控件，不提交业务表单'
              : '确认执行这一次报表导出',
          )
        )
          throw new Error('candidate did not authorize this confirmation');
      },
      ...(options.mode === 'denied'
        ? {
            onBeforeAction: async () => ({ allowed: false, reason: 'controlled user refusal' }),
            park: async () => null,
          }
        : {}),
      onBrowserDownload: async ({ filename, buffer, sha256, mimetype, source }) => {
        stores++;
        if (!source || source.taskId !== options.taskId)
          throw new Error('actual task download source missing');
        const row = await fixture.service.storeTaskBrowserOutput({
          userIdInternal: 7,
          userExternalId: 'usr_alice',
          source: { version: 1, kind: 'task_download', ...source },
          filename,
          mimetype: mimetype ?? 'application/octet-stream',
          buffer,
        });
        if (options.mode === 'store-unknown')
          throw new Error('controlled missing write receipt after actual storage');
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
    const stored = [];
    for (const row of fixture.records) {
      const id = row.externalId;
      if (typeof id !== 'string') throw new Error('fixture output ID missing');
      const loaded = (await fixture.service.loadMany([id], 7))[0];
      if (!loaded) throw new Error('actual stored bytes missing');
      stored.push({
        fileId: id,
        filename: loaded.row.filename,
        mimeType: loaded.row.mimetype,
        sizeBytes: loaded.buffer.length,
        sha256: createHash('sha256').update(loaded.buffer).digest('hex'),
        text: loaded.buffer.toString(),
      });
    }
    const closed = await sessions.finish('usr_alice', options.taskId);
    return {
      outcome,
      stores,
      stored,
      published,
      admitted: scope.references().map((file) => ({ ...file, source: scope.source(file.fileId) })),
      modelRequests: calls,
      modelPrivateDataLeaked: modelRequests.some(
        (value) => value.includes('PRIVATE-') || value.includes('ORIGINAL-731'),
      ),
      modelNonSensitiveQueryPreserved: modelRequests.some((value) => value.includes('range=7')),
      maxModelRequestBytes: Math.max(0, ...modelRequests.map((value) => Buffer.byteLength(value))),
      commands: commands.map((command) => command.op),
      closeConfirmed: Boolean(closed?.ok && closed.closed),
      questions,
    };
  } finally {
    try {
      await sessions.finish('usr_alice', options.taskId);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  }
}
