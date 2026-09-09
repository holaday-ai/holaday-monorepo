import type Anthropic from '@anthropic-ai/sdk';
import type { Logger } from 'pino';
import {
  type CoreExecutionHandle,
  type CoreExecutionRegistry,
  coreExecutionRegistry,
} from '../execution/core-execution-registry.js';
import {
  deriveFinalStatus,
  finalizeCoreAnswerForPersistence,
} from '../execution/execution-pipeline.js';
import {
  type ReviewableGenerateOutcome,
  reviewGenerateOutcome,
} from '../execution/generate-outcome-review.js';
import {
  createTaskVerificationContext,
  renderVerificationUserIntent,
} from '../execution/task-verification-context.js';
import { VERIFICATION_INPUT_LIMITS } from '../execution/verification-input-budget.js';
import type { MessagesAdapter } from '../llm/messages-adapter.js';
import type { ResponsesAdapter } from '../llm/responses-adapter.js';
import {
  type CoreAcceptedRequirements,
  type CoreAdmission,
  type CoreTaskHead,
  type CoreTaskScope,
  prepareCoreAdmission,
} from './core-task-admission.js';
import { assertCoreTaskInput } from './core-task-input.js';
import {
  type CoreRecoveryClock,
  admitCoreTask,
  persistCoreSettlement,
} from './core-task-recovery.js';
import type { CoreTaskRepository } from './core-task-repository.js';
import { type CoreSettlement, prepareCoreSettlement } from './core-task-settlement.js';
import { runGenerateTask } from './generate-runner.js';

type ExecutionIdentity = { taskId: string; executionId: string; executionRevision: number };
/** Server-internal events. The router must project public fields into WS schemas. */
export type CoreExecutionEvent = ExecutionIdentity &
  (
    | { type: 'stream'; delta: string }
    | { type: 'verifying' }
    | { type: 'unconfirmed' }
    | { type: 'settled'; settlement: CoreSettlement }
  );
export interface CoreExecutionInput {
  scope: CoreTaskScope;
  before: CoreTaskHead;
  requirements: CoreAcceptedRequirements;
  legacySnapshot?: CoreAdmission['legacySnapshot'];
  /** Already authorized and completely parsed; never client-supplied model context. */
  blocks: readonly Anthropic.Beta.BetaContentBlockParam[];
  actorExternalId: string;
  responsesAdapter: ResponsesAdapter | null;
  semanticAdapter?: MessagesAdapter;
  logger: Logger;
  registry?: CoreExecutionRegistry;
  repo: Pick<CoreTaskRepository, 'admit' | 'readHead' | 'settle' | 'readSettlement'>;
  intakeIntent?: string;
  skillId?: string;
  expertMode?: 'normal' | 'expert' | 'auto';
  publish: (event: CoreExecutionEvent) => void | Promise<void>;
  /** Optional display-only planning after admission. Never changes the frozen requirements. */
  beforeGeneration?: (
    admission: CoreAdmission,
    isCurrent: () => boolean,
    deadline: number,
  ) => Promise<'ready' | 'stale' | 'unconfirmed'>;
  /** Optional follow-up channel; consumer must use settlement identity in its CAS. */
  afterSettlement?: (settlement: CoreSettlement) => Promise<void>;
  recoveryClock?: CoreRecoveryClock;
}
export interface CoreExecutionStart {
  ack: ExecutionIdentity & { state: 'resumed' | 'acceptedUnconfirmed' | 'notAdmitted' };
  completion: Promise<'committed' | 'stale' | 'unconfirmed' | 'notDispatched'>;
}

/** Server orchestration, not an HTTP endpoint. Authorization, phase selection and
 * file loading happen in the caller; this layer owns the one admission permit.
 * ACK confirms admission only; stream deltas remain provisional. Only a
 * confirmed settlement produces a saved-delivery event.
 */
export async function startCoreTaskExecution(
  input: CoreExecutionInput,
): Promise<CoreExecutionStart> {
  const requirements = {
    ...input.requirements,
    resume: input.requirements.resume ?? {
      schemaVersion: 1 as const,
      expertMode: input.expertMode ?? 'auto',
      skillId: input.skillId ?? null,
      legacyWorkflowId: null,
      intakeBindings: [],
    },
  };
  assertCoreTaskInput({ ...requirements, blocks: input.blocks });
  if (requirements.resume.legacyWorkflowId && !requirements.legacyWorkflow)
    throw new Error('CORE_LEGACY_WORKFLOW_CONTEXT_REQUIRED');
  const admission = prepareCoreAdmission({
    scope: input.scope,
    before: input.before,
    requirements,
    ...(input.legacySnapshot ? { legacySnapshot: input.legacySnapshot } : {}),
  });
  const resume = admission.requirements.resume;
  if (!resume) throw new Error('CORE_RESUME_METADATA_REQUIRED');
  // Snapshot materials before the first await: callers cannot mutate the model
  // request while the database transaction is pending. No attachment second channel.
  const context = createTaskVerificationContext({
    schemaVersion: 1,
    executionId: admission.executionId,
    executionRevision: admission.executionRevision,
    initialRequest: admission.requirements.initialRequest,
    userTurns: admission.requirements.userTurns,
    phase: admission.requirements.phase,
    workflow: admission.requirements.workflow,
    referencePlan: admission.requirements.referencePlan,
    ...(admission.requirements.referenceContext !== undefined
      ? { referenceContext: admission.requirements.referenceContext }
      : {}),
    ...(admission.requirements.legacyWorkflow
      ? { legacyWorkflow: admission.requirements.legacyWorkflow }
      : {}),
    materials: input.blocks.map((block, index) =>
      block.type === 'text'
        ? { kind: 'text', key: `file-block-${index}`, source: 'file', text: block.text }
        : { kind: 'unavailable', key: `file-block-${index}`, source: 'file', reason: 'non_text' },
    ),
  });
  const identity = Object.freeze({
    taskId: admission.scope.taskId,
    executionId: admission.executionId,
    executionRevision: admission.executionRevision,
  });
  const accepted = await admitCoreTask(input.repo, admission, input.recoveryClock);
  if (!accepted.dispatchAllowed) {
    return {
      ack: {
        ...identity,
        state:
          accepted.kind === 'committed' || accepted.kind === 'unknown'
            ? 'acceptedUnconfirmed'
            : 'notAdmitted',
      },
      completion: Promise.resolve('notDispatched'),
    };
  }
  const registry = input.registry ?? coreExecutionRegistry;
  let handle: CoreExecutionHandle;
  try {
    handle = registry.begin({
      taskId: identity.taskId,
      verificationContext: context,
      expertMode: resume.expertMode,
      hasAttachments: context.materials.length > 0,
    });
  } catch {
    // Admission exists, but no owned execution can start. Do not invent a
    // verification receipt, fall back to legacy, or replace another handle.
    safelyPublish(input, { ...identity, type: 'unconfirmed' });
    return {
      ack: { ...identity, state: 'acceptedUnconfirmed' },
      completion: Promise.resolve('unconfirmed'),
    };
  }
  const owned = registry.read(handle);
  if (!owned) {
    return {
      ack: { ...identity, state: 'acceptedUnconfirmed' },
      completion: Promise.resolve('unconfirmed'),
    };
  }
  const intent = renderVerificationUserIntent(owned.context);
  const completion = (async (): CoreExecutionStart['completion'] => {
    try {
      if (input.beforeGeneration && input.responsesAdapter) {
        const deadline = performance.now() + 15_000;
        let readiness: 'ready' | 'stale' | 'unconfirmed';
        try {
          readiness = await input.beforeGeneration(
            admission,
            () => Boolean(registry.read(handle)),
            deadline,
          );
        } catch {
          readiness = 'unconfirmed';
        }
        if (!registry.read(handle) || readiness === 'stale') return 'stale';
        if (readiness !== 'ready' || performance.now() >= deadline) {
          safelyPublish(input, { ...identity, type: 'unconfirmed' });
          return 'unconfirmed';
        }
      }
      let outcome: ReviewableGenerateOutcome;
      try {
        outcome = input.responsesAdapter
          ? await runGenerateTask({
              taskId: identity.taskId,
              userId: input.actorExternalId,
              intent,
              verificationContext: owned.context,
              intakeIntent: input.intakeIntent,
              skillId: resume.skillId ?? undefined,
              expertMode: resume.expertMode,
              responsesAdapter: input.responsesAdapter,
              logger: input.logger,
              onStreamDelta: (delta) => {
                if (registry.read(handle))
                  safelyPublish(input, { ...identity, type: 'stream', delta });
              },
            })
          : failedGeneration();
      } catch {
        outcome = failedGeneration();
      }
      if (!registry.read(handle)) return 'stale';
      const reviewed = await reviewGenerateOutcome({
        taskId: identity.taskId,
        intent,
        outcome,
        semanticAdapter: input.semanticAdapter,
        logger: input.logger,
        coreExecution: { handle, registry },
        onVerifying: () => safelyPublish(input, { ...identity, type: 'verifying' }),
      });
      if (!registry.read(handle)) return 'stale';
      let verification = reviewed.verification;
      let summary = reviewed.outcome.summary;
      let status = reviewed.terminalStatus;
      if (outcome.status === 'completed') {
        const final = await finalizeCoreAnswerForPersistence({
          handle,
          registry,
          answerText: summary,
          priorVerification: verification,
          semanticMetadata: input.semanticAdapter?.metadata,
        });
        verification = final.verification;
        summary = final.finalText;
        status = deriveFinalStatus(outcome.status, verification, reviewed.sourceTrust);
        if (status === 'completed' && outcome.generation?.completeness === 'partial')
          status = 'partial_success';
      }
      if (!registry.read(handle)) return 'stale';
      if (!verification || !outcome.generation) throw new Error('CORE_REVIEW_UNAVAILABLE');
      const op = settlementFor({
        admission,
        status,
        summary,
        outcome,
        verification,
        sourceTrust: reviewed.sourceTrust,
      });
      const persisted = await persistCoreSettlement(input.repo, op, input.recoveryClock);
      if (persisted.kind === 'stale') return 'stale';
      if (persisted.kind !== 'committed') {
        safelyPublish(input, { ...identity, type: 'unconfirmed' });
        return 'unconfirmed';
      }
      // Identity accompanies even a late confirmed event; a newer local owner
      // suppresses it altogether. Cross-process ordering is a client gate too.
      if (registry.read(handle))
        safelyPublish(input, { ...identity, type: 'settled', settlement: op });
      if (registry.read(handle) && op.status === 'completed' && input.afterSettlement) {
        // Suggestions are an independent optional channel, not an awaited part
        // of delivery. The consumer must scope writes to this exact settlement.
        try {
          // Start while ownership is still current. A delayed microtask would
          // run after finally releases this handle or after another admission.
          void Promise.resolve(input.afterSettlement(op)).catch(() => {});
        } catch {
          /* Synchronous optional callbacks are isolated too. */
        }
      }
      return 'committed';
    } catch {
      safelyPublish(input, { ...identity, type: 'unconfirmed' });
      return 'unconfirmed';
    } finally {
      registry.release(handle);
    }
  })();
  return { ack: { ...identity, state: 'resumed' }, completion };
}

function safelyPublish(input: CoreExecutionInput, event: CoreExecutionEvent): void {
  try {
    void Promise.resolve(input.publish(event)).catch(() => {});
  } catch {
    /* Notification transport cannot undo persistence. */
  }
}

function failedGeneration(): ReviewableGenerateOutcome {
  return {
    status: 'failed',
    summary: '',
    reason: 'CORE_GENERATION_FAILED',
    generation: { completeness: 'partial', stopReason: 'provider_error' },
    inputTokens: 0,
    outputTokens: 0,
    durationMs: 0,
  };
}

function settlementFor(input: {
  admission: CoreAdmission;
  status: Awaited<ReturnType<typeof reviewGenerateOutcome>>['terminalStatus'];
  summary: string;
  outcome: ReviewableGenerateOutcome;
  verification: NonNullable<Awaited<ReturnType<typeof reviewGenerateOutcome>>['verification']>;
  sourceTrust: Awaited<ReturnType<typeof reviewGenerateOutcome>>['sourceTrust'];
}): CoreSettlement {
  const { admission, status, summary, outcome, verification, sourceTrust } = input;
  if (!outcome.generation) throw new Error('CORE_GENERATION_INVALID');
  const shared = { admission, verification, sourceTrust, generation: outcome.generation };
  // A locally known payload rejection is not an uncertain database commit.
  // Persist only a controlled failure and its real input-limit verdict, never
  // the over-budget candidate or a silently truncated version of that candidate.
  if (Buffer.byteLength(summary, 'utf8') > VERIFICATION_INPUT_LIMITS.answerBytes) {
    return prepareCoreSettlement({
      ...shared,
      status: 'failed',
      result: { reason: 'CORE_OUTPUT_LIMIT' },
      verification: {
        ...verification,
        passed: false,
        failureLevel: verification.failureLevel ?? 'fixable',
        inputCoverage: {
          complete: false,
          codes: [
            ...new Set([
              ...(verification.inputCoverage?.codes ?? []),
              'VERIFICATION_INPUT_LIMIT' as const,
            ]),
          ],
        },
      },
    });
  }
  if (status === 'awaiting_user') {
    const plan =
      admission.requirements.phase === 'draft' || admission.requirements.phase === 'revise';
    return prepareCoreSettlement({
      ...shared,
      status,
      result: { question: summary, ...(plan ? { planText: summary } : {}) },
    });
  }
  if (status === 'completed' || status === 'partial_success')
    return prepareCoreSettlement({ ...shared, status, result: { summary } });
  return prepareCoreSettlement({
    ...shared,
    status: 'failed',
    result: { reason: 'CORE_EXECUTION_FAILED' },
  });
}
