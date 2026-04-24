import type { UiStep } from '@/types/task';

/**
 * Translate one agent tick into a single line of plain user-facing
 * language. The goal is "看起来像助手在解释自己在做什么", not a
 * debug log — technical details (exact URLs, millisecond timings,
 * screenshot counters) belong in the collapsed "详细步骤" panel, not
 * the main conversation stream.
 *
 * Returning null means "hide this step entirely from the humanized
 * stream". Use for actions the user doesn't care about:
 *   - screenshot: an internal snapshot, never the point
 *   - wait:       pure throttle; noise
 *   - done:       the terminal summary block already renders the payoff
 *
 * The collapsed detail view still shows the raw StepCards for anyone
 * who wants to audit every tick.
 */
export function humanizeStep(step: UiStep): string | null {
  const kind = step.actionKind ?? '';
  switch (kind) {
    case 'screenshot':
    case 'wait':
      return null;
    case 'done':
      return null;
    case 'navigate':
      return describeNavigate(step);
    case 'click':
    case 'click_ref':
      return describeClick(step);
    case 'type':
    case 'type_in_ref':
      return describeType(step);
    case 'key':
    case 'press_key':
      return describeKey(step);
    case 'scroll':
      return '正在浏览页面…';
    case 'give_up':
      return '任务无法完成';
    case 'wait_for_human':
      return '需要您完成验证';
    // Supercar's per-iteration tool name is one of:
    //   computer  — the Anthropic computer-use tool (click/type/screenshot)
    //   text      — the model "spoke" this turn (textPreamble carries
    //               the natural-language sentence it emitted)
    //   web_search — handled by WebSearchLine, skip here
    // For `text` we want the model's actual sentence to surface as the
    // agent's voice; for `computer` we return a compact status so the
    // user doesn't see a wall of "computer" rows.
    case 'text':
      return pickAgentText(step);
    case 'computer':
      return describeComputer(step);
    case 'web_search':
      return null;
    default:
      if (!kind) return null;
      // Suppress anything that still looks like a raw tool name —
      // lowercase identifier, no spaces. Unknown rich summaries still
      // fall through so we don't accidentally silence structured text.
      if (/^[a-z_][a-z0-9_]*$/.test(kind)) {
        return step.actionSummary && !/^[a-z_][a-z0-9_]*$/.test(step.actionSummary)
          ? step.actionSummary
          : null;
      }
      return step.actionSummary || null;
  }
}

function pickAgentText(step: UiStep): string | null {
  const s = step.actionSummary?.trim();
  if (!s) return null;
  // The server populates actionSummary with either the textPreamble or
  // the joined tool names. If it's just "text" or "thinking" we have
  // nothing useful — drop the row rather than render a debug label.
  if (s === 'text' || s === 'thinking') return null;
  return s;
}

function describeComputer(step: UiStep): string {
  const s = step.actionSummary?.trim();
  // When the commander included a text preamble alongside the computer
  // call, surface the preamble as the agent's voice. Otherwise fall
  // back to a compact status so the stream doesn't repeat "computer"
  // on every iteration.
  if (s && s !== 'computer' && !/^[a-z_][a-z0-9_]*$/.test(s)) return s;
  return step.status === 'running' ? '正在操作浏览器…' : '完成一步操作';
}

/**
 * Very short badge to label each line in the humanized stream. Mirrors
 * the icon set used in BrowserPanel's activity overlay so the user
 * builds one mental model across panels.
 */
export function humanizedGlyph(kind: string | undefined): string {
  switch (kind) {
    case 'navigate':
      return '→';
    case 'click':
    case 'click_ref':
      return '·';
    case 'type':
    case 'type_in_ref':
      return '✎';
    case 'key':
    case 'press_key':
      return '⏎';
    case 'scroll':
      return '↕';
    case 'wait_for_human':
      return '!';
    case 'give_up':
      return '×';
    default:
      return '·';
  }
}

function describeNavigate(step: UiStep): string {
  const summary = step.actionSummary ?? '';
  const url = extractUrl(summary);
  if (!url) return '正在打开页面…';
  try {
    const u = new URL(url);
    const hostLabel = friendlyHost(u.hostname);
    if (step.status === 'running') return `正在打开 ${hostLabel}…`;
    return `已打开 ${hostLabel}`;
  } catch {
    return step.status === 'running' ? '正在打开页面…' : '已打开页面';
  }
}

function describeClick(step: UiStep): string {
  const label = extractQuoted(step.actionSummary);
  if (label) return step.status === 'running' ? `正在点击"${label}"…` : `点击了"${label}"`;
  return step.status === 'running' ? '正在点击页面元素…' : '已点击页面元素';
}

function describeType(step: UiStep): string {
  const text = extractTypedText(step.actionSummary);
  if (text) return step.status === 'running' ? `正在输入"${text}"…` : `输入了"${text}"`;
  return step.status === 'running' ? '正在填写内容…' : '已填写内容';
}

function describeKey(step: UiStep): string {
  const key = extractQuoted(step.actionSummary) ?? step.actionSummary ?? '';
  if (!key) return '按下按键';
  if (/enter/i.test(key)) return '按下回车';
  if (/tab/i.test(key)) return '切换焦点';
  if (/esc/i.test(key)) return '按下 Esc';
  return `按下 ${key}`;
}

/**
 * Pull the first URL-looking substring out of a free-form action
 * summary. Accepts http(s) and protocol-relative; everything else falls
 * through to null so we don't turn `javascript:void(0)` into a link.
 */
export function extractUrl(summary: string): string | null {
  if (!summary) return null;
  const m = /(https?:\/\/[^\s]+)/i.exec(summary);
  if (!m) return null;
  return (m[1] ?? '').replace(/[),.]+$/, '');
}

function extractQuoted(summary: string | undefined): string | null {
  if (!summary) return null;
  const m = /['"]([^'"\n]{1,40})['"]/.exec(summary);
  return m?.[1] ?? null;
}

function extractTypedText(summary: string | undefined): string | null {
  if (!summary) return null;
  const quoted = extractQuoted(summary);
  if (quoted) return quoted;
  const m = /(?:输入|type)\s*[:：]?\s*(.{1,40})/i.exec(summary);
  return m?.[1]?.trim() ?? null;
}

/**
 * Strip the common `www.` prefix and map a handful of brand hostnames
 * to their Chinese name. Fall through to the hostname as-is for anything
 * unrecognised — a bare `example.com` reads fine.
 */
export function friendlyHost(hostname: string): string {
  const h = hostname.replace(/^www\./, '').toLowerCase();
  if (BRAND_LABELS[h]) return BRAND_LABELS[h] as string;
  for (const suffix of Object.keys(BRAND_LABELS)) {
    if (h.endsWith(`.${suffix}`)) return BRAND_LABELS[suffix] as string;
  }
  return h;
}

const BRAND_LABELS: Readonly<Record<string, string>> = {
  'baidu.com': '百度',
  'google.com': 'Google',
  'bing.com': 'Bing',
  'xueqiu.com': '雪球',
  'eastmoney.com': '东方财富',
  'taobao.com': '淘宝',
  'tmall.com': '天猫',
  'jd.com': '京东',
  'github.com': 'GitHub',
  'zhipin.com': 'BOSS 直聘',
  'weibo.com': '微博',
  'xiaohongshu.com': '小红书',
  'douyin.com': '抖音',
  'bilibili.com': '哔哩哔哩',
};
