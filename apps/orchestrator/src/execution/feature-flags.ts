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
}

function readFlagsFromEnv(): FeatureFlags {
  return {
    EXECUTION_CONTRACT: process.env.EXECUTION_CONTRACT_ENABLED === 'true',
    EXECUTION_VERIFIER: process.env.EXECUTION_VERIFIER_ENABLED === 'true',
    EVIDENCE_LEDGER: process.env.EVIDENCE_LEDGER_ENABLED === 'true',
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
