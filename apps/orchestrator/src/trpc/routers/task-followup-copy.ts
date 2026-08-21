import type { ExecutionMode } from '../../agent/intent-classifier.js';

const BROWSER_FOLLOW_UP_VERBS = ['打开', '登录', '访问', '点击', '下载', '搜索'];

export function followUpTerminalGuardMessage(): string {
  return '只能追问已完成/需复核/失败/取消的任务，正在执行的任务请用回复';
}

export function followUpParentReasonLabel(status: string): string {
  if (status === 'failed') return '失败原因';
  if (status === 'partial_success') return '需复核原因';
  return '终止原因';
}

export function resolveFollowUpExecutionMode(input: {
  parentHasBrowserContext: boolean;
  typedWorkflowOverride: ExecutionMode | null;
  expertRouteOverride: ExecutionMode | null | undefined;
  classifiedExecutionMode: ExecutionMode;
  explicitMediaMode?: Extract<ExecutionMode, 'image' | 'video_creation'> | null;
}): ExecutionMode {
  // The media workbenches send structured options only when the user is
  // submitting an image/video job. That explicit UI contract must win over
  // prompt keywords such as "上传", which otherwise look like browser actions.
  if (input.explicitMediaMode) return input.explicitMediaMode;
  if (input.parentHasBrowserContext) return 'browser';
  return (
    input.typedWorkflowOverride ??
    input.expertRouteOverride ??
    input.classifiedExecutionMode
  );
}

/**
 * Keep the verification contract and the workflow lineage deliberately
 * separate for derived follow-ups. A calendar/SOP generated from a typed
 * parent must not be checked against the parent's report schema, but it is
 * still part of that workflow and must keep the response-preservation policy.
 */
export function resolveWorkflowIdentities(input: {
  reportWorkflowId: string | null | undefined;
  routingWorkflowId: string | null | undefined;
  legacyWorkflowId: string | null | undefined;
}): {
  contractWorkflowId: string | null;
  lineageWorkflowId: string | null;
} {
  const contractWorkflowId = input.reportWorkflowId ?? input.legacyWorkflowId ?? null;
  return {
    contractWorkflowId,
    lineageWorkflowId:
      input.reportWorkflowId ?? input.routingWorkflowId ?? input.legacyWorkflowId ?? null,
  };
}

/**
 * Keep legacy browser tasks on the same continuation path as current rows.
 * An explicit non-browser mode wins; evidence heuristics are only for older
 * tasks written before executionMode was persisted.
 */
export function followUpParentHasBrowserContext(input: {
  executionMode?: string | null;
  finalUrl?: string | null;
  hasFinalScreenshot?: boolean;
  intent: string;
}): boolean {
  if (input.executionMode) return input.executionMode === 'browser';
  if (input.finalUrl?.trim() || input.hasFinalScreenshot) return true;
  if (/https?:\/\//i.test(input.intent)) return true;
  return BROWSER_FOLLOW_UP_VERBS.some((verb) => input.intent.includes(verb));
}

export type BrowserFollowUpContinuation =
  | 'fresh'
  | 'adopted'
  | 'restore'
  | 'unavailable';

export function resolveBrowserFollowUpContinuation(input: {
  hasParentTask: boolean;
  parentHasBrowserContext: boolean;
  adopted: boolean;
  restoreUrl: string | null;
}): BrowserFollowUpContinuation {
  if (!input.hasParentTask || !input.parentHasBrowserContext) return 'fresh';
  if (input.adopted) return 'adopted';
  return input.restoreUrl ? 'restore' : 'unavailable';
}
