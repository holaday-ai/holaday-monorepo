/**
 * Phase 1 — Evidence ledger.
 *
 * The ledger is the durable record of what the agent OBSERVED vs
 * INFERRED during a task. Verification cross-references the
 * agent's final answer against this ledger to catch fabrication
 * (a URL in the answer that nobody ever visited; a number that
 * doesn't match the user's input).
 *
 * Storage model: in-memory `Map<taskId, EvidenceLedger>` while a
 * task is in flight; serialised to the DB on terminal status (the
 * persistence side lands in the integration step — this module
 * only owns the in-memory shape).
 *
 * Cap: each fact is hard-truncated to 500 chars so a runaway agent
 * can't blow heap. The ledger never stores raw page bytes — only
 * verifiable facts (numbers, URLs, boolean states).
 */
import { randomUUID } from 'node:crypto';

export type EvidenceSourceType =
  | 'user_input'
  | 'file_parse'
  | 'browser_state'
  | 'tool_result'
  | 'inference';

export type EvidenceConfidence = 'observed' | 'extracted' | 'inferred';

export interface EvidenceEntry {
  id: string;
  taskId: string;
  timestamp: string;
  fact: string;
  sourceType: EvidenceSourceType;
  sourceDetail: string;
  confidence: EvidenceConfidence;
}

/**
 * Hard cap to keep a single fact bounded. Long page snippets and
 * verbose tool outputs get truncated. Verification relies on
 * structured facts (numbers, URLs, status flags), not narrative.
 */
export const MAX_FACT_CHARS = 500;

/**
 * Cap on total entries per task to bound memory in the runaway
 * case (a tool-loop that emits 10k inferences). 1000 is generous
 * for any realistic task; anything above is a bug.
 */
export const MAX_ENTRIES_PER_TASK = 1_000;

export class EvidenceLedger {
  readonly taskId: string;
  private readonly _entries: EvidenceEntry[] = [];
  private _truncated = false;

  constructor(taskId: string) {
    this.taskId = taskId;
  }

  /**
   * Append a fact. The caller owns deciding sourceType + confidence;
   * this method only normalises the fact length and assigns id +
   * timestamp. Returns the assigned id (or empty string on overflow).
   */
  add(entry: Omit<EvidenceEntry, 'id' | 'timestamp' | 'taskId'>): string {
    if (this._entries.length >= MAX_ENTRIES_PER_TASK) {
      this._truncated = true;
      return '';
    }
    const fact =
      entry.fact.length > MAX_FACT_CHARS
        ? entry.fact.slice(0, MAX_FACT_CHARS)
        : entry.fact;
    const id = randomUUID();
    this._entries.push({
      id,
      taskId: this.taskId,
      timestamp: new Date().toISOString(),
      fact,
      sourceType: entry.sourceType,
      sourceDetail: entry.sourceDetail,
      confidence: entry.confidence,
    });
    return id;
  }

  /** Read-only view of all entries in insertion order. */
  get entries(): readonly EvidenceEntry[] {
    return this._entries;
  }

  get size(): number {
    return this._entries.length;
  }

  /** True iff a write was rejected because the cap was hit. */
  get isTruncated(): boolean {
    return this._truncated;
  }

  /** Filter by sourceType — common verification lookup. */
  getByType(sourceType: EvidenceSourceType): EvidenceEntry[] {
    return this._entries.filter((e) => e.sourceType === sourceType);
  }

  /** Strict facts: things the agent literally observed (vs inferred). */
  getObservedFacts(): EvidenceEntry[] {
    return this._entries.filter((e) => e.confidence === 'observed');
  }

  /**
   * URL allow-list built from facts where the agent actually went
   * somewhere (browser_state) or pulled bytes from somewhere
   * (tool_result). Used by the answer verifier to flag URLs in
   * the final answer that don't match anything the agent saw.
   */
  getGroundedUrls(): string[] {
    const urls = new Set<string>();
    for (const e of this._entries) {
      if (e.sourceType !== 'browser_state' && e.sourceType !== 'tool_result') {
        continue;
      }
      // Match http(s) URLs liberally; the verifier normalises before compare.
      const matches = e.fact.match(/https?:\/\/[^\s,;'")\]]+/g);
      if (matches) {
        for (const m of matches) urls.add(m);
      }
    }
    return [...urls];
  }

  /**
   * JSON-safe snapshot for persistence / debugging. Returns plain
   * data — no class instances, safe to JSON.stringify.
   */
  toJSON(): {
    taskId: string;
    entries: EvidenceEntry[];
    truncated: boolean;
  } {
    return {
      taskId: this.taskId,
      entries: [...this._entries],
      truncated: this._truncated,
    };
  }
}

/**
 * Process-wide registry. The orchestrator runs in a single Node
 * process per PM2 instance, so a Map keyed by taskId is enough —
 * no cross-instance coordination needed (a task only ever runs
 * on one instance).
 *
 * Callers that don't yet have a ledger reference go through the
 * registry. Once the integration step plumbs ledger handles
 * through the runner signatures, registry use should drop.
 */
const ledgers = new Map<string, EvidenceLedger>();

export function getOrCreateLedger(taskId: string): EvidenceLedger {
  let ledger = ledgers.get(taskId);
  if (!ledger) {
    ledger = new EvidenceLedger(taskId);
    ledgers.set(taskId, ledger);
  }
  return ledger;
}

export function getLedger(taskId: string): EvidenceLedger | undefined {
  return ledgers.get(taskId);
}

/**
 * Drop the ledger from the registry. Caller is responsible for
 * persisting first if they want it durable. Idempotent.
 */
export function disposeLedger(taskId: string): void {
  ledgers.delete(taskId);
}

/** Test-only — clear the registry. Don't call in production code. */
export function _resetLedgerRegistryForTest(): void {
  ledgers.clear();
}
