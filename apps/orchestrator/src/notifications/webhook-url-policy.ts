/**
 * Batch 10.3 — outbound IM-bot webhook URL policy.
 *
 * Notification webhooks carry the bot token in the URL and receive task
 * titles / error text, so they get the same treatment as Bailian MCP URLs
 * (`llm/mcp-url-policy.ts`): https only, port 443 only, no userinfo, no
 * fragment, and the parsed + lower-cased hostname must EXACTLY equal one of
 * the platform's official bot hosts. The path / query must also match the
 * platform's robot-webhook shape, so a valid host cannot be pointed at an
 * arbitrary API on the same domain.
 *
 *   wecom    https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=<key>
 *   feishu   https://open.feishu.cn/open-apis/bot/v2/hook/<token>
 *            https://open.larksuite.com/open-apis/bot/v2/hook/<token>
 *   dingtalk https://oapi.dingtalk.com/robot/send?access_token=<token>
 *
 * The free-form `custom` platform cannot satisfy a host allowlist and is
 * therefore rejected everywhere (create / update / test / send).
 *
 * Error messages never echo the URL: it contains the bot secret.
 */

export type WebhookPresetPlatform = 'wecom' | 'feishu' | 'dingtalk';

export const WEBHOOK_PLATFORM_HOSTS: Readonly<Record<WebhookPresetPlatform, readonly string[]>> =
  {
    wecom: ['qyapi.weixin.qq.com'],
    feishu: ['open.feishu.cn', 'open.larksuite.com'],
    dingtalk: ['oapi.dingtalk.com'],
  };

const TOKEN = /^[A-Za-z0-9-]{8,128}$/;
const DINGTALK_TOKEN = /^[A-Za-z0-9]{16,128}$/;
const FEISHU_PATH = /^\/open-apis\/bot\/v2\/hook\/([A-Za-z0-9-]{8,128})$/;

export const CUSTOM_WEBHOOK_DISABLED_MESSAGE =
  '自定义 Webhook 已停用，仅支持企业微信、飞书、钉钉官方机器人地址。';

export type WebhookUrlCheck =
  | { ok: true; url: URL; platform: WebhookPresetPlatform; host: string }
  | { ok: false; reason: string };

function isPresetPlatform(value: string): value is WebhookPresetPlatform {
  return value === 'wecom' || value === 'feishu' || value === 'dingtalk';
}

function singleParam(url: URL, name: string, pattern: RegExp): boolean {
  const keys = [...url.searchParams.keys()];
  if (keys.length !== 1 || keys[0] !== name) return false;
  const values = url.searchParams.getAll(name);
  return values.length === 1 && pattern.test(values[0] ?? '');
}

/**
 * Pure syntactic policy check. Callers that open a connection must ALSO run
 * `validateWebhookTarget` (DNS answers must be public) right before sending.
 */
export function checkNotificationWebhookUrl(raw: string, platform: string): WebhookUrlCheck {
  if (!isPresetPlatform(platform)) {
    return { ok: false, reason: CUSTOM_WEBHOOK_DISABLED_MESSAGE };
  }
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 2000 || raw.trim() !== raw) {
    return { ok: false, reason: 'Webhook 地址格式无效，请检查后重试。' };
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'Webhook 地址格式无效，请检查后重试。' };
  }
  if (url.protocol !== 'https:') {
    return { ok: false, reason: 'Webhook 地址必须使用 https 协议。' };
  }
  if (url.username || url.password) {
    return { ok: false, reason: 'Webhook 地址不能包含用户名或密码。' };
  }
  // WHATWG URL normalises an explicit :443 on https to '' — anything else is
  // a non-default port.
  if (url.port !== '' && url.port !== '443') {
    return { ok: false, reason: 'Webhook 地址只能使用默认的 443 端口。' };
  }
  if (url.hash) {
    return { ok: false, reason: 'Webhook 地址不能包含 # 片段。' };
  }
  const host = url.hostname.toLowerCase();
  const allowedHosts = WEBHOOK_PLATFORM_HOSTS[platform];
  if (!allowedHosts.includes(host)) {
    return {
      ok: false,
      reason: `该平台只接受官方机器人域名：${allowedHosts.join('、')}。`,
    };
  }
  const pathOk =
    platform === 'wecom'
      ? url.pathname === '/cgi-bin/webhook/send' && singleParam(url, 'key', TOKEN)
      : platform === 'feishu'
        ? FEISHU_PATH.test(url.pathname) && url.search === ''
        : url.pathname === '/robot/send' && singleParam(url, 'access_token', DINGTALK_TOKEN);
  if (!pathOk) {
    return { ok: false, reason: '不是该平台的机器人 Webhook 地址格式，请从机器人设置页完整复制。' };
  }
  return { ok: true, url, platform, host };
}

/** Log-safe description of a webhook: platform + host only, never path/query. */
export function describeWebhookForLog(
  raw: string,
  platform: string,
): { platform: string; host: string | null } {
  try {
    return { platform, host: new URL(raw).hostname.toLowerCase() || null };
  } catch {
    return { platform, host: null };
  }
}
