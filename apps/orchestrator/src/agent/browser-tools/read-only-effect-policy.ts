/**
 * FIX-61B P1-4 (Deploy-61 online b-m01 高德, new-bestbuy BestBuy): a read-only task stopped to ask
 * 「页面在后台发出了一个我认不出的请求…回复继续」 after an ordinary step — opening a page, a plain
 * link, closing a popup, typing a search word. Such a pause in a task that only reads is logged and
 * passed; the task goes on. Everything that may change something still asks, as before:
 *
 *  - only a background POST nothing could place (`unknown_post`) may pass — never a form submission
 *    (`form_submit`), a PUT / PATCH / DELETE (`mutation_method`), a checkout / payment request,
 *    page, popup or receipt (`transaction_*`, `new_transaction_receipt`) or an intercepted submit;
 *  - the step before was: navigate; a click whose control is not a buy / book / confirm / submit /
 *    pay / account act (log in, register, send, post, delete, follow, like, subscribe, comment…);
 *    or typing that does not press Enter, into a box that is not a password / code / card / phone /
 *    e-mail field;
 *  - selecting an option, a submit after typing, or any task that is not read-only: asks.
 */
import { cleanElementName } from '../internal-refs.js';

export interface EffectAction {
  tool: string;
  label?: string | null;
  /** Typing pressed Enter afterwards (`submit: true`). */
  submit?: boolean;
  /** The control's role from the snapshot (button, link, textbox…), when known. */
  role?: string | null;
}

/** Buy / book / confirm / submit / pay: the act itself. */
const TRANSACTION_RE =
  /提交|下单|支付|付款|购票|购买|预约|预订|订票|订购|结算|确认|加入购物车|加购|抢购|报名|充值|领取|兑换|submit|pay\b|payment|place (?:your )?order|buy|purchase|book(?:ing)?\b|reserve|reservation|checkout|check out|add to (?:cart|bag|basket)|confirm|order now|subscribe|redeem|claim/i;
/** Account and social acts: log in, register, send, post, delete, follow, like, comment… */
const ACCOUNT_ACT_RE =
  /登录|登陆|注册|发送|发布|删除|关注|点赞|收藏|评论|转发|分享到|举报|退出|注销|log ?in|sign ?in|sign ?up|register|send|post\b|publish|delete|remove|follow|like\b|comment|share to|report|log ?out|sign ?out/i;
/** A field whose text is a secret or identity, not a search word. */
const SENSITIVE_FIELD_RE =
  /密码|验证码|校验码|卡号|银行卡|信用卡|身份证|手机号|手机|电话|邮箱|email|e-mail|password|passcode|otp|verification code|card number|credit card|cvv|cvc|phone|mobile|ssn/i;
/** Controls whose click changes state by itself, whatever their name. */
const STATEFUL_ROLE_RE = /^(?:checkbox|radio|switch|slider|spinbutton|combobox|listbox|option)$/i;

export function readOnlyEffectMayPass(input: {
  readOnly: boolean;
  reason: string;
  action: EffectAction | null;
  triggers: ReadonlyArray<{ branch: string }>;
}): boolean {
  const { readOnly, reason, action, triggers } = input;
  if (!readOnly || reason !== 'unexpected_effect' || !action) return false;
  if (!triggers.length || !triggers.every((t) => t.branch === 'unknown_post')) return false;
  const label = cleanElementName(action.label) ?? '';
  switch (action.tool) {
    case 'navigate':
      return true;
    case 'click':
      if (action.role && STATEFUL_ROLE_RE.test(action.role)) return false;
      return !TRANSACTION_RE.test(label) && !ACCOUNT_ACT_RE.test(label);
    case 'type':
      return !action.submit && !SENSITIVE_FIELD_RE.test(label);
    default:
      return false;
  }
}
