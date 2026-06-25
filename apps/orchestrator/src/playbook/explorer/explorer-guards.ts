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
  /** 预订站加固 (login-mode only) — structural signals from the target descriptor.
   *  tagName/inputType → 提交型控件 detection (层 B); pageUrl (the page's location.href at
   *  capture time) → 交易阶段 fail-closed reversal. All OPTIONAL → 免登录 lane unaffected. */
  tagName?: string;
  pageUrl?: string;
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
// NOTE: matched against normLabel output (whitespace + zero-width stripped, lower-cased) — so an
// EN share-link control "Copy link" arrives as "copylink"; patterns are space-free accordingly.
const SENSITIVE_LABEL_EXTRA_RE =
  /转账|汇款|提现|提款|充值|绑卡|绑定银行卡|授权扣款|自动扣费|解绑|注销|注销账号|删除账号|删除账户|删除文件|删除任务|删除项目|删除|永久删除|清空收件箱|清空回收站|清空账户|清空账号|清空数据|清空所有|清空全部|清空列表|清空项目|设为公开|公开分享|公开发布|分享|分享给|转发|邀请|授权登录|确认授权|授权访问|复制链接|分享链接|获取链接|生成链接|邀请链接|预订|预定|立即预订|确认预订|继续预订|提交订单|确认订单|下单|立即下单|去支付|去结算|继续支付|确认支付|立即支付|占座|选座|锁定座位|担保|预授权|添加出行人|添加乘客|新增联系人|填写证件|提交资料|保存出行人|copylink|sharelink|getlink|invitelink|copylinktoshare|booknow|bookflight|reserve|checkout|placeorder|confirmbooking|proceedtopay|paynow|continuetopayment|holdseat|addtraveler|addpassenger|addguest|transfer|withdraw|topup|recharge|bind\w*card|unbind|deactivate|delete\w*account|delete|remove|permanent\w*delete|make\w*public|share|invite|authorize\w*login|grant\w*access/i;

// 预订/交易站 fail-closed 加固 (login-mode ONLY). 三段：
// ① 层 B 结构信号 —— 提交型控件(button / input[submit|button|image]) + 这些交易/继续/提交文案任一 →
//    视为交易动作拦(不靠精确词、靠"提交型 + 交易语境"上下文；"继续/下一步" 本身 benign，在提交钮上=进交易)。
const TRANSACTION_TEXT_RE =
  /确认|下单|支付|付款|预订|预定|继续|下一步|提交|结算|占座|选座|担保|预授权|book\w*now|reserve|checkout|pay\b|paynow|confirm|proceed|continue|next|submit|placeorder/i;
// ② 交易阶段页面(pageUrl=location.href 命中这些段) —— 登录态在此页 = 最危险，default-deny。
const TRANSACTION_PAGE_RE =
  /checkout|payment|cashier|\/order|\/orders|booking|\/confirm|settlement|\/pay\b|\/pay\/|\/trade|\/buy\b|订单提交|booking\/confirm/i;
// ③ 交易页唯一放行的安全白名单(返回/取消/查看/修改/搜索/筛选类) —— 其余 click 全拦。
const SAFE_CONTROL_RE =
  /返回|退回|后退|上一步|上一页|取消|放弃|修改|编辑|查看|详情|展开|收起|筛选|搜索|过滤|排序|关闭|帮助|back|cancel|edit|view|detail|filter|search|sort|close|previous|prev|help/i;

/** 提交型控件 = button / input[submit|button|image]. (role 未捕获 → 是已知盲点、层 C 兜底。) */
function isSubmitTypeControl(tagName?: string, inputType?: string): boolean {
  const t = (tagName ?? '').trim().toLowerCase();
  const it = (inputType ?? '').trim().toLowerCase();
  if (t === 'button') return true;
  if (t === 'input' && (it === 'submit' || it === 'button' || it === 'image')) return true;
  return false;
}

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
      // 预订/交易站 fail-closed 加固 — login-mode ONLY (免登录 lane / user tasks never set loginMode →
      // this whole block is skipped; base + EXTRA word checks above already ran). Adds STRUCTURE/CONTEXT.
      if (loginMode) {
        const normSignals = signals.map((sig) => normLabel((sig ?? '').trim())).filter(Boolean);
        const anySafe = normSignals.some((s) => SAFE_CONTROL_RE.test(s));
        // ② 交易页反转 (最危险页·判不准往拦·极致): 登录态 + pageUrl 命中交易阶段 → default-deny ANY
        //    click 除非命中安全白名单(返回/取消/查看/修改/搜索/筛选…). 提交型钮 + 中性钮 全覆盖。
        if (
          action.kind === 'click' &&
          action.pageUrl &&
          TRANSACTION_PAGE_RE.test(action.pageUrl.toLowerCase()) &&
          !anySafe
        ) {
          return {
            allowed: false,
            sensitive: true,
            reason: `交易页 fail-closed: 登录态交易阶段(${action.pageUrl.slice(0, 60)}) 非白名单点击默认拦`,
          };
        }
        // ① 层 B 结构信号: 提交型控件(button/submit) + 交易/继续/提交 文案 → 交易动作拦 (catches a
        //    NEUTRAL "继续/下一步/continue" sitting on a 提交钮 = proceed-to-transact, no keyword needed).
        if (
          isSubmitTypeControl(action.tagName, action.inputType) &&
          normSignals.some((s) => TRANSACTION_TEXT_RE.test(s))
        ) {
          return {
            allowed: false,
            sensitive: true,
            reason: `层B 提交型交易控件拦 (tag=${(action.tagName ?? '?').slice(0, 12)}, "${rawLabel.slice(0, 30)}")`,
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
