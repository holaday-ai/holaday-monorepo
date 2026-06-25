/**
 * Phase 1 Day 5 — Execution-pipeline feature flags.
 *
 * Three independent boolean flags, all default-false. Read once
 * at module load (env vars are stable across the process lifetime
 * post-boot). Designed to be flipped in stages on Vultr:
 *
 *   1. EVIDENCE_LEDGER_ENABLED       → start writing facts to the
 *                                      ledger but don't act on them
 *   2. EXECUTION_CONTRACT_ENABLED    → also generate the contract
 *                                      (still no enforcement)
 *   3. EXECUTION_VERIFIER_ENABLED    → finally turn on verification
 *                                      (read contract + ledger,
 *                                      possibly autoFix the answer)
 *
 * Off-by-default semantics is the safety contract: on a fresh
 * deploy with no env vars set, the pipeline is a no-op and
 * production behaviour is identical to pre-Phase-1.
 *
 * Module-scope `Object.freeze` so a malicious test can't mutate
 * flags mid-suite. Tests that need to flip flags should use
 * `setFeatureFlagsForTest` below — explicit, easy to grep.
 */

interface FeatureFlags {
  EXECUTION_CONTRACT: boolean;
  EXECUTION_VERIFIER: boolean;
  EVIDENCE_LEDGER: boolean;
  /**
   * Phase 2 — expert workflow framework. When true, generate-runner
   * intercepts douyin-review (and other registered workflows) for
   * deterministic intake gating + structured report generation. When
   * false (default), generate path runs the legacy text-prompt
   * supercar/expert-workflows.ts flow unchanged.
   */
  EXPERT_WORKFLOW: boolean;
  /**
   * B-专项 — user-browser/extension execution for China-OTA query
   * tasks (查询/筛选/提取, never 下单/预订/支付). When false (default),
   * OTA tasks run on the server Brave exactly as today; the
   * user-browser lane decision may be computed but is never dispatched.
   * The actual extension transport stays behind this flag so enabling
   * it is a deliberate, reviewed switch — not an accidental revival of
   * the disabled P0 chrome.debugger path.
   */
  OTA_USER_BROWSER: boolean;
  /**
   * Phase 1 #3 Pack B — Evidence Ledger DB write path. When true, the
   * task terminal hook mirrors the in-memory EvidenceLedger into the
   * queryable `evidence_artifacts` / `claims` / `claim_evidence_links`
   * tables (in addition to the existing `tasks.evidence_json` snapshot,
   * which is always written). When false (default), only the JSON
   * snapshot is written — identical to pre-Pack-B behaviour, so the
   * answer verifier is unaffected. Flip on Vultr once R2 + the 0033
   * tables are validated in production.
   */
  LEDGER_DB_WRITE: boolean;
  /**
   * Phase 1 Playbook B2 — per-action capture. When true, the supercar
   * loop captures a multi-signal target descriptor (visible text / stable
   * selector / coordinate) for each click / type / navigate and writes it
   * to `task_action_captures` (distillation source for ① crystallization).
   * When false (default) the whole capture → emit → write chain is skipped
   * — zero hot-path overhead, no behaviour change (dark ship; canary on
   * after validation). `tasks.ts` only wires the supercar `onAction`
   * callback when this is on, so OFF means the in-loop capture (incl. the
   * page.evaluate) never runs.
   */
  ACTION_CAPTURE: boolean;
  /**
   * Phase 1 Playbook B4 — screenshot anchor. When true (AND ACTION_CAPTURE on),
   * the supercar loop attaches the post-action screenshot for SELECTED key
   * steps (a page-advancing click) to the capture event; tasks.ts uploads it to
   * R2 + writes an `evidence_artifacts` row (retention_policy='manual_hold' so
   * the reaper never sweeps it) + backfills `task_action_captures.
   * screenshot_anchor_id`. Capped per task. Independent of ACTION_CAPTURE so
   * the R2-spending screenshot path can be canaried separately. Default OFF:
   * the loop does not even attach the screenshot, and the upload chain never
   * runs (dark ship). No migration — table/column/FK already exist.
   */
  B4_SCREENSHOT_ANCHOR: boolean;
  /**
   * Phase 1 Playbook ④ B1 — user-task crystallize sweep. When true, a low-frequency cron runs
   * the EXISTING `crystallizeTasks` (crystallizer internals UNCHANGED) over all completed/
   * partial_success tasks that have captures — INCLUDING origin='user' (the crystallizer has no
   * origin filter) — distilling their real trajectories into DRAFT `operation_paths`. Idempotent
   * (dedup by source_task_id). WRITE-ONLY sink: nothing reads operation_paths back into the live
   * product lane (reuse/replay is a later phase), so this is ZERO live-user impact. Default OFF.
   */
  USER_TASK_CRYSTALLIZE: boolean;
}

function readFlagsFromEnv(): FeatureFlags {
  return {
    EXECUTION_CONTRACT: process.env.EXECUTION_CONTRACT_ENABLED === 'true',
    EXECUTION_VERIFIER: process.env.EXECUTION_VERIFIER_ENABLED === 'true',
    EVIDENCE_LEDGER: process.env.EVIDENCE_LEDGER_ENABLED === 'true',
    EXPERT_WORKFLOW: process.env.EXPERT_WORKFLOW_ENABLED === 'true',
    OTA_USER_BROWSER: process.env.OTA_USER_BROWSER_ENABLED === 'true',
    LEDGER_DB_WRITE: process.env.LEDGER_DB_WRITE_ENABLED === 'true',
    ACTION_CAPTURE: process.env.ACTION_CAPTURE_ENABLED === 'true',
    B4_SCREENSHOT_ANCHOR: process.env.B4_SCREENSHOT_ANCHOR_ENABLED === 'true',
    USER_TASK_CRYSTALLIZE: process.env.USER_TASK_CRYSTALLIZE_ENABLED === 'true',
  };
}

let _flags: FeatureFlags = readFlagsFromEnv();

/**
 * Read the current flag state. Returns a frozen copy so callers
 * can't mutate the live object.
 */
export function getFeatureFlags(): Readonly<FeatureFlags> {
  return Object.freeze({ ..._flags });
}

/**
 * Test-only: override the flag state. Always pass an explicit
 * value for every flag — the writer assumes you mean what you
 * set, including `false` for the omitted flags.
 *
 * Real production code reads flags via `getFeatureFlags()`. There
 * is no production setter — flags are environmental.
 */
export function setFeatureFlagsForTest(overrides: Partial<FeatureFlags>): void {
  _flags = { ..._flags, ...overrides };
}

/** Test-only: reload flags from process.env. Pair with stub env writes. */
export function reloadFeatureFlagsForTest(): void {
  _flags = readFlagsFromEnv();
}
