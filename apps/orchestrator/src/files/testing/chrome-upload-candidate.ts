import { createHash } from 'node:crypto';
import { rm } from 'node:fs/promises';
import type { SelectedChromeSessionCommand } from '@holaday/shared-types';
import { BrowserTaskFiles } from '../../agent/browser-tools/browser-task-files.js';
import { LocalChromeTaskSessions } from '../../agent/supercar/local-chrome-task-session.js';
import { supercarReply } from '../../agent/supercar/qwen-only-agent-loop.js';
import { runSelectedChromeTask } from '../../agent/supercar/selected-chrome-runner.js';
import type { MessagesAdapter } from '../../llm/messages-adapter.js';
import type { ExtensionToolCallOptions, ExtensionToolCallOutcome } from '../../ws/server.js';
import { createBrowserTaskFileScope } from '../browser-task-file-scope.js';
import { browserOutputFixture } from './browser-output-fixture.js';

/** Loaded once through tsx's public scoped import so branded file references
 * and their consumers share one module graph. Only DB/auth/model/WS are doubles;
 * FileService, local bytes, sessions, gate, runner and extension are actual code. */
export async function runChromeUploadCandidate(options: {
  mode: 'owned' | 'declined' | 'unprovided' | 'full-budget' | 'lost-chooser-reply';
  targetKind?: 'selector' | 'chooser';
  taskId: string;
  origin: string;
  target: Extract<SelectedChromeSessionCommand, { op: 'open' }>['target'];
  send: (userId: string, options: ExtensionToolCallOptions) => Promise<ExtensionToolCallOutcome>;
}) {
  const fixture = await browserOutputFixture();
  const sessions = new LocalChromeTaskSessions();
  const bytes =
    options.mode === 'full-budget'
      ? Buffer.alloc(50 * 1024 * 1024, '1')
      : Buffer.from('sku,qty\nA-731,31\n');
  if (options.mode === 'full-budget') {
    bytes.write('value\n');
    bytes[bytes.length - 1] = 90;
  }
  const expectedSHA256 = createHash('sha256').update(bytes).digest('hex');
  let chooserRepliesLost = 0;
  fixture.taskRecords[0]!.externalId = options.taskId;
  try {
    const row = await fixture.service.storeUpload({
      userIdInternal: 7,
      userExternalId: 'usr_alice',
      filename: 'report.csv',
      mimetype: 'text/csv',
      buffer: bytes,
    });
    const inputs = BrowserTaskFiles.validatedReferences(
      await fixture.service.loadMany([row.externalId], 7),
      7,
    );
    const scope = createBrowserTaskFileScope({
      db: fixture.db,
      files: fixture.service,
      taskId: options.taskId,
      userId: 7,
      origin: 'user',
      inputs: options.mode === 'unprovided' ? [] : inputs,
    });
    const session = sessions.start(
      'usr_alice',
      options.taskId,
      { ...options.target, extensionClientId: 'e2e-active-extension' },
      async (user, input) => {
        const result = await options.send(user, input);
        if (options.mode === 'lost-chooser-reply' && input.args?.session?.op === 'chooser_open') {
          chooserRepliesLost++;
          return {
            ok: false,
            error: { code: 'timeout', message: 'synthetic lost chooser reply after native click' },
          };
        }
        return result;
      },
      undefined,
      { viewportV2: false, observationV2: false, replayV1: false, routingV2: true },
      { taskFilesV1: true },
    );
    let calls = 0;
    let maxModelRequestBytes = 0;
    const questions: string[] = [];
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
        calls++;
        maxModelRequestBytes = Math.max(
          maxModelRequestBytes,
          Buffer.byteLength(JSON.stringify(request)),
        );
        const chooser = options.targetKind === 'chooser';
        const opened = chooser && calls === 1;
        const chooserId = request.messages
          .flatMap((message) => (Array.isArray(message.content) ? message.content : []))
          .filter((block) => block.type === 'tool_result')
          .map((block) => {
            try {
              return JSON.parse(String(block.content)) as {
                chooserState?: { status: string; chooserId?: string };
              };
            } catch {
              return {};
            }
          })
          .find((receipt) => receipt.chooserState?.status === 'captured')?.chooserState?.chooserId;
        const uploading = chooser ? calls === 2 && Boolean(chooserId) : calls === 1;
        return {
          id: 'candidate-owned-file',
          metadata,
          stopReason: 'tool_use',
          content: [
            {
              type: 'tool_use',
              id: `tool-${calls}`,
              name: opened
                ? 'browser_open_file_chooser'
                : uploading
                  ? 'browser_upload'
                  : 'browser_finish',
              input: opened
                ? {
                    selector: {
                      description: 'Choose report',
                      strategies: [{ kind: 'css', value: '#choose' }],
                    },
                  }
                : uploading
                  ? {
                      ...(chooser
                        ? { chooserId }
                        : {
                            selector: {
                              description: 'Report',
                              strategies: [{ kind: 'css', value: '#report' }],
                            },
                          }),
                      fileIds: [row.externalId],
                    }
                  : {
                      status: chooser && !chooserId ? 'failed' : 'completed',
                      summary: '网站控件已读到 report.csv；未声称外部业务提交。',
                      evidenceText: 'Received report.csv',
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
        options.mode === 'declined'
          ? '读取网页表单并准备报告'
          : `把附件 report.csv 上传到 ${options.origin}，核对页面实际接收文件`,
      browserTaskFiles: scope,
      client: session.client,
      control: session.control,
      target: options.target,
      messagesAdapter: adapter,
      maxIterations: 4,
      timeoutMs: 120_000,
      onAwaitingUser: async (event) => {
        questions.push(event.question);
        if (!supercarReply(options.taskId, '不要执行'))
          throw new Error('candidate confirmation wait missing');
      },
    });
    const closed = await sessions.finish('usr_alice', options.taskId);
    return {
      outcome,
      expectedSHA256,
      sizeBytes: bytes.length,
      lastByte: bytes[bytes.length - 1],
      admittedFileIds: scope.references().map((file) => file.fileId),
      questions,
      maxModelRequestBytes,
      modelRequests: calls,
      chooserRepliesLost,
      closeConfirmed: Boolean(closed?.ok && closed.closed),
    };
  } finally {
    try {
      await sessions.finish('usr_alice', options.taskId);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  }
}
