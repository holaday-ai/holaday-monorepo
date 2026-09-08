import type Anthropic from '@anthropic-ai/sdk';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import {
  VerificationContextError,
  createTaskVerificationContext,
} from '../execution/task-verification-context.js';
import { checkVerificationAdmission } from '../execution/verification-input-budget.js';
import type { CoreAcceptedRequirements } from './core-task-admission.js';

/** Pre-dispatch budget only, not an execution identity or an admission permit.
 * Files must already be authorized and parsed in complete-text mode. Reserve
 * UUID/revision serialization overhead; the real identity is assigned by P1.
 */
export function assertCoreTaskInput(
  input: CoreAcceptedRequirements & { blocks: readonly Anthropic.Beta.BetaContentBlockParam[] },
): void {
  const { blocks, fileIds, ...requirements } = input;
  try {
    z.array(z.string().min(1).max(32))
      .max(5)
      .refine((ids) => new Set(ids).size === ids.length)
      .parse(fileIds);
    createTaskVerificationContext({
      ...requirements,
      schemaVersion: 1,
      executionId: '0'.repeat(36),
      executionRevision: Number.MAX_SAFE_INTEGER,
      materials: blocks.map((block, index) =>
        block.type === 'text'
          ? { kind: 'text', key: `file-block-${index}`, source: 'file', text: block.text }
          : { kind: 'unavailable', key: `file-block-${index}`, source: 'file', reason: 'non_text' },
      ),
    });
    if (!checkVerificationAdmission(JSON.stringify({ ...requirements, fileIds }), []).ok)
      throw new VerificationContextError('VERIFICATION_INPUT_LIMIT');
  } catch {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: '任务要求或附件超出完整核验范围，请缩小材料或拆分任务后再提交。',
    });
  }
}
