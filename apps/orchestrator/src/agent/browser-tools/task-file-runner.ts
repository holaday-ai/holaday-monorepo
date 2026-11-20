import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import type { MessagesAdapter } from '../../llm/messages-adapter.js';
import type { RunSupercarOptions, SupercarOutcome } from '../supercar/agent-loop.js';
import { recordedBrowserAdapter } from '../supercar/recorded-browser-adapter.js';
import { BrowserTaskOutputs } from './browser-task-output.js';
import { createTaskFileContract } from './task-file-contract.js';
import { runUnifiedBrowserLoop } from './unified-browser-loop.js';

/** Same file services and unified loop, without acquiring a browser or website authority. */
export async function runTaskFileMaterials(
  opts: RunSupercarOptions,
  signal: AbortSignal,
): Promise<SupercarOutcome> {
  const files = opts.browserTaskFiles;
  if (!files || !opts.messagesAdapter || files.taskId !== opts.taskId)
    return {
      status: 'failed',
      reason: '缺少本任务已验证的附件。',
      failureSource: 'task',
      iterations: 0,
      toolsUsed: [],
    };
  const current = async () =>
    env.BROWSER_TASK_FILES_V1 &&
    !signal.aborted &&
    !(await opts.isTaskCancelled?.()) &&
    (await files.isActive());
  const outputs = new BrowserTaskOutputs({
    formats: opts.createFileFormats,
    store: opts.onCreateFile,
    signal,
    canPublish: () => env.BROWSER_TASK_FILES_V1 && !signal.aborted,
    current,
  });
  let contract: Awaited<ReturnType<typeof createTaskFileContract>>;
  try {
    contract = await createTaskFileContract({
      intent: opts.userRequest ?? opts.intent,
      files,
      outputs,
      signal,
    });
  } catch {
    contract = null;
  }
  if (!contract || !(await current()))
    return {
      status: 'failed',
      reason: '附件任务归属或处理范围未确认。',
      failureSource: 'task',
      iterations: 0,
      toolsUsed: [],
    };
  const toolsUsed = new Set<string>();
  let turns = 0;
  let sequence = 0;
  let latency = 0;
  let progress = Promise.resolve();
  const adapter: MessagesAdapter = {
    metadata: opts.messagesAdapter.metadata,
    async create(request, options) {
      if (!(await current())) throw new Error('file_task_stopped');
      const start = Date.now();
      const recorded = recordedBrowserAdapter(opts.messagesAdapter!, {
        recorder: opts.recorder,
        userExternalId: opts.userExternalId,
        taskId: opts.taskId,
        iteration: ++turns,
        onRecordError: () =>
          logger.warn({ taskId: opts.taskId }, 'file task model accounting failed'),
      });
      const response = await recorded.create(
        { ...request, maxTokens: Math.min(request.maxTokens, 4096) },
        options,
      );
      latency = Date.now() - start;
      const text = response.content
        .flatMap((block) => (block.type === 'text' ? [block.text] : []))
        .join('\n')
        .trim();
      if (text) await Promise.resolve(opts.onThinking?.(text)).catch(() => {});
      return response;
    },
  };
  const outcome = await runUnifiedBrowserLoop({
    intent: opts.userRequest ?? opts.intent,
    userIntent: opts.userRequest ?? opts.intent,
    adapter,
    taskFileContract: contract,
    requireBrowserEvidence: true,
    signal,
    maxSteps: opts.maxIterations ?? 50,
    execute: async () => {
      throw new Error('file_contract_forbids_browser');
    },
    beforeFinish: async () =>
      (await current())
        ? { kind: 'proceed' }
        : {
            kind: 'stop',
            outcome: {
              status: 'failed',
              reason: '文件任务已停止或账号失效。',
              failureSource: 'task',
              steps: turns,
            },
          },
    async onCompletionRejected(event) {
      const iteration = ++sequence;
      progress = progress
        .then(async () => {
          await opts.onTick?.({
            iteration,
            toolsInTurn: [],
            textPreamble: '',
            apiLatencyMs: 0,
            execution: {
              actionKind: 'browser_finish_rejected',
              actionSummary: '文件结果证据尚未核对完成',
              ok: false,
              errorCode: 'completion_evidence_rejected',
              message: JSON.stringify(event),
            },
          });
        })
        .catch(() =>
          logger.warn({ taskId: opts.taskId }, 'file task completion diagnostic failed'),
        );
      await progress;
    },
    onStep(step) {
      toolsUsed.add(step.tool);
      const summary =
        step.tool === 'read_task_file'
          ? '已读取任务文件'
          : step.tool === 'analyze_task_table'
            ? '已获取表格统计回执'
            : step.tool === 'create_file'
              ? '已保存生成文件'
              : '已处理文件步骤';
      const iteration = ++sequence;
      progress = progress
        .then(async () => {
          await opts.onTick?.({
            iteration,
            toolsInTurn: [step.tool],
            textPreamble: '',
            apiLatencyMs: latency,
            execution: {
              actionKind: step.tool,
              actionSummary: step.ok ? summary : '文件步骤未完成',
              ok: step.ok,
            },
          });
        })
        .catch((error) => {
          logger.warn(
            {
              taskId: opts.taskId,
              error: error instanceof Error ? error.message : 'progress_failed',
            },
            'file task progress callback failed',
          );
        });
    },
  });
  await progress;
  if (outcome.status === 'completed') {
    const gap = await contract.completionGap();
    if (gap || !(await current()))
      return {
        status: 'failed',
        reason: gap ?? '文件任务已停止。',
        failureSource: 'task',
        iterations: turns,
        toolsUsed: [...toolsUsed],
      };
    return {
      status: 'completed',
      summary: contract.attach(outcome.summary),
      iterations: turns,
      toolsUsed: [...toolsUsed],
    };
  }
  if (outcome.status === 'cancelled')
    return { status: 'cancelled', iterations: turns, toolsUsed: [...toolsUsed] };
  return {
    status: 'failed',
    reason: outcome.status === 'failed' ? outcome.reason : '文件任务尚未完成。',
    failureSource: outcome.status === 'failed' ? (outcome.failureSource ?? 'task') : 'task',
    iterations: turns,
    toolsUsed: [...toolsUsed],
  };
}
