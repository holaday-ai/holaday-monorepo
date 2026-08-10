import rruleModule from 'rrule';
import { z } from 'zod';
import { computeNextRunFromInputs } from '../agent/scheduled-runner.js';
import type { PlannedRepeatType } from './planned-task-rules.js';

const { rrulestr } = rruleModule as {
  rrulestr: (value: string) => { after(date: Date, inclusive?: boolean): Date | null };
};

export const PLANNED_REPEAT_TYPES = [
  'once',
  'daily',
  'weekly',
  'monthly',
  'custom',
] as const;

export function validatePlannedRepeatRule(
  repeatType: PlannedRepeatType,
  rrule: string | null,
): void {
  if (repeatType === 'custom' && !rrule?.trim()) {
    throw new Error('自定义重复需要重复规则');
  }
  if (!rrule?.trim()) return;
  try {
    rrulestr(rrule.trim());
  } catch (error) {
    throw new Error(
      `重复规则格式错误：${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

const rruleSchema = z
  .string()
  .trim()
  .max(255)
  .nullable()
  .optional()
  .transform((value) => value || null)
  .superRefine((value, ctx) => {
    if (!value) return;
    try {
      rrulestr(value);
    } catch (error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `重复规则格式错误：${error instanceof Error ? error.message : String(error)}`,
      });
    }
  });

export const plannedEndsOnInputSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, '结束日期格式必须为 YYYY-MM-DD')
  .nullable()
  .optional();

export const plannedTaskCreateInputSchema = z
  .object({
    title: z.string().trim().max(200).default(''),
    instruction: z.string().trim().max(4000).default(''),
    notes: z.string().trim().max(4000).nullable().optional(),
    items: z.array(z.string().trim().min(1).max(2000)).max(50).default([]),
    repeatType: z.enum(PLANNED_REPEAT_TYPES),
    scheduledAt: z.string().datetime(),
    rrule: rruleSchema,
    timezone: z.string().trim().min(1).max(64).default('Asia/Shanghai'),
    endsOn: plannedEndsOnInputSchema,
    reminderMinutes: z.number().int().min(0).max(60 * 24 * 7).nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.instruction && value.items.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['instruction'],
        message: '至少需要一个任务',
      });
    }
    if (value.repeatType === 'custom' && !value.rrule) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['rrule'],
        message: '自定义重复需要重复规则',
      });
    }
    if (value.repeatType === 'once' && value.endsOn) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endsOn'],
        message: '单次任务不能设置结束日期',
      });
    }
  });

export const plannedCalendarInputSchema = z
  .object({
    rangeStart: z.string().datetime(),
    rangeEnd: z.string().datetime(),
  })
  .superRefine((value, ctx) => {
    const start = new Date(value.rangeStart);
    const end = new Date(value.rangeEnd);
    const span = end.getTime() - start.getTime();
    if (span <= 0 || span > 400 * 24 * 60 * 60 * 1000) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['rangeEnd'],
        message: '日历范围必须在开始时间之后且不超过 400 天',
      });
    }
  });

export function resolveRequestedSchedule(input: {
  scheduledAt: string;
  repeatType: PlannedRepeatType;
  rrule: string | null;
  now?: Date;
}): { firstRunAt: Date; nextRunAt: Date; adjusted: boolean } {
  const firstRunAt = new Date(input.scheduledAt);
  if (Number.isNaN(firstRunAt.getTime())) throw new Error('执行时间无效');
  const now = input.now ?? new Date();
  const past = firstRunAt.getTime() < now.getTime() - 60_000;
  if (!past) return { firstRunAt, nextRunAt: firstRunAt, adjusted: false };
  if (input.repeatType === 'once' && !input.rrule) throw new Error('执行时间已过去，请重新选择');

  let nextRunAt = firstRunAt;
  let safety = 20_000;
  while (nextRunAt.getTime() <= now.getTime() && safety > 0) {
    const next = computeNextRunFromInputs({
      from: input.rrule ? now : nextRunAt,
      rrule: input.rrule,
      repeatType: input.repeatType,
    });
    if (!next) throw new Error('无法计算下次执行时间，请检查重复规则');
    nextRunAt = next;
    if (input.rrule) break;
    safety -= 1;
  }
  if (safety === 0) throw new Error('重复规则跨度过大，请重新选择开始时间');
  return { firstRunAt, nextRunAt, adjusted: true };
}

export interface PlannedMutationResult {
  ok: true;
  plannedTaskId: string;
  nextRunAt: Date | null;
  adjusted: boolean;
}

export function plannedMutationResult(
  plannedTaskId: string,
  schedule?: { nextRunAt: Date | null; adjusted: boolean } | null,
): PlannedMutationResult {
  return {
    ok: true,
    plannedTaskId,
    nextRunAt: schedule?.nextRunAt ?? null,
    adjusted: schedule?.adjusted ?? false,
  };
}
