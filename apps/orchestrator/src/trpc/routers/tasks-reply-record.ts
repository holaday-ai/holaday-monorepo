import { TRPCError } from '@trpc/server';
import { readCoreTaskRecord } from '../../agent/core-task-record.js';

/** Only the legacy continuation may pass this gate. A core snapshot is not a
 * permit for the old scheduler; it needs the transactional core entry instead.
 * The caller supplies one authorized row with an already-normalized result.
 */
export function assertLegacyReplyRecord(row: {
  status: string;
  executionId: string | null;
  executionRevision: number;
  coreRecordVersion: number;
  result: unknown;
}): void {
  const decoded = readCoreTaskRecord({
    head: {
      status: row.status,
      executionId: row.executionId,
      executionRevision: row.executionRevision,
      recordVersion: row.coreRecordVersion,
    },
    result: row.result,
  });
  if (decoded.kind === 'invalid') {
    throw new TRPCError({ code: 'BAD_REQUEST', message: '任务执行记录无法恢复，请刷新后重试。' });
  }
  if (decoded.kind === 'core') {
    throw new TRPCError({ code: 'CONFLICT', message: '任务已进入新的执行轮次，请刷新后再继续。' });
  }
}
