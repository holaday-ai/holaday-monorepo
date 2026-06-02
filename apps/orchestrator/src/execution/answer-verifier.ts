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
import type { ExpertWorkflowContract } from './expert-workflow-contract.js';

export type FailureLevel = 'fixable' | 'needs_clarification' | 'hard_fail';

export interface CheckResult {
  criterionId: string;
  /**
   * Codex Round 2 P1-6 — machine-readable category for the SPA's
   * VerificationBanner. Covers the structural Pack A1/A2 checkers
   * (`url_count` / `result_count` / `price_sort` / `ecommerce_rows`)
   * plus the generic checkers (`url_grounding` / `empty_result` /
   * `constraints` / `number_cross_check`). When absent, the SPA
   * falls back to the generic banner copy.
   */
  criterionType?: string;
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
  /**
   * Phase 2 Day 4 — when the contract was built from an expert
   * workflow, the pipeline resolves the typed contract from the
   * registry and passes it through. The verifier then runs the
   * workflow-specific section_presence + source_annotation checks.
   * Absent for non-workflow tasks → those checks are skipped
   * entirely (no false positives on translation / browser tasks).
   */
  workflowContract?: ExpertWorkflowContract;
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
  const { contract, ledger, answerText, finalUrl, workflowContract } = inputs;
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

  // 3. Workflow-specific checks (only when an expert workflow drove
  //    this task). Section presence + source annotation. No-op for
  //    every non-workflow task — translation / browser / scrape
  //    tiers never see the workflow contract.
  if (workflowContract) {
    const sectionCheck = checkWorkflowSectionPresence(workflowContract, answerText);
    if (sectionCheck) checks.push(sectionCheck);
    const annotationCheck = checkWorkflowSourceAnnotation(workflowContract, answerText);
    if (annotationCheck) checks.push(annotationCheck);
  }

  // 4. Product-polish #2 — empty-result guard. After stripping
  //    markdown structure (headings, list ordinals, table pipes,
  //    code/format markers, collapsed whitespace), the meaningful
  //    text must be at least 20 chars. Common failure shape: the
  //    model hits max_tokens during a tool loop and the visible
  //    output ends up like "## 报告\n\n1. \n2. \n3.". SPA-side
  //    sanitizer already hints this is empty to the user; the
  //    verifier failure here flags the task as `fixable` so an
  //    eventual autoFix step (or the user retrying via 重试) gets
  //    surfaced cleanly instead of presenting a near-blank card
  //    as a "success".
  const emptyCheck = checkEmptyResult(answerText, contract);
  if (emptyCheck) checks.push(emptyCheck);

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
    case 'url_count':
      return checkUrlCount(criterion, answerText);
    case 'result_count':
      return checkResultCount(criterion, answerText);
    case 'price_sort':
      return checkPriceSort(criterion, answerText);
    case 'ecommerce_rows':
      return checkEcommerceRows(criterion, answerText);
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

// ---------------------------------------------------------------------------
// Codex Pack A2 + Round 2 P1-4 — output-requirement structural checks
// ---------------------------------------------------------------------------

/**
 * Codex Round 2 P1-4 — unified item extractor.
 *
 * Parses the model's answer into a list of {name, price, url, raw}
 * records the structural checkers all share. Strategy in priority:
 *   1. JSON code block (Pack C3 schema): items[] or bare array
 *   2. Markdown table: cell-position-agnostic field detection
 *   3. Numbered list: `1. name ¥price https://url` per line
 *   4. Bullet list: `- text` as a coarse fallback (name only)
 *
 * Returns [] when no shape matches. price/url are nullable per item
 * so the caller can decide what "incomplete" means.
 *
 * Why one extractor: pre-P1-4 each checker had its own line-scanner,
 * which let "说明文字 ¥299 是参考价" leak into price_sort even when
 * the answer had a perfectly-sorted JSON block above. Now price_sort
 * etc. only operate on parsed structured items.
 */
export interface ParsedItem {
  name: string | null;
  price: number | null;
  url: string | null;
  raw: string;
  source: 'json' | 'table' | 'list' | 'bullet';
}

export function extractStructuredItems(answerText: string): ParsedItem[] {
  const jsonItems = tryExtractJsonItems(answerText);
  if (jsonItems.length > 0) return jsonItems;
  const tableItems = tryExtractTableItems(answerText);
  if (tableItems.length > 0) return tableItems;
  const listItems = tryExtractNumberedListItems(answerText);
  if (listItems.length > 0) return listItems;
  const bulletItems = tryExtractBulletItems(answerText);
  if (bulletItems.length > 0) return bulletItems;
  return [];
}

const JSON_BLOCK_RE = /```(?:json)?\s*([\s\S]*?)```/i;

function tryExtractJsonItems(answerText: string): ParsedItem[] {
  const m = answerText.match(JSON_BLOCK_RE);
  if (!m || !m[1]) return [];
  try {
    const parsed = JSON.parse(m[1].trim()) as unknown;
    const items = pickItemsArray(parsed);
    if (!items) return [];
    return items
      .slice(0, 200) // safety cap
      .map((raw): ParsedItem => {
        const obj = (raw ?? {}) as Record<string, unknown>;
        return {
          name: pickString(obj.name),
          price: pickNumber(obj.price),
          url:
            typeof obj.url === 'string' && /^https?:\/\//i.test(obj.url)
              ? obj.url.trim()
              : null,
          raw: JSON.stringify(obj),
          source: 'json',
        };
      });
  } catch {
    return [];
  }
}

function tryExtractTableItems(answerText: string): ParsedItem[] {
  const lines = answerText.split(/\r?\n/);
  const tableRows: string[][] = [];
  let inTable = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!/^\|.*\|$/.test(line)) {
      if (inTable) inTable = false;
      continue;
    }
    if (/^\|[\s|:-]+\|$/.test(line)) {
      inTable = true;
      continue;
    }
    if (!inTable) continue;
    tableRows.push(
      line
        .slice(1, -1)
        .split('|')
        .map((c) => c.trim()),
    );
  }
  return tableRows.map((cells): ParsedItem => {
    let name: string | null = null;
    let price: number | null = null;
    let url: string | null = null;
    for (const cell of cells) {
      const c = cell.trim();
      if (!c) continue;
      if (!url) {
        const found = extractUrlFromCell(c);
        if (found) {
          url = found;
          continue;
        }
      }
      if (price == null) {
        const parsedPrice = parsePriceText(c);
        if (parsedPrice != null) {
          price = parsedPrice;
          continue;
        }
      }
      if (!name || c.length > name.length) name = c;
    }
    return { name, price, url, raw: cells.join(' | '), source: 'table' };
  });
}

const NUMBERED_LIST_RE = /^\s*\d+[.、)]\s+(.+)$/;

function tryExtractNumberedListItems(answerText: string): ParsedItem[] {
  const lines = answerText.split(/\r?\n/);
  const items: ParsedItem[] = [];
  for (const raw of lines) {
    const m = raw.match(NUMBERED_LIST_RE);
    if (!m || !m[1]) continue;
    const body = m[1].trim();
    const url = extractUrlFromCell(body);
    const price = parsePriceText(body);
    let name: string | null = body;
    if (url) name = name.replace(url, '').trim();
    // Strip the price token off the name with a separate parse so
    // dropping ¥ doesn't catch random digits embedded in the name.
    const priceMatch = body.match(
      /[¥￥$]\s*[0-9]+(?:,[0-9]{3})*(?:\.[0-9]+)?|[0-9]+(?:,[0-9]{3})*(?:\.[0-9]+)?\s*(?:元|RMB|人民币)/i,
    );
    if (priceMatch) name = name.replace(priceMatch[0], '').trim();
    // Trim residual punctuation (separators between fields).
    name = name.replace(/^[—\-·,，:：、\s]+|[—\-·,，:：、\s]+$/g, '').trim();
    items.push({
      name: name || null,
      price,
      url,
      raw: body,
      source: 'list',
    });
  }
  return items;
}

const BULLET_LIST_RE = /^\s*[-*+]\s+(.+)$/;

function tryExtractBulletItems(answerText: string): ParsedItem[] {
  const lines = answerText.split(/\r?\n/);
  const items: ParsedItem[] = [];
  for (const raw of lines) {
    const m = raw.match(BULLET_LIST_RE);
    if (!m || !m[1]) continue;
    const body = m[1].trim();
    if (!body) continue;
    items.push({
      name: body,
      price: parsePriceText(body),
      url: extractUrlFromCell(body),
      raw: body,
      source: 'bullet',
    });
  }
  return items;
}

function pickItemsArray(parsed: unknown): unknown[] | null {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === 'object') {
    const items = (parsed as { items?: unknown }).items;
    if (Array.isArray(items)) return items;
    const candidates = (parsed as { candidates?: unknown }).candidates;
    if (Array.isArray(candidates)) return candidates;
  }
  return null;
}

function pickString(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s ? s : null;
}

function pickNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') return parsePriceText(v);
  return null;
}

function parsePriceText(s: string): number | null {
  const m = s.match(
    /[¥￥$]\s*([0-9]+(?:,[0-9]{3})*(?:\.[0-9]+)?)|([0-9]+(?:,[0-9]{3})*(?:\.[0-9]+)?)\s*(?:元|RMB|人民币)/i,
  );
  if (!m) return null;
  const raw = (m[1] ?? m[2] ?? '').replace(/,/g, '');
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function extractUrlFromCell(c: string): string | null {
  const md = c.match(/\[[^\]]+\]\((https?:\/\/[^)]+)\)/);
  if (md && md[1]) return md[1];
  const direct = c.match(/https?:\/\/\S+/);
  if (direct) return direct[0].replace(/[)\].,;:]+$/, '');
  return null;
}

/**
 * url_count — assert the answer has at least `data.min` URLs.
 * Codex Round 2 P1-4: prefer ParsedItem[].url when items are
 * available; fall back to a global URL scan only when the answer
 * doesn't parse as structured (e.g. stock_quote responses that come
 * back as prose with a citation). Stops "京东 Apple 自营旗舰店"-as-
 * bare-text from satisfying the criterion just because the prose
 * happened to embed an unrelated URL elsewhere.
 *
 * Soft (fixable) failure: lets the verifier downgrade the verdict
 * to partial_success rather than blocking.
 */
function checkUrlCount(
  criterion: SuccessCriterion,
  answerText: string,
): CheckResult {
  const min = Number(criterion.data?.min ?? 1);
  const items = extractStructuredItems(answerText);
  const itemUrls = items.map((it) => it.url).filter((u): u is string => Boolean(u));
  // Fall back to global URL count only when no items parsed at all
  // (stock_quote / comparison responses that are mostly prose).
  const count =
    items.length === 0 ? (answerText.match(URL_RE) ?? []).length : itemUrls.length;
  const passed = count >= min;
  return {
    criterionId: criterion.id,
    criterionType: 'url_count',
    passed,
    checker: 'deterministic',
    detail: passed
      ? `${count} URL(s) found (${items.length === 0 ? 'global scan' : 'parsed items'}), min ${min}`
      : `only ${count} URL(s) found (${items.length === 0 ? 'global scan' : 'parsed items'}), need at least ${min}`,
    severity: passed ? undefined : 'fixable',
  };
}

/**
 * result_count — count parsed structured items. Codex Round 2 P1-4
 * folds the prior numbered/bullet/table heuristics into a single
 * extractor; this checker just reads its output.
 */
function checkResultCount(
  criterion: SuccessCriterion,
  answerText: string,
): CheckResult {
  const min = Number(criterion.data?.min ?? 1);
  const items = extractStructuredItems(answerText);
  const count = items.length;
  const passed = count >= min;
  return {
    criterionId: criterion.id,
    criterionType: 'result_count',
    passed,
    checker: 'deterministic',
    detail: passed
      ? `${count} structured item(s) found (${items[0]?.source ?? 'mixed'}), min ${min}`
      : `only ${count} structured item(s), need at least ${min}`,
    severity: passed ? undefined : 'fixable',
  };
}

/**
 * price_sort — validate monotonic asc/desc over the parsed items'
 * `price` field only. Codex Round 2 P1-4: no more whole-text scan,
 * so a "建议预算 ¥2,000 起" sentence above the listing doesn't
 * poison the ordering verdict.
 *
 * < 2 prices = vacuous pass (result_count handles "not enough rows").
 * Non-strict monotonic — ties allowed for identical prices.
 */
function checkPriceSort(
  criterion: SuccessCriterion,
  answerText: string,
): CheckResult {
  const direction = (criterion.data?.direction as 'asc' | 'desc' | undefined) ?? 'asc';
  const items = extractStructuredItems(answerText);
  const prices = items
    .map((it) => it.price)
    .filter((p): p is number => p != null && p > 0);
  if (prices.length < 2) {
    return {
      criterionId: criterion.id,
      criterionType: 'price_sort',
      passed: true,
      checker: 'deterministic',
      detail: `only ${prices.length} structured price(s) parsed — vacuously sorted`,
    };
  }
  let violation: { i: number; prev: number; cur: number } | null = null;
  for (let i = 1; i < prices.length; i++) {
    const prev = prices[i - 1]!;
    const cur = prices[i]!;
    if (direction === 'asc' && cur < prev) {
      violation = { i, prev, cur };
      break;
    }
    if (direction === 'desc' && cur > prev) {
      violation = { i, prev, cur };
      break;
    }
  }
  const passed = violation === null;
  return {
    criterionId: criterion.id,
    criterionType: 'price_sort',
    passed,
    checker: 'deterministic',
    detail: passed
      ? `${prices.length} structured prices in ${direction} order: ${prices.slice(0, 8).join(', ')}${
          prices.length > 8 ? '…' : ''
        }`
      : `${direction} order broken at position ${violation!.i}: ${violation!.prev} → ${violation!.cur}`,
    severity: passed ? undefined : 'fixable',
  };
}

// ---------------------------------------------------------------------------
// Codex Round 2 P0-2 + P1-4 — per-row ecommerce schema check
// ---------------------------------------------------------------------------

/**
 * Codex Round 2 P1-4 — rewritten on top of the unified
 * `extractStructuredItems` so the same parser feeds url_count /
 * result_count / price_sort / ecommerce_rows. JSON-block answers,
 * markdown tables, and numbered/bullet lists all flow through the
 * single pipeline; row-level "第 N 行缺少..." copy survives.
 *
 * Skips bullet-source items when auditing (bullet lines rarely have
 * full {name, price, url} triples and were never the target shape
 * for ecommerce listings).
 */
function checkEcommerceRows(
  criterion: SuccessCriterion,
  answerText: string,
): CheckResult {
  const minItems = Number(criterion.data?.minItems ?? 0);
  const allItems = extractStructuredItems(answerText);
  const rows = allItems.filter((it) => it.source !== 'bullet');
  if (rows.length === 0) {
    return {
      criterionId: criterion.id,
      criterionType: 'ecommerce_rows',
      passed: false,
      checker: 'deterministic',
      detail: '未能从回复中解析出结构化的商品列表（应当是 JSON 块、markdown 表格或 1. 2. 3. 编号列表）',
      severity: 'fixable',
    };
  }
  const incomplete: string[] = [];
  rows.forEach((row, i) => {
    const missing: string[] = [];
    if (!row.name) missing.push('名称');
    if (row.price == null) missing.push('价格');
    if (!row.url) missing.push('链接');
    if (missing.length > 0) {
      incomplete.push(`第 ${i + 1} 行缺少${missing.join('、')}`);
    }
  });
  const tooFew = rows.length < minItems;
  const passed = incomplete.length === 0 && !tooFew;
  const detailParts: string[] = [];
  if (tooFew) detailParts.push(`只解析到 ${rows.length} 行，要求至少 ${minItems} 条`);
  if (incomplete.length > 0) detailParts.push(incomplete.join('；'));
  return {
    criterionId: criterion.id,
    criterionType: 'ecommerce_rows',
    passed,
    checker: 'deterministic',
    detail: passed
      ? `已解析 ${rows.length} 条商品（${rows[0]!.source}），均包含名称、价格、链接`
      : detailParts.join('；'),
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
/**
 * Product-polish #2 — empty-result check.
 *
 * Strips markdown structure (headings, list ordinals, table pipes,
 * code/format markers, whitespace) and counts the remaining
 * characters. Anything below 20 = the visible card is effectively
 * empty (model hit max_tokens, post-check ate everything, tool
 * loop never produced a final synthesis). Returns a `'fixable'`
 * failure so the integration step + future autoFix can re-attempt;
 * also lets `failureLevel` classification flip the task off the
 * "completed" path so the user doesn't see a near-blank result
 * card as "success".
 *
 * Returns null when the answer is long enough — the check is a
 * floor, not a ceiling.
 */
function checkEmptyResult(
  answerText: string,
  contract: ExecutionContract,
): CheckResult | null {
  // BUG-A2 fix (2026-05-20): bypass the empty-result check when the
  // original (un-sanitized) answer is substantial (>200 non-whitespace
  // chars). The sanitization regex strips full header lines, ordinals,
  // bullet markers, and table pipes — on long structured Chinese
  // markdown reports this over-eats and trips the 20-char floor on
  // answers users would consider rich. 200 is generous enough that a
  // genuinely empty model output (single-line stub / pure ordinals)
  // can't hit it. Keep the existing 20-char meaningful check as the
  // floor for short answers where the original failure mode lives.
  const originalContentLen = answerText.replace(/\s/g, '').length;
  if (originalContentLen >= 200) return null;
  const meaningful = answerText
    .replace(/^#{1,6}\s+.*$/gm, '')
    .replace(/^[-*]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/[|`*_>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  // Two-part guard: at least 20 chars AND at least one
  // alphanumeric / CJK content character. Pure-ordinal markdown like
  // "## 报告\n1. \n2. " sanitizes to empty + fails. Empty tables like
  // "| a | b |\n|---|---|\n" also sanitize to empty. The 20-char
  // floor matches the SPA-side fallback in TaskStream so the user
  // never sees a near-empty result card; a one-line "搜索完成" stub
  // also flags now so 自动 retry / 追问 can intervene before we
  // call the task completed.
  const hasContentChars =
    /[A-Za-z0-9一-鿿぀-ゟ゠-ヿ]/.test(meaningful);
  if (
    allowsConciseFactAnswer(contract) &&
    meaningful.length >= 3 &&
    hasContentChars
  ) {
    return null;
  }
  if (meaningful.length >= 20 && hasContentChars) return null;
  return {
    criterionId: 'generic.empty_result',
    passed: false,
    checker: 'deterministic',
    detail: `meaningful answer length ${meaningful.length}, hasContentChars=${hasContentChars} — output looks empty after sanitization`,
    severity: 'fixable',
  };
}

function allowsConciseFactAnswer(contract: ExecutionContract): boolean {
  if (contract.tier !== 'light') return false;
  const goal = contract.goal.toLowerCase();
  const asksForConciseAnswer =
    /只(回复|回答|输出)|仅(回复|回答|输出)|直接(回复|回答|输出)|only\s+(reply|answer|return|output)|just\s+(reply|answer|return|output)/i.test(
      goal,
    );
  const asksForSingleFact =
    /标题|title|是什么|what\s+is|页面名|名称|name|读取.*(标题|title|文本|text)|提取.*(标题|title|文本|text|名称|name)/i.test(
      goal,
    );
  const asksForLongForm =
    /报告|总结|分析|对比|列表|清单|多(个|条)|前\s*\d+|top\s*\d+|report|summary|analysis|compare|list/i.test(
      goal,
    );
  return (asksForConciseAnswer || asksForSingleFact) && !asksForLongForm;
}

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
// Workflow-specific checks (Phase 2 Day 4)
// ---------------------------------------------------------------------------

/**
 * Source-annotation markers the workflow report prompt pins. The
 * verifier only requires that AT LEAST ONE of these markers appears
 * inside a section that demanded annotation. Stricter counting
 * belongs in the LLM tier because it is too noisy for deterministic.
 */
const SOURCE_ANNOTATION_MARKERS = [
  '[用户提供]',
  '[系统计算]',
  '[模型假设]',
  '[外部来源]',
] as const;
const LEGACY_SOURCE_ANNOTATION_MARKERS = [
  '\u{1F7E2}',
  '\u{1F535}',
  '\u{1F7E1}',
  '\u{1F534}',
] as const;

/**
 * Strip decorative symbols + leading/trailing whitespace so a titled
 * section still matches if a model adds or removes visual markers. The
 * goal is forgiving title comparison — the model will sometimes
 * drop the leading icon, sometimes restate it differently. The
 * core noun phrase is the load-bearing identifier.
 *
 * Range covered: BMP decorative symbol block + the supplementary ranges that
 * codepoint-aware regex keeps the list broad without naming every symbol.
 */
function normaliseSectionTitle(s: string): string {
  return (
    s
      .replace(/\p{Extended_Pictographic}/gu, '')
      // Variation selector (U+FE0F) often follows decorative symbols.
      .replace(/\uFE0F/g, '')
      .replace(/\s+/g, '')
      .trim()
  );
}

/**
 * Locate the slice of `text` that belongs to a section identified
 * by `title`. Two-pass approach:
 *   1. find the title using normalised comparison (forgiving — ignores
 *      decorative marker + whitespace differences in the model's heading style)
 *   2. return the body from the ORIGINAL text so source-annotation
 *      markers survive for the annotation check
 *
 * Returns null when the title isn't found at all.
 */
function extractSectionBody(
  text: string,
  title: string,
  allTitles: readonly string[],
): string | null {
  const titleCore = normaliseSectionTitle(title);
  if (titleCore.length === 0) return null;

  const startIdx = findNormalisedIndex(text, titleCore, 0);
  if (startIdx === -1) return null;

  // Skip past the original characters that contributed to the
  // matched title. Original text may have extra decorative markers or spaces
  // between the core characters, so probe forward until we've
  // consumed enough normalised chars.
  let bodyStart = startIdx;
  let collected = 0;
  while (bodyStart < text.length && collected < titleCore.length) {
    if (normaliseSectionTitle(text[bodyStart]!).length > 0) collected++;
    bodyStart++;
  }

  let endIdx = text.length;
  for (const other of allTitles) {
    if (other === title) continue;
    const otherCore = normaliseSectionTitle(other);
    if (otherCore.length === 0) continue;
    const idx = findNormalisedIndex(text, otherCore, bodyStart);
    if (idx !== -1 && idx < endIdx) endIdx = idx;
  }
  return text.slice(bodyStart, endIdx);
}

/**
 * Find the first index in `text` (original — marker + whitespace
 * intact) where the normalised suffix starts with `needleCore`
 * (already normalised). Returns -1 if no match. Quadratic worst
 * case but inputs are short.
 */
function findNormalisedIndex(
  text: string,
  needleCore: string,
  fromIdx: number,
): number {
  if (needleCore.length === 0) return -1;
  for (let i = fromIdx; i < text.length; i++) {
    let collected = '';
    let j = i;
    while (j < text.length && collected.length < needleCore.length) {
      collected += normaliseSectionTitle(text[j]!);
      j++;
    }
    if (collected.startsWith(needleCore)) return i;
  }
  return -1;
}

/**
 * Section-presence check. For every required `ReportSection`,
 * confirm its title (or the title minus marker/whitespace) appears
 * in the answer text. Missing required sections → fixable failure
 * so autoFix can re-prompt the model to fill the gap. Optional
 * sections being absent never fails.
 *
 * Returns null when the workflow defines zero required sections —
 * defensive, can't reach with the current douyin-review contract
 * but keeps the function pure.
 */
function checkWorkflowSectionPresence(
  workflow: ExpertWorkflowContract,
  answerText: string,
): CheckResult | null {
  const required = workflow.reportSections.filter((s) => s.required);
  if (required.length === 0) return null;
  const normalisedAnswer = normaliseSectionTitle(answerText);
  const missing = required.filter(
    (s) => !normalisedAnswer.includes(normaliseSectionTitle(s.title)),
  );
  const passed = missing.length === 0;
  return {
    criterionId: 'workflow.section_presence',
    passed,
    checker: 'deterministic',
    detail: passed
      ? `all ${required.length} required sections present`
      : `missing required sections: ${missing.map((s) => s.title).join('、')}`,
    severity: passed ? undefined : 'fixable',
  };
}

/**
 * Source-annotation check. For every section flagged
 * `sourceAnnotation: true`, confirm at least one source annotation
 * appears inside that section's body. A required
 * section that's missing entirely is already caught by
 * section_presence — here we vacuous-pass so we don't double-fail.
 * An optional section that's missing is also vacuous-pass.
 *
 * Failure → fixable: autoFix can prompt the model to add source
 * markers without regenerating the whole report. Returns null
 * when no section requires annotation (some workflows might not).
 */
function checkWorkflowSourceAnnotation(
  workflow: ExpertWorkflowContract,
  answerText: string,
): CheckResult | null {
  const annotated = workflow.reportSections.filter((s) => s.sourceAnnotation);
  if (annotated.length === 0) return null;
  const allTitles = workflow.reportSections.map((s) => s.title);
  const unannotated: string[] = [];
  for (const section of annotated) {
    const body = extractSectionBody(answerText, section.title, allTitles);
    if (body == null) {
      // Section absent. If it was required, section_presence will
      // already have flagged it; here we skip silently so we don't
      // double-count. If optional, also skip — annotation only
      // matters when the section exists.
      continue;
    }
    const hasAny = [...SOURCE_ANNOTATION_MARKERS, ...LEGACY_SOURCE_ANNOTATION_MARKERS].some((marker) =>
      body.includes(marker),
    );
    if (!hasAny) unannotated.push(section.title);
  }
  const passed = unannotated.length === 0;
  return {
    criterionId: 'workflow.source_annotation',
    passed,
    checker: 'deterministic',
    detail: passed
      ? 'all annotated sections include source markers'
      : `sections missing source markers: ${unannotated.join('、')}`,
    severity: passed ? undefined : 'fixable',
  };
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
