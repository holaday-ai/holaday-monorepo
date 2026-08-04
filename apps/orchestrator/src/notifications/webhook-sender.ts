/**
 * Phase 26B — outbound webhook sender for notification channels.
 *
 * Pure-ish module:
 *   - `buildPayload(platform, template, context)` is fully pure —
 *     unit-testable without HTTP.
 *   - `sendWebhook(channel, context, deps)` wraps fetch with a 10 s
 *     timeout + one retry. Logs failures but never throws (notify
 *     callers fan out via Promise.allSettled and must not block the
 *     task pipeline on a slow Slack endpoint).
 *
 * Platform presets (text-only message — the simplest universal
 * shape every China IM accepts):
 *
 *   wecom      → { msgtype: 'text', text: { content: <msg> } }
 *   feishu     → { msg_type: 'text', content: { text: <msg> } }
 *   dingtalk   → { msgtype: 'text', text: { content: <msg> } }
 *   custom     → user-supplied JSON template with placeholder
 *                substitution: {{title}} {{message}} {{status}}
 *                {{taskName}}
 *
 * The presets all carry the formatted `message` field as the body;
 * we DON'T attempt rich-card formatting per-platform — that's a
 * polish round once the basic path is proven. The `title` /
 * `taskName` / `status` context fields are surfaced INSIDE the
 * message string for presets (via `formatPresetMessage`), so users
 * who want platform-native rich formatting can switch to 'custom'.
 */

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { Logger } from 'pino';
import { Agent, fetch as undiciFetch, type Dispatcher } from 'undici';
import { isPublicInternetAddress } from '../agent/browser-network-policy.js';

export type NotificationPlatform = 'wecom' | 'feishu' | 'dingtalk' | 'custom';

export type NotificationType =
  | 'task_started'
  | 'task_complete'
  | 'task_failed'
  | 'task_skipped'
  | 'task_reminder';

/**
 * Context used to template a notification's webhook body. Same shape
 * the SPA passes when previewing a custom template — keeps the
 * field set stable across the codebase.
 */
export interface WebhookContext {
  /** Notification title — short. */
  title: string;
  /** Notification message body — sentence or two. */
  message: string;
  /** Easy switch in custom JSON: started / success / failed / skipped / reminder. */
  status: 'started' | 'success' | 'failed' | 'skipped' | 'reminder';
  /** Short label of the underlying scheduled task. May be empty. */
  taskName: string;
}

export interface WebhookChannel {
  platform: NotificationPlatform;
  webhookUrl: string;
  /** Required when platform='custom'; ignored otherwise. */
  customTemplate?: unknown;
}

export interface SendResult {
  ok: boolean;
  status?: number;
  attempt: number;
  error?: string;
}

export interface WebhookSenderDeps {
  fetch?: typeof globalThis.fetch;
  resolve?: WebhookHostResolver;
  logger?: Pick<Logger, 'info' | 'warn'>;
  /** Override the per-attempt timeout. Default 10s. */
  timeoutMs?: number;
  /** Override the retry cap. Default 1 retry (2 attempts total). */
  maxAttempts?: number;
}

export interface WebhookResolvedAddress {
  address: string;
  family: 4 | 6;
}

export type WebhookHostResolver = (
  hostname: string,
) => Promise<readonly WebhookResolvedAddress[]>;

export interface ValidatedWebhookTarget {
  url: string;
  hostname: string;
  addresses: WebhookResolvedAddress[];
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_ATTEMPTS = 2;
const MAX_REDIRECTS = 5;
const PRIVATE_TARGET_MESSAGE =
  'Webhook 仅允许连接安全的公网地址，不能使用本机、内网、链路本地或云元数据地址。';
const DNS_TARGET_MESSAGE = 'Webhook 目标暂时无法安全解析，请检查地址后重试。';

function normaliseHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
}

function isBlockedHostname(hostname: string): boolean {
  return (
    !hostname ||
    !hostname.includes('.') ||
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === 'metadata' ||
    hostname === 'metadata.google.internal' ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.lan') ||
    hostname.endsWith('.home')
  );
}

async function defaultWebhookResolver(
  hostname: string,
): Promise<readonly WebhookResolvedAddress[]> {
  const resolved = await lookup(hostname, { all: true, verbatim: true });
  return resolved
    .filter(
      (entry): entry is { address: string; family: 4 | 6 } =>
        entry.family === 4 || entry.family === 6,
    )
    .map(({ address, family }) => ({ address, family }));
}

/**
 * Resolve and validate a webhook destination immediately before use.
 * Every DNS answer must be globally routable; mixed public/private answers are
 * rejected to avoid selecting the public address while leaving a rebinding
 * path to the private member.
 */
export async function validateWebhookTarget(
  rawUrl: string,
  options: { resolve?: WebhookHostResolver } = {},
): Promise<ValidatedWebhookTarget> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('Webhook 地址格式无效，请检查后重试。');
  }

  if (url.protocol !== 'https:') {
    throw new Error('Webhook 地址必须使用 https 协议，以保护通知内容和凭据。');
  }
  if (url.username || url.password) {
    throw new Error('Webhook 地址不能包含用户名或密码。');
  }

  const hostname = normaliseHostname(url.hostname);
  const literalFamily = isIP(hostname);
  if (isBlockedHostname(hostname)) {
    throw new Error(PRIVATE_TARGET_MESSAGE);
  }
  if (literalFamily !== 0) {
    if (!isPublicInternetAddress(hostname)) {
      throw new Error(PRIVATE_TARGET_MESSAGE);
    }
    return {
      url: url.href,
      hostname,
      addresses: [
        {
          address: hostname,
          family: literalFamily as 4 | 6,
        },
      ],
    };
  }

  let resolved: readonly WebhookResolvedAddress[];
  try {
    resolved = await (options.resolve ?? defaultWebhookResolver)(hostname);
  } catch {
    throw new Error(DNS_TARGET_MESSAGE);
  }
  if (resolved.length === 0) {
    throw new Error(DNS_TARGET_MESSAGE);
  }
  if (
    resolved.some(
      ({ address, family }) =>
        isIP(address) !== family || !isPublicInternetAddress(address),
    )
  ) {
    throw new Error(PRIVATE_TARGET_MESSAGE);
  }

  const addresses = Array.from(
    new Map(
      resolved.map((entry) => [
        `${entry.family}:${entry.address}`,
        { address: entry.address, family: entry.family },
      ]),
    ).values(),
  );
  return { url: url.href, hostname, addresses };
}

function createPinnedDispatcher(target: ValidatedWebhookTarget): Dispatcher {
  const selected = target.addresses[0];
  if (!selected) {
    throw new Error(DNS_TARGET_MESSAGE);
  }
  return new Agent({
    connect: {
      lookup(hostname, _options, callback) {
        if (normaliseHostname(hostname) !== target.hostname) {
          callback(
            new Error('Webhook 连接目标与已校验域名不一致。'),
            selected.address,
            selected.family,
          );
          return;
        }
        callback(null, selected.address, selected.family);
      },
    },
  });
}

async function closeDispatcher(dispatcher: Dispatcher): Promise<void> {
  try {
    await dispatcher.close();
  } catch {
    // Closing an already-failed connection must not mask the delivery result.
  }
}

async function fetchWebhookHop(
  fetchImpl: typeof globalThis.fetch,
  target: ValidatedWebhookTarget,
  body: string,
  signal: AbortSignal,
): Promise<Response> {
  const dispatcher = createPinnedDispatcher(target);
  try {
    const response = await fetchImpl(
      target.url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal,
        redirect: 'manual',
        dispatcher,
      } as unknown as RequestInit,
    );
    const snapshot = new Response(null, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
    await response.body?.cancel();
    return snapshot;
  } finally {
    await closeDispatcher(dispatcher);
  }
}

async function fetchWebhookWithRedirects(
  initialUrl: string,
  body: string,
  signal: AbortSignal,
  fetchImpl: typeof globalThis.fetch,
  resolve: WebhookHostResolver | undefined,
): Promise<Response> {
  let currentUrl = initialUrl;
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const target = await validateWebhookTarget(currentUrl, { resolve });
    const response = await fetchWebhookHop(fetchImpl, target, body, signal);
    if (response.status < 300 || response.status >= 400) {
      return response;
    }

    const location = response.headers.get('location');
    if (!location) return response;
    if (redirectCount === MAX_REDIRECTS) {
      throw new Error('Webhook 重定向次数过多，已停止发送。');
    }
    currentUrl = new URL(location, target.url).href;
  }
  throw new Error('Webhook 重定向次数过多，已停止发送。');
}

/**
 * Format the platform-text-preset message string. Composes a single
 * line per field so the IM client renders it as one bubble even
 * without rich card support. Empty-string fields are skipped so
 * "title=undefined" / "task=undefined" never leak.
 */
export function formatPresetMessage(ctx: WebhookContext): string {
  const lines: string[] = [];
  if (ctx.title) lines.push(`【${ctx.title}】`);
  if (ctx.taskName) lines.push(`任务：${ctx.taskName}`);
  if (ctx.message) lines.push(ctx.message);
  // No trailing status line for 'success' — the title already
  // says "完成". Surface non-terminal/attention statuses explicitly
  // so webhook bubbles don't imply the underlying task already ended.
  if (ctx.status === 'started') lines.push('(状态：已启动)');
  else if (ctx.status === 'failed') lines.push('(状态：失败)');
  else if (ctx.status === 'skipped') lines.push('(状态：已跳过)');
  else if (ctx.status === 'reminder') lines.push('(状态：提醒)');
  return lines.join('\n');
}

/**
 * Substitute the four supported placeholders in a custom template.
 *
 * Walks an arbitrary JSON value recursively, replacing
 * `{{title}}` / `{{message}}` / `{{status}}` / `{{taskName}}` in
 * every string node. Unknown placeholders are left intact so a
 * future spec addition doesn't silently break existing templates.
 *
 * Pure: doesn't mutate the input.
 */
export function substituteTemplate(
  template: unknown,
  ctx: WebhookContext,
): unknown {
  if (typeof template === 'string') {
    return template
      .replace(/\{\{\s*title\s*\}\}/g, ctx.title)
      .replace(/\{\{\s*message\s*\}\}/g, ctx.message)
      .replace(/\{\{\s*status\s*\}\}/g, ctx.status)
      .replace(/\{\{\s*taskName\s*\}\}/g, ctx.taskName);
  }
  if (Array.isArray(template)) {
    return template.map((v) => substituteTemplate(v, ctx));
  }
  if (template && typeof template === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(template)) {
      out[k] = substituteTemplate(v, ctx);
    }
    return out;
  }
  // numbers / booleans / null pass through unchanged
  return template;
}

/**
 * Build the JSON body the webhook should receive for a given
 * channel + context. Pure function — fully unit-testable.
 *
 * Throws on platform='custom' with no template (caller validation
 * problem; we don't want to silently POST an empty body).
 */
export function buildPayload(
  channel: WebhookChannel,
  ctx: WebhookContext,
): unknown {
  const text = formatPresetMessage(ctx);
  if (channel.platform === 'wecom') {
    return { msgtype: 'text', text: { content: text } };
  }
  if (channel.platform === 'feishu') {
    return { msg_type: 'text', content: { text } };
  }
  if (channel.platform === 'dingtalk') {
    return { msgtype: 'text', text: { content: text } };
  }
  if (channel.platform === 'custom') {
    if (channel.customTemplate === undefined || channel.customTemplate === null) {
      throw new Error('custom platform requires a non-null customTemplate');
    }
    return substituteTemplate(channel.customTemplate, ctx);
  }
  // Exhaustiveness: unknown platform — treat as no-op error so the
  // caller's Promise.allSettled records it.
  const exhaustive: never = channel.platform;
  void exhaustive;
  throw new Error(`unknown notification platform: ${channel.platform as string}`);
}

/**
 * POST the payload to the channel's URL with 10 s timeout + 1
 * retry (2 attempts total). Returns a structured result; never
 * throws so the caller's `Promise.allSettled` records the outcome
 * cleanly.
 *
 * A 4xx response counts as a permanent failure (no retry) — most
 * IM webhooks 400 on bad token, retrying doesn't help. A 5xx /
 * network error retries once with a 500 ms backoff.
 */
export async function sendWebhook(
  channel: WebhookChannel,
  ctx: WebhookContext,
  deps: WebhookSenderDeps = {},
): Promise<SendResult> {
  const fetchImpl =
    deps.fetch ?? (undiciFetch as unknown as typeof globalThis.fetch);
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxAttempts = deps.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

  let body: string;
  try {
    body = JSON.stringify(buildPayload(channel, ctx));
  } catch (err) {
    return {
      ok: false,
      attempt: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  let lastError: string | undefined;
  let lastStatus: number | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchWebhookWithRedirects(
        channel.webhookUrl,
        body,
        controller.signal,
        fetchImpl,
        deps.resolve,
      );
      clearTimeout(timer);
      lastStatus = res.status;
      if (res.ok) {
        deps.logger?.info(
          { platform: channel.platform, status: res.status, attempt },
          'webhook delivered',
        );
        return { ok: true, status: res.status, attempt };
      }
      // 4xx is permanent — don't burn the retry slot.
      if (res.status >= 400 && res.status < 500) {
        lastError = `HTTP ${res.status} (permanent)`;
        deps.logger?.warn(
          { platform: channel.platform, status: res.status, attempt },
          'webhook permanent failure',
        );
        return { ok: false, status: res.status, attempt, error: lastError };
      }
      lastError = `HTTP ${res.status}`;
    } catch (err) {
      clearTimeout(timer);
      lastError = err instanceof Error ? err.message : String(err);
      deps.logger?.warn(
        { platform: channel.platform, attempt, err: lastError },
        'webhook attempt failed',
      );
    }
    // 500ms backoff between attempts. Don't sleep after the last
    // attempt (we're about to return anyway).
    if (attempt < maxAttempts) {
      await new Promise<void>((resolve) => setTimeout(resolve, 500));
    }
  }
  return {
    ok: false,
    ...(lastStatus !== undefined ? { status: lastStatus } : {}),
    attempt: maxAttempts,
    ...(lastError ? { error: lastError } : {}),
  };
}

/**
 * Mask a webhook URL for SPA display. Shows the host + last 6 chars
 * of the path so the user can recognise it without exposing the
 * full token in a screenshot. Used by the settings list.
 *
 *   https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=ABCD-1234-EFGH
 *   →   qyapi.weixin.qq.com/...EFGH
 *
 * Pure — unit-testable.
 */
export function maskWebhookUrl(url: string): string {
  try {
    const u = new URL(url);
    const tail = url.length > 6 ? url.slice(-6) : url;
    return `${u.host}/...${tail}`;
  } catch {
    // Malformed URL — show first + last 6 chars only.
    if (url.length <= 12) return url;
    return `${url.slice(0, 6)}...${url.slice(-6)}`;
  }
}
