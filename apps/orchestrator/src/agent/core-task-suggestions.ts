import { classifyLightweightTask } from '../execution/lightweight-task.js';
import type { ProductionModelRuntimeWiring } from '../llm/model-runtime-wiring.js';
import { type NextStep, generateNextSteps } from './next-steps-generator.js';

/** FIX-57 #4: the frame fields — instructions for older clients, steps for the new one. */
export function nextStepsFrame(steps: readonly NextStep[]): {
  suggestions: string[];
  nextSteps: NextStep[];
} {
  return { suggestions: steps.map((step) => step.prompt), nextSteps: [...steps] };
}

/** Optional follow-ups never change, delay or claim completion of the main task. */
export async function publishCoreTaskSuggestions(input: {
  wiring: ProductionModelRuntimeWiring;
  actorExternalId: string;
  modelDataRegion: unknown;
  /** Original request, before plan/parent preambles; eligibility only. */
  rawIntent: string;
  intent: string;
  summary: string;
  isCurrent: () => Promise<boolean>;
  persist: (steps: NextStep[]) => Promise<boolean>;
  publish: (steps: NextStep[]) => void;
  /** FIX-57 #4: the person's latest other requests, for continuity. */
  recentIntents?: () => Promise<string[]>;
}): Promise<void> {
  if (
    !input.rawIntent.trim() ||
    !input.intent.trim() ||
    !input.summary.trim() ||
    classifyLightweightTask(input.rawIntent)
  )
    return;
  try {
    const runtime = input.wiring.resolveCore({
      actorExternalId: input.actorExternalId,
      lane: 'suggestions',
      ownership: { scope: 'personal', userRegion: input.modelDataRegion },
    });
    if (runtime.kind !== 'ready' || !(await input.isCurrent())) return;
    const recentIntents = await input.recentIntents?.().catch(() => []);
    const suggestions = await generateNextSteps({
      messagesAdapter: runtime.messages('fast'),
      intent: input.intent,
      outcome: 'completed',
      summary: input.summary,
      ...(recentIntents?.length ? { recentIntents } : {}),
    });
    if (suggestions.length > 0 && (await input.persist(suggestions)) && (await input.isCurrent())) {
      input.publish(suggestions);
    }
  } catch {
    // Model calls already emit sanitized runtime observations. Never log raw
    // database/broadcast errors or let optional work reject the terminal path.
  }
}
