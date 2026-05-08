/**
 * Phase 1 — Answer verifier (deterministic tier).
 *
 * Reads the contract + ledger and decides whether the agent's
 * final answer is allowed to ship. Two layers per BOSS spec:
 *   1. Deterministic — pure rules, 0 LLM cost. Implemented here.
 *   2. LLM — Haiku-driven content judgement. Lands in the
 *      integration step (Phase 1 Day 4); the type surface
 *      already accommodates `tier: 'llm'` for forward compat.
 *
 * Failure levels (drives downstream control flow):
 *   - fixable             → auto-fix path (autoFix + recheck)
 *   - needs_clarification → ask user (data conflict / missing input)
 *   - hard_fail           → mark task failed, do not output
 *
 * Design choices:
 *   - URL fabrication detection works on grounded URL set from
 *     the ledger. An answer URL not in the set is a fabrication.
 *   - Number cross-validation works on the douyin metric triple
 *     (GMV / 订单数 / 客单价) and the UV-conversion variant —
 *     domain-specific but explicitly called out in BOSS spec
 *     acceptance #4. Other metric domains land in Phase 2.
 *   - Constraint violation uses keyword matching against ledger
 *     facts — best-effort but catches the obvious cases (form
 *     submit / payment) without inventing a structured DSL.
 */
import type {
  ExecutionContract,
  SuccessCriterion,
} from './execution-contract.js';
import type { EvidenceLedger } from './evidence-ledger.js';

export type FailureLevel = 'fixable' | 'needs_clarification' | 'hard_fail';

export interface CheckResult {
  criterionId: string;
  passed: boolean;
  checker: 'deterministic' | 'llm';
  detail: string;
  /** Hint to the failure-level classifier — only meaningful when !passed. */
  severity?: FailureLevel;
}

export interface VerificationResult {
  taskId: string;
  passed: boolean;
  tier: 'deterministic' | 'llm';
  checks: CheckResult[];
  failureLevel?: FailureLevel;
  suggestedFix?: string;
}

export interface VerifyInputs {
  contract: ExecutionContract;
  ledger: EvidenceLedger;
  /** The agent's final answer text. */
  answerText: string;
  /** When the task is browser-mode, the last URL the agent reached. */
  finalUrl?: string;
}

const URL_RE = /https?:\/\/[^\s,;'")\]>]+/g;
// Permissible drift in cross-validation arithmetic (5%) — covers
// rounding in the user's input ("GMV ¥100,000" vs computed 99,852.50).
const CROSS_VALIDATION_TOLERANCE = 0.05;
// A number is "interesting" for cross-checking if it's at least
// this large — avoids treating "ROI 1:2.5" or "增长率 3%" as GMV.
const MIN_CROSSCHECK_VALUE = 100;

const KNOWN_NUMERIC_KEYS = [
  'GMV',
  '订单数',
  '订单',
  '客单价',
  'UV',
  '转化率',
  'ROI',
  '千川消耗',
  '消耗',
] as const;

// Keyword checkers for constraint violation matching. Function-based
// (not single regex) so we can express co-occurrence — e.g. an entry
// that mentions "submit" AND "form" anywhere counts as a form-submit
// violation regardless of word order ("submitted login form",
// "form_submit fired", "submit the search form" all match). Function
// shape also keeps Chinese aliases inline. False positives are
// tolerable: verifier flags as hard_fail and the integration step
// decides whether to actually block or just warn.
const CONSTRAINT_CHECKERS: Record<string, (fact: string) => boolean> = {
  no_form_submit: (fact) => {
    if (/提交表单|表单提交/i.test(fact)) return true;
    // Avoid `\b` here — `_` counts as a word char in JS regex, so
    // `\bsubmit\b` wouldn't match "form_submit". Plain substring
    // co-occurrence is good enough for ledger fact text.
    return /submit/i.test(fact) && /form/i.test(fact);
  },
  no_payment: (fact) =>
    /payment|checkout|paypal|pay\s+now|支付|付款|结账|下单/i.test(fact),
  no_credentials: (fact) =>
    /password|credential|api[_ ]?key|secret|token|密码|凭证/i.test(fact),
};

const CHINESE_CONSTRAINT_ALIASES: Record<string, string> = {
  不提交表单: 'no_form_submit',
  禁止提交表单: 'no_form_submit',
  不进行支付: 'no_payment',
  禁止支付: 'no_payment',
  不点击购买按钮: 'no_payment',
  不输入凭证: 'no_credentials',
  不泄露密钥: 'no_credentials',
};

/**
 * Top-level entrypoint. Currently deterministic-only; the LLM
 * tier will wrap this in Phase 1 Day 4 by feeding the result
 * into a Haiku prompt when `contract.tier === 'full'`.
 */
export function verifyDeterministic(inputs: VerifyInputs): VerificationResult {
  const { contract, ledger, answerText, finalUrl } = inputs;
  const checks: CheckResult[] = [];

  // 1. Per-criterion checks.
  for (const criterion of contract.successCriteria) {
    checks.push(checkCriterion(criterion, ledger, answerText, finalUrl, contract));
  }

  // 2. Generic checks (always run, regardless of explicit criteria).
  const groundingCheck = checkUrlGrounding(answerText, ledger);
  if (groundingCheck) checks.push(groundingCheck);

  const constraintCheck = checkConstraints(contract.constraints, ledger);
  if (constraintCheck) checks.push(constraintCheck);

  const numberCheck = checkNumberCrossValidation(ledger);
  if (numberCheck) checks.push(numberCheck);

  const passed = checks.every((c) => c.passed);
  const result: VerificationResult = {
    taskId: contract.taskId,
    passed,
    tier: 'deterministic',
    checks,
  };
  if (!passed) {
    result.failureLevel = classifyFailureLevel(checks, contract);
    const suggestion = buildSuggestion(checks, ledger);
    if (suggestion) result.suggestedFix = suggestion;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Per-criterion dispatch
// ---------------------------------------------------------------------------

function checkCriterion(
  criterion: SuccessCriterion,
  ledger: EvidenceLedger,
  answerText: string,
  finalUrl: string | undefined,
  contract: ExecutionContract,
): CheckResult {
  switch (criterion.type) {
    case 'url_match':
      return checkUrlMatch(criterion, finalUrl);
    case 'data_present':
      return checkDataPresent(criterion, ledger);
    case 'file_exists':
      return checkFileExists(criterion);
    case 'field_count':
      return checkFieldCount(criterion, answerText);
    case 'word_count':
      return checkWordCount(criterion, answerText);
    case 'custom':
      return checkCustom(criterion, ledger, answerText, contract);
    default: {
      // TS exhaustiveness — should be unreachable.
      const _exhaust: never = criterion.type;
      void _exhaust;
      return {
        criterionId: criterion.id,
        passed: false,
        checker: 'deterministic',
        detail: `unknown criterion type: ${(criterion as SuccessCriterion).type}`,
        severity: 'hard_fail',
      };
    }
  }
}

function checkUrlMatch(
  criterion: SuccessCriterion,
  finalUrl: string | undefined,
): CheckResult {
  const domain = (criterion.data?.domain as string | undefined) ?? '';
  if (!domain) {
    return {
      criterionId: criterion.id,
      passed: false,
      checker: 'deterministic',
      detail: 'url_match criterion missing data.domain',
      severity: 'hard_fail',
    };
  }
  if (!finalUrl) {
    return {
      criterionId: criterion.id,
      passed: false,
      checker: 'deterministic',
      detail: `expected finalUrl on domain "${domain}", got none`,
      severity: 'needs_clarification',
    };
  }
  const passed = finalUrl.includes(domain);
  return {
    criterionId: criterion.id,
    passed,
    checker: 'deterministic',
    detail: passed
      ? `finalUrl matches domain "${domain}"`
      : `finalUrl="${finalUrl}" does not include "${domain}"`,
    severity: passed ? undefined : 'needs_clarification',
  };
}

function checkDataPresent(
  criterion: SuccessCriterion,
  ledger: EvidenceLedger,
): CheckResult {
  const productive = ledger.entries.filter(
    (e) => e.confidence === 'observed' || e.confidence === 'extracted',
  );
  const passed = productive.length > 0;
  return {
    criterionId: criterion.id,
    passed,
    checker: 'deterministic',
    detail: passed
      ? `${productive.length} productive ledger entries`
      : 'ledger has no observed/extracted entries — agent never gathered data',
    severity: passed ? undefined : 'hard_fail',
  };
}

function checkFileExists(criterion: SuccessCriterion): CheckResult {
  // Phase 1: stub. The integration step will wire actual fs.access
  // against /opt/holaday-files/<absPath>. Stubbing as "passing when
  // no path is given" lets the criterion be in the catalogue without
  // failing the deterministic pass for tasks that don't produce files.
  const absPath = criterion.data?.absPath as string | undefined;
  if (!absPath) {
    return {
      criterionId: criterion.id,
      passed: true,
      checker: 'deterministic',
      detail: 'no absPath specified — skipping (file_exists is opt-in)',
    };
  }
  return {
    criterionId: criterion.id,
    passed: false,
    checker: 'deterministic',
    detail: 'file_exists fs check not yet wired (Phase 1 integration)',
    severity: 'fixable',
  };
}

function checkFieldCount(
  criterion: SuccessCriterion,
  answerText: string,
): CheckResult {
  const fields = (criterion.data?.fields as string[] | undefined) ?? [];
  if (fields.length === 0) {
    return {
      criterionId: criterion.id,
      passed: true,
      checker: 'deterministic',
      detail: 'no fields specified — skipping',
    };
  }
  const missing = fields.filter((f) => !answerText.includes(f));
  const passed = missing.length === 0;
  return {
    criterionId: criterion.id,
    passed,
    checker: 'deterministic',
    detail: passed
      ? `all ${fields.length} fields present`
      : `missing fields: ${missing.join(', ')}`,
    severity: passed ? undefined : 'fixable',
  };
}

function checkWordCount(
  criterion: SuccessCriterion,
  answerText: string,
): CheckResult {
  const min = (criterion.data?.min as number | undefined) ?? 0;
  const max = (criterion.data?.max as number | undefined) ?? Infinity;
  const length = answerText.length;
  const passed = length >= min && length <= max;
  return {
    criterionId: criterion.id,
    passed,
    checker: 'deterministic',
    detail: passed
      ? `length ${length} in [${min}, ${max === Infinity ? '∞' : max}]`
      : `length ${length} outside [${min}, ${max === Infinity ? '∞' : max}]`,
    // Too short = answer is a stub / error state — fixable by re-running.
    // Too long is unlikely but treated the same.
    severity: passed ? undefined : 'fixable',
  };
}

function checkCustom(
  criterion: SuccessCriterion,
  ledger: EvidenceLedger,
  answerText: string,
  contract: ExecutionContract,
): CheckResult {
  switch (criterion.rule) {
    case 'no_ungrounded_urls': {
      // Generic URL grounding runs separately as a hard rule; this
      // criterion mirror lets `successCriteria` advertise the
      // requirement explicitly. Pass-through: rely on the generic
      // check's verdict.
      const generic = checkUrlGrounding(answerText, ledger);
      if (!generic) {
        return {
          criterionId: criterion.id,
          passed: true,
          checker: 'deterministic',
          detail: 'no URLs in answer — vacuously grounded',
        };
      }
      return {
        ...generic,
        criterionId: criterion.id,
      };
    }
    case 'covers_required_inputs': {
      const provided = contract.requiredInputs.filter((r) => r.provided);
      if (provided.length === 0) {
        return {
          criterionId: criterion.id,
          passed: true,
          checker: 'deterministic',
          detail: 'no provided inputs to cover — vacuously satisfied',
        };
      }
      const missing = provided.filter((r) => !answerText.includes(r.name));
      const passed = missing.length === 0;
      return {
        criterionId: criterion.id,
        passed,
        checker: 'deterministic',
        detail: passed
          ? `all ${provided.length} provided inputs surface in answer`
          : `provided inputs missing from answer: ${missing.map((r) => r.name).join(', ')}`,
        severity: passed ? undefined : 'fixable',
      };
    }
    default:
      return {
        criterionId: criterion.id,
        passed: true,
        checker: 'deterministic',
        detail: `unknown custom rule "${criterion.rule}" — deferred to LLM tier`,
      };
  }
}

// ---------------------------------------------------------------------------
// Generic checks (run regardless of explicit criteria)
// ---------------------------------------------------------------------------

/**
 * URL fabrication detector. Scans answer for URLs and matches each
 * against the ledger's grounded set (browser_state + tool_result
 * sources). Returns null when the answer has no URLs at all
 * (vacuously fine — nothing to fabricate).
 */
function checkUrlGrounding(
  answerText: string,
  ledger: EvidenceLedger,
): CheckResult | null {
  const answerUrls = (answerText.match(URL_RE) ?? []).map((u) =>
    u.replace(/[)\].,;:]+$/, ''),
  );
  if (answerUrls.length === 0) return null;
  const grounded = ledger.getGroundedUrls().map((u) =>
    u.replace(/[)\].,;:]+$/, ''),
  );
  const groundedSet = new Set(grounded);
  const fabricated = answerUrls.filter((u) => !groundedSet.has(u));
  const passed = fabricated.length === 0;
  return {
    criterionId: 'generic.url_grounding',
    passed,
    checker: 'deterministic',
    detail: passed
      ? `${answerUrls.length} URL(s) all grounded in ledger`
      : `URL(s) absent from ledger (likely fabricated): ${fabricated.join(', ')}`,
    severity: passed ? undefined : 'fixable',
  };
}

/**
 * Constraint violation scan. Maps Chinese / English constraint
 * strings to canonical keys, then keyword-matches ledger fact
 * text. False positives are possible (e.g. an article that
 * mentions "支付" wouldn't actually be a payment action) — the
 * integration step should write structured violation entries
 * instead of relying on substring matches when feasible.
 */
function checkConstraints(
  constraints: string[],
  ledger: EvidenceLedger,
): CheckResult | null {
  if (constraints.length === 0) return null;
  const canonicalised = new Set<string>();
  for (const c of constraints) {
    const direct = c in CONSTRAINT_CHECKERS ? c : CHINESE_CONSTRAINT_ALIASES[c];
    if (direct) canonicalised.add(direct);
  }
  if (canonicalised.size === 0) {
    return {
      criterionId: 'generic.constraints',
      passed: true,
      checker: 'deterministic',
      detail: `no canonical constraint mapping for [${constraints.join(', ')}] — skipping`,
    };
  }

  const violations: string[] = [];
  for (const e of ledger.entries) {
    // Only audit entries that are about agent actions (tool / browser).
    // user_input / file_parse / inference don't represent the agent
    // doing something forbidden.
    if (e.sourceType !== 'browser_state' && e.sourceType !== 'tool_result') {
      continue;
    }
    for (const key of canonicalised) {
      const checker = CONSTRAINT_CHECKERS[key];
      if (checker && checker(e.fact)) {
        violations.push(`${key}: "${e.fact.slice(0, 80)}"`);
      }
    }
  }
  const passed = violations.length === 0;
  return {
    criterionId: 'generic.constraints',
    passed,
    checker: 'deterministic',
    detail: passed
      ? `no constraint violations across ${canonicalised.size} canonical key(s)`
      : `violations: ${violations.join('; ')}`,
    severity: passed ? undefined : 'hard_fail',
  };
}

/**
 * Number cross-validation for douyin metric triples. If the
 * ledger has the GMV / 订单数 / 客单价 trio (from user_input),
 * verify GMV ≈ 订单数 × 客单价 within tolerance. Same for
 * GMV ≈ UV × 转化率 × 客单价.
 */
function checkNumberCrossValidation(ledger: EvidenceLedger): CheckResult | null {
  const numericFacts = collectNumericFacts(ledger);
  if (numericFacts.size === 0) return null;
  const checks: { ok: boolean; note: string }[] = [];

  const gmv = numericFacts.get('GMV');
  const orders = numericFacts.get('订单数') ?? numericFacts.get('订单');
  const aov = numericFacts.get('客单价');
  const uv = numericFacts.get('UV');
  const conv = numericFacts.get('转化率');

  if (gmv != null && orders != null && aov != null) {
    const expected = orders * aov;
    const ok = withinTolerance(gmv, expected);
    checks.push({
      ok,
      note: `GMV=${gmv} vs 订单数×客单价=${expected.toFixed(0)}${
        ok ? ' ≈' : ' ≠'
      }`,
    });
  }
  if (gmv != null && uv != null && conv != null && aov != null) {
    // 转化率 stored as either 0.03 or 3 (interpreted as percent).
    const ratio = conv > 1 ? conv / 100 : conv;
    const expected = uv * ratio * aov;
    const ok = withinTolerance(gmv, expected);
    checks.push({
      ok,
      note: `GMV=${gmv} vs UV×转化率×客单价=${expected.toFixed(0)}${
        ok ? ' ≈' : ' ≠'
      }`,
    });
  }

  if (checks.length === 0) return null;
  const passed = checks.every((c) => c.ok);
  return {
    criterionId: 'generic.number_cross_check',
    passed,
    checker: 'deterministic',
    detail: passed
      ? `cross-checks ok: ${checks.map((c) => c.note).join('; ')}`
      : `arithmetic mismatch: ${checks.map((c) => c.note).join('; ')}`,
    severity: passed ? undefined : 'needs_clarification',
  };
}

function collectNumericFacts(ledger: EvidenceLedger): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of ledger.entries) {
    if (e.sourceType !== 'user_input' && e.sourceType !== 'file_parse') continue;
    for (const key of KNOWN_NUMERIC_KEYS) {
      // Match `<key> <separator> <number>` where separator is
      // `=`, `:`, whitespace, or `¥`. Number may use comma
      // separators or have a `%` suffix.
      const re = new RegExp(
        `${escapeRegex(key)}\\s*[=:：]?\\s*[¥¥$]?\\s*([0-9]+(?:[.,][0-9]+)?)\\s*[%％]?`,
      );
      const m = e.fact.match(re);
      if (!m) continue;
      const raw = m[1]!.replace(/,/g, '');
      const n = Number(raw);
      if (!Number.isFinite(n)) continue;
      // Don't clobber if we already saw a more interesting value.
      if (!out.has(key) || (n >= MIN_CROSSCHECK_VALUE && (out.get(key) ?? 0) < MIN_CROSSCHECK_VALUE)) {
        out.set(key, n);
      }
    }
  }
  return out;
}

function withinTolerance(a: number, b: number): boolean {
  if (a === 0 && b === 0) return true;
  const denom = Math.max(Math.abs(a), Math.abs(b), 1);
  return Math.abs(a - b) / denom <= CROSS_VALIDATION_TOLERANCE;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// Failure-level classification
// ---------------------------------------------------------------------------

/**
 * Pick the worst severity among failing checks. Order:
 *   hard_fail > needs_clarification > fixable.
 *
 * If a contract has unprovided requiredInputs the verdict
 * becomes needs_clarification regardless (the agent shouldn't
 * be answering yet). Empty answer hard-fails.
 */
function classifyFailureLevel(
  checks: CheckResult[],
  contract: ExecutionContract,
): FailureLevel {
  const unprovidedRequired = contract.requiredInputs.some((r) => !r.provided);
  if (unprovidedRequired) return 'needs_clarification';
  const failed = checks.filter((c) => !c.passed);
  if (failed.some((c) => c.severity === 'hard_fail')) return 'hard_fail';
  if (failed.some((c) => c.severity === 'needs_clarification')) {
    return 'needs_clarification';
  }
  return 'fixable';
}

function buildSuggestion(
  checks: CheckResult[],
  ledger: EvidenceLedger,
): string | undefined {
  const fixable = checks.filter((c) => !c.passed && c.severity === 'fixable');
  if (fixable.length === 0) return undefined;
  const lines = fixable.map((c) => `- ${c.detail}`);
  // For URL fabrication, surface the grounded URL list so the
  // auto-fixer (or the user) has the canonical candidates.
  const urlGround = ledger.getGroundedUrls();
  if (urlGround.length > 0 && fixable.some((c) => c.detail.includes('URL'))) {
    lines.push(`- grounded URLs: ${urlGround.slice(0, 5).join(', ')}`);
  }
  return lines.join('\n');
}
