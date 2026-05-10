/**
 * Phase 2 Day 1 — Expert Workflow: 抖音直播复盘 (douyin-review).
 *
 * First fully-typed expert workflow. Replaces the loose
 * text-prompt flow in `apps/orchestrator/src/agent/supercar/
 * expert-workflows.ts` with:
 *
 *   - 5 required inputs (gmv / uv / orders / avg_price / conversion_rate)
 *     each with a regex `extractPattern` so the parser can pull
 *     them DETERMINISTICALLY from the user's free-form text or
 *     pasted screenshot transcript.
 *   - 8 optional inputs (ad_spend / roi / duration / peak_viewers /
 *     avg_stay / gpm / fans_gained / product_list).
 *   - 3 data validators with arithmetic cross-checks. Failure →
 *     halt before report, surface the discrepancy + suggested fix.
 *   - 6 report sections (data_validation / core_metrics /
 *     diagnosis / optimization / next_stream_checklist /
 *     industry_benchmark). 5 required, 1 optional.
 *   - 3 follow-up actions for the SPA's chip rail.
 *   - Sonnet-facing system prompt preamble that pins the source-
 *     annotation glyph rules (🟢🔵🟡🔴) and the section-by-section
 *     output structure.
 *
 * Pure data — no I/O, no React, no model client. The intake
 * handler (Day 2) and report generator (Day 3) consume this
 * structure.
 */
import type {
  DataValidator,
  ExpertWorkflowContract,
  FollowUpAction,
  ReportSection,
  WorkflowInput,
} from './expert-workflow-contract.js';

const REQUIRED_INPUTS: readonly WorkflowInput[] = [
  {
    name: 'gmv',
    label: '直播 GMV',
    type: 'number',
    unit: '元',
    // Anchor on "GMV" / "总成交" / "成交额"; allow any combination
    // of whitespace, ASCII/CJK colons, and the common Chinese
    // copulas (是/为/等于/有/一共/总共) between key and value so
    // both "GMV: 100000" and "GMV 是 200000" extract.
    extractPattern: /(?:GMV|总成交额?|成交额|销售额)[\s:：]*(?:是|为|等于|有|一共|共计|总共)?\s*[¥￥]?\s*([\d.,]+(?:\s*[万亿千百])?)/i,
  },
  {
    name: 'uv',
    label: '场观/UV',
    type: 'number',
    unit: '次',
    extractPattern: /(?:UV|场观|观看人?数?|观众|曝光观看)[\s:：]*(?:是|为|有|达到)?\s*([\d.,]+(?:\s*[万亿千百])?)/i,
  },
  {
    name: 'orders',
    label: '订单数',
    type: 'number',
    unit: '单',
    // Two alternations, each with ONE capture group (group 1 OR
    // group 2 yields the number). The parser's extractOne reads
    // whichever group is non-undefined.
    //   alt 1: "订单 500" / "订单数: 500" / "总订单 500" — leading
    //          form, capture digits AFTER the noun.
    //   alt 2: "一共 500 单" / "共 500 单" — trailing-unit form,
    //          capture digits BEFORE 单. Excludes "客单价" via
    //          a non-trivial preamble (一共|共) before digits.
    extractPattern: /(?:(?:订单数?|成交单数?|总订单|订单量)[\s:：]*(?:是|为|有|共|约)?\s*[¥￥]?\s*([\d.,]+(?:\s*[万亿千百])?))|(?:(?:一共|共|总共)\s*([\d.,]+)\s*单(?!价))/i,
  },
  {
    name: 'avg_price',
    label: '客单价',
    type: 'number',
    unit: '元',
    extractPattern: /客单价[\s:：]*(?:是|为|约|大约|等于)?\s*[¥￥]?\s*([\d.,]+(?:\s*[万亿千百])?)/i,
  },
  {
    name: 'conversion_rate',
    label: '转化率',
    type: 'number',
    unit: '%',
    extractPattern: /(?:转化率|成交转化率?)[\s:：]*(?:是|为|约|大约)?\s*([\d.,]+)\s*[%％]?/i,
  },
] as const;

const OPTIONAL_INPUTS: readonly WorkflowInput[] = [
  {
    name: 'ad_spend',
    label: '千川消耗',
    type: 'number',
    unit: '元',
    extractPattern: /(?:千川消耗|投放消耗|广告消耗|消耗)\s*[：:]?\s*[¥￥]?\s*([\d.,]+(?:\s*[万亿千百])?)/i,
  },
  {
    name: 'roi',
    label: 'ROI',
    type: 'text',
    // ROI typically given as "1:2.5" or "2.5"
    extractPattern: /ROI\s*[：:]?\s*([\d.,:]+)/i,
  },
  {
    name: 'duration',
    label: '直播时长',
    type: 'number',
    unit: '小时',
    extractPattern: /(?:直播时?长|时长)\s*[：:]?\s*([\d.,]+)\s*(?:小时|h|hour)?/i,
  },
  {
    name: 'peak_viewers',
    label: '峰值在线',
    type: 'number',
    unit: '人',
    extractPattern: /(?:峰值(?:在线|观看)|最高在线|最高观看)\s*[：:]?\s*([\d.,]+(?:\s*[万亿千百])?)/i,
  },
  {
    name: 'avg_stay',
    label: '平均停留',
    type: 'number',
    unit: '秒',
    extractPattern: /(?:平均停留|停留时长|平均观看时长)\s*[：:]?\s*([\d.,]+)\s*(?:秒|s)?/i,
  },
  {
    name: 'gpm',
    label: 'GPM',
    type: 'number',
    unit: '元/千次',
    extractPattern: /GPM\s*[：:]?\s*[¥￥]?\s*([\d.,]+)/i,
  },
  {
    name: 'fans_gained',
    label: '涨粉数',
    type: 'number',
    unit: '人',
    extractPattern: /(?:涨粉|新增粉丝|粉丝增长)\s*[：:]?\s*([\d.,]+(?:\s*[万亿千百])?)/i,
  },
  {
    name: 'product_list',
    label: '商品明细',
    type: 'text',
    // No anchor — user usually pastes a multi-line table after
    // the marker. Capture-group is permissive: anything between
    // "商品明细：" and a sentinel line break of 2+ newlines or end.
    extractPattern: /(?:商品明细|商品列表|SKU列表)\s*[：:]\s*([\s\S]*?)(?:\n\s*\n|$)/i,
  },
] as const;

/**
 * Tolerance for the GMV / orders / avg-price triangle. The agent
 * loop's earlier rule used 10% which BOSS's data showed was too
 * tight (legitimate rounding in user input + post-refund
 * adjustments routinely landed in the 10-15% band). 20% is
 * BOSS-specified and matches the ratio observed in clean cases.
 */
const GMV_PRICE_TOLERANCE = 0.2;
const ROI_TOLERANCE = 0.3;

const DATA_VALIDATORS: readonly DataValidator[] = [
  {
    id: 'gmv_order_price',
    description: 'GMV ÷ 订单数 ≈ 客单价（±20% 容差）',
    check: (e) => {
      const gmv = numFrom(e, 'gmv');
      const orders = numFrom(e, 'orders');
      const price = numFrom(e, 'avg_price');
      if (gmv == null || orders == null || price == null) {
        return { passed: true };
      }
      if (orders === 0 || price === 0) {
        return {
          passed: false,
          message: '订单数或客单价为 0，无法做交叉校验。',
          suggestedFix: '请确认订单数和客单价是否正确填写。',
        };
      }
      const calculated = gmv / orders;
      const drift = Math.abs(calculated - price) / price;
      if (drift > GMV_PRICE_TOLERANCE) {
        return {
          passed: false,
          message: `GMV ÷ 订单数 = ¥${calculated.toFixed(0)}，与填报的客单价 ¥${price} 偏差 ${(drift * 100).toFixed(0)}%。`,
          suggestedFix: `请确认：实际客单价是 ¥${calculated.toFixed(0)} 还是 ¥${price}？（GMV、订单数、客单价 三者只需修正一个就能对齐）`,
        };
      }
      return { passed: true };
    },
  },
  {
    id: 'conversion_sanity',
    description: '转化率 ≤ 100%',
    check: (e) => {
      const cv = numFrom(e, 'conversion_rate');
      if (cv == null) return { passed: true };
      if (cv > 100) {
        return {
          passed: false,
          message: `转化率 ${cv}% 超过 100%，请核实。`,
          suggestedFix:
            '转化率应该是 0-100% 范围内的数字。如果你想表达的是「点击成交转化率」，请明确口径。',
        };
      }
      if (cv < 0) {
        return {
          passed: false,
          message: `转化率 ${cv}% 是负值，请核实。`,
          suggestedFix: '转化率不能为负。',
        };
      }
      return { passed: true };
    },
  },
  {
    id: 'roi_ad_spend_check',
    description: 'GMV ÷ 千川消耗 ≈ ROI（±30% 容差）',
    check: (e) => {
      const gmv = numFrom(e, 'gmv');
      const adSpend = numFrom(e, 'ad_spend');
      const roiRaw = textFrom(e, 'roi');
      if (gmv == null || adSpend == null || !roiRaw) return { passed: true };
      if (adSpend === 0) {
        return {
          passed: false,
          message: '千川消耗为 0，但提供了 ROI。',
          suggestedFix: '请确认千川消耗是否为 0；为 0 时 ROI 不适用。',
        };
      }
      // Parse "1:2.5" → 2.5; "2.5" → 2.5.
      const colonMatch = roiRaw.match(/([\d.]+)\s*[:：]\s*([\d.]+)/);
      let declaredRoi: number;
      if (colonMatch) {
        const left = parseFloat(colonMatch[1]!);
        const right = parseFloat(colonMatch[2]!);
        if (!Number.isFinite(left) || !Number.isFinite(right) || left === 0) {
          return { passed: true }; // unparseable, skip
        }
        declaredRoi = right / left;
      } else {
        const single = parseFloat(roiRaw);
        if (!Number.isFinite(single)) return { passed: true };
        declaredRoi = single;
      }
      const calculated = gmv / adSpend;
      const drift = Math.abs(calculated - declaredRoi) / declaredRoi;
      if (drift > ROI_TOLERANCE) {
        return {
          passed: false,
          message: `声明 ROI=${roiRaw}（=${declaredRoi.toFixed(2)}），但 GMV ÷ 千川消耗 = ${calculated.toFixed(2)}。`,
          suggestedFix:
            '请确认 GMV、千川消耗、ROI 三者哪个需要修正。常见原因：千川消耗只是某个计划而非全场；ROI 是账户整体而非本场。',
        };
      }
      return { passed: true };
    },
  },
] as const;

const REPORT_SECTIONS: readonly ReportSection[] = [
  {
    id: 'data_validation',
    title: '⚠️ 数据校验',
    required: true,
    sourceAnnotation: false,
    guidance:
      '列出每个 validator 的结果。通过的写"已通过"。失败的写"⚠️"+具体差异+建议确认项。',
  },
  {
    id: 'core_metrics',
    title: '📊 核心数据',
    required: true,
    sourceAnnotation: true,
    guidance:
      '表格形式列出所有 5 个核心指标 + 提供的可选指标。每个数字后标注 🟢/🔵/🟡/🔴 表示来源。',
  },
  {
    id: 'diagnosis',
    title: '🔍 问题诊断',
    required: true,
    sourceAnnotation: true,
    guidance:
      '指出 2-4 个核心问题。每个结论必须标注依据：🟢 用户数据 / 🔵 计算 / 🟡 模型假设 / 🔴 外部基准。',
  },
  {
    id: 'optimization',
    title: '💡 优化动作',
    required: true,
    sourceAnnotation: false,
    guidance:
      '3-5 条具体可执行建议。禁止"提高转化率"这类废话。要"把主推品从第3位提到第1位"这种粒度。',
  },
  {
    id: 'next_stream_checklist',
    title: '✅ 下场直播 Checklist',
    required: true,
    sourceAnnotation: false,
    guidance:
      'Markdown checkbox 格式（- [ ] 项）。覆盖：开播前准备、主推品话术节奏、投放配置、下播前的复盘记录。',
  },
  {
    id: 'industry_benchmark',
    title: '📈 行业参考',
    required: false,
    sourceAnnotation: true,
    guidance:
      '可选。如果有清晰的行业基准对比，标注来源；没有就跳过整个 section。绝不编造类目档位数字。',
  },
] as const;

const FOLLOW_UP_ACTIONS: readonly FollowUpAction[] = [
  {
    label: '生成下场直播 SOP',
    prompt: '基于这次复盘的诊断和优化建议，帮我生成一份详细的下场直播 SOP，包含开播前准备、节奏节点、话术框架。',
  },
  {
    label: '分析单品表现',
    prompt: '帮我详细分析这场直播每个商品的表现：哪些是明星品、哪些拖了后腿、为什么。',
  },
  {
    label: '对比上场数据',
    prompt: '帮我对比这场和上一场直播的数据变化，找出关键改善项和恶化项。',
  },
] as const;

const SYSTEM_PROMPT_PREAMBLE = [
  '【专家技能工作流：抖音直播复盘 (douyin-review v2)】',
  '你是抖音直播复盘专家。用户已经提供了直播数据（在「数据」section）和数据校验结果（在「校验」section）。请按下方 6 个 section 结构生成报告。',
  '',
  '## 来源标注规则（每个数字必须标注一种）',
  '- 🟢 用户提供：直接引用用户给的原始数据。',
  '- 🔵 系统计算：从用户数据推导（如 GMV÷订单=客单价），标注计算公式。',
  '- 🟡 模型假设：基于行业经验的推断，必须显式标注"假设"或"经验估计"字样。',
  '- 🔴 外部来源：引用第三方数据/报告，标注来源名称（不可编造来源）。',
  '',
  '## 硬性约束',
  '- 如果"校验" section 有失败项，**不得使用矛盾数据继续推导**。报告以"数据校验未通过，需用户确认"开头，然后只列出无矛盾部分的诊断。',
  '- "优化动作" section 禁止给"提高转化率/优化话术"这类抽象建议。要"把主推品 X 从第 3 位上架位调整到第 1 位"这种粒度。',
  '- "下场直播 Checklist" 必须用 Markdown checkbox 格式（`- [ ] 项`）。',
  '- 没把握的行业基准数字写"—"+"缺少类目基准数据"，绝不编造。',
  '- 每个 section 的 title 必须严格按下方列出的写（用于 verifier 识别）。',
].join('\n');

export const DOUYIN_REVIEW_WORKFLOW: ExpertWorkflowContract = {
  workflowId: 'douyin-review',
  name: '抖音直播复盘',
  roleIds: ['douyin-strategist', 'livestream-coach', 'china-ecommerce', 'data-analyst'],
  requiredInputs: REQUIRED_INPUTS,
  optionalInputs: OPTIONAL_INPUTS,
  dataValidators: DATA_VALIDATORS,
  reportSections: REPORT_SECTIONS,
  followUpActions: FOLLOW_UP_ACTIONS,
  systemPromptPreamble: SYSTEM_PROMPT_PREAMBLE,
};

// ---------------------------------------------------------------------------
// Helpers (used by validators)
// ---------------------------------------------------------------------------

function numFrom(
  extracted: Readonly<Record<string, unknown>>,
  key: string,
): number | null {
  const v = extracted[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function textFrom(
  extracted: Readonly<Record<string, unknown>>,
  key: string,
): string | null {
  const v = extracted[key];
  return typeof v === 'string' && v.length > 0 ? v : null;
}
