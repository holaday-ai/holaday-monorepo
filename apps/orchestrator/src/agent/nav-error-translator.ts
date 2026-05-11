/**
 * Phase 3 R4 — friendly navigation-error messages.
 *
 * Playwright + Chromium surface navigation failures as English
 * net::ERR_* strings or "Timeout 30000ms exceeded" stack traces.
 * Forwarding those verbatim to a Chinese-speaking user is poor UX:
 * "ERR_NAME_NOT_RESOLVED" tells the user nothing they can act on.
 * This module classifies the raw error and returns a short Chinese
 * message describing what went wrong + what to try.
 *
 * Pure function. No I/O. Easy to unit test.
 *
 * Returned `kind` is for telemetry / verifier hints; the user-facing
 * surface is `friendly`.
 */
export type NavErrorKind = 'dns' | 'ssl' | 'timeout' | 'connection_refused' | 'generic';

export interface NavErrorTranslation {
  kind: NavErrorKind;
  /** User-facing Chinese message. Always returned (generic on unknown). */
  friendly: string;
  /** Raw error text (truncated) — included for logs / debugging. */
  rawMessage: string;
}

/**
 * Classify a navigation error. The matching is substring-based against
 * the error's `message` field (the only thing Playwright reliably
 * exposes) — Chrome's net error codes are written into the message
 * as literal strings (e.g. "net::ERR_NAME_NOT_RESOLVED at https://x").
 */
export function translateNavError(err: unknown): NavErrorTranslation {
  const raw = err instanceof Error ? err.message : String(err);
  const truncated = raw.length > 500 ? `${raw.slice(0, 500)}...` : raw;
  const lower = raw.toLowerCase();

  // DNS failures — domain doesn't resolve to any IP.
  if (
    lower.includes('err_name_not_resolved') ||
    lower.includes('enotfound') ||
    lower.includes('dns_probe_finished_nxdomain') ||
    lower.includes('err_name_resolution_failed')
  ) {
    return {
      kind: 'dns',
      friendly: '无法访问该网址，请检查是否拼写正确。',
      rawMessage: truncated,
    };
  }

  // Certificate / SSL errors — cert expired, self-signed, etc.
  if (
    lower.includes('err_cert') ||
    lower.includes('ssl error') ||
    lower.includes('err_ssl') ||
    lower.includes('certificate_verify_failed')
  ) {
    return {
      kind: 'ssl',
      friendly: '该网站证书有问题，无法安全连接。请确认网址是否正确或换一个站点。',
      rawMessage: truncated,
    };
  }

  // Timeouts — Playwright's TimeoutError OR Chromium net::ERR_TIMED_OUT.
  if (
    lower.includes('timeout') ||
    lower.includes('err_timed_out') ||
    lower.includes('err_connection_timed_out')
  ) {
    return {
      kind: 'timeout',
      friendly: '页面加载超时，可能网络不稳定或站点响应慢，请稍后重试。',
      rawMessage: truncated,
    };
  }

  // Connection refused / host unreachable — site is down, port closed.
  if (
    lower.includes('err_connection_refused') ||
    lower.includes('econnrefused') ||
    lower.includes('err_connection_reset') ||
    lower.includes('econnreset') ||
    lower.includes('err_address_unreachable')
  ) {
    return {
      kind: 'connection_refused',
      friendly: '无法连接到该站点（服务器拒绝连接或不可达），请稍后重试或换一个站点。',
      rawMessage: truncated,
    };
  }

  // Generic fallback — surface the first ~80 chars of the raw error
  // so users have a hint without seeing a stack trace.
  // Trim to a single line so logs / chat rendering stay clean.
  const oneLine = raw.split(/\r?\n/)[0]!.trim();
  const hint = oneLine.length > 80 ? `${oneLine.slice(0, 80)}...` : oneLine;
  return {
    kind: 'generic',
    friendly: `页面加载失败：${hint || '未知错误'}。请稍后重试。`,
    rawMessage: truncated,
  };
}
