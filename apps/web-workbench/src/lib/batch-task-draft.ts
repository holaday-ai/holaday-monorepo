export interface BatchTaskDraft {
  readonly goal: string;
  readonly steps: string;
  readonly output: string;
}

export const EMPTY_BATCH_TASK_DRAFT: BatchTaskDraft = {
  goal: '',
  steps: '',
  output: '',
};

export interface BatchTaskDraftProgress {
  readonly hasGoal: boolean;
  readonly hasSteps: boolean;
  readonly hasOutput: boolean;
  readonly missingGoal: boolean;
  readonly count: number;
}

export function batchTaskDraftFromPrompt(prompt: string): BatchTaskDraft {
  const trimmed = prompt.trim();
  if (!trimmed) return { ...EMPTY_BATCH_TASK_DRAFT };

  const parsed = parseLabelledPrompt(trimmed);
  if (parsed) return parsed;

  return {
    goal: trimmed,
    steps: '',
    output: '',
  };
}

export function composeBatchTaskPrompt(draft: BatchTaskDraft): string {
  const goal = draft.goal.trim();
  const steps = draft.steps.trim();
  const output = draft.output.trim();
  const parts: string[] = [];
  if (goal) parts.push(`目标：${goal}`);
  if (steps) parts.push(`步骤：${steps}`);
  if (output) parts.push(`输出：${output}`);
  return parts.join('\n');
}

export function batchTaskDraftHasContent(draft: BatchTaskDraft): boolean {
  return (
    draft.goal.trim().length > 0 ||
    draft.steps.trim().length > 0 ||
    draft.output.trim().length > 0
  );
}

export function batchTaskDraftIsEmpty(draft: BatchTaskDraft): boolean {
  return !batchTaskDraftHasContent(draft);
}

export function batchTaskDraftMissingGoal(draft: BatchTaskDraft): boolean {
  return draft.goal.trim().length === 0 && batchTaskDraftHasContent(draft);
}

export function batchTaskDraftHasReusableDetail(draft: BatchTaskDraft): boolean {
  return draft.steps.trim().length > 0 || draft.output.trim().length > 0;
}

export function firstBatchTaskDraftMissingGoal(
  drafts: readonly BatchTaskDraft[],
): number | null {
  const index = drafts.findIndex(batchTaskDraftMissingGoal);
  return index >= 0 ? index : null;
}

export function batchTaskDraftProgress(draft: BatchTaskDraft): BatchTaskDraftProgress {
  const hasGoal = draft.goal.trim().length > 0;
  const hasSteps = draft.steps.trim().length > 0;
  const hasOutput = draft.output.trim().length > 0;
  return {
    hasGoal,
    hasSteps,
    hasOutput,
    missingGoal: !hasGoal && (hasSteps || hasOutput),
    count: [hasGoal, hasSteps, hasOutput].filter(Boolean).length,
  };
}

function parseLabelledPrompt(prompt: string): BatchTaskDraft | null {
  const fields: Record<keyof BatchTaskDraft, string[]> = {
    goal: [],
    steps: [],
    output: [],
  };
  let current: keyof BatchTaskDraft | null = null;
  let sawLabel = false;

  for (const rawLine of prompt.split('\n')) {
    const line = rawLine.trim();
    const match = /^(目标|步骤|输出)\s*[:：]\s*(.*)$/u.exec(line);
    if (match) {
      sawLabel = true;
      current =
        match[1] === '目标'
          ? 'goal'
          : match[1] === '步骤'
            ? 'steps'
            : 'output';
      if (match[2]) fields[current].push(match[2]);
      continue;
    }
    if (current && line) fields[current].push(line);
  }

  if (!sawLabel) return null;
  return {
    goal: fields.goal.join('\n'),
    steps: fields.steps.join('\n'),
    output: fields.output.join('\n'),
  };
}
