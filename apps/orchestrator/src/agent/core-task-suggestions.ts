import { classifyLightweightTask } from '../execution/lightweight-task.js';
import type { ProductionModelRuntimeWiring } from '../llm/model-runtime-wiring.js';
import { generateSuggestions } from './suggestions-generator.js';

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
  publish: (suggestions: string[]) => void;
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
    const suggestions = await generateSuggestions({
      messagesAdapter: runtime.messages('fast'),
      intent: input.intent,
      summary: input.summary,
    });
    if (suggestions.length > 0 && (await input.isCurrent())) input.publish(suggestions);
  } catch {
    // Model calls already emit sanitized runtime observations. Never log raw
    // database/broadcast errors or let optional work reject the terminal path.
  }
}
