/**
 * Phase 13 Dim 1 — first-frame plan generation.
 *
 * Before the supercar loop dispatches a single tool call, run a
 * separate Anthropic call that asks the model to produce a step
 * list for the task. The list goes into:
 *   1. tasks.plan_text  (text, persisted for audit + UI hydration)
 *   2. tasks.plan_status (JSON array, [{idx, status, note}])
 *   3. WS broadcast `server.task.plan` so the SPA renders the
 *      upcoming-steps card before any execution starts
 *
 * The plan is a hint, not a contract — the agent loop is free to
 * deviate (e.g. when error recovery forces a different path), but
 * the plan_status array gets updated as the loop progresses so the
 * UI can highlight which steps actually finished.
 *
 * Skipped for:
 *   - simple-search intents (Brave fast-lane handles them, no plan needed)
 *   - one-step intents (e.g. "今天天气", "打开百度", reply chat)
 */

import Anthropic from '@anthropic-ai/sdk';
import type { Logger } from 'pino';

export const PLAN_SYSTEM = `你是 HOLA DAY 的任务规划助手。用户会发一个任务给你，你只输出执行计划，不执行。规则：

- 列出 2-6 个可执行步骤，每步用一行简短中文描述。
- 每步括号里标注预计使用的工具：（搜索 API）/（浏览器操作）/（文件处理）/（生成内容）。
- 涉及下单、支付、发送、预订、预约、报名、投递、取消订阅、删除、注销等高风险流程时，计划只写到"到达最终确认页 / 草稿预览页并展示明细"。不要把"点击确认 / Place order / Pay / Send / Delete / Unsubscribe"列为步骤。
- 末尾一行写"**预计耗时**：~Xs"（粗略估计就行）。
- 不要 markdown 标题（##），不要分隔线，不要"以下是..."这种开场。
- 如果任务太琐碎（一句话能答完），输出 \`SKIP_PLAN\` 三个字符，**什么都不要再写**。

示范：

任务：对比京东和淘宝 MacBook Air 的价格

**执行计划**
1. 搜索 MacBook Air 在京东的最新价格（搜索 API）
2. 搜索 MacBook Air 在淘宝的最新价格（搜索 API）
3. 整理表格 + 一句话结论（生成内容）

**预计耗时**：~6s

任务：今天上海天气

SKIP_PLAN`;

export interface PlanStep {
  idx: number;
  status: 'pending' | 'running' | 'done' | 'failed';
  /** Optional human-readable note (failure reason, retry count, etc). */
  note?: string;
}

export interface PlanGenerateResult {
  /** Full markdown text shown to the user. Null when SKIP_PLAN. */
  planText: string | null;
  /** Initial status array, parallel to bullet count. Null when no plan. */
  planStatus: PlanStep[] | null;
}

/**
 * Drop the leading numbered-bullet text out of the plan body to
 * count steps. Tolerant of model formatting drift; defaults to 0
 * when no recognisable list is found (caller treats that as
 * "skip plan" too, since a step-less plan is no plan).
 */
function countPlanSteps(planText: string): number {
  const lines = planText.split('\n');
  let count = 0;
  for (const line of lines) {
    if (/^\s*\d+\.\s/.test(line)) count += 1;
  }
  return count;
}

export async function generatePlan(opts: {
  apiKey: string;
  model?: string;
  intent: string;
  logger: Logger;
  taskId?: string;
}): Promise<PlanGenerateResult> {
  const client = new Anthropic({ apiKey: opts.apiKey });
  const model = opts.model ?? 'claude-sonnet-4-6';
  try {
    const resp = await client.messages.create({
      model,
      max_tokens: 512,
      // Cache the system prompt — every plan call is identical.
      system: [{ type: 'text', text: PLAN_SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: `任务：${opts.intent}` }],
    });
    const text = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text.trim())
      .join('\n')
      .trim();
    if (!text || text === 'SKIP_PLAN' || /^SKIP_PLAN\b/.test(text)) {
      return { planText: null, planStatus: null };
    }
    const stepCount = countPlanSteps(text);
    if (stepCount === 0) {
      // Model didn't produce a numbered list — treat as skip rather
      // than render unstructured prose as a "plan". Keeps the UI
      // contract clean (we always have step count = bullet count).
      opts.logger.warn(
        { taskId: opts.taskId, len: text.length },
        'plan-service: planner returned no numbered bullets — skipping plan',
      );
      return { planText: null, planStatus: null };
    }
    const planStatus: PlanStep[] = Array.from({ length: stepCount }, (_, i) => ({
      idx: i,
      status: 'pending' as const,
    }));
    opts.logger.info(
      {
        taskId: opts.taskId,
        stepCount,
        inputTokens: resp.usage?.input_tokens ?? 0,
        outputTokens: resp.usage?.output_tokens ?? 0,
        cacheReadInputTokens: resp.usage?.cache_read_input_tokens ?? 0,
      },
      'plan-service: plan generated',
    );
    return { planText: text, planStatus };
  } catch (err) {
    // Plan failure is non-fatal — caller continues without one.
    opts.logger.warn(
      { taskId: opts.taskId, err: err instanceof Error ? err.message : String(err) },
      'plan-service: generate failed, falling through to no-plan',
    );
    return { planText: null, planStatus: null };
  }
}

/**
 * Cheap heuristic to skip plan generation entirely on intents that
 * obviously don't need one. The orchestrator already has
 * `classifyAsSimpleSearch` for the Brave fast-lane — this is a
 * second narrower check for trivial reply-style intents the agent
 * loop handles in one or two iterations.
 *
 * Conservative on purpose: when in doubt, generate the plan and
 * let the planner emit SKIP_PLAN itself.
 */
export function shouldSkipPlan(intent: string): boolean {
  const t = intent.trim();
  if (!t) return true;
  // Very short intents (≤ 8 chars) almost never benefit from a plan.
  if (t.length <= 8) return true;
  return false;
}
