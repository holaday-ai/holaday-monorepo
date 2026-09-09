import { type CoreTaskHead, parseCoreTaskHead } from './core-task-admission.js';
import { type CoreAcceptedRequirements, parseCoreRequirements } from './core-task-requirements.js';

export type CoreRecordRead =
  | { readonly kind: 'legacy' }
  | {
      readonly kind: 'core';
      readonly head: CoreTaskHead;
      readonly requirements: CoreAcceptedRequirements;
    }
  | { readonly kind: 'invalid'; readonly code: 'CORE_RECORD_INVALID' };

/** Decode one already-authorized database snapshot. Never choose a lane or resume a task. */
export function readCoreTaskRecord(input: { head: CoreTaskHead; result: unknown }): CoreRecordRead {
  try {
    const head = parseCoreTaskHead(input.head);
    const result = input.result;
    const hasMarker =
      result !== null &&
      typeof result === 'object' &&
      Object.prototype.hasOwnProperty.call(result, 'coreRequirements');
    if (head.executionId === null) {
      if (head.recordVersion !== 0 || hasMarker) throw new Error('CORE_RECORD_INVALID');
      return Object.freeze({ kind: 'legacy' });
    }
    if (head.recordVersion < 1 || !hasMarker || Array.isArray(result))
      throw new Error('CORE_RECORD_INVALID');
    const requirements = parseCoreRequirements(
      (result as Record<string, unknown>).coreRequirements,
      { executionId: head.executionId, executionRevision: head.executionRevision },
    );
    return Object.freeze({ kind: 'core', head, requirements });
  } catch {
    return Object.freeze({ kind: 'invalid', code: 'CORE_RECORD_INVALID' });
  }
}
