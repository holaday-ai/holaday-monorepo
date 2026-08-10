export type PlannedSaveAction = 'create' | 'occurrence' | 'future' | 'series';
export type PlannedEditorErrorKey = 'instruction' | 'items' | 'scheduledAt' | 'customDays';
export type PlannedEditorErrors = Partial<Record<PlannedEditorErrorKey, string>>;

export interface PlannedEditorDraft {
  title: string;
  instruction: string;
  multiple: boolean;
  items: string[];
  repeatType: 'once' | 'daily' | 'weekly' | 'monthly' | 'custom';
  customDays: string[];
  date: string;
  time: string;
  timezone: string;
  reminderMinutes: string;
  endsOn: string | null;
}

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

export function validatePlannedEditor(editor: PlannedEditorDraft): PlannedEditorErrors {
  const errors: PlannedEditorErrors = {};
  if (editor.multiple) {
    if (!editor.items.some((item) => item.trim())) {
      errors.items = '请填写至少一个任务';
    }
  } else if (!editor.instruction.trim()) {
    errors.instruction = '请填写任务内容';
  }
  if (!isValidLocalDateTime(editor.date, editor.time)) {
    errors.scheduledAt = '请选择有效的执行日期和时间';
  }
  if (editor.repeatType === 'custom' && editor.customDays.length === 0) {
    errors.customDays = '请选择至少一个执行日';
  }
  return errors;
}

const ERROR_ORDER: readonly PlannedEditorErrorKey[] = [
  'instruction',
  'items',
  'scheduledAt',
  'customDays',
];

export function firstPlannedEditorError(
  errors: PlannedEditorErrors,
): PlannedEditorErrorKey | null {
  return ERROR_ORDER.find((key) => Boolean(errors[key])) ?? null;
}

export function plannedEditorFingerprint(editor: PlannedEditorDraft): string {
  return JSON.stringify({
    title: editor.title.trim(),
    instruction: editor.instruction.trim(),
    multiple: editor.multiple,
    items: editor.items.map((item) => item.trim()),
    repeatType: editor.repeatType,
    customDays: [...editor.customDays].sort(),
    date: editor.date,
    time: editor.time,
    timezone: editor.timezone,
    reminderMinutes: editor.reminderMinutes,
    endsOn: editor.endsOn,
  });
}

function isValidLocalDateTime(date: string, time: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return false;
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    hour === undefined ||
    minute === undefined ||
    hour > 23 ||
    minute > 59
  ) {
    return false;
  }
  const value = new Date(year, month - 1, day, hour, minute, 0, 0);
  return (
    value.getFullYear() === year &&
    value.getMonth() === month - 1 &&
    value.getDate() === day &&
    value.getHours() === hour &&
    value.getMinutes() === minute
  );
}
