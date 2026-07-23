import { summariseIntent } from '@/utils/summarise-intent';

export interface TaskDisplayCopyInput {
  readonly intent: string;
  readonly title?: string | null;
}

const CREATIVE_INTERNAL_SECTION =
  /(?:图片设置|图片风格要求|主体一致性要求)[：:]/u;
const CREATIVE_LANE_PREFIX =
  /^(?:生成(?:一张)?图片|基于上传的参考图片进行图生图或图片编辑)[：:]/u;
const APPENDED_CREATIVE_INSTRUCTIONS =
  /(?:\n\s*(?:图片风格要求|主体一致性要求)[：:]|^主体一致性要求[：:]\s*请以用户上传)/u;

/**
 * Returns the user-authored part of an intent for display only. The stored
 * intent remains untouched so retries and audits keep the complete request.
 */
export function taskDisplayIntent(intent: string): string {
  const rawIntent = intent.trim();
  const cleanIntent = cleanCreativeTaskCopy(rawIntent);
  if (cleanIntent) return cleanIntent;
  if (looksLikeGeneratedImageCopy(rawIntent)) return '图片任务';
  return rawIntent || '未命名任务';
}

/**
 * Resolves full user-facing task copy. A usable title wins; generated titles
 * containing only internal instructions fall back to the cleaned intent.
 */
export function taskDisplaySource(task: TaskDisplayCopyInput): string {
  const rawTitle = task.title?.trim() ?? '';
  const cleanTitle = cleanCreativeTaskCopy(rawTitle);
  if (cleanTitle) return cleanTitle;
  return taskDisplayIntent(task.intent);
}

export function taskDisplayTitle(
  task: TaskDisplayCopyInput,
  maxLen = 24,
): string {
  const source = taskDisplaySource(task);
  const rawTitle = task.title?.trim() ?? '';
  if (rawTitle && cleanCreativeTaskCopy(rawTitle)) {
    return truncateTaskDisplayText(source, maxLen);
  }
  const summary = summariseIntent(source, maxLen);
  return summary || truncateTaskDisplayText(source, maxLen);
}

function cleanCreativeTaskCopy(source: string): string {
  if (!source) return '';
  let clean = source.trim();
  if (!looksLikeGeneratedImageCopy(clean)) return clean;
  const internalSection = clean.search(CREATIVE_INTERNAL_SECTION);
  if (internalSection >= 0) {
    clean = clean.slice(0, internalSection).trim();
  }
  return clean
    .replace(/^生成(?:一张)?图片[：:]\s*/u, '')
    .replace(/^基于上传的参考图片进行图生图或图片编辑[：:]\s*/u, '')
    .trim();
}

function looksLikeGeneratedImageCopy(source: string): boolean {
  return (
    CREATIVE_LANE_PREFIX.test(source) ||
    APPENDED_CREATIVE_INSTRUCTIONS.test(source)
  );
}

function truncateTaskDisplayText(source: string, maxLen: number): string {
  if (source.length <= maxLen) return source;
  if (maxLen <= 1) return '…';
  return `${source.slice(0, maxLen - 1).trim()}…`;
}
