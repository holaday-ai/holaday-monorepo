/**
 * Phase 2 Day 3 — Expert Workflow prompt builder + follow-up footer.
 *
 * Pure functions. Composes the Sonnet system prompt for the report
 * generation step + the trailing follow-up actions footer the SPA
 * renders as a chip rail under the report.
 *
 * Two reasons we render the follow-up footer in markdown rather
 * than via a structured WS event:
 *   1. The persisted `result.summary` carries the report verbatim
 *      to the SPA on refresh / history click. A markdown footer
 *      means the chips come back too without extra plumbing.
 *   2. The `[FOLLOW_UP_ACTIONS]` block format is greppable by the
 *      SPA which can hoist it into an interactive chip rail OR
 *      fall back to plain markdown rendering if the SPA isn't
 *      yet aware of the format. Defence in depth — the answer
 *      always reads sensibly even without the SPA upgrade.
 */
import type {
  ExpertWorkflowContract,
  ReportSection,
} from './expert-workflow-contract.js';
import type { NamedValidatorResult } from './expert-workflow-intake.js';

/**
 * Build the system prompt for the report generation step. The
 * model receives:
 *   - Workflow's pinned preamble (source-annotation rules,
 *     structural constraints).
 *   - Section list with per-section guidance.
 *   - Pre-validated user inputs as a JSON block.
 *   - Validation results so the model knows the data is clean.
 *
 * Caller passes the result to `runGenerateTask({systemPromptOverride: ...})`
 * which uses it INSTEAD OF the default `buildLayeredSystemPrompt(roleId)`.
 */
export function buildReportSystemPrompt(opts: {
  workflow: ExpertWorkflowContract;
  extracted: Readonly<Record<string, string | number>>;
  validatorResults: readonly NamedValidatorResult[];
}): string {
  const { workflow, extracted, validatorResults } = opts;
  const lines: string[] = [];

  lines.push(workflow.systemPromptPreamble);
  lines.push('');

  lines.push('## 输出规模预算');
  lines.push(
    `- 正文目标 ${workflow.generationBudget.targetChars.min}-${workflow.generationBudget.targetChars.max} 个中文字符；完整覆盖必需 section，但同一事实、数字和结论只写一次。`,
  );
  if (workflow.workflowId === 'content-topic') {
    const requestedTopicCount = Number(extracted.topic_count ?? 5);
    const topicCount = Number.isFinite(requestedTopicCount)
      ? Math.max(1, Math.floor(requestedTopicCount))
      : 5;
    lines.push(`- 严格输出 ${topicCount} 个选题方向；不要擅自增加或减少。`);
    lines.push('- 每个方向只生成 2 个标题，且两种钩子不同。');
    lines.push('- 只展开 1 个 Top 选题为详细内容大纲。');
  }
  lines.push('');

  lines.push('## 必须输出的报告 sections（按顺序）');
  for (const s of workflow.reportSections) {
    if (!s.required) continue;
    lines.push(formatSectionDirective(s));
  }
  const optional = workflow.reportSections.filter((s) => !s.required);
  if (optional.length > 0) {
    lines.push('');
    lines.push('## 可选 sections（有把握时再写，没把握就跳过）');
    for (const s of optional) {
      lines.push(formatSectionDirective(s));
    }
  }
  lines.push('');

  lines.push('## 不可变 Markdown 输出骨架');
  lines.push(
    '输出时必须逐字保留下列标题行；不得重命名、增加编号或用其他章节替代。标题下直接填写真实内容，不要输出额外的“关键结论/归因分析/实验清单”来代替必需 section。',
  );
  for (const section of workflow.reportSections.filter((item) => item.required)) {
    lines.push('');
    lines.push(`## ${section.title}`);
    if (section.id === 'next_stream_checklist') {
      lines.push('- [ ] 开播前准备：填写具体负责人、动作和完成时间');
      lines.push('- [ ] 主推品话术节奏：填写具体节点和话术动作');
      lines.push('- [ ] 投放配置：填写具体预算、定向和止损条件');
      lines.push('- [ ] 下播前复盘记录：填写需要保存的数据与责任人');
    } else {
      lines.push('<!-- 在此标题下按上方 guidance 填写真实内容 -->');
    }
  }
  lines.push('');

  lines.push('## 用户提供的数据（已结构化提取）');
  lines.push('```json');
  lines.push(JSON.stringify(extracted, null, 2));
  lines.push('```');
  lines.push('');

  lines.push('## 数据校验结果');
  for (const v of validatorResults) {
    if (v.passed) {
      lines.push(`- 通过 \`${v.validatorId}\`: ${v.description}`);
    } else {
      lines.push(`- 未通过 \`${v.validatorId}\`: ${v.description}`);
      if (v.message) lines.push(`  - ${v.message}`);
    }
  }
  lines.push('');

  lines.push('## 输出要求');
  lines.push(
    '- 直接输出 Markdown 报告，不要以解释 / 引言开场。第一行就是第一个 section 的标题。',
  );
  lines.push(
    '- 严格按 section 顺序输出。每个 section 必须用提供的 title 字符串。',
  );
  lines.push(
    '- 数据校验如果有未通过项，"数据校验" section 必须重述失败项；不要在后续 section 引用矛盾数据。',
  );
  lines.push('- 不要重复展示用户的 JSON 数据；用表格或项目符号呈现核心指标。');
  lines.push('- 不要在末尾自己加"如有疑问请告知"等套话；followUpActions 由系统拼接。');

  return lines.join('\n');
}

function formatSectionDirective(s: ReportSection): string {
  const annot = s.sourceAnnotation ? ' [需要来源标注：[用户提供]/[系统计算]/[模型假设]/[外部来源]]' : '';
  const guidance = s.guidance ? `\n  > ${s.guidance}` : '';
  return `- **${s.title}** (id: \`${s.id}\`)${annot}${guidance}`;
}

/**
 * Marker block that wraps the follow-up suggestions. The SPA can
 * detect this verbatim and hoist into a chip rail; without that
 * support the markdown still reads as a "下一步" section.
 */
export const FOLLOW_UP_ACTIONS_MARKER_OPEN = '<!-- HOLA_FOLLOW_UP_ACTIONS_START -->';
export const FOLLOW_UP_ACTIONS_MARKER_CLOSE = '<!-- HOLA_FOLLOW_UP_ACTIONS_END -->';

/**
 * Render the workflow's followUpActions as a Markdown footer.
 * Each action is `- [label](workflow-action://prompt)` so a default
 * markdown renderer turns it into a clickable list; SPA-aware
 * renderers can intercept the `workflow-action://` scheme and
 * pre-fill the composer instead of opening a URL.
 *
 * Empty workflow.followUpActions → empty string. Don't render the
 * marker block when there's nothing to show.
 */
export function buildFollowUpFooter(workflow: ExpertWorkflowContract): string {
  if (workflow.followUpActions.length === 0) return '';
  const lines: string[] = [];
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push(FOLLOW_UP_ACTIONS_MARKER_OPEN);
  lines.push('### 下一步建议');
  lines.push('');
  for (const a of workflow.followUpActions) {
    // Encode the prompt so newlines / parens survive the
    // markdown link wrapper. Actions are short single-line
    // prompts in practice; URL-encoding is belt-and-braces.
    lines.push(
      `- [${a.label}](workflow-action://${encodeURIComponent(a.prompt)})`,
    );
  }
  lines.push(FOLLOW_UP_ACTIONS_MARKER_CLOSE);
  return lines.join('\n');
}
