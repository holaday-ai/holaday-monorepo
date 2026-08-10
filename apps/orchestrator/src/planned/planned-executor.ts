import { computeNextRunFromInputs } from '../agent/scheduled-runner.js';
import { normalizePlannedItems, type PlannedRepeatType } from './planned-task-rules.js';

const OCCURRENCE_CONTENT_PREFIX = 'planned-content:v1:';

export interface OccurrenceContent {
  title: string;
  instruction: string;
  items: string[];
}

export function encodeOccurrenceContent(input: OccurrenceContent): string {
  return `${OCCURRENCE_CONTENT_PREFIX}${JSON.stringify({
    title: input.title.trim(),
    instruction: input.instruction.trim(),
    items: normalizePlannedItems(input.items),
  })}`;
}

export function parseOccurrenceContent(value: string | null): OccurrenceContent | null {
  if (!value?.startsWith(OCCURRENCE_CONTENT_PREFIX)) return null;
  try {
    const parsed = JSON.parse(value.slice(OCCURRENCE_CONTENT_PREFIX.length)) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const candidate = parsed as Record<string, unknown>;
    if (
      typeof candidate.title !== 'string' ||
      typeof candidate.instruction !== 'string' ||
      !Array.isArray(candidate.items) ||
      candidate.items.some((item) => typeof item !== 'string')
    ) {
      return null;
    }
    return {
      title: candidate.title,
      instruction: candidate.instruction,
      items: normalizePlannedItems(candidate.items as string[]),
    };
  } catch {
    return null;
  }
}

export function resolvePlannedRunTitle(
  planTitle: string,
  contentOverride: OccurrenceContent | null,
): string {
  return contentOverride?.title.trim() || planTitle;
}

export function preparePlannedTaskCreate(input: {
  title: string;
  instruction: string;
  items: readonly string[];
}): {
  title: string;
  instruction: string;
  scope: 'single' | 'multiple';
  items: string[];
} {
  const instruction = input.instruction.trim();
  const normalizedItems = normalizePlannedItems(input.items);
  const multiple = normalizedItems.length > 0;
  const items = multiple ? normalizedItems : normalizePlannedItems([instruction]);
  if (items.length === 0) throw new Error('至少需要一个任务');
  const title = input.title.trim() || items[0]!.slice(0, 200);
  return {
    title,
    instruction: instruction || items[0]!,
    scope: multiple ? 'multiple' : 'single',
    items,
  };
}

export function composePlannedItemInstruction(input: {
  itemInstruction: string;
  sharedInstruction: string;
  multiple: boolean;
}): string {
  const item = input.itemInstruction.trim();
  const shared = input.sharedInstruction.trim();
  if (!input.multiple || !shared || shared === item) return item || shared;
  return `${item}\n\n统一执行要求：\n${shared}`;
}

export function advancePlannedSchedule(input: {
  firedAt: Date;
  repeatType: PlannedRepeatType;
  rrule: string | null;
  dispatchSucceeded: boolean;
}): { status: 'active' | 'completed' | 'failed'; nextRunAt: Date | null } {
  const nextRunAt = computeNextRunFromInputs({
    from: input.firedAt,
    rrule: input.rrule,
    repeatType: input.repeatType,
  });
  if (nextRunAt) return { status: 'active', nextRunAt };
  return {
    status: input.dispatchSucceeded ? 'completed' : 'failed',
    nextRunAt: null,
  };
}

export function derivePlannedRunOutcome(input:
  | { kind: 'task'; status: string }
  | { kind: 'batch'; status: string },
):
  | { terminal: false; status: 'running' }
  | {
      terminal: true;
      status: 'completed' | 'partial_success' | 'failed' | 'cancelled';
    } {
  if (input.kind === 'batch') {
    if (input.status === 'completed') return { terminal: true, status: 'completed' };
    if (input.status === 'partial') return { terminal: true, status: 'partial_success' };
    if (input.status === 'cancelled') return { terminal: true, status: 'cancelled' };
    return { terminal: false, status: 'running' };
  }
  if (input.status === 'completed') return { terminal: true, status: 'completed' };
  if (input.status === 'partial_success') {
    return { terminal: true, status: 'partial_success' };
  }
  if (input.status === 'cancelled') return { terminal: true, status: 'cancelled' };
  if (input.status === 'failed') return { terminal: true, status: 'failed' };
  return { terminal: false, status: 'running' };
}
