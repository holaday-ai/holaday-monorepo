import type { SupercarTickEvent } from '../../agent/supercar/agent-loop.js';

/** One projection shared by live ticks and persisted task history. */
export function taskTickReceipt(event: SupercarTickEvent, fallbackSummary: string) {
  const execution = event.execution;
  const ok = execution?.ok ?? true;
  return {
    actionKind: execution?.actionKind ?? event.toolsInTurn[0] ?? 'text',
    actionSummary: execution?.actionSummary ?? fallbackSummary,
    ok,
    status: ok ? ('done' as const) : ('failed' as const),
    ...(execution?.message ? { message: execution.message } : {}),
  };
}
