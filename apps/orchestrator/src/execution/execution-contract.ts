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

export type ContractTier = 'full' | 'light' | 'checklist';

export type ExpectedOutputType = 'text' | 'file' | 'action' | 'data';

export type CriterionType =
  | 'url_match'
  | 'data_present'
  | 'file_exists'
  | 'field_count'
  | 'word_count'
  | 'custom';

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
}

export interface ContractInputs {
  taskId: string;
  intent: string;
  executionMode: 'browser' | 'generate' | 'scrape';
  /** When non-null, an expert workflow ID was matched → tier='full'. */
  expertWorkflowId?: string | null;
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
 */
export function buildContract(inputs: ContractInputs): ExecutionContract {
  const tier = pickTier(inputs);
  const builders: Record<ContractTier, (i: ContractInputs) => ExecutionContract> = {
    full: buildFullTier,
    light: buildLightTier,
    checklist: buildChecklistTier,
  };
  return builders[tier](inputs);
}

function pickTier(i: ContractInputs): ContractTier {
  if (i.expertWorkflowId) return 'full';
  if (i.executionMode === 'browser') return 'light';
  return 'checklist';
}

function commonHeader(
  inputs: ContractInputs,
  tier: ContractTier,
  expectedOutputType: ExpectedOutputType,
): Pick<
  ExecutionContract,
  'taskId' | 'tier' | 'goal' | 'expectedOutputType' | 'createdAt' | 'requiredInputs' | 'timeout' | 'maxSteps'
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

function buildChecklistTier(inputs: ContractInputs): ExecutionContract {
  // Pure-text generate / scrape lanes. Cheapest tier — no domain,
  // no step budget. Catch the obvious failure modes only.
  return {
    ...commonHeader(inputs, 'checklist', 'text'),
    successCriteria: [
      {
        id: newCriterionId(),
        type: 'word_count',
        description: '回复非空且至少 50 字符（避免空响应 / 错误回退到默认文案）',
        data: { min: 50 },
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
    ],
    constraints: inputs.constraints ?? [],
  };
}
