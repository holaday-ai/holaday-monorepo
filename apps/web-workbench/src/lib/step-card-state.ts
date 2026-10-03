import type { UiStep } from '@/types/task';
import { classifyBrowserErrorKind } from './browser-error-kind';
import { humaniseTaskError } from './error-copy';

export type StepExecutionStatus = UiStep['status'];

export interface StepDetailSummary {
  readonly total: number;
  readonly done: number;
  readonly failed: number;
  readonly running: number;
  readonly cancelled: number;
  readonly label: string;
  readonly tone: 'idle' | 'running' | 'done' | 'failed' | 'cancelled';
}

export function stepStatusLabel(status: StepExecutionStatus, tickIndex: number): string {
  const stepNumber = Math.max(0, tickIndex) + 1;
  const statusLabel = stepStatusText(status);
  return `步骤 ${stepNumber} · ${statusLabel}`;
}

export function stepStatusText(status: StepExecutionStatus): string {
  if (status === 'done') return '已完成';
  if (status === 'failed') return '失败';
  if (status === 'cancelled') return '已取消';
  return '执行中';
}

export function stepRecordStatusText(
  step: Pick<UiStep, 'actionKind' | 'status'>,
): string | null {
  switch (step.actionKind) {
    case 'selected_chrome_action':
      return executionStatusText(step.status, {
        done: '操作已应用',
        failed: '未确认完成',
        running: '操作执行中',
        cancelled: '未确认完成',
      });
    case 'selected_chrome_observe':
      return executionStatusText(step.status, {
        done: '观察已记录',
        failed: '观察失败',
        running: '观察中',
        cancelled: '观察未确认',
      });
    case 'selected_chrome_finish':
      return executionStatusText(step.status, {
        done: '验证通过',
        failed: '验证失败',
        running: '验证中',
        cancelled: '验证未确认',
      });
    case 'selected_chrome_plan_discarded':
      return executionStatusText(step.status, {
        done: '未执行',
        failed: '记录失败',
        running: '记录中',
        cancelled: '记录未确认',
      });
    case 'selected_chrome_handoff':
      return executionStatusText(step.status, {
        done: '人工已交还',
        failed: '交还失败',
        running: '等待人工交还',
        cancelled: '交还未确认',
      });
    case 'browser_act':
    case 'browser_observe':
    case 'browser_finish':
      return executionStatusText(step.status, {
        done: '历史记录 · 未验证',
        failed: '历史记录 · 失败',
        running: '历史记录 · 进行中',
        cancelled: '历史记录 · 已取消',
      });
    default:
      return null;
  }
}

export function stepRecordStatusLabel(
  step: Pick<UiStep, 'actionKind' | 'status' | 'tickIndex'>,
): string {
  const recordStatus = stepRecordStatusText(step);
  const stepNumber = SELECTED_CHROME_RECORDS.has(step.actionKind ?? '')
    ? Math.max(1, step.tickIndex)
    : Math.max(0, step.tickIndex) + 1;
  return recordStatus
    ? `步骤 ${stepNumber} · ${recordStatus}`
    : stepStatusLabel(step.status, step.tickIndex);
}

export function stepDoneIsCompletion(actionKind: string | undefined): boolean {
  return !INFORMATIONAL_EXECUTION_RECORDS.has(actionKind ?? '');
}

export function stepDisplayStepsForTask<
  T extends Pick<UiStep, 'actionKind' | 'status'>,
>(
  steps: readonly T[],
  taskStatus: string | null | undefined,
): readonly T[] {
  const staleRunningStatus = (() => {
    switch (taskStatus) {
      case 'completed':
        return 'done' as const;
      case 'failed':
        return 'failed' as const;
      case 'partial_success':
      case 'cancelled':
        return 'cancelled' as const;
      default:
        return null;
    }
  })();
  if (!staleRunningStatus) return steps;
  return steps.map((step) =>
    step.status === 'running'
      ? {
          ...step,
          status:
            staleRunningStatus === 'done' &&
            SELECTED_CHROME_RECORDS.has(step.actionKind ?? '')
              ? ('cancelled' as const)
              : staleRunningStatus,
        }
      : step,
  );
}

export function stepDurationLabel(durationMs: number | null | undefined): string | null {
  if (durationMs == null || durationMs <= 0) return null;
  if (durationMs < 1000) return '<1s';
  if (durationMs < 60_000) return `${(durationMs / 1000).toFixed(1)}s`;
  const minutes = Math.floor(durationMs / 60_000);
  const seconds = Math.round((durationMs % 60_000) / 1000);
  return `${minutes}分${String(seconds).padStart(2, '0')}秒`;
}

export function stepDisplayTitle(
  step: Pick<UiStep, 'actionKind' | 'tickIndex'>,
): string {
  if (!step.actionKind) return `步骤 ${Math.max(0, step.tickIndex) + 1}`;
  switch (step.actionKind) {
    case 'click':
    case 'click_ref':
      return '点击元素';
    case 'type':
    case 'type_in_ref':
      return '输入文本';
    case 'key':
    case 'press_key':
      return '按键';
    case 'scroll':
      return '滚动页面';
    case 'wait':
      return '等待页面';
    case 'screenshot':
      return '截图';
    case 'navigate':
      return '跳转页面';
    case 'computer':
      return '浏览器操作';
    case 'web_search':
      return '联网搜索';
    case 'bash':
      return '命令执行';
    case 'code_execution':
    case 'run_code':
    case 'python':
      return '代码执行';
    case 'str_replace_editor':
    case 'file_editor':
    case 'text_editor':
      return '文件编辑';
    case 'text':
      return '结果说明';
    case 'wait_for_human':
      return '等待人工验证';
    case 'selected_chrome_action':
      return '浏览器操作结果';
    case 'selected_chrome_observe':
      return '页面观察记录';
    case 'selected_chrome_finish':
      return '结果验证记录';
    case 'selected_chrome_plan_discarded':
      return '未执行计划';
    case 'selected_chrome_handoff':
      return '人工交还记录';
    case 'browser_act':
      return '历史浏览器轮次（未验证）';
    case 'browser_observe':
      return '历史页面观察（未验证）';
    case 'browser_finish':
      return '历史结束轮次（未验证）';
    case 'done':
      return '任务完成';
    case 'give_up':
      return '放弃任务';
    default:
      return '任务步骤';
  }
}

export function stepDisplaySummary(
  step: Pick<UiStep, 'actionKind' | 'actionSummary'>,
): string | null {
  const summary = step.actionSummary?.trim();
  if (!summary) return null;
  const raw = summary.toLowerCase();
  const kind = step.actionKind?.toLowerCase();
  if (kind && raw === kind) return null;
  if (RAW_LABEL_SUMMARIES.has(raw)) return null;
  return summary;
}

export function shouldShowStepCard(
  step: Pick<UiStep, 'actionKind' | 'actionSummary'>,
): boolean {
  if (stepDisplaySummary(step)) return true;
  return step.actionKind !== 'computer' && step.actionKind !== 'text';
}

export function stepFailureMessage(step: Pick<UiStep, 'actionKind' | 'message'>): string | null {
  const message = step.message?.trim();
  if (!message) return null;
  const haystack = `${step.actionKind ?? ''} ${message}`.toLowerCase();
  const browserKind = classifyBrowserErrorKind(haystack);

  switch (browserKind) {
    case 'extension_timeout':
    case 'timeout':
      return '浏览器响应超时，可能是页面仍在加载或扩展连接短暂中断。可以重新执行当前任务。';
    case 'extension_missing':
      return '浏览器扩展未连接。请打开 HOLA DAY 扩展后重试。';
    case 'extension_disconnected':
      return '浏览器扩展连接已断开。请重新打开 HOLA DAY 扩展后重试。';
    case 'extension_permission':
      return '浏览器扩展缺少当前网站权限。请在扩展里允许访问该网站后重试。';
    case 'no_active_tab':
      return '浏览器当前没有活动标签页。请打开一个网页后重试。';
    case 'hibernated':
      return '浏览器会话已休眠。重新执行任务时会拉起新的浏览器。';
    case 'dns':
      return '无法访问该网址。请检查网址是否正确，或换一个能直接访问的页面。';
    case 'ssl':
      return '网站证书异常，浏览器无法安全连接。请确认网址是否正确。';
    case 'connection':
      return '无法连接到该站点。请稍后重试，或换一个能直接访问的网址。';
    case 'transport_closed':
      return '浏览器连接中断，请重新执行任务。';
    case 'page_switch':
      return '页面正在切换，本次步骤未能稳定完成。可以重新执行当前任务。';
    case 'captcha':
      return '网站要求人机验证。请在浏览器里完成验证后继续，或重新执行任务。';
    case 'login':
      return '目标网站需要登录。请在浏览器里完成登录后继续，或重新执行任务。';
    default:
      break;
  }

  return humaniseTaskError(message);
}

const RAW_LABEL_SUMMARIES = new Set([
  'bash',
  'click',
  'click_ref',
  'code_execution',
  'computer',
  'done',
  'file_editor',
  'give_up',
  'key',
  'navigate',
  'press_key',
  'python',
  'run_code',
  'screenshot',
  'scroll',
  'str_replace_editor',
  'text',
  'text_editor',
  'thinking',
  'type',
  'type_in_ref',
  'wait',
  'wait_for_human',
  'web_search',
  'selected_chrome_action',
  'selected_chrome_observe',
  'selected_chrome_finish',
  'selected_chrome_plan_discarded',
  'selected_chrome_handoff',
  'browser_act',
  'browser_observe',
  'browser_finish',
]);

const SELECTED_CHROME_RECORDS = new Set([
  'selected_chrome_action',
  'selected_chrome_observe',
  'selected_chrome_finish',
  'selected_chrome_plan_discarded',
  'selected_chrome_handoff',
]);

const HISTORICAL_BROWSER_RECORDS = new Set([
  'browser_act',
  'browser_observe',
  'browser_finish',
]);

const INFORMATIONAL_EXECUTION_RECORDS = new Set([
  'selected_chrome_observe',
  'selected_chrome_plan_discarded',
  'selected_chrome_handoff',
  ...HISTORICAL_BROWSER_RECORDS,
]);

export function stepDetailSummary(
  steps: readonly Pick<UiStep, 'actionKind' | 'status'>[],
): StepDetailSummary {
  const total = steps.length;
  const done = steps.filter((step) => step.status === 'done').length;
  const failed = steps.filter((step) => step.status === 'failed').length;
  const running = steps.filter((step) => step.status === 'running').length;
  const cancelled = steps.filter((step) => step.status === 'cancelled').length;
  const hasExecutionRecords = steps.some((step) =>
    isExecutionRecord(step.actionKind),
  );
  if (!hasExecutionRecords) {
    return genericStepDetailSummary({ total, done, failed, running, cancelled });
  }

  const recordCount = (actionKind: string, status?: StepExecutionStatus) =>
    steps.filter(
      (step) =>
        step.actionKind === actionKind && (!status || step.status === status),
    ).length;
  const selectedActions = {
    applied: recordCount('selected_chrome_action', 'done'),
    failed: recordCount('selected_chrome_action', 'failed'),
    running: recordCount('selected_chrome_action', 'running'),
    cancelled: recordCount('selected_chrome_action', 'cancelled'),
  };
  const observations = recordCount('selected_chrome_observe');
  const discardedPlans = recordCount('selected_chrome_plan_discarded');
  const handoffs = recordCount('selected_chrome_handoff');
  const historicalUnverified = steps.filter((step) =>
    HISTORICAL_BROWSER_RECORDS.has(step.actionKind ?? ''),
  ).length;
  const parts: string[] = [];
  if (selectedActions.applied > 0) {
    parts.push(`${selectedActions.applied} 项操作已应用`);
  }
  if (selectedActions.running > 0) {
    parts.push(`${selectedActions.running} 项操作执行中`);
  }
  const unconfirmedActions =
    selectedActions.failed + selectedActions.cancelled;
  if (unconfirmedActions > 0) {
    parts.push(`${unconfirmedActions} 项操作未确认完成`);
  }
  if (observations > 0) parts.push(`${observations} 次页面观察`);
  const validationLabels: ReadonlyArray<[StepExecutionStatus, string]> = [
    ['done', '次验证通过'],
    ['running', '次结果验证中'],
    ['failed', '次验证失败'],
    ['cancelled', '次验证未确认'],
  ];
  for (const [status, suffix] of validationLabels) {
    const count = recordCount('selected_chrome_finish', status);
    if (count > 0) parts.push(`${count} ${suffix}`);
  }
  if (discardedPlans > 0) parts.push(`${discardedPlans} 项计划未执行`);
  if (handoffs > 0) parts.push(`${handoffs} 次人工交还`);
  if (historicalUnverified > 0) {
    parts.push(`${historicalUnverified} 条历史轮次（未验证）`);
  }

  const otherSteps = steps.filter((step) => !isExecutionRecord(step.actionKind));
  if (otherSteps.length > 0) {
    const other = genericStepDetailSummary({
      total: otherSteps.length,
      done: otherSteps.filter((step) => step.status === 'done').length,
      failed: otherSteps.filter((step) => step.status === 'failed').length,
      running: otherSteps.filter((step) => step.status === 'running').length,
      cancelled: otherSteps.filter((step) => step.status === 'cancelled').length,
    });
    parts.push(`其他步骤：${other.label}`);
  }
  const tone = executionDetailTone(steps, selectedActions.applied);
  return {
    total,
    done,
    failed,
    running,
    cancelled,
    label: parts.join(' · '),
    tone,
  };
}

function executionStatusText(
  status: StepExecutionStatus,
  labels: Readonly<Record<StepExecutionStatus, string>>,
): string {
  return labels[status];
}

function isExecutionRecord(actionKind: string | undefined): boolean {
  const kind = actionKind ?? '';
  return SELECTED_CHROME_RECORDS.has(kind) || HISTORICAL_BROWSER_RECORDS.has(kind);
}

function executionDetailTone(
  steps: readonly Pick<UiStep, 'actionKind' | 'status'>[],
  appliedActions: number,
): StepDetailSummary['tone'] {
  if (steps.some((step) => step.status === 'failed')) return 'failed';
  if (steps.some((step) => step.status === 'running')) return 'running';
  if (steps.some((step) => step.status === 'cancelled')) return 'cancelled';
  const passedValidation = steps.some(
    (step) =>
      step.actionKind === 'selected_chrome_finish' && step.status === 'done',
  );
  return appliedActions > 0 || passedValidation ? 'done' : 'idle';
}

function genericStepDetailSummary(counts: {
  total: number;
  done: number;
  failed: number;
  running: number;
  cancelled: number;
}): StepDetailSummary {
  const { total, done, failed, running, cancelled } = counts;
  const parts = total > 0 ? [`${done}/${total} 步完成`] : ['暂无详细步骤'];
  if (running > 0) parts.push(`${running} 执行中`);
  if (failed > 0) parts.push(`${failed} 失败`);
  if (cancelled > 0) parts.push(`${cancelled} 已取消`);
  const tone =
    failed > 0
      ? 'failed'
      : running > 0
        ? 'running'
        : cancelled > 0 && done + cancelled === total
          ? 'cancelled'
          : total > 0 && done === total
            ? 'done'
            : 'idle';
  return { total, done, failed, running, cancelled, label: parts.join(' · '), tone };
}
