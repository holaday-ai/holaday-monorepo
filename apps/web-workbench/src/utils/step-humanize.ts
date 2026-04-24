import type { UiStep } from '@/types/task';

/**
 * Humanized step filter — Claude-style chat output.
 *
 * The rule is strict: **tool invocations are not user-facing**. A user
 * reading the chat should see only the model's own voice (text
 * preambles) and a final result. Step rows labelled with the machine
 * tool name (computer / navigate / web_search / bash / screenshot /
 * wait / done / click / type / key / scroll) are UI chrome — the
 * raw log belongs behind the "查看详细步骤" toggle.
 *
 * Returning null means "hide from the main flow". The TaskStream
 * wraps a LiveStatus indicator around the most recent running tool
 * so the user still knows something is happening, they just don't
 * see "完成一步操作" stacked five deep.
 *
 * The exceptions — `give_up` and `wait_for_human` — aren't tool
 * calls; they're terminal signals the model produced for the user.
 * They stay visible.
 */
export function humanizeStep(step: UiStep): string | null {
  const kind = step.actionKind ?? '';
  switch (kind) {
    // Tool calls. All hidden from the main flow — LiveStatus below
    // renders a single live spinner + label instead.
    case 'screenshot':
    case 'wait':
    case 'done':
    case 'navigate':
    case 'click':
    case 'click_ref':
    case 'type':
    case 'type_in_ref':
    case 'key':
    case 'press_key':
    case 'scroll':
    case 'computer':
    case 'web_search':
    case 'bash':
    case 'code_execution':
    case 'run_code':
    case 'python':
    case 'str_replace_editor':
    case 'file_editor':
    case 'text_editor':
      return null;

    // Terminal-ish semantics — keep.
    case 'give_up':
      return '任务无法完成';
    case 'wait_for_human':
      return '需要您完成验证';

    // The agent's own voice. Supercar populates actionSummary with
    // the textPreamble when toolsInTurn[0] === 'text', which means
    // Claude spoke without calling a tool this turn. That's the one
    // thing we DO want to surface.
    case 'text':
      return pickAgentText(step);

    default:
      if (!kind) return null;
      // Anything else: if it looks like a raw identifier (snake_case,
      // lowercase), drop it; otherwise surface the summary so we
      // don't silently swallow future tool names the humanizer
      // doesn't know about.
      if (/^[a-z_][a-z0-9_]*$/.test(kind)) return null;
      return step.actionSummary || null;
  }
}

function pickAgentText(step: UiStep): string | null {
  const s = step.actionSummary?.trim();
  if (!s) return null;
  // Defensive: drop known "label-only" values that sometimes land
  // in actionSummary when the server couldn't extract a preamble.
  if (s === 'text' || s === 'thinking' || s === 'computer') return null;
  // Suppress the old humanizer's placeholder strings — these are
  // pre-Round-1 artefacts that used to stack on screen.
  if (s === '完成一步操作' || s === '正在操作浏览器…') return null;
  return s;
}

/**
 * One-line friendly label for a tool kind, used by the LiveStatus
 * indicator at the bottom of the running stream. Matches the rhythm
 * of Claude's "正在 … 中" progress captions.
 */
export function liveStatusLabel(kind: string | undefined): string {
  switch (kind) {
    case 'navigate':
      return '正在打开页面…';
    case 'click':
    case 'click_ref':
      return '正在点击…';
    case 'type':
    case 'type_in_ref':
      return '正在输入…';
    case 'key':
    case 'press_key':
      return '正在发送按键…';
    case 'scroll':
      return '正在浏览页面…';
    case 'screenshot':
      return '正在截图…';
    case 'wait':
      return '等待页面加载…';
    case 'computer':
      return '正在操作浏览器…';
    case 'web_search':
      return '正在联网搜索…';
    case 'bash':
      return '正在执行命令…';
    case 'code_execution':
    case 'run_code':
    case 'python':
      return '正在执行代码…';
    case 'str_replace_editor':
    case 'file_editor':
    case 'text_editor':
      return '正在编辑文件…';
    case 'text':
    case '':
    case undefined:
      return '正在思考…';
    default:
      return '正在处理…';
  }
}

/**
 * Strip the common `www.` prefix and map a handful of brand hostnames
 * to their Chinese name. Still used by the Panel URL chip + terminal
 * summary even though the humanizer no longer emits navigation rows.
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
  'ctrip.com': '携程',
};

/**
 * Kept for backwards compatibility — TaskStream still imports it for
 * the list-marker glyph. Empty string is a safe default; nothing
 * renders the glyph anymore after the Round 1 rewrite but keeping
 * the export avoids a rebuild of every consumer.
 */
export function humanizedGlyph(_kind: string | undefined): string {
  return '·';
}
