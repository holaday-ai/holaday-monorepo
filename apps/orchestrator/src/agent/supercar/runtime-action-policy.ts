export interface RuntimeAction {
  kind: 'click' | 'navigate' | 'type';
  label?: string | null;
  ariaLabel?: string | null;
  title?: string | null;
  placeholder?: string | null;
  name?: string | null;
  inputType?: string | null;
  url?: string | null;
  tagName?: string | null;
  pageUrl?: string | null;
  pageTitle?: string | null;
  pageTxSignal?: string | null;
  /**
   * FIX-36 #9: the field sits in a login / verification form or dialog (one with a password
   * or one-time-code field). With the page fully readable, its account / phone box is in
   * reach too — typing there is the user's, like the password itself.
   */
  credentialForm?: boolean | null;
}

export interface RuntimeActionVerdict {
  allowed: boolean;
  reason?: string;
  requiresConfirmation?: boolean;
  requiresTakeover?: boolean;
  awaitingKind?: 'login' | 'permission';
  question?: string;
}

const IRREVERSIBLE_CONTROL_RE =
  /确认付款|确认支付|立即支付|去支付|付款|支付|提交订单|确认订单|立即下单|下单|购买|立即购买|结算|确认预订|提交预订|立即预订|转账|汇款|提现|充值|永久删除|删除账号|删除账户|删除文件|删除任务|删除项目|清空|发送消息|发送邮件|发送|发布|发表|公开分享|分享给|转发|授权扣款|自动扣费/;

/**
 * FIX-27 (zb core-07): English control words, as whole words of the label.
 * Labels are compared without spaces, so a bare substring turned a wiki
 * preview's 「…locate shared resources…」 into a 「share」 button and paused
 * a read-only task for confirmation.
 */
const IRREVERSIBLE_CONTROL_EN_RE =
  /\b(?:confirm(?:\s*\w+)?\s*(?:pay(?:ment)?|order|booking)|pay\s*now|proceed(?:\s*\w+){0,2}\s*pay(?:ment)?|place(?:\s*\w+)?\s*order|submit(?:\s*\w+)?\s*order|checkout|purchase|buy(?:\s*\w+)?\s*now|transfer|withdraw|delete|remove|publish|send|share)\b/i;

/**
 * A label that is one token (「sendmessage」「deleteaccount」「publishpost」) has
 * no word boundaries to go by: it is matched as before, by substring (PR #286
 * review). Only text with spaces — prose — is held to whole words.
 */
const IRREVERSIBLE_CONTROL_TOKEN_RE =
  /confirm\w*(?:pay|order|booking)|paynow|proceed\w*pay|place\w*order|submit\w*order|checkout|purchase|buy\w*now|transfer|withdraw|delete|remove|publish|send|share/i;

export const TRANSACTION_PAGE_RE =
  /(?:\/|\b)(?:checkout|payment|cashier|order[-_/]?confirm|confirm[-_/]?order|order[-_/]?submit|submit[-_/]?order|booking\/confirm|settlement|pay)(?:\/|\b)|订单提交/i;

const TRANSACTION_CONTEXT_RE =
  /订单|支付|付款|结算|收款|交易|预订|银行卡|卡号|cvv|cvc|有效期|收货地址|配送地址|转账|汇款|充值|提现|payment|checkout|cashier|order|booking|settlement|cardnumber|billing|shipping|transfer|withdraw/i;

const PROCEED_CONTROL_RE = /继续|下一步|确定|完成|提交|continue|next|proceed|confirm|submit|done/i;

export function classifyRuntimeAction(action: RuntimeAction): RuntimeActionVerdict {
  if (action.kind === 'type' && action.credentialForm) {
    return {
      allowed: false,
      requiresTakeover: true,
      awaitingKind: 'login',
      reason:
        '这是登录或验证表单（账号、手机号、密码、验证码），不会由 Agent 代填，请由用户接管浏览器完成。',
    };
  }
  if (
    action.kind === 'type' &&
    (normalize(action.inputType) === 'password' ||
      [action.label, action.ariaLabel, action.placeholder, action.name].some((value) =>
        /密码|password|验证码|verificationcode|otp/i.test(normalize(value)),
      ))
  ) {
    return {
      allowed: false,
      requiresTakeover: true,
      awaitingKind: 'login',
      reason: '检测到密码或验证码输入框，请由用户接管浏览器完成，不会由 Agent 代填凭证。',
    };
  }

  if (action.kind === 'navigate') return { allowed: true };

  const raw = [action.label, action.ariaLabel, action.title, action.placeholder, action.name];
  const signals = raw.map((value) => normalize(value)).filter(Boolean);
  const matchedSignal =
    signals.find((value) => IRREVERSIBLE_CONTROL_RE.test(value)) ??
    raw.find(
      (value) =>
        !!value?.trim() &&
        (/\s/.test(value.trim())
          ? IRREVERSIBLE_CONTROL_EN_RE.test(words(value))
          : IRREVERSIBLE_CONTROL_TOKEN_RE.test(value)),
    );
  const neutralTransactionSubmit =
    action.kind === 'click' &&
    isSubmitControl(action) &&
    hasTransactionContext(action) &&
    signals.some((value) => PROCEED_CONTROL_RE.test(value));

  if (!matchedSignal && !neutralTransactionSubmit) return { allowed: true };

  const label =
    [action.label, action.ariaLabel, action.title].find((value) => value?.trim())?.trim() ??
    '当前操作';
  return {
    allowed: false,
    requiresConfirmation: true,
    reason: `不可逆操作需要用户确认：${label}`,
    question: `即将执行“${label}”，这可能产生付款、下单、发送、发布或删除等外部影响。确认继续执行吗？`,
  };
}

export function isAffirmativeActionConfirmation(message: string): boolean {
  const text = normalize(message);
  if (!text || /不要|不执行|不同意|拒绝|取消|等等|等一下|先别|no|cancel|stop/i.test(text)) {
    return false;
  }
  return /确认(?:执行|继续|下单|支付)?|同意|批准|继续(?:执行|下单|支付)?|可以执行|按计划执行|yes|confirm|approve|proceed/i.test(
    text,
  );
}

/** Words of a label: 「deleteItem」「send_message」「Buy-Now」 split apart. */
function words(value: string): string {
  return value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ');
}

function normalize(value: string | null | undefined): string {
  return (value ?? '').replace(/[\s\u200b-\u200f\u2060-\u2064\ufeff]+/g, '').toLowerCase();
}

function isSubmitControl(action: RuntimeAction): boolean {
  const tagName = normalize(action.tagName);
  const inputType = normalize(action.inputType);
  return (
    tagName === 'button' ||
    (tagName === 'input' && ['submit', 'button', 'image'].includes(inputType))
  );
}

function hasTransactionContext(action: RuntimeAction): boolean {
  const pageUrl = normalize(action.pageUrl);
  if (pageUrl && TRANSACTION_PAGE_RE.test(pageUrl)) return true;
  return [action.pageTitle, action.pageTxSignal].some((value) =>
    TRANSACTION_CONTEXT_RE.test(normalize(value)),
  );
}
