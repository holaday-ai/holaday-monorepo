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
