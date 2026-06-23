import { estimateCostUsd } from '../../agent/llm-call-recorder.js';
import type { LlmCallRecord, LlmCallRecorder } from '../../agent/llm-call-recorder.js';

/**
 * Playbook ④ browse-试用 — FAIL-CLOSED in-memory cost accumulator (cost-source A).
 *
 * Why in-memory, not a DB read-back: the per-site $5 circuit breaker is a SPEND
 * controller; it must fail CLOSED. A DB path (write llm_calls → read it back) fails
 * OPEN — a missing user / unwritten row / write error makes the breaker read $0 and
 * keep burning. So the breaker reads THIS number, computed in-process from each turn's
 * token usage.
 *
 * The supercar loop fires `recorder.record()` FIRE-AND-FORGET (`void ….catch`), so the
 * accumulation MUST be synchronous: `this._total += …` runs before any `await`, so the
 * total is already complete the instant runSupercarTask returns — even for the last turn.
 *
 * The optional `inner` recorder is the best-effort llm_calls DB write (finance détail);
 * its success/failure NEVER affects `total`.
 */
export class CostAccumulatingRecorder implements LlmCallRecorder {
  private _total = 0;

  constructor(private readonly inner?: LlmCallRecorder) {}

  /** In-process accumulated USD across all recorded turns. The breaker reads this. */
  get total(): number {
    return this._total;
  }

  async record(call: LlmCallRecord): Promise<void> {
    // SYNCHRONOUS first — before any await — so a fire-and-forget invocation still lands
    // its cost into the total even if the loop returns immediately after.
    this._total += estimateCostUsd(
      call.model,
      call.inputTokens,
      call.outputTokens,
      call.cacheReadInputTokens ?? 0,
      call.cacheCreationInputTokens ?? 0,
    );
    if (this.inner) {
      try {
        await this.inner.record(call);
      } catch {
        /* finance détail is best-effort; the breaker uses `total`, never this write */
      }
    }
  }
}
