/**
 * FIX-58 复审 #2 第 4 项: the pause after an action the page answered with a request it may have
 * written was 「检测到写请求或交易状态变化，已暂停后续操作。第一次副作用无法事前阻止，请核对结果后确认如何
 * 继续。」 — machine words. It is said as what happened, then what the user should do:
 * 「我在故宫博物院网站点了「导览」，页面像是提交了一个请求，我先停下了。你看一下右侧画面有没有生成预约或
 * 订单；没有的话回复「继续」，我接着只读查看。」 English tasks are answered in English. No
 * 「副作用 / 写请求 / 交易状态」.
 */

export interface PausedAction {
  tool: string;
  /** The control's visible name, when the snapshot gave one. */
  label?: string | null;
  /** A select's chosen value. */
  value?: string | null;
}

/** The visible name of a ref in a snapshot: 「- link "导览" [ref=e5]」, 「- generic [ref=e5]: 导览」, or its first child's text. */
export function refName(snapshot: string, ref: string): string | null {
  const lines = snapshot.split('\n');
  const at = lines.findIndex((line) => line.includes(`[ref=${ref}]`));
  if (at < 0) return null;
  const own = lines[at]!;
  const quoted = own.match(/^\s*-\s+[a-z]+\s+"([^"]{1,80})"/i)?.[1];
  if (quoted?.trim()) return tidy(quoted);
  const trailing = own.match(/\[ref=[^\]]+\][^:]*:\s*(.+)$/)?.[1];
  if (trailing?.trim()) return tidy(trailing);
  const indent = own.match(/^\s*/)?.[0].length ?? 0;
  for (const line of lines.slice(at + 1, at + 6)) {
    if ((line.match(/^\s*/)?.[0].length ?? 0) <= indent) break;
    const child =
      line.match(/^\s*-\s+[a-z]+\s+"([^"]{1,80})"/i)?.[1] ??
      line.match(/^\s*-\s+text:\s*(.+)$/)?.[1] ??
      line.match(/\[ref=[^\]]+\][^:]*:\s*(.+)$/)?.[1];
    if (child?.trim()) return tidy(child);
  }
  return null;
}

const tidy = (text: string) => {
  const one = text
    .replace(/\s+/g, ' ')
    .replace(/^["「]|["」]$/g, '')
    .trim();
  return one.length > 24 ? `${one.slice(0, 23)}…` : one;
};

/** The site as a person names it: the page title's site part (「导览-故宫博物院」→「故宫博物院」), else the host. */
export function siteCalled(
  title: string | null | undefined,
  url: string | null | undefined,
): string {
  const parts = (title ?? '')
    .split(/\s*[-|_｜—–·]\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
  const named = [...parts].reverse().find((part) => part.length >= 2 && part.length <= 16);
  if (named) return named;
  try {
    return url ? new URL(url).hostname.replace(/^www\./, '') : '';
  } catch {
    return '';
  }
}

/**
 * DEPLOY-58 第 0 步 2 (复审 #3): a control or request that looks like an order, a payment, a booking,
 * a submit or a confirm. Then the pause does not say it lightly: it may already have gone through.
 */
const SUBMIT_LABEL_RE =
  /下单|提交|支付|付款|结算|购买|立即购|立即抢|预约|预订|订票|购票|抢票|确认|确定|报名|注册|发送|发布|place (?:your )?order|\bpay(?:ment)?\b|check ?out|\bbuy\b|purchase|\bbook(?:ing)?\b|reserve|reservation|\bsubmit\b|\bconfirm\b|sign ?up|\bregister\b|\bsend\b|\bpost\b/i;
const SUBMIT_TRIGGER_BRANCHES = new Set([
  'transaction_request',
  'transaction_navigation',
  'transaction_popup',
  'new_transaction_receipt',
]);
const SUBMIT_PATH_RE =
  /order|pay|checkout|booking|reserv|submit|confirm|purchase|ticket|appointment|register|signup/i;

export function looksSubmitted(
  action: PausedAction | null,
  triggers: ReadonlyArray<{ branch: string; url: string }> = [],
): boolean {
  if (action?.label && SUBMIT_LABEL_RE.test(action.label)) return true;
  return triggers.some((trigger) => {
    if (SUBMIT_TRIGGER_BRANCHES.has(trigger.branch)) return true;
    if (trigger.branch === 'intercepted_submit') return false;
    try {
      return SUBMIT_PATH_RE.test(new URL(trigger.url).pathname);
    } catch {
      return false;
    }
  });
}

export function effectPauseQuestion(input: {
  english: boolean;
  site: string;
  action: PausedAction | null;
  /** The task only reads (look up a price, read a page): the user is asked to let it read on. */
  readOnly: boolean;
  /** Every request that paused was a background report nothing could place. */
  background: boolean;
  /** What paused it (branch and address), to tell a real submit. */
  triggers?: ReadonlyArray<{ branch: string; url: string }>;
}): string {
  const { english, site, action, readOnly, background } = input;
  const label = action?.label?.trim();
  const submitted = looksSubmitted(action, input.triggers);
  if (english) {
    const did =
      action?.tool === 'click'
        ? label
          ? `clicked “${label}”`
          : 'clicked something'
        : action?.tool === 'type'
          ? label
            ? `typed into “${label}”`
            : 'typed into the page'
          : action?.tool === 'select'
            ? `chose “${action.value ?? label ?? ''}”`
            : action?.tool === 'navigate'
              ? 'opened the page'
              : 'acted on the page';
    const where = site ? ` on ${site}` : '';
    if (submitted)
      return `I ${did}${where}. This step may already have gone through (an order or booking may have been created). Please check the screen on the right first, and cancel it if needed.`;
    const what = background
      ? 'the page sent a background request I could not identify'
      : 'the page seems to have submitted a request';
    const next = readOnly
      ? 'Please check the screen on the right for any booking or order. If there is none, reply “continue” and I will keep to reading only.'
      : 'Please check the screen on the right. If it is what you expected, reply “continue” and I will carry on.';
    return `I ${did}${where} and ${what}, so I stopped. ${next}`;
  }
  const did =
    action?.tool === 'click'
      ? label
        ? `点了「${label}」`
        : '点了一下'
      : action?.tool === 'type'
        ? label
          ? `在「${label}」里输入了内容`
          : '输入了内容'
        : action?.tool === 'select'
          ? `选了「${action.value ?? label ?? ''}」`
          : action?.tool === 'navigate'
            ? '打开了页面'
            : '操作了一下页面';
  const where = site ? `在${site}` : '';
  if (submitted)
    return `我${where}${did}，这一步可能已经提交成功了（可能已经生成订单或预约）。请先在右侧画面核对，需要的话去取消。`;
  const what = background ? '页面在后台发出了一个我认不出的请求' : '页面像是提交了一个请求';
  const next = readOnly
    ? '你看一下右侧画面有没有生成预约或订单；没有的话回复「继续」，我接着只读查看。'
    : '你看一下右侧画面，结果符合预期的话回复「继续」，我接着往下做。';
  return `我${where}${did}，${what}，我先停下了。${next}`;
}
