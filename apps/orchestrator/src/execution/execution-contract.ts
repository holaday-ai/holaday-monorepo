/**
 * Phase 1 — Execution contract.
 *
 * Generated at the front of every task. Captures: what's the goal,
 * what counts as success, what's forbidden, what inputs we still
 * need, and what the runtime envelope is (timeout / step cap).
 *
 * Three tiers, picked from execution-mode + expert-workflow signal:
 *   - full      → expert-workflow tasks (complex domain reviews).
 *                 Currently template-driven; the LLM-driven variant
 *                 lands in the integration step.
 *   - light     → browser tasks. Template + url-resolver output.
 *   - checklist → generate / scrape tasks. Pure template, 0 LLM cost.
 *
 * The contract is an INPUT to the verifier, not a runtime instruction
 * to the agent. The agent doesn't read it — it executes whatever the
 * intent says, and the verifier compares the result against the
 * contract afterwards.
 */
import { randomUUID } from 'node:crypto';
import { isResearchOrRetrievalIntent as isSharedResearchOrRetrievalIntent } from '@holaday/shared-types';
import { classifyLightweightTask } from './lightweight-task.js';

export type ContractTier = 'full' | 'light' | 'checklist';

export type ExpectedOutputType = 'text' | 'file' | 'action' | 'data';

export type CriterionType =
  | 'url_match'
  | 'data_present'
  | 'file_exists'
  | 'field_count'
  | 'word_count'
  | 'url_count'
  | 'result_count'
  | 'price_sort'
  // Codex Round 2 P0-2 — per-row schema check for ecommerce listings.
  // Stricter than url_count: a result that mentions a platform name
  // as bare text ("京东 Apple 自营旗舰店") used to satisfy url_count
  // (no URL present at all) without ever being caught. The row-level
  // checker parses the answer as JSON-block-first → markdown-table
  // fallback and audits each row for name + price + url presence.
  | 'ecommerce_rows'
  | 'custom';

/**
 * Codex Pack A1 — intent-driven output requirements.
 *
 * Detected at contract-build time from the user's intent. Each kind
 * contributes typed success criteria the verifier checks post-run.
 * Conservative keyword matching: a STRONG signal (e.g. "股价",
 * "前 5", "对比", "来源") attaches a requirement; weak signals stay
 * in the general fallback so we don't fail tasks that didn't ask
 * for the structure we'd otherwise enforce.
 */
export type IntentKind =
  | 'stock_quote'
  | 'ecommerce_listing'
  | 'comparison'
  | 'general_with_links'
  | 'general';

export interface OutputRequirementStock {
  kind: 'stock';
}

export interface OutputRequirementEcommerce {
  kind: 'ecommerce';
  /** Minimum number of items the result must enumerate. */
  minItems: number;
  /** Required price ordering, or null when the user did not specify. */
  sortOrder: 'asc' | 'desc' | null;
}

export interface OutputRequirementComparison {
  kind: 'comparison';
  minCandidates: number;
  minUrls: number;
}

export interface OutputRequirementGeneralLinks {
  kind: 'general_with_links';
  minUrls: number;
}

export type OutputRequirement =
  | OutputRequirementStock
  | OutputRequirementEcommerce
  | OutputRequirementComparison
  | OutputRequirementGeneralLinks;

export interface SuccessCriterion {
  id: string;
  type: CriterionType;
  description: string;
  /**
   * Optional rule expression. Currently only used by the
   * deterministic verifier as a hint — callers can persist it for
   * later LLM-driven evaluation. Keep simple (string compare /
   * number compare); never `eval()` raw user input.
   */
  rule?: string;
  /**
   * Tier-specific data the criterion needs at evaluation time.
   * Examples:
   *   url_match     → { domain: 'example.com' }
   *   word_count    → { min: 50, max: 5000 }
   *   field_count   → { fields: ['GMV', '订单数', '客单价'] }
   *   file_exists   → { absPath: '/opt/holaday-files/...' }
   * Stays unstructured here so new criteria don't force a schema
   * change; the verifier validates per-type.
   */
  data?: Record<string, unknown>;
}

export interface RequiredInput {
  name: string;
  description: string;
  provided: boolean;
}

export interface ExecutionContract {
  taskId: string;
  tier: ContractTier;
  goal: string;
  expectedOutputType: ExpectedOutputType;
  successCriteria: SuccessCriterion[];
  constraints: string[];
  requiredInputs: RequiredInput[];
  timeout: number; // seconds
  maxSteps: number;
  createdAt: string; // ISO
  /**
   * Phase 2 Day 4 — pass-through of the matched expert workflow id
   * (`douyin-review` etc.). Set only on full-tier contracts. The
   * verifier reads this to look up the typed workflow from the
   * registry and run section-presence / source-annotation checks
   * against the model's report. Null on non-workflow tiers.
   */
  expertWorkflowId?: string | null;
  /** Explicit task-level mode. `expert` promotes even a generic task
   * to the full quality contract so post-run verification is not skipped. */
  expertMode?: 'normal' | 'expert' | 'auto';
  /**
   * Codex Pack A1 — intent classification + typed output requirement
   * stamped at build time. Null when the intent didn't carry a
   * strong signal (default keyword conservatism). The verifier reads
   * this to know which structural checks to enforce and how to
   * phrase failure detail.
   */
  intentKind?: IntentKind;
  outputRequirement?: OutputRequirement | null;
}

export interface ContractInputs {
  taskId: string;
  intent: string;
  executionMode: 'browser' | 'generate' | 'scrape';
  /** When non-null, an expert workflow ID was matched → tier='full'. */
  expertWorkflowId?: string | null;
  expertMode?: 'normal' | 'expert' | 'auto';
  /**
   * For browser tasks the url-resolver figured out which domain
   * the agent will visit. The verifier uses this to ground the
   * `url_match` criterion. For generate/scrape this is undefined.
   */
  targetDomain?: string;
  /**
   * Whether the user has provided enough data to answer
   * meaningfully. For expert workflows this maps to the
   * matchExpertWorkflow().missingInputs check. The contract
   * surfaces missing inputs but doesn't block — that's the
   * intake gate's job.
   */
  requiredInputs?: RequiredInput[];
  /**
   * Free-form constraint strings (BOSS spec). Kept loose so we
   * don't have to invent a structured DSL on day one. The
   * verifier matches by substring against ledger facts; a
   * follow-up phase can move to a tagged enum once we see what
   * patterns recur.
   */
  constraints?: string[];
  /**
   * Phase 1 follow-up — whether the user's request came with file
   * attachments. Used to differentiate "short translation / Q&A"
   * (low word_count threshold) from "short prompt + attachments
   * = analyze the data you uploaded" (regular threshold).
   */
  hasAttachments?: boolean;
}

const DEFAULT_TIMEOUTS = {
  full: 300,
  light: 120,
  checklist: 60,
} as const;

const DEFAULT_MAX_STEPS = {
  full: 30,
  light: 15,
  checklist: 1,
} as const;

const newCriterionId = (): string => randomUUID();

/**
 * Pure-function entrypoint. Synchronous; no LLM call. The
 * "full" tier currently emits the same template a future
 * LLM-augmented variant would produce — landing the LLM call
 * is part of the integration step where we can budget for it.
 *
 * Codex Pack A1: after the tier-specific build, classify the
 * intent and attach typed output-requirement criteria (url_count
 * / result_count / price_sort) on top. This is purely additive —
 * tier criteria stay; the requirement layer adds structural
 * checks the verifier can run without LLM cost.
 */
export function buildContract(inputs: ContractInputs): ExecutionContract {
  const tier = pickTier(inputs);
  const builders: Record<ContractTier, (i: ContractInputs) => ExecutionContract> = {
    full: buildFullTier,
    light: buildLightTier,
    checklist: buildChecklistTier,
  };
  const base = builders[tier](inputs);
  const { kind, requirement } = classifyIntentForOutputRequirement(inputs.intent);
  base.intentKind = kind;
  base.outputRequirement = requirement;
  if (requirement) {
    base.successCriteria.push(...criteriaForRequirement(requirement));
  }
  return base;
}

/**
 * Codex Pack A1 — keyword-based intent classifier.
 *
 * Strong-signal only: a clear stock/ecommerce/comparison cue
 * attaches a requirement. Vague phrasing (e.g. "推荐手机" with
 * no price or sort keywords) stays `general` so the verifier
 * doesn't fail tasks the user never asked to structure. False
 * positives here become spurious verifier failures, so we err
 * on the side of "no requirement" when the signal is fuzzy.
 *
 * Pure function. No LLM call. Cheap to invoke per task.
 */
export function classifyIntentForOutputRequirement(intent: string): {
  kind: IntentKind;
  requirement: OutputRequirement | null;
} {
  const text = intent;
  const explicitLinkRequest = /链接|来源|引用|参考链接|参考资料|出处|reference|source\s+url|cite|引用链接/i.test(text);
  const researchOrRetrievalIntent = isResearchOrRetrievalIntent(text);

  // Stock — explicit market-data phrasing. "价格" alone is too broad
  // (matches ecommerce too), so require co-occurrence with "股".
  if (/股价|股票.*价|stock\s+(price|quote)|股市.*价/i.test(text)) {
    return { kind: 'stock_quote', requirement: { kind: 'stock' } };
  }

  // E-commerce listing — at least one product-list cue AND either a
  // count signal or a price/sort signal.
  const ecomCue = /商品|榜单|排行|淘宝|天猫|京东|拼多多|电商|amazon|亚马逊|sku|商城|网购/i.test(
    text,
  );
  const minItems = inferRequestedItemCount(text);
  const sortAsc = /价格\s*(升序|从低到高|低到高|排序|排列)|按价格(排序|排列|升序)|便宜.*前|最便宜/i.test(
    text,
  );
  const sortDesc = /价格\s*(降序|从高到低|高到低)|按价格降序|最贵/i.test(text);
  const priceCue = /价格|价钱|报价|售价|price/i.test(text);
  if (ecomCue && (Number.isFinite(minItems) || sortAsc || sortDesc || priceCue)) {
    return {
      kind: 'ecommerce_listing',
      requirement: {
        kind: 'ecommerce',
        minItems: Number.isFinite(minItems) && minItems >= 1 ? minItems : 5,
        sortOrder: sortAsc ? 'asc' : sortDesc ? 'desc' : null,
      },
    };
  }

  // Comparison — explicit comparison cue. "vs" / "对比" / "哪个好".
  if (/对比|比较|对照|\bvs\.?\b|哪个(更)?(好|强|划算)|二选一|怎么选/i.test(text)) {
    const minCandidates = inferRequestedItemCount(text);
    return {
      kind: 'comparison',
      requirement: {
        kind: 'comparison',
        minCandidates: Number.isFinite(minCandidates) && minCandidates >= 2 ? minCandidates : 2,
        minUrls: explicitLinkRequest
          ? Number.isFinite(minCandidates) && minCandidates >= 2
            ? minCandidates
            : 1
          : 1,
      },
    };
  }

  // Research and retrieval results need at least one clickable source
  // to remain completed. This is only a zero-source structural guard;
  // it does not claim that a URL verifies every fact in the answer.
  if (explicitLinkRequest || researchOrRetrievalIntent) {
    return {
      kind: 'general_with_links',
      requirement: { kind: 'general_with_links', minUrls: 1 },
    };
  }

  return { kind: 'general', requirement: null };
}

export function isResearchOrRetrievalIntent(intent: string): boolean {
  return isSharedResearchOrRetrievalIntent(intent);
}

function inferRequestedItemCount(text: string): number {
  const numeric = text.match(
    /前\s*(\d+)|top\s*(\d+)|(\d+)\s*(?:个平台|个方案|个|款|条|家|项|种|平台|方案)/i,
  );
  if (numeric) {
    const value = Number(numeric[1] ?? numeric[2] ?? numeric[3]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  const chinese = text.match(
    /([一二两三四五六七八九十])\s*(?:个平台|个方案|个|款|条|家|项|种|平台|方案)/,
  );
  if (chinese?.[1]) {
    const value = parseChineseSmallNumber(chinese[1]);
    if (value > 0) return value;
  }
  return NaN;
}

function parseChineseSmallNumber(raw: string): number {
  const map: Record<string, number> = {
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
  };
  return map[raw] ?? NaN;
}

/**
 * Codex Pack C3 — JSON schema suffix appended to the runner's system
 * prompt when the intent matches a known kind. Tells the model what
 * structure to produce + how to flag missing fields (null), without
 * forcing a JSON-only response (it can still wrap the JSON block in
 * a prose explanation — the verifier just looks for the block).
 *
 * Pure function, no LLM call. Returns empty string for `general`
 * intents so the prompt isn't bloated for tasks that don't need
 * structured output.
 */
export function buildPromptSchemaSuffix(intent: string): string {
  const { kind } = classifyIntentForOutputRequirement(intent);
  const schema = INTENT_OUTPUT_SCHEMAS[kind];
  if (!schema) return '';
  return [
    '',
    '请按以下 JSON 格式输出结果（可放在 markdown 代码块里，前后可附简短说明）：',
    '```json',
    schema,
    '```',
    '如果无法获取某个字段，标为 null（不要省略字段）。',
  ].join('\n');
}

const INTENT_OUTPUT_SCHEMAS: Partial<Record<IntentKind, string>> = {
  stock_quote: JSON.stringify(
    {
      symbol: 'string',
      price: 'number',
      change: 'number | null',
      change_pct: 'number | null',
      market_time: 'ISO datetime string',
      source_url: 'string',
    },
    null,
    2,
  ),
  ecommerce_listing: JSON.stringify(
    {
      query: 'string',
      sort_by: "'price_asc' | 'price_desc' | 'relevance'",
      items: [
        {
          rank: 'number',
          name: 'string',
          price: 'number',
          url: 'string',
          platform: 'string',
        },
      ],
    },
    null,
    2,
  ),
  comparison: JSON.stringify(
    {
      candidates: [
        {
          name: 'string',
          pros: ['string'],
          cons: ['string'],
        },
      ],
      recommendation: 'string',
      rationale: 'string',
      sources: ['string (URL)'],
    },
    null,
    2,
  ),
  general_with_links: JSON.stringify(
    {
      answer: 'string',
      sources: ['string (URL)'],
    },
    null,
    2,
  ),
};

/**
 * Codex Pack A1 — convert a typed `OutputRequirement` into the
 * `SuccessCriterion[]` the verifier consumes. Each requirement
 * kind emits the structural checks the verifier dispatches
 * (url_count / result_count / price_sort).
 */
function criteriaForRequirement(req: OutputRequirement): SuccessCriterion[] {
  switch (req.kind) {
    case 'stock':
      return [
        {
          id: newCriterionId(),
          type: 'url_count',
          description: '股价回复必须附带至少 1 个来源 URL（行情页 / 财经站）',
          data: { min: 1 },
        },
        {
          id: newCriterionId(),
          type: 'field_count',
          description: '股价回复必须包含价格与时间戳字段',
          data: { fields: ['价格', '时间'] },
        },
      ];
    case 'ecommerce': {
      // Codex Round 2 P0-2 — drop `url_count` for ecommerce in favour
      // of `ecommerce_rows`. The row check audits each item for
      // {name, price, url} together so a result with platform names
      // as bare text instead of links no longer slips past.
      const criteria: SuccessCriterion[] = [
        {
          id: newCriterionId(),
          type: 'result_count',
          description: `结构化结果至少 ${req.minItems} 条`,
          data: { min: req.minItems },
        },
        {
          id: newCriterionId(),
          type: 'ecommerce_rows',
          description: `每行商品必须同时包含名称、价格、链接（至少 ${req.minItems} 条，尽量每行独立商品链接）`,
          data: { minItems: req.minItems, minUniqueUrls: req.minItems },
        },
      ];
      if (req.sortOrder) {
        criteria.push({
          id: newCriterionId(),
          type: 'price_sort',
          description: `价格按 ${req.sortOrder === 'asc' ? '升序' : '降序'} 排列`,
          data: { direction: req.sortOrder },
        });
      }
      return criteria;
    }
    case 'comparison':
      return [
        {
          id: newCriterionId(),
          type: 'result_count',
          description: `至少给出 ${req.minCandidates} 个候选`,
          data: { min: req.minCandidates },
        },
        {
          id: newCriterionId(),
          type: 'url_count',
          description: `对比结论必须附带至少 ${req.minUrls} 个来源 URL`,
          data: { min: req.minUrls },
        },
      ];
    case 'general_with_links':
      return [
        {
          id: newCriterionId(),
          type: 'url_count',
          description: `回复必须包含至少 ${req.minUrls} 个来源链接`,
          data: { min: req.minUrls },
        },
      ];
  }
}

function pickTier(i: ContractInputs): ContractTier {
  if (i.expertWorkflowId || i.expertMode === 'expert') return 'full';
  if (i.executionMode === 'browser') return 'light';
  return 'checklist';
}

function commonHeader(
  inputs: ContractInputs,
  tier: ContractTier,
  expectedOutputType: ExpectedOutputType,
): Pick<
  ExecutionContract,
  | 'taskId'
  | 'tier'
  | 'goal'
  | 'expectedOutputType'
  | 'createdAt'
  | 'requiredInputs'
  | 'timeout'
  | 'maxSteps'
  | 'expertMode'
> {
  return {
    taskId: inputs.taskId,
    tier,
    goal: summariseIntent(inputs.intent),
    expectedOutputType,
    requiredInputs: inputs.requiredInputs ?? [],
    timeout: DEFAULT_TIMEOUTS[tier],
    maxSteps: DEFAULT_MAX_STEPS[tier],
    createdAt: new Date().toISOString(),
    expertMode: inputs.expertMode ?? 'auto',
  };
}

/**
 * Trim the intent to a one-liner goal. Truncates at 120 chars and
 * collapses interior whitespace so persisted contracts stay grep-able.
 */
function summariseIntent(intent: string): string {
  const oneLine = intent.replace(/\s+/g, ' ').trim();
  return oneLine.length <= 120 ? oneLine : `${oneLine.slice(0, 117)}...`;
}

/**
 * Phase 1 follow-up — differentiated word_count threshold per task
 * shape. The single 50-char threshold over-rejected legitimate
 * short translation answers (e.g. "Today's weather is really nice."
 * is 31 chars, well below 50). Three buckets:
 *
 *   - scrape          → 100. The runner has bytes from Firecrawl;
 *                       answers should weave them into a real summary.
 *   - generate, short → 10.  Translation / Q&A; answers can be one
 *                       sentence. "short" = prompt < 100 chars AND
 *                       no attachments (attachments imply analysis).
 *   - generate, long  → 50.  PRD / report / analysis; the prompt
 *                       itself signals expectation of a meaty answer.
 *
 * Rule logic is keyword-free — pure length checks plus the
 * attachment flag — so it never invents an LLM call. Threshold
 * tuning lives ONLY here; verifier is unchanged.
 */
function pickChecklistMinWordCount(inputs: ContractInputs): number {
  if (inputs.executionMode === 'scrape') return 100;
  // Plain Q&A — arithmetic / greeting / short knowledge — can answer in
  // a few chars ("2" / "你好！"). The 10-char floor wrongly flags those
  // 结果内容不足. classifyLightweightTask is keyword-only (no LLM) and
  // returns null for any web / action / file signal, so real generate
  // tasks keep the normal threshold.
  if (classifyLightweightTask(inputs.intent)) return 1;
  const isShortPrompt = inputs.intent.length < 100;
  const hasAttachments = inputs.hasAttachments === true;
  if (isShortPrompt && !hasAttachments) return 10;
  return 50;
}

function buildChecklistTier(inputs: ContractInputs): ExecutionContract {
  // Pure-text generate / scrape lanes. Cheapest tier — no domain,
  // no step budget. Catch the obvious failure modes only.
  const wordCountMin = pickChecklistMinWordCount(inputs);
  return {
    ...commonHeader(inputs, 'checklist', 'text'),
    successCriteria: [
      {
        id: newCriterionId(),
        type: 'word_count',
        description: `回复非空且至少 ${wordCountMin} 字符（避免空响应 / 错误回退到默认文案）`,
        data: { min: wordCountMin },
      },
      {
        id: newCriterionId(),
        type: 'custom',
        description: '回复中的 URL 必须存在于 ledger 的 observed/extracted 来源（防编造）',
        rule: 'no_ungrounded_urls',
      },
    ],
    constraints: inputs.constraints ?? [],
  };
}

function buildLightTier(inputs: ContractInputs): ExecutionContract {
  // Browser lane. Has a target domain (from url-resolver) and a
  // step budget. Verifier checks the agent actually got there and
  // pulled at least one fact.
  const successCriteria: SuccessCriterion[] = [
    {
      id: newCriterionId(),
      type: 'data_present',
      description: '至少提取到 1 个数据点（observed 或 extracted）',
    },
    {
      id: newCriterionId(),
      type: 'custom',
      description: '回复中的 URL 必须存在于 ledger 的 observed/extracted 来源（防编造）',
      rule: 'no_ungrounded_urls',
    },
  ];
  if (inputs.targetDomain) {
    successCriteria.unshift({
      id: newCriterionId(),
      type: 'url_match',
      description: `最终页面 URL 必须包含目标域 ${inputs.targetDomain}`,
      rule: `finalUrl.includes("${inputs.targetDomain}")`,
      data: { domain: inputs.targetDomain },
    });
  }
  return {
    ...commonHeader(inputs, 'light', 'data'),
    successCriteria,
    // Default safety guardrails for unattended browser execution.
    // Caller can override / extend via inputs.constraints.
    constraints: [
      ...(inputs.constraints ?? []),
      'no_form_submit',
      'no_payment',
    ],
  };
}

function buildFullTier(inputs: ContractInputs): ExecutionContract {
  // Expert-workflow lane. The intake step has already gathered
  // structured fields; the contract focuses on output quality.
  // The richer LLM-driven criteria land in the integration step.
  return {
    ...commonHeader(inputs, 'full', 'text'),
    expertWorkflowId: inputs.expertWorkflowId ?? null,
    expertMode: inputs.expertMode ?? 'auto',
    successCriteria: [
      {
        id: newCriterionId(),
        type: 'word_count',
        description: '专家任务输出至少 200 字符（足够给出可执行洞察）',
        data: { min: 200 },
      },
      {
        id: newCriterionId(),
        type: 'data_present',
        description: 'ledger 中至少有 1 条 user_input 或 file_parse 来源（确保用了用户给的数据）',
      },
      {
        id: newCriterionId(),
        type: 'custom',
        description: '所有用户提供的关键字段必须出现在回复中（field_count 默认覆盖）',
        rule: 'covers_required_inputs',
      },
      {
        id: newCriterionId(),
        type: 'custom',
        description: '回复中的 URL 必须存在于 ledger 的 observed/extracted 来源（防编造）',
        rule: 'no_ungrounded_urls',
      },
      ...(inputs.expertMode === 'expert'
        ? [
            {
              id: newCriterionId(),
              type: 'custom' as const,
              description: '专家回复中的 benchmark、百分比和倍数必须说明证据或假设边界',
              rule: 'expert_claim_provenance',
            },
          ]
        : []),
    ],
    constraints: inputs.constraints ?? [],
  };
}
