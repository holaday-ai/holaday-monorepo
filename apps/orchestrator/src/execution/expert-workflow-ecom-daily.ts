/**
 * Phase 2b — Expert Workflow: 电商日报 (ecom-daily).
 *
 * Third typed workflow. Reuses the same framework pieces as
 * `douyin-review` and `content-topic`; this file is just the
 * workflow definition.
 *
 * Domain: 店铺 / 品牌 的日度业绩复盘。和 douyin-review（场次粒度）的
 * 区别：日报跨多场 / 多渠道，颗粒度是日维度。
 *
 * Schema:
 *   - 2 required inputs:
 *       report_date — 日期 (text, e.g. "2026-05-09" / "昨日" / "5月9日")
 *       revenue     — 营收 / GMV (number)
 *   - 9 optional inputs (covers典型店铺 KPI):
 *       orders / uv / conversion_rate / avg_order_value /
 *       ad_spend / roi / refund_rate / new_users / top_skus
 *   - 3 data validators (algebraic + sanity):
 *       revenue_orders_aov       — revenue ≈ orders × avg_order_value
 *       conversion_sanity        — 0 ≤ conversion_rate ≤ 100
 *       refund_rate_sanity       — 0 ≤ refund_rate ≤ 100
 *       roi_ad_spend_check       — revenue ÷ ad_spend ≈ ROI
 *   - 7 report sections (6 required + 1 optional):
 *       data_validation     — 数据校验
 *       core_metrics        — 核心指标表
 *       anomaly_diagnosis   — 异动诊断 (今日 vs 经验基准)
 *       channel_analysis    — 渠道拆解 (可选 — 仅当 top_skus 或 ad_spend 提供)
 *       tomorrow_priorities — 明日重点 3-5 条
 *       trend_alert         — 趋势预警
 *       execution_checklist — 执行 Checklist
 *   - 3 follow-up actions
 *
 * Matcher buckets (in registry):
 *   TIME terms:    日报 / 昨日 / 每日 / 每日复盘 / 当日 / today / yesterday
 *   ECOM terms:    电商 / 营收 / 销售 / 店铺 / 营业额 / GMV / 销售额
 * Need ALL of [TIME] AND [ECOM].
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
    name: 'report_date',
    label: '日报日期',
    type: 'text',
    // Accept ISO date / "M月D日" / "昨日" / "今日" / "yesterday" /
    // "today". Capture group returns the verbatim form — model
    // can handle any of these.
    extractPattern:
      /(?:日期|日报)?[\s:：]*(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}月\d{1,2}日|昨日|昨天|今日|今天|前日|前天|yesterday|today)/i,
  },
  {
    name: 'revenue',
    label: '营收 / GMV',
    type: 'number',
    unit: '元',
    extractPattern:
      /(?:营收|营业额|销售额|总销售额?|GMV)[\s:：]*(?:是|为|等于)?\s*[¥￥]?\s*([\d.,]+(?:\s*[万亿千百])?)/i,
  },
] as const;

const OPTIONAL_INPUTS: readonly WorkflowInput[] = [
  {
    name: 'orders',
    label: '订单数',
    type: 'number',
    unit: '单',
    // Same dual-alt pattern as douyin-review. First alt: leading
    // noun + digits. Second alt: trailing-单 form (excluding 客单价).
    extractPattern:
      /(?:(?:订单数?|成交单数?|总订单|订单量)[\s:：]*(?:是|为|有|共|约)?\s*[¥￥]?\s*([\d.,]+(?:\s*[万亿千百])?))|(?:(?:一共|共|总共)\s*([\d.,]+)\s*单(?!价))/i,
  },
  {
    name: 'uv',
    label: '访客数 / UV',
    type: 'number',
    unit: '人',
    extractPattern:
      /(?:UV|访客数?|访客量|UV访客|店铺访客)[\s:：]*(?:是|为|有|达到)?\s*([\d.,]+(?:\s*[万亿千百])?)/i,
  },
  {
    name: 'conversion_rate',
    label: '转化率',
    type: 'number',
    unit: '%',
    extractPattern:
      /(?:转化率|成交转化率?|店铺转化率?)[\s:：]*(?:是|为|约|大约)?\s*([\d.,]+)\s*[%％]?/i,
  },
  {
    name: 'avg_order_value',
    label: '客单价',
    type: 'number',
    unit: '元',
    extractPattern:
      /客单价[\s:：]*(?:是|为|约|大约|等于)?\s*[¥￥]?\s*([\d.,]+(?:\s*[万亿千百])?)/i,
  },
  {
    name: 'ad_spend',
    label: '投放消耗',
    type: 'number',
    unit: '元',
    extractPattern:
      /(?:投放消耗|广告消耗|千川消耗|直通车消耗|消耗)\s*[：:]?\s*[¥￥]?\s*([\d.,]+(?:\s*[万亿千百])?)/i,
  },
  {
    name: 'roi',
    label: 'ROI',
    type: 'text',
    extractPattern: /ROI\s*[：:]?\s*([\d.,:]+)/i,
  },
  {
    name: 'refund_rate',
    label: '退款率',
    type: 'number',
    unit: '%',
    extractPattern:
      /(?:退款率|售后率|售后退款率)\s*[：:]?\s*([\d.,]+)\s*[%％]?/i,
  },
  {
    name: 'new_users',
    label: '新客数',
    type: 'number',
    unit: '人',
    extractPattern:
      /(?:新客数|新增客户|新增用户|首单用户)\s*[：:]?\s*([\d.,]+(?:\s*[万亿千百])?)/i,
  },
  {
    name: 'top_skus',
    label: 'TOP SKU 明细',
    type: 'text',
    extractPattern:
      /(?:TOP\s*SKU|TOP\s*单品|爆款单品|商品明细|爆款明细)[：:]\s*([\s\S]*?)(?:\n\s*\n|$)/i,
  },
] as const;

const REVENUE_AOV_TOLERANCE = 0.2;
const ROI_TOLERANCE = 0.3;

const DATA_VALIDATORS: readonly DataValidator[] = [
  {
    id: 'revenue_orders_aov',
    description: '营收 ÷ 订单数 ≈ 客单价（±20% 容差）',
    check: (e) => {
      const rev = numFrom(e, 'revenue');
      const orders = numFrom(e, 'orders');
      const aov = numFrom(e, 'avg_order_value');
      if (rev == null || orders == null || aov == null) return { passed: true };
      if (orders === 0 || aov === 0) {
        return {
          passed: false,
          message: '订单数或客单价为 0，无法做交叉校验。',
          suggestedFix: '请确认订单数和客单价是否正确填写。',
        };
      }
      const calculated = rev / orders;
      const drift = Math.abs(calculated - aov) / aov;
      if (drift > REVENUE_AOV_TOLERANCE) {
        return {
          passed: false,
          message: `数据不一致：营收 ÷ 订单数 = ¥${calculated.toFixed(0)}，但客单价填的是 ¥${aov}（偏差 ${(drift * 100).toFixed(0)}%）。`,
          suggestedFix: `请确认：实际客单价是 ¥${calculated.toFixed(0)} 还是 ¥${aov}？三者只需修正一个就能对齐。`,
        };
      }
      return { passed: true };
    },
  },
  {
    id: 'conversion_sanity',
    description: '转化率 ∈ [0, 100]',
    check: (e) => {
      const cv = numFrom(e, 'conversion_rate');
      if (cv == null) return { passed: true };
      if (cv > 100) {
        return {
          passed: false,
          message: `转化率 ${cv}% 超过 100%，请核实。`,
          suggestedFix:
            '转化率应该是 0-100% 范围内的数字。如果你想表达的是「点击成交转化率」或多类目复合口径，请明确口径。',
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
    id: 'refund_rate_sanity',
    description: '退款率 ∈ [0, 100]',
    check: (e) => {
      const rr = numFrom(e, 'refund_rate');
      if (rr == null) return { passed: true };
      if (rr > 100) {
        return {
          passed: false,
          message: `退款率 ${rr}% 超过 100%，请核实（口径错误？是否把笔数混成了金额比？）。`,
          suggestedFix: '退款率应是 0-100% 范围内的数字。',
        };
      }
      if (rr < 0) {
        return {
          passed: false,
          message: `退款率 ${rr}% 是负值，请核实。`,
          suggestedFix: '退款率不能为负。',
        };
      }
      return { passed: true };
    },
  },
  {
    id: 'roi_ad_spend_check',
    description: '营收 ÷ 投放消耗 ≈ 声明 ROI（±30% 容差）',
    check: (e) => {
      const rev = numFrom(e, 'revenue');
      const adSpend = numFrom(e, 'ad_spend');
      const roiRaw = textFrom(e, 'roi');
      if (rev == null || adSpend == null || !roiRaw) return { passed: true };
      if (adSpend === 0) {
        return {
          passed: false,
          message: '投放消耗为 0，但提供了 ROI。',
          suggestedFix: '请确认投放消耗是否为 0；为 0 时 ROI 不适用。',
        };
      }
      const colonMatch = roiRaw.match(/([\d.]+)\s*[:：]\s*([\d.]+)/);
      let declaredRoi: number;
      if (colonMatch) {
        const left = parseFloat(colonMatch[1]!);
        const right = parseFloat(colonMatch[2]!);
        if (!Number.isFinite(left) || !Number.isFinite(right) || left === 0) {
          return { passed: true };
        }
        declaredRoi = right / left;
      } else {
        const single = parseFloat(roiRaw);
        if (!Number.isFinite(single)) return { passed: true };
        declaredRoi = single;
      }
      const calculated = rev / adSpend;
      const drift = Math.abs(calculated - declaredRoi) / declaredRoi;
      if (drift > ROI_TOLERANCE) {
        return {
          passed: false,
          message: `数据不一致：声明 ROI=${roiRaw}（=${declaredRoi.toFixed(2)}），但营收 ÷ 投放消耗 = ${calculated.toFixed(2)}。`,
          suggestedFix:
            '请确认营收、投放消耗、ROI 哪个需要修正。常见原因：投放消耗只是某个渠道而非全店；ROI 是账户整体而非本日。',
        };
      }
      return { passed: true };
    },
  },
] as const;

const REPORT_SECTIONS: readonly ReportSection[] = [
  {
    id: 'data_validation',
    title: '数据校验',
    required: true,
    sourceAnnotation: false,
    guidance:
      '列出每个 validator 的结果。通过的写"已通过"或"已通过（字段缺失，跳过）"。失败的写"注意："+具体差异+建议确认项。',
  },
  {
    id: 'core_metrics',
    title: '核心数据',
    required: true,
    sourceAnnotation: true,
    guidance:
      '表格形式列出所有提供的指标 + 系统计算的派生指标（如 UV 价值、获客成本）。每个数字后标注 [用户提供] 用户提供 / [系统计算] 系统计算 / [模型假设] 模型假设 / [外部来源] 外部基准。',
  },
  {
    id: 'anomaly_diagnosis',
    title: '异动诊断',
    required: true,
    sourceAnnotation: true,
    guidance:
      '基于今日数据 vs 行业经验基准 / 用户提供的历史范围（如有），指出 2-4 个核心异动点。每个结论必须标注依据：[用户提供] 用户数据 / [系统计算] 计算 / [模型假设] 模型假设 / [外部来源] 外部基准。**禁止编造同比环比数字** — 没有历史就明确写"未提供历史，以行业经验为参考"。',
  },
  {
    id: 'channel_analysis',
    title: '渠道拆解',
    required: false,
    sourceAnnotation: true,
    guidance:
      '可选 — 仅当用户提供 ad_spend 或 top_skus 时输出。基于投放数据拆解：付费 vs 自然流，TOP SKU 占比，转化漏斗的薄弱点。来源标注严格。无数据就完全跳过整个 section。',
  },
  {
    id: 'tomorrow_priorities',
    title: '明日重点',
    required: true,
    sourceAnnotation: false,
    guidance:
      '3-5 条明日必做动作。每条必须落到具体执行（"把活动页 banner 从 ¥199 改成 ¥159"），禁止"提升转化"这种废话。给定优先级 P0/P1/P2。',
  },
  {
    id: 'trend_alert',
    title: '趋势预警',
    required: true,
    sourceAnnotation: true,
    guidance:
      '基于今日数据是否有趋势性预警（连续亏损、退款率上升、ROI 持续走低等）。无趋势数据就基于今日单点经验判断，必须标注 [模型假设]（经验估计）。',
  },
  {
    id: 'execution_checklist',
    title: '执行 Checklist',
    required: true,
    sourceAnnotation: false,
    guidance:
      'Markdown checkbox 格式（- [ ] 项）。覆盖：明日开播 / 上架前准备、价格 / 库存核对、客服话术更新、24 小时数据回看节点。',
  },
] as const;

const FOLLOW_UP_ACTIONS: readonly FollowUpAction[] = [
  {
    label: '生成明日 SOP',
    prompt:
      '基于本日报的诊断和明日重点，帮我生成一份完整的明日运营 SOP：开店前准备、上架顺序、活动页改动、投放配置、客服话术。',
  },
  {
    label: '对比上周同期',
    prompt:
      '帮我对比这日的数据和上周同一日的数据，找出关键改善项和恶化项，按重要性排序。',
  },
  {
    label: '深挖 ROI 不达预期原因',
    prompt:
      '基于今日 ROI 和投放消耗，深入分析为什么 ROI 不达预期：是投放定向问题？素材问题？落地页转化问题？给出排查步骤。',
  },
] as const;

const SYSTEM_PROMPT_PREAMBLE = [
  '【专家技能工作流：电商日报 (ecom-daily v1)】',
  '你是电商运营日报专家。用户已经提供了日期 + 营收（必填）和可选的订单 / UV / 转化率 / 客单价 / 投放 / ROI / 退款 / 新客 / TOP SKU。请按下方 7 个 section 结构生成日报。',
  '',
  '## 来源标注规则（每个数字必须标注一种）',
  '- [用户提供]：直接引用用户给的原始数据。',
  '- [系统计算]：从用户数据推导（如 UV 价值 = 营收÷UV、ROI = 营收÷投放消耗）。',
  '- [模型假设]：基于行业经验的推断，必须显式写"假设"或"经验估计"字样。',
  '- [外部来源]：引用第三方数据/报告，必须标注来源名称（不可编造）。',
  '',
  '## 硬性约束',
  '- 如果"校验" section 有失败项，**不得使用矛盾数据继续推导**。报告以"数据校验未通过，需用户确认"开头，然后只列出无矛盾部分的诊断。',
  '- "异动诊断" 禁止编造同比 / 环比数字 — 没有历史数据就明确说"未提供历史基准"，绝不假设"昨日 ROI 是 X"这种数据。',
  '- "明日重点" 禁止抽象建议（"提升转化率"），要"把活动页 banner 从 ¥199 改成 ¥159"这种粒度，并给 P0/P1/P2 优先级。',
  '- "执行 Checklist" 用 Markdown checkbox 格式（`- [ ] 项`）。',
  '- 渠道拆解 section：用户没提供 ad_spend / top_skus 就完全跳过（不放空 section 占位）。',
  '- 没把握的行业基准数字写"—"+"缺少类目基准数据"，绝不编造。',
  '- 每个 section 的 title 必须严格按下方列出的写（用于 verifier 识别）。',
].join('\n');

export const ECOM_DAILY_WORKFLOW: ExpertWorkflowContract = {
  workflowId: 'ecom-daily',
  name: '电商日报',
  roleIds: [
    'ecom-operator',
    'shop-manager',
    'taobao-operator',
    'douyin-shop',
    'data-analyst',
  ],
  requiredInputs: REQUIRED_INPUTS,
  optionalInputs: OPTIONAL_INPUTS,
  dataValidators: DATA_VALIDATORS,
  reportSections: REPORT_SECTIONS,
  followUpActions: FOLLOW_UP_ACTIONS,
  systemPromptPreamble: SYSTEM_PROMPT_PREAMBLE,
};

// ---------------------------------------------------------------------------
// Validator helpers (mirror the douyin file's pattern)
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
