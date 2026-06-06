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
]);

export function stepDetailSummary(
  steps: readonly Pick<UiStep, 'status'>[],
): StepDetailSummary {
  const total = steps.length;
  const done = steps.filter((step) => step.status === 'done').length;
  const failed = steps.filter((step) => step.status === 'failed').length;
  const running = steps.filter((step) => step.status === 'running').length;
  const cancelled = steps.filter((step) => step.status === 'cancelled').length;
  const parts =
    total > 0
      ? [`${done}/${total} 步完成`]
      : ['暂无详细步骤'];
  if (running > 0) parts.push(`${running} 执行中`);
  if (failed > 0) parts.push(`${failed} 失败`);
  if (cancelled > 0) parts.push(`${cancelled} 取消`);
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
