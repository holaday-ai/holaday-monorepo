export type PlannedSaveAction = 'create' | 'occurrence' | 'future' | 'series';

const SUCCESS_COPY: Record<PlannedSaveAction, string> = {
  create: '规划已创建',
  occurrence: '本次日程已保存',
  future: '这次及以后的规划已保存',
  series: '整个规划已保存',
};

export function plannedSaveFeedback(input: {
  action: PlannedSaveAction;
  adjusted: boolean;
  nextRunAt: string | Date | null;
  timezone: string;
}): string {
  const base = SUCCESS_COPY[input.action];
  if (!input.adjusted || !input.nextRunAt) return base;
  const effective = new Date(input.nextRunAt);
  if (Number.isNaN(effective.getTime())) return base;
  const formatted = new Intl.DateTimeFormat('zh-CN', {
    timeZone: input.timezone,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
    .format(effective)
    .replace(/\//g, '月')
    .replace(/,?\s+/, '日 ');
  return `${base}，首次执行已调整为 ${formatted}`;
}
