/**
 * Playbook ④ explorer — SENSITIVE SITE PROTOCOL + D-boundary (charter §D).
 *
 * A domain-agnostic action guard. Mirrors the proven forbidden-action patterns
 * from the OTA user-browser policy (`ota-user-browser-policy.ts:classifyOtaAction`)
 * but is NOT OTA-domain-coupled, and ADDS login / register / credential / identity
 * patterns the OTA guard lacks (the explorer must never start an auth flow). The
 * label match runs on a WHITESPACE-NORMALISED, lower-cased label so spacing /
 * zero-width-char bypasses ("登 录", "paynow") cannot slip through.
 *
 * Pure / no IO. v1 STOP semantics (see PLAYBOOK_PHASE4_EXPLORER_DESIGN.md §5):
 *   1. doc-first explore has ZERO live actions → inherently within D-boundary.
 *   2. the optional browse-试用 path is given a read-only-constrained intent.
 *   3. crystallize-time: `isCapturedStepSafe` (label AND url aware; fail-closed on
 *      unknown step types) drops a sensitive captured step so a draft path never
 *      replays it.
 *   4. run-level: a sensitive encounter marks the site human-final-click + skips it.
 * A LIVE per-action veto INSIDE the supercar loop is DEFERRED — it would touch the
 * hot path; v1 does not (and v1's doc-first path emits no live actions). When the
 * browse-试用 lane lands, this guard MUST be wired as a pre-action veto, not left as
 * a prompt-only constraint. The explorer NEVER crosses the sensitive line.
 */

export type ExplorerActionKind =
  | 'navigate'
  | 'screenshot'
  | 'read'
  | 'scroll'
  | 'click'
  | 'type'
  | 'submit';

export interface ExplorerAction {
  kind: ExplorerActionKind;
  /** Visible control label / accessible name (click / type / submit). */
  label?: string;
  /**
   * Additional accessible-name signals — ALL are checked independently (fail-safe
   * OR). An ICON-ONLY control hides its sensitive intent in aria-label / title while
   * the visible text is a benign glyph (e.g. 💳); a `??` first-non-null label pick let
   * that slip the veto, so every signal is matched on its own. (Veto-path only.)
   */
  ariaLabel?: string;
  title?: string;
  /** Input-field signals for `type` (also OR-checked). */
  placeholder?: string;
  name?: string;
  /** For `type`: the focused element's input type. 'password' → ALWAYS vetoed. */
  inputType?: string;
  /** Target URL (navigate). */
  url?: string;
}

export interface ExplorerActionVerdict {
  allowed: boolean;
  /** true when blocked specifically because the action is sensitive (vs unknown). */
  sensitive: boolean;
  /** machine + human readable, suitable for the audit log + exploration_run summary. */
  reason: string;
}

// Forbidden control labels (tested against the whitespace-normalised, lower-cased
// label). Order / pay / cart / checkout / account / credential / identity / login /
// register + common side-effect actions (subscribe/follow/post). Broadened after the
// adversarial review caught 立即购买 / 购买 / 下单 / 确认付款 / 加入购物车 / 结算 /
// 微信支付 / Buy Now / Add to cart / Order Now slipping through. EN patterns are
// contiguous (whitespace already stripped); `\w*` bridges inserted words.
const SENSITIVE_LABEL_RE =
  /提交|下单|下订单|购买|结算|付款|支付|去支付|确认支付|确认付款|确认下单|确认订单|确认并支付|确认$|^确认|立即下单|立即购买|马上购买|去结算|去付款|去登录|加入购物车|加购|立即预订|确认预订|提交预订|绑定银行卡|添加银行卡|保存银行卡|保存支付|微信支付|支付宝|实名认证|身份证|银行卡号|手机验证码|短信验证码|验证码|登录|登陆|注册|设置密码|修改密码|重置密码|密码|发送|发布|发表|关注|订阅|私信|pay(?:now|ment)?|buynow|addtocart|cart|checkout|place\w*order|submitorder|order(?:now|confirm)?|confirm\w*pay|proceed\w*pay|continue\w*pay|signin|login|logon|signup|register|授权|authorize|continuewith|connectwith|oauth|password|verification\w*code|subscribe|follow/i;

// Forbidden navigation targets (tested against the lower-cased url). Pay/checkout/
// order/cart/wallet/billing (commerce) + login/signin/signup/register/auth/oauth/sso/
// account (auth). Broadened after the review caught bare /order, /account, /cart,
// /buy, /purchase, /sso, /connect/authorize, /users/sign_in.
const SENSITIVE_URL_RE =
  /\b(?:pay|payment|cashier|checkout|order|orders|orderpay|buy|buynow|purchase|cart|trade|settlement|wallet|billing|recharge|topup|subscribe|login|log-in|signin|sign-in|sign_in|logon|signup|sign-up|register|auth|oauth|sso|connect\/authorize|account)\b|订单提交|booking\/confirm/i;

// Phase 1 Playbook ④ A3 — LOGIN-MODE-ONLY extra blacklist. A logged-in test-account browse can
// reach controls that DON'T exist for a logged-out visitor (money movement / irreversible account
// ops / content publishing-and-sharing). These are vetoed ONLY when loginMode is passed (the
// public-skeleton免登录 lane is byte-identical — the base RE above is untouched). Three groups:
//   资金 transfer/withdraw/recharge/bind-card/authorized-deduction
//   不可逆 unbind/deactivate/delete-account/delete/permanent
//   发布扩展 publish-public/share/invite/authorize-login/confirm-authorize
const SENSITIVE_LABEL_EXTRA_RE =
  /转账|汇款|提现|提款|充值|绑卡|绑定银行卡|授权扣款|自动扣费|解绑|注销|注销账号|删除账号|删除账户|删除文件|删除|清空|永久|公开|设为公开|分享|分享给|转发|邀请|授权登录|确认授权|授权访问|transfer|withdraw|topup|recharge|bind\w*card|unbind|deactivate|delete\w*account|delete|remove|permanent|make\w*public|share|invite|authorize\w*login|grant\w*access/i;

/** Normalise a label for matching: strip whitespace + zero-width chars, lower-case. */
function normLabel(label: string): string {
  // strip whitespace + zero-width / BOM formatting chars, then lower-case, so
  // spacing / invisible-char bypasses ("登 录") cannot defeat the patterns.
  let out = '';
  for (const ch of label) {
    const c = ch.codePointAt(0) ?? 0;
    if (/\s/.test(ch)) continue;
    if (
      c === 0x200b ||
      (c >= 0x200c && c <= 0x200f) ||
      (c >= 0x2060 && c <= 0x2064) ||
      c === 0xfeff
    )
      continue;
    out += ch;
  }
  return out.toLowerCase();
}

/**
 * Classify a proposed explorer action. read / screenshot / scroll are always
 * allowed; navigate is allowed unless the URL is sensitive; submit is NEVER
 * allowed; click / type are allowed only when the (normalised) label is not sensitive.
 */
export function classifyExplorerAction(
  action: ExplorerAction,
  opts: { loginMode?: boolean } = {},
): ExplorerActionVerdict {
  // A3: login-mode thickens the label blacklist with EXTRA_RE (money / irreversible / publish).
  // Default false → byte-identical to the免登录 lane (the public-skeleton explorer never passes it).
  const loginMode = opts.loginMode === true;
  const rawLabel = (action.label ?? '').trim();
  const url = (action.url ?? '').trim().toLowerCase();
  switch (action.kind) {
    case 'read':
    case 'screenshot':
    case 'scroll':
      return { allowed: true, sensitive: false, reason: `${action.kind}: read-only, allowed` };
    case 'navigate':
      if (SENSITIVE_URL_RE.test(url)) {
        return {
          allowed: false,
          sensitive: true,
          reason: `navigate blocked: sensitive url (${url.slice(0, 80)})`,
        };
      }
      return { allowed: true, sensitive: false, reason: 'navigate: non-sensitive url, allowed' };
    case 'submit':
      return {
        allowed: false,
        sensitive: true,
        reason: `submit blocked: form submission is never allowed (label="${rawLabel.slice(0, 40)}")`,
      };
    case 'click':
    case 'type': {
      // D-boundary: typing into a credential field is NEVER allowed, independent of
      // any label (the explorer enters no credentials). type=password is decisive.
      if (action.kind === 'type' && normLabel((action.inputType ?? '').trim()) === 'password') {
        return {
          allowed: false,
          sensitive: true,
          reason: 'type blocked: password field (D-boundary, credentials never entered)',
        };
      }
      // Fail-safe multi-signal OR. visible text / aria-label / title / placeholder /
      // name are each matched INDEPENDENTLY — an icon-only sensitive control (benign
      // glyph as visible text, sensitive aria-label/title) must not slip a first-non-
      // null label pick. Blocked if ANY signal is sensitive.
      const signals: Array<string | undefined> = [
        action.label,
        action.ariaLabel,
        action.title,
        action.placeholder,
        action.name,
      ];
      for (const raw of signals) {
        const s = normLabel((raw ?? '').trim());
        if (s && (SENSITIVE_LABEL_RE.test(s) || (loginMode && SENSITIVE_LABEL_EXTRA_RE.test(s)))) {
          return {
            allowed: false,
            sensitive: true,
            reason: `${action.kind} blocked: sensitive control ("${(raw ?? '').trim().slice(0, 40)}")`,
          };
        }
      }
      return { allowed: true, sensitive: false, reason: `${action.kind}: benign control, allowed` };
    }
    default:
      return { allowed: false, sensitive: true, reason: 'unknown action kind blocked' };
  }
}

/** True when an action is within the explorer's read-only D-boundary. */
export function isWithinDBoundary(action: ExplorerAction): boolean {
  return classifyExplorerAction(action).allowed;
}

const KNOWN_STEP_KINDS: Record<string, ExplorerActionKind> = {
  navigate: 'navigate',
  click: 'click',
  type: 'type',
  scroll: 'scroll',
  submit: 'submit',
  read: 'read',
  screenshot: 'screenshot',
};

/**
 * Crystallize-time filter: should this captured step be distilled into a draft
 * path? A sensitive captured step (e.g. a "提交订单" click, or a navigate to a
 * /checkout url) is dropped so a path never replays it.
 *
 * FAIL-CLOSED: an UNRECOGNISED `stepType` (e.g. a future 'form_submit' / 'tap' /
 * 'press') is treated as unsafe — never crystallized — rather than coerced to a
 * harmless 'read'. Both the visible-text label AND the captured url (frame/entry)
 * are checked.
 */
export function isCapturedStepSafe(
  stepType: string,
  visibleText: string | null,
  url?: string | null,
): boolean {
  const kind = KNOWN_STEP_KINDS[stepType];
  if (!kind) return false; // unknown step type → fail closed
  if (kind === 'navigate') {
    return classifyExplorerAction({ kind: 'navigate', url: url ?? visibleText ?? undefined })
      .allowed;
  }
  const labelSafe = classifyExplorerAction({ kind, label: visibleText ?? undefined }).allowed;
  const urlSafe = !url || classifyExplorerAction({ kind: 'navigate', url }).allowed;
  return labelSafe && urlSafe;
}
