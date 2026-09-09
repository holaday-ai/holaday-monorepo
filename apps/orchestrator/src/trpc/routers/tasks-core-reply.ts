import { TRPCError } from '@trpc/server';
import { prepareCoreContinuation } from '../../agent/core-task-continuation.js';
import {
  type CoreExecutionEvent,
  startCoreTaskExecution,
} from '../../agent/core-task-execution.js';
import { readCoreTaskRecord } from '../../agent/core-task-record.js';
import { CoreTaskRepository } from '../../agent/core-task-repository.js';
import { FileService } from '../../files/file-service.js';
import { parseFileForPrompt } from '../../files/parsers.js';
import type { ProductionModelRuntimeWiring } from '../../llm/model-runtime-wiring.js';
import { broadcastToUser } from '../../ws/server.js';
import type { Context } from '../context.js';
import { publishCoreSettledSuggestions } from './tasks-core-suggestions.js';

/** Receives exactly the already owner/origin-authorized row read by tasks.reply. */
export async function handleCoreTaskReply(args: {
  ctx: Context & { userId: string };
  userId: number;
  modelDataRegion: unknown;
  wiring: ProductionModelRuntimeWiring;
  input: { taskId: string; message: string; fileIds?: string[] };
  row: {
    status: string;
    executionId: string | null;
    executionRevision: number;
    coreRecordVersion: number;
    awaitingQuestion: string | null;
    result: unknown;
  };
}) {
  const { ctx, row, input } = args;
  const record = readCoreTaskRecord({
    head: {
      status: row.status,
      executionId: row.executionId,
      executionRevision: row.executionRevision,
      recordVersion: row.coreRecordVersion,
    },
    result: row.result,
  });
  if (record.kind === 'legacy') return null;
  if (record.kind === 'invalid')
    throw new TRPCError({ code: 'BAD_REQUEST', message: '任务执行记录无法恢复，请刷新后重试。' });
  if (!record.requirements.resume)
    throw new TRPCError({
      code: 'CONFLICT',
      message: '任务缺少可恢复的执行配置，请保留要求后重新创建任务。',
    });
  const prepared = prepareCoreContinuation({
    record,
    result: row.result as Record<string, unknown>,
    awaitingQuestion: row.awaitingQuestion,
    message: input.message,
    fileIds: input.fileIds,
  });
  if (prepared.hold)
    return {
      ok: true,
      state: 'stillAwaiting' as const,
      executionId: row.executionId,
      executionRevision: row.executionRevision,
    };
  const { requirements } = prepared;
  const blocks: Awaited<ReturnType<typeof parseFileForPrompt>>['blocks'] = [];
  try {
    if (requirements.fileIds.length) {
      const files = await new FileService(ctx.db, ctx.logger).loadMany(
        [...requirements.fileIds],
        args.userId,
      );
      if (requirements.fileIds.some((id) => !files.some((file) => file.row.externalId === id)))
        throw new Error('CORE_FILES_UNAVAILABLE');
      for (const file of files) {
        const parsed = await parseFileForPrompt(file.buffer, file.row.filename, file.row.mimetype, {
          completeText: true,
        });
        if (!parsed.blocks.length) throw new Error('CORE_FILES_UNAVAILABLE');
        blocks.push(...parsed.blocks);
      }
    }
  } catch {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: '附件已失效、无法读取或超出完整核验范围，请重新整理后提交。',
    });
  }
  const resolve = (lane: 'generate' | 'verifier') =>
    args.wiring.resolveCore({
      actorExternalId: ctx.userId,
      lane,
      ownership: { scope: 'personal', userRegion: args.modelDataRegion },
    });
  const generation = resolve('generate');
  const semantic = resolve('verifier');
  const repo = new CoreTaskRepository(ctx.db);
  const execution = await startCoreTaskExecution({
    scope: { taskId: input.taskId, userId: args.userId },
    before: record.head,
    requirements,
    blocks,
    intakeIntent: prepared.intakeIntent,
    actorExternalId: ctx.userId,
    logger: ctx.logger,
    repo,
    responsesAdapter: generation.kind === 'ready' ? generation.responses('standard') : null,
    semanticAdapter: semantic.kind === 'ready' ? semantic.messages('verify_strict') : undefined,
    publish: (event) => publishCoreExecutionEvent(ctx.userId, event),
    afterSettlement: (op) =>
      publishCoreSettledSuggestions({
        op,
        requirements,
        repo,
        wiring: args.wiring,
        actorExternalId: ctx.userId,
        modelDataRegion: args.modelDataRegion,
        rawIntent: input.message,
      }),
  });
  void execution.completion.catch(() => {});
  return {
    ok: execution.ack.state === 'resumed',
    state: execution.ack.state === 'notAdmitted' ? ('persistFailed' as const) : execution.ack.state,
    executionId: execution.ack.executionId,
    executionRevision: execution.ack.executionRevision,
  };
}

export function publishCoreExecutionEvent(userId: string, event: CoreExecutionEvent): void {
  const identity = {
    taskId: event.taskId,
    executionId: event.executionId,
    executionRevision: event.executionRevision,
  };
  if (event.type === 'stream') {
    broadcastToUser(userId, { ...identity, type: 'server.task.stream', delta: event.delta });
    return;
  }
  if (event.type === 'verifying' || event.type === 'unconfirmed') {
    broadcastToUser(userId, {
      ...identity,
      type: 'server.task.progress',
      message:
        event.type === 'verifying'
          ? '正在核验本轮结果'
          : '本轮结果保存未确认，请保留当前内容并刷新核对。',
    });
    return;
  }
  const op = event.settlement;
  if (op.status === 'awaiting_user') {
    broadcastToUser(userId, {
      ...identity,
      type: 'server.supercar.awaiting_user',
      awaitingKind: 'clarification',
      question: op.awaitingQuestion ?? '',
    });
    return;
  }
  broadcastToUser(userId, {
    ...identity,
    type: 'server.task.terminal',
    status: op.status,
    ...(op.result.summary ? { summary: op.result.summary } : {}),
    ...(op.result.reason ? { reason: op.result.reason } : {}),
    verificationPassed: op.verificationPassed,
    failedChecks: op.verification.issueCodes.map((type) => ({
      type,
      detail: '本轮存在未通过或未完成的核验项目。',
    })),
  });
}
