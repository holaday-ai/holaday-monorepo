import type { AwaitingKind } from '@/lib/awaiting-user-copy';
import { verificationCheckLabel, type VerificationCheck } from '@/lib/verification-banner-copy';
import type { UiTask } from '@/types/task';

export type TrustTone = 'neutral' | 'warning' | 'danger';
export type TrustEvidenceStage = 'observed' | 'extracted' | 'inferred' | 'boundary';

export interface TrustEvidenceRow {
  label: string;
  value: string;
  detail: string;
}

export interface TrustLedgerItem {
  stage: TrustEvidenceStage;
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
  ledger: TrustLedgerItem[];
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

export interface TrustSummaryInput {
  status: UiTask['status'];
  resultText?: string;
  currentUrl?: string | null;
  finalScreenshot?: string | null;
  attachments?: UiTask['attachments'];
  verificationPassed?: boolean | null;
  failureLevel?: UiTask['failureLevel'];
  failedChecks?: Array<VerificationCheck> | null;
}

export interface TrustEvidenceInput {
  resultText?: string;
  currentUrl?: string | null;
  finalScreenshot?: string | null;
  attachments?: UiTask['attachments'];
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
  const hasAnyEvidence = hasTrustEvidence(input);
  const compactMissingEvidence =
    !hasAnyEvidence &&
    (input.status === 'cancelled' ||
      input.status === 'failed' ||
      input.status === 'partial_success' ||
      input.verificationPassed === false ||
      failedChecks.length > 0);

  const tone: TrustTone = hardFailure ? 'danger' : flagged ? 'warning' : 'neutral';
  const verdict = trustVerdict({
    status: input.status,
    verificationPassed: input.verificationPassed,
    failureLevel: input.failureLevel,
    failedCheckCount: failedChecks.length,
  });

  return {
    tone,
    title: compactMissingEvidence
      ? input.status === 'cancelled' || input.status === 'failed'
        ? '任务状态'
        : '复核提示'
      : '结果复核',
    verdict,
    boundary: compactMissingEvidence
      ? '本次没有拿到可复核的链接、截图或产物；HOLA DAY 只保留已生成内容和步骤线索，不会把空指标包装成证据。'
      : 'HOLA DAY 只展示已经拿到的线索；没有截图、链接或终态页的部分，不会被当作已验证事实。',
    rows: compactMissingEvidence
      ? []
      : buildEvidenceRows({
          sourceCount,
          hasFinalUrl,
          hasScreenshot,
          attachmentCount,
        }),
    ledger: compactMissingEvidence
      ? [
          {
            stage: 'observed',
            label: '页面状态',
            value: '未形成终态证据',
            detail: '任务结束前没有保存截图或终态页，无法从本卡复核页面事实。',
          },
          ...(input.verificationPassed === false || failedChecks.length > 0
            ? [
                {
                  stage: 'inferred' as const,
                  label: '自动审核',
                  value: verificationLedgerValue(input.verificationPassed, failedChecks.length),
                  detail: '这是系统检查信号，不等同于人工或事实级验证通过。',
                },
              ]
            : []),
          {
            stage: 'boundary',
            label: '使用边界',
            value: '只能参考过程',
            detail:
              '请只把已完成步骤当作线索；涉及事实、价格、排序或链接的结论需要重新执行或补充来源。',
          },
        ]
      : [
          {
            stage: 'observed',
            label: '页面状态',
            value: hasScreenshot ? '已观察' : '未观察',
            detail: hasScreenshot
              ? '保存了终态截图，可复核任务结束时页面长什么样。'
              : '没有终态截图，无法从本卡观察任务结束时页面状态。',
          },
          {
            stage: 'extracted',
            label: '来源链接',
            value: `${sourceCount} 个`,
            detail:
              sourceCount > 0
                ? '从结果文本和最终页面 URL 中提取到链接，但未逐条证明每个事实都来自这些链接。'
                : '没有提取到可点击来源，事实型任务需要补来源。',
          },
          {
            stage: 'extracted',
            label: '最终 URL',
            value: hasFinalUrl ? '已记录' : '未记录',
            detail: hasFinalUrl
              ? '记录了任务结束时所在地址，可作为浏览路径线索。'
              : '没有记录终态地址，不能据此确认到达了目标页面。',
          },
          {
            stage: 'inferred',
            label: '自动审核',
            value: verificationLedgerValue(input.verificationPassed, failedChecks.length),
            detail:
              '这是系统检查信号，不等同于人工或事实级验证通过。',
          },
          {
            stage: 'boundary',
            label: '未验证边界',
            value: '结论推断',
            detail:
              '结果中的判断、建议和归因仍需结合来源、截图和业务上下文复核。',
          },
        ],
    checks,
    hiddenCheckCount,
  };
}

export function shouldShowTrustSummary(input: TrustSummaryInput): boolean {
  const failedCheckCount = input.failedChecks?.length ?? 0;
  const hasEvidence = hasTrustEvidence(input);

  if (input.status === 'cancelled') {
    return hasEvidence || failedCheckCount > 0 || Boolean(input.failureLevel);
  }
  if (input.status === 'failed') {
    return (
      hasEvidence ||
      failedCheckCount > 0 ||
      Boolean(input.failureLevel) ||
      input.verificationPassed === false
    );
  }
  if (input.status === 'partial_success') return true;
  if (input.verificationPassed === false) return true;
  if (failedCheckCount > 0) return true;
  if (input.failureLevel) return true;
  return hasEvidence;
}

export function hasTrustEvidence(input: TrustEvidenceInput): boolean {
  return (
    countVisibleSourceUrls(input.resultText, input.currentUrl) > 0 ||
    hasHttpUrl(input.currentUrl) ||
    Boolean(input.finalScreenshot) ||
    (input.attachments?.length ?? 0) > 0
  );
}

function buildEvidenceRows(input: {
  sourceCount: number;
  hasFinalUrl: boolean;
  hasScreenshot: boolean;
  attachmentCount: number;
}): TrustEvidenceRow[] {
  const rows: TrustEvidenceRow[] = [];
  if (input.sourceCount > 0) {
    rows.push({
      label: '来源链接',
      value: `${input.sourceCount} 个链接`,
      detail: '结果里有可点击来源，关键事实仍建议点开核对。',
    });
  }
  if (input.hasFinalUrl) {
    rows.push({
      label: '结束页面',
      value: '已记录',
      detail: '保留了任务结束时的页面地址，可作为路径线索。',
    });
  }
  if (input.hasScreenshot) {
    rows.push({
      label: '页面截图',
      value: '已保存',
      detail: '保存了结束时页面画面，可辅助复核。',
    });
  }
  if (input.attachmentCount > 0) {
    rows.push({
      label: '产物文件',
      value: `${input.attachmentCount} 个`,
      detail: '有可下载产物或附件，仍需核对内容是否满足任务目标。',
    });
  }
  return rows;
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

function verificationLedgerValue(
  verificationPassed: boolean | null | undefined,
  failedCheckCount: number,
): string {
  if (verificationPassed === true) return '未发现结构问题';
  if (verificationPassed === false || failedCheckCount > 0) return '发现问题';
  return '未返回';
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
