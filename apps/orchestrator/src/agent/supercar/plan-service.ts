/**
 * First-frame task-plan generation.
 *
 * The model returns a small JSON object. This module validates the object and
 * renders the existing markdown/UI contract deterministically; raw model text
 * is never persisted or logged. Invalid or unavailable plans are non-fatal.
 */

import type { Logger } from 'pino';
import { z } from 'zod';
import { type MessagesAdapter, MessagesAdapterError } from '../../llm/messages-adapter.js';

export const PLAN_SYSTEM = `你是 HOLA DAY 的任务规划助手。用户会发一个任务给你，你只输出执行计划，不执行。

只输出一个 JSON 对象，不要 markdown、代码围栏或其他文字。允许两种结构：

1. 需要计划时：
{"steps":[{"text":"检索资料","tool":"搜索 API"},{"text":"整理结果","tool":"生成内容"}],"estimatedSeconds":6}

2. 一句话可以完成、不需要计划时：
{"skip":true}

规则：
- steps 必须有 2-6 项，每项 text 为简短中文动作，tool 只能是“搜索 API”“浏览器操作”“文件处理”“生成内容”之一。
- estimatedSeconds 必须是 1-1800 的整数秒数。
- 涉及下单、支付、发送、预订、预约、报名、投递、文件分享或权限变更、取消订阅、删除、注销等高风险流程时，计划只写到“到达最终确认页 / 草稿预览页并展示明细”。不要把"点击确认 / Place order / Pay / Send / Share / Change access / Delete / Unsubscribe"列为步骤。
- 不要虚构已经执行、已经验证或已经完成。
- 如果任务太琐碎，严格输出 {"skip":true}。`;

const TOOL_LABELS = ['搜索 API', '浏览器操作', '文件处理', '生成内容'] as const;

const PlanPayloadSchema = z
  .object({
    steps: z
      .array(
        z
          .object({
            text: z
              .string()
              .trim()
              .min(2)
              .max(80)
              .refine((value) => !/[\r\n]/.test(value)),
            tool: z.enum(TOOL_LABELS),
          })
          .strict(),
      )
      .min(2)
      .max(6),
    estimatedSeconds: z.number().int().min(1).max(1_800),
  })
  .strict();

const SkipPayloadSchema = z.object({ skip: z.literal(true) }).strict();
const PlannerPayloadSchema = z.union([SkipPayloadSchema, PlanPayloadSchema]);

const UNSAFE_PLAN_ACTIONS = [
  /(?:点击|确认|执行|完成|进行|立即|马上|公开|永久|提交)(?:下单|付款|支付|发送|发出|寄出|预订|预约|报名|投递|删除|注销|取消订阅|更改权限|修改权限|提交|分享)/i,
  /(?:提交(?:订单|表单|申请|报名)|支付(?:订单|费用|款项)|付款|下单|发送(?:邮件|消息|文件)|删除(?:账号|账户|文件|数据)|注销(?:账号|账户)|取消订阅|分享(?:文件|链接|文档)|更改(?:访问)?权限|修改(?:访问)?权限)/i,
  /\b(?:place\s+order|pay|send|share|change\s+access|delete|unsubscribe|submit)\b/i,
] as const;

export interface PlanStep {
  idx: number;
  status: 'pending' | 'running' | 'done' | 'failed';
  note?: string;
}

export interface PlanGenerateResult {
  planText: string | null;
  planStatus: PlanStep[] | null;
}

export async function generatePlan(opts: {
  messagesAdapter: MessagesAdapter;
  intent: string;
  logger: Logger;
  taskId?: string;
}): Promise<PlanGenerateResult> {
  try {
    const response = await opts.messagesAdapter.create(
      {
        maxTokens: 512,
        thinking: { type: 'disabled' },
        system: PLAN_SYSTEM,
        messages: [{ role: 'user', content: `任务：${opts.intent}` }],
      },
      { timeoutMs: 6_000, maxRetries: 0 },
    );
    const raw = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
      .trim();
    const payload = parsePlannerPayload(raw);

    if (!payload || 'skip' in payload) {
      if (!payload) {
        opts.logger.warn(
          {
            taskId: opts.taskId,
            provider: response.metadata.provider,
            model: response.metadata.model,
            reason: 'INVALID_PLAN_OUTPUT',
          },
          'plan-service: planner output rejected',
        );
      }
      return noPlan();
    }

    if (payload.steps.some((step) => isUnsafePlanAction(step.text))) {
      opts.logger.warn(
        {
          taskId: opts.taskId,
          provider: response.metadata.provider,
          model: response.metadata.model,
          reason: 'UNSAFE_PLAN_ACTION',
        },
        'plan-service: planner output rejected',
      );
      return noPlan();
    }

    const planStatus: PlanStep[] = payload.steps.map((_, idx) => ({
      idx,
      status: 'pending',
    }));
    opts.logger.info(
      {
        taskId: opts.taskId,
        provider: response.metadata.provider,
        model: response.metadata.model,
        stepCount: payload.steps.length,
        inputTokens: response.usage.inputTokens,
        outputTokens: response.usage.outputTokens,
        cacheReadInputTokens: response.usage.cacheReadInputTokens,
        usageComplete: response.usage.complete,
      },
      'plan-service: plan generated',
    );
    return {
      planText: renderPlan(payload),
      planStatus,
    };
  } catch (error) {
    opts.logger.warn(
      {
        taskId: opts.taskId,
        provider: opts.messagesAdapter.metadata.provider,
        model: opts.messagesAdapter.metadata.model,
        reason: error instanceof MessagesAdapterError ? error.code : 'PROVIDER_ERROR',
      },
      'plan-service: generate failed, falling through to no-plan',
    );
    return noPlan();
  }
}

function parsePlannerPayload(raw: string): z.infer<typeof PlannerPayloadSchema> | null {
  if (!raw) return null;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end < start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  const result = PlannerPayloadSchema.safeParse(parsed);
  return result.success ? result.data : null;
}

function isUnsafePlanAction(text: string): boolean {
  return UNSAFE_PLAN_ACTIONS.some((pattern) => pattern.test(text));
}

function renderPlan(payload: z.infer<typeof PlanPayloadSchema>): string {
  const steps = payload.steps.map((step, index) => `${index + 1}. ${step.text}（${step.tool}）`);
  return ['**执行计划**', ...steps, '', `**预计耗时**：~${payload.estimatedSeconds}s`].join('\n');
}

function noPlan(): PlanGenerateResult {
  return { planText: null, planStatus: null };
}

/** Skip obviously trivial requests before spending a model call. */
export function shouldSkipPlan(intent: string): boolean {
  const normalized = intent.trim();
  if (!normalized) return true;
  return normalized.length <= 8;
}
