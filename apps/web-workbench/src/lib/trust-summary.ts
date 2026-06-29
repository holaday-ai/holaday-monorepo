import type { AwaitingKind } from '@/lib/awaiting-user-copy';
import { verificationCheckLabel, type VerificationCheck } from '@/lib/verification-banner-copy';
import type { UiTask } from '@/types/task';

export type TrustTone = 'neutral' | 'warning' | 'danger';

export interface TrustEvidenceRow {
  label: string;
  value: string;
  detail: string;
}

export interface TrustSummaryModel {
  tone: TrustTone;
  title: string;
  verdict: string;
  boundary: string;
  rows: TrustEvidenceRow[];
  checks: string[];
  hiddenCheckCount: number;
}

export type RecoveryActionKind = 'retry' | 'prefill';

export interface RecoveryAction {
  kind: RecoveryActionKind;
  label: string;
  detail: string;
  prompt?: string;
}

interface TrustSummaryInput {
  status: UiTask['status'];
  resultText?: string;
  currentUrl?: string | null;
  finalScreenshot?: string | null;
  attachments?: UiTask['attachments'];
  verificationPassed?: boolean | null;
  failureLevel?: UiTask['failureLevel'];
  failedChecks?: Array<VerificationCheck> | null;
}

interface RecoveryInput {
  status: UiTask['status'];
  intent?: string;
  resultText?: string;
  awaitingKind?: AwaitingKind | null;
  failureLevel?: UiTask['failureLevel'];
  failedChecks?: Array<VerificationCheck> | null;
}

export function buildTrustSummary(input: TrustSummaryInput): TrustSummaryModel {
  const failedChecks = input.failedChecks ?? [];
  const checks = dedupe(failedChecks.map(verificationCheckLabel)).slice(0, 4);
  const hiddenCheckCount = Math.max(0, failedChecks.length - checks.length);
  const sourceCount = countVisibleSourceUrls(input.resultText, input.currentUrl);
  const hasFinalUrl = hasHttpUrl(input.currentUrl);
  const hasScreenshot = Boolean(input.finalScreenshot);
  const attachmentCount = input.attachments?.length ?? 0;
  const hardFailure = input.status === 'failed' || input.failureLevel === 'hard_fail';
  const flagged =
    input.status === 'partial_success' ||
    input.verificationPassed === false ||
    failedChecks.length > 0;

  const tone: TrustTone = hardFailure ? 'danger' : flagged ? 'warning' : 'neutral';
  const verdict = trustVerdict({
    status: input.status,
    verificationPassed: input.verificationPassed,
    failureLevel: input.failureLevel,
    failedCheckCount: failedChecks.length,
  });

  return {
    tone,
    title: '本次任务可信度',
    verdict,
    boundary:
      '这里汇总前端已收到的证据，不把推断包装成事实；完整 evidence ledger 未在本视图展开。',
    rows: [
      {
        label: '答案可见来源',
        value: `${sourceCount} 个链接`,
        detail:
          sourceCount > 0
            ? '仅统计结果文本和最终页面里的 http(s) 链接，不代表每条结论都已逐条验证。'
            : '未看到可点击来源；涉及事实、价格、排序时应补充来源后再使用。',
      },
      {
        label: '最终页面',
        value: hasFinalUrl ? '已记录' : '未记录',
        detail: hasFinalUrl
          ? '记录了任务结束时所在 URL，可作为浏览路径线索。'
          : '没有可展示的终态 URL，不能据此判断浏览是否到达目标页面。',
      },
      {
        label: '最终截图',
        value: hasScreenshot ? '已保存' : '未保存',
        detail: hasScreenshot
          ? '保存了任务结束时的可视页面状态，可辅助复核。'
          : '没有终态截图；页面状态需要通过其它来源复核。',
      },
      {
        label: '产物文件',
        value: `${attachmentCount} 个`,
        detail:
          attachmentCount > 0
            ? '有可下载产物或截图附件，仍需核对内容是否满足任务目标。'
            : '没有文件产物；若任务要求下载、导出或生成文件，应重新执行或补充要求。',
      },
      {
        label: '事实级证据',
        value: '未展开',
        detail:
          '后端区分 observed / extracted / inferred；本卡不声称所有结论都已被 observed 证据支持。',
      },
    ],
    checks,
    hiddenCheckCount,
  };
}

export function buildRecoveryActions(input: RecoveryInput): RecoveryAction[] {
  const intent = input.intent?.trim();
  const actions: RecoveryAction[] = [];
  const checkTypes = new Set((input.failedChecks ?? []).map((c) => c.type));

  if (input.status === 'awaiting_user' && input.awaitingKind) {
    if (input.awaitingKind === 'login') {
      actions.push({
        kind: 'prefill',
        label: '登录完成后继续',
        detail: '在浏览器里完成登录后，把这句话发给 HOLA DAY。',
        prompt: '我已完成登录，请继续。',
      });
    } else if (input.awaitingKind === 'captcha') {
      actions.push({
        kind: 'prefill',
        label: '验证完成后继续',
        detail: '完成验证码或滑块后继续原任务。',
        prompt: '我已完成验证，请继续。',
      });
    } else if (input.awaitingKind === 'permission') {
      actions.push({
        kind: 'prefill',
        label: '改用公开来源',
        detail: '目标页无权限时，提供一个可访问来源继续。',
        prompt: '当前页面没有权限，请改用这个公开来源继续：',
      });
    } else if (input.awaitingKind === 'browser_action') {
      actions.push({
        kind: 'prefill',
        label: '确认后继续',
        detail: '你检查完页面后，让任务接着跑。',
        prompt: '我已确认当前页面，可以继续。',
      });
    } else if (input.awaitingKind === 'clarification') {
      actions.push({
        kind: 'prefill',
        label: '补充信息',
        detail: '补上缺失条件后继续，不用重开任务。',
        prompt: '补充信息：',
      });
    }
  }

  if (intent && (input.status === 'failed' || input.status === 'partial_success')) {
    actions.push({
      kind: 'retry',
      label: '重新执行',
      detail: '新开一次任务，保留旧记录用于对照。',
    });
  }

  if (
    checkTypes.has('url_count') ||
    checkTypes.has('source_count') ||
    checkTypes.has('generic.url_grounding')
  ) {
    actions.push({
      kind: 'prefill',
      label: '指定可信来源',
      detail: '把来源范围写清楚，避免未验证链接混入结果。',
      prompt: withIntent(intent, '请只使用以下可信来源，并逐条给出链接：'),
    });
  }

  if (
    checkTypes.has('ecommerce_rows') ||
    checkTypes.has('result_count') ||
    checkTypes.has('price_sort')
  ) {
    actions.push({
      kind: 'prefill',
      label: '补齐字段重试',
      detail: '把名称、价格、链接、排序规则写成硬要求。',
      prompt: withIntent(intent, '请按表格输出：名称 / 价格 / 来源链接，并说明无法验证的项。'),
    });
  }

  if (input.failureLevel === 'needs_clarification') {
    actions.push({
      kind: 'prefill',
      label: '补充约束',
      detail: '结果需要更多条件才能可靠完成。',
      prompt: withIntent(intent, '补充约束：'),
    });
  }

  if (input.status === 'failed' || input.failureLevel === 'hard_fail') {
    actions.push({
      kind: 'prefill',
      label: '拆成小步骤',
      detail: '先完成第一步并保留来源，再继续下一步。',
      prompt: withIntent(intent, '请先只完成第一步，并保留已完成页面和来源。'),
    });
  } else if (input.status === 'partial_success' || input.failureLevel === 'fixable') {
    actions.push({
      kind: 'prefill',
      label: '补齐缺失项',
      detail: '沿用上次已完成信息，只补来源、字段或数量。',
      prompt: withIntent(intent, '请沿用上次已完成的信息，只补齐缺失来源和字段。'),
    });
  }

  return dedupeActions(actions).slice(0, 4);
}

function trustVerdict(input: {
  status: UiTask['status'];
  verificationPassed?: boolean | null;
  failureLevel?: UiTask['failureLevel'];
  failedCheckCount: number;
}): string {
  if (input.status === 'failed') return '任务未完成，结果不能当作完成产物使用。';
  if (input.status === 'cancelled') return '任务已取消，只能参考已保留的中间信息。';
  if (input.status === 'partial_success') return '任务产出了结果，但自动审核发现不完整或需复核。';
  if (input.verificationPassed === true) return '自动审核未发现结构性问题，但仍需按来源复核关键事实。';
  if (input.verificationPassed === false || input.failedCheckCount > 0) {
    return '自动审核发现问题，请优先查看检查项和恢复建议。';
  }
  if (input.failureLevel) return '任务带有审核结论，请结合下方证据边界使用。';
  return '未收到自动审核结论；本卡只展示已知证据，不给额外确定性。';
}

function countVisibleSourceUrls(text?: string, currentUrl?: string | null): number {
  const urls = new Set<string>();
  for (const value of [text ?? '', currentUrl ?? '']) {
    const matches = value.match(/https?:\/\/[^\s,;'")\]>]+/g) ?? [];
    for (const match of matches) urls.add(match);
  }
  return urls.size;
}

function hasHttpUrl(url?: string | null): boolean {
  return typeof url === 'string' && /^https?:\/\//i.test(url);
}

function withIntent(intent: string | undefined, suffix: string): string {
  return intent ? `${intent}\n${suffix}` : suffix;
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function dedupeActions(actions: RecoveryAction[]): RecoveryAction[] {
  const seen = new Set<string>();
  const out: RecoveryAction[] = [];
  for (const action of actions) {
    const key = `${action.kind}:${action.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(action);
  }
  return out;
}
