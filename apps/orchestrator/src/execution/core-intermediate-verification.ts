import { type VerificationResult, verifyDeterministic } from './answer-verifier.js';
import type { CoreExecutionState } from './core-execution-registry.js';
import type { ExecutionContract } from './execution-contract.js';
import type { VerifyInputs, VerifyOutput } from './execution-pipeline.js';
import {
  mergeDeterministicAndSemantic,
  prepareLlmVerificationInput,
  verifyWithLlm,
} from './llm-verifier.js';
import type { TaskVerificationContext } from './task-verification-context.js';
import { VERIFICATION_INPUT_LIMITS } from './verification-input-budget.js';

/** Called only inside the pipeline's live-handle/flags boundary. A waiting
 * artifact is not a final report. Its context, safety constraints and evidence
 * remain unchanged; only the expected deliverable is phase-specific.
 */
export async function verifyCoreIntermediate(input: {
  state: Pick<CoreExecutionState, 'contract' | 'ledger'>;
  verificationContext: TaskVerificationContext;
  runnerStatus: 'awaiting_user' | 'failed';
  answerText: string;
  semanticAdapter?: VerifyInputs['semanticAdapter'];
}): Promise<VerifyOutput> {
  const { state, verificationContext: context } = input;
  if (input.runnerStatus === 'failed') {
    // There is no accepted candidate to review. Never transmit a failed model
    // body/reason or invent a semantic pass to satisfy the persistence schema.
    const { inputCoverage } = prepareLlmVerificationInput({
      ...state,
      verificationContext: context,
      answerText: '',
      adapter: null,
      semanticMetadata: input.semanticAdapter?.metadata,
    });
    return {
      finalText: '',
      verification: {
        taskId: state.contract.taskId,
        passed: false,
        tier: 'deterministic',
        semanticStatus: 'unavailable',
        inputCoverage,
        failureLevel: 'fixable',
        checks: [
          {
            criterionId: 'generation.incomplete',
            criterionType: 'GENERATION_INCOMPLETE',
            passed: false,
            checker: 'deterministic',
            severity: 'fixable',
            detail: '本轮未产生可交付结果。',
          },
        ],
      },
    };
  }

  const deliveryStage =
    context.phase === 'draft' || context.phase === 'revise' ? 'plan' : 'clarification';
  const contract: ExecutionContract = {
    ...state.contract,
    expectedOutputType: 'text',
    outputRequirement: null,
    successCriteria: state.contract.successCriteria.filter(
      (criterion) =>
        criterion.type === 'data_present' ||
        (criterion.type === 'custom' &&
          ['no_ungrounded_urls', 'expert_claim_provenance'].includes(criterion.rule ?? '')),
    ),
  };
  const shared = {
    contract,
    ledger: state.ledger,
    verificationContext: context,
    deliveryStage,
    answerText: input.answerText,
  } as const;
  const semanticInput = { ...shared, adapter: input.semanticAdapter ?? null };
  const prepared = prepareLlmVerificationInput(semanticInput);
  const bytes = Buffer.byteLength(input.answerText, 'utf8');
  // Existing P2 stores the visible plan in question + planText. Account for
  // that exact shape, including the separate MySQL TEXT column limits.
  const waitingTooLarge =
    bytes > 65_535 ||
    (deliveryStage === 'plan' && bytes * 2 > VERIFICATION_INPUT_LIMITS.answerBytes);
  if (waitingTooLarge || prepared.inputCoverage?.complete === false) {
    const codes = [
      ...new Set([
        ...(prepared.inputCoverage?.codes ?? []),
        ...(waitingTooLarge ? ['VERIFICATION_INPUT_LIMIT' as const] : []),
      ]),
    ];
    return {
      finalText: input.answerText,
      verification: {
        taskId: contract.taskId,
        passed: false,
        tier: 'deterministic',
        semanticStatus: 'unavailable',
        inputCoverage: { complete: false, codes },
        failureLevel: 'fixable',
        checks: codes.map((code) => ({
          criterionId: `verification.${code.toLowerCase()}`,
          criterionType: code,
          passed: false,
          checker: 'deterministic',
          severity: 'fixable',
          detail: '本轮材料或输出无法完整核验，请缩小材料或拆分任务。',
        })),
      },
    };
  }
  const det = verifyDeterministic(shared);
  // Coverage is required even when a deterministic failure prevents the model
  // call. No repair/formatter is allowed to silently rewrite the user's question.
  const semantic = det.passed
    ? await verifyWithLlm(semanticInput)
    : { status: 'unavailable' as const, issues: [], inputCoverage: prepared.inputCoverage };
  const verification: VerificationResult = mergeDeterministicAndSemantic(det, semantic);
  return { finalText: input.answerText, verification };
}
