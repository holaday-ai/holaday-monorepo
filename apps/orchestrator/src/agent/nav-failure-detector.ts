/**
 * Phase 24 RC follow-up — nav-failure-detector.
 *
 * Catches the "false success" failure mode where the agent calls
 * `task_done` with a body that is essentially "I couldn't reach the
 * site — DNS failed / SSL expired / timed out / refused". The agent
 * thinks it has fulfilled the task (it accurately reported the
 * failure), so the runner finalises with status `completed`. The user
 * then sees a sidebar row labelled "已完成" attached to a card whose
 * only content is an error message — which is misleading and breaks
 * trust in the completion icon.
 *
 * The vision-loop runner already maps explicit `give_up` actions to
 * `failed`, but the orchestrator can't force the agent to call
 * `give_up` when the right thing happens to be "report this and
 * stop". This detector is the safety net: pattern-match the final
 * answer text for nav-failure language and downgrade the status.
 *
 * Pure function, no I/O. Detection is intentionally conservative —
 * a long report that mentions "DNS failed" as one bullet among many
 * should NOT be flipped to failed; only a short summary whose whole
 * point is the navigation error should trigger.
 *
 * Pairs with `nav-error-translator.ts` (which produces the friendly
 * Chinese phrases the agent often repeats verbatim) and answer-verifier
 * (which catches separate failure modes like empty / fabricated URL).
 */
import type { NavErrorKind } from './nav-error-translator.js';

export interface NavFailureSignal {
  detected: boolean;
  /** When detected, the matching nav-error kind (best-effort classification). */
  kind?: NavErrorKind;
  /**
   * Short Chinese reason suitable for use as the task's `reason`
   * field. Always populated when `detected` is true.
   */
  reason?: string;
  /**
   * Which pattern fired. Logged for telemetry, not user-facing.
   */
  matchedPattern?: string;
}

/**
 * Detector trips ONLY when the summary text is short. A long report
 * that happens to mention a nav-failure phrase is almost always a
 * legitimate writeup that includes the URL accessibility as one data
 * point. The cutoff is generous — a short failure summary in
 * Chinese is typically 50-150 chars, and we allow up to 400 to cover
 * a one-paragraph apology + retry hint.
 */
const MAX_FAILURE_SUMMARY_LENGTH = 400;

interface PatternMatch {
  re: RegExp;
  kind: NavErrorKind;
  /** Stable name for telemetry. */
  name: string;
  /** Chinese reason surfaced to the user. */
  reason: string;
}

/**
 * Strong signals — short Chinese phrases produced by
 * nav-error-translator.translateNavError, plus the raw Chromium net::
 * error code strings the model sometimes pastes verbatim into a
 * task_done summary. Order doesn't matter; we return the first
 * match.
 */
const STRONG_PATTERNS: PatternMatch[] = [
  // DNS — friendly Chinese phrase + raw Chromium codes
  {
    re: /无法访问该网址(?:[，,。]|，请检查是否拼写正确)/,
    kind: 'dns',
    name: 'zh.unreachable_url',
    reason: '无法访问该网址（DNS 解析失败或拼写错误）',
  },
  {
    re: /DNS\s*(解析)?\s*(失败|错误|未?能完成)/i,
    kind: 'dns',
    name: 'zh.dns_failed',
    reason: 'DNS 解析失败，无法访问该网址',
  },
  {
    re: /err_name_not_resolved|dns_probe_finished_nxdomain|err_name_resolution_failed/i,
    kind: 'dns',
    name: 'raw.err_dns',
    reason: '域名解析失败（ERR_NAME_NOT_RESOLVED）',
  },
  // SSL
  {
    re: /证书有问题.*无法安全连接|证书(过期|无效|不可信)|SSL\s*(错误|失败)/i,
    kind: 'ssl',
    name: 'zh.ssl_problem',
    reason: '该网站证书有问题，无法安全连接',
  },
  {
    re: /err_cert|err_ssl|certificate_verify_failed/i,
    kind: 'ssl',
    name: 'raw.err_ssl',
    reason: '证书校验失败（ERR_CERT / SSL）',
  },
  // Timeout
  {
    re: /页面加载超时|连接超时|访问超时/,
    kind: 'timeout',
    name: 'zh.timeout',
    reason: '页面加载超时，请稍后重试',
  },
  {
    re: /err_timed_out|err_connection_timed_out/i,
    kind: 'timeout',
    name: 'raw.err_timeout',
    reason: '连接超时（ERR_TIMED_OUT）',
  },
  // Connection refused / unreachable
  {
    re: /无法连接到该站点|连接被(拒绝|重置)|服务器(拒绝|不可达)/,
    kind: 'connection_refused',
    name: 'zh.refused',
    reason: '无法连接到该站点（拒绝连接或不可达）',
  },
  {
    re: /err_connection_refused|err_connection_reset|err_address_unreachable|econnrefused|econnreset|enotfound/i,
    kind: 'connection_refused',
    name: 'raw.err_refused',
    reason: '无法连接到该站点（ERR_CONNECTION_REFUSED / 重置）',
  },
];

/**
 * Detect nav-failure language in a task's final answer. Returns
 * `{ detected: false }` when no signal fires OR when the summary is
 * long enough that the phrase is likely part of a broader report.
 *
 * Caller (tasks.ts terminal flow) should treat a positive return as
 * grounds to flip `outcome.status` from `'completed'` to `'failed'`
 * before persisting. The `reason` field provides the user-facing
 * failure message that mirrors what the sidebar shows for explicit
 * give_up rows.
 */
export function detectNavFailure(summary: string | undefined | null): NavFailureSignal {
  if (!summary) return { detected: false };
  const trimmed = summary.trim();
  if (trimmed.length === 0) return { detected: false };
  // Conservative gate — only treat the summary as a nav-failure
  // report when it's short. Anything longer should rely on the
  // (in-flight) agent prompt fix or the verifier's empty-result
  // check.
  if (trimmed.length > MAX_FAILURE_SUMMARY_LENGTH) return { detected: false };

  for (const p of STRONG_PATTERNS) {
    if (p.re.test(trimmed)) {
      return {
        detected: true,
        kind: p.kind,
        reason: p.reason,
        matchedPattern: p.name,
      };
    }
  }
  return { detected: false };
}
