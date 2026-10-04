import type { UnifiedBrowserOutcome } from '../../src/agent/browser-tools/unified-browser-loop.js';

export interface BrowserEvalTask {
  id: string;
  category: string;
  startUrl: string;
  instruction: string;
  publicSite: boolean;
  expectHandoff: boolean;
  success:
    | { type: 'answer_contains_all'; values: string[]; minItems?: number }
    | { type: 'answer_mentions'; values: string[] }
    | { type: 'answer_nonempty' }
    | { type: 'expect_handoff'; reason?: string }
    | { type: 'handoff_or_answer'; note?: string };
}

/** Deterministic success judgement for one eval run (no model in the loop). */
export function scoreBrowserEval(task: BrowserEvalTask, outcome: UnifiedBrowserOutcome): boolean {
  const handedOff = outcome.status === 'awaiting_user';
  const answer = outcome.status === 'completed' ? `${outcome.summary}\n${outcome.evidence}` : '';
  switch (task.success.type) {
    case 'expect_handoff':
      return (
        handedOff &&
        (!task.success.reason ||
          outcome.status !== 'awaiting_user' ||
          outcome.reason === task.success.reason)
      );
    case 'handoff_or_answer':
      return handedOff || answer.trim().length > 0;
    case 'answer_nonempty':
      return answer.trim().length > 0;
    case 'answer_mentions':
      return (
        answer.trim().length > 0 && task.success.values.every((value) => answer.includes(value))
      );
    case 'answer_contains_all': {
      if (!task.success.values.every((value) => answer.includes(value))) return false;
      const lines = answer.split('\n').filter((line) => line.trim()).length;
      return lines >= (task.success.minItems ?? 1);
    }
  }
}

/**
 * Failure attribution for success-rate accounting:
 *  - model_layer: a model call failed (403/429/timeouts/provider errors) — excluded;
 *  - environment: the harness could not reach the start page — excluded;
 *  - browser: everything else (counted; includes successes).
 */
export function classifyFailure(
  success: boolean,
  outcome: UnifiedBrowserOutcome,
  trace: ReadonlyArray<Record<string, unknown>>,
): 'none' | 'model_layer' | 'environment' | 'browser' {
  if (success) return 'none';
  if (outcome.status === 'failed' && outcome.reason.startsWith('harness:')) return 'environment';
  const modelErrors = trace.filter((entry) => entry.type === 'model_error').length;
  const modelOk = trace.filter((entry) => entry.type === 'model').length;
  if (modelErrors > 0 && (modelOk === 0 || outcome.status !== 'completed')) return 'model_layer';
  return 'browser';
}
