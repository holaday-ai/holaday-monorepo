/// <reference lib="dom" />

/** What a click or typing target is to a login / sign-up / authorization step. */
export interface LoginContext {
  /** An account, phone, password or code box, or any box of a login popup / form block. */
  loginField: boolean;
  /** A login, sign-up, authorize, 「同意并…」 or 「获取验证码」 control of such a step. */
  loginControl: boolean;
}

/**
 * FIX-36 复审 #1 (red line: never type an account or phone number, never log in or authorize
 * for the user). Runs IN THE PAGE on the action's target — `evaluate`d by the cloud gate and
 * `toString()`ed into the user-browser extension's reads — so it stays self-contained: no
 * imports, no closures, no named inner helpers.
 *
 * A login field: the box's own attributes, `<label>` or aria-labelledby text name an account /
 * phone / mailbox, or it is a password / one-time-code box (「6位数字」 included), or it sits
 * in a login block — a dialog, a fixed / absolute layer smaller than the page, or a framed
 * document — that has a password box, a code box or a 「获取验证码」 control, or that says
 * 登录 / 注册 while the page probe reports a login popup (`popupReported`). Search boxes
 * are never login fields.
 * A login control: 「授权登录 / 一键登录 / 同意并… / 获取验证码」 anywhere, or 登录 / 注册 /
 * 授权 inside such a block or a form that asks for a password or code.
 */
export function readLoginContext(node: Node, popupReported: boolean): LoginContext {
  const ACCOUNT_RE =
    /账号|帐号|账户|用户名|手机号|手机账号|电话|邮箱|login|user|account|e-?mail|phone|mobile/i;
  const SEARCH_RE = /搜索|search|查找|keyword|(?:^|\s)(?:q|wd|kw|k|key|query)(?:\s|$)/i;
  const CODE_RE =
    /验证码|短信码|动态码|校验码|安全码|口令|otp|one-time|verification ?code|passcode|\d\s*位数字|\d[- ]?digit/i;
  const GET_CODE_RE =
    /(?:获取|发送|重新发送|重发|免费获取)(?:短信)?(?:验证码|动态码)|(?:get|send)(?: a)? (?:verification )?code/i;
  const LOGIN_RE = /登录|登入|注册|sign ?in|log ?in|sign ?up/i;
  const CONTROL_RE =
    /登录|登入|注册|授权|同意并|(?:获取|发送)(?:短信)?验证码|sign ?in|log ?in|sign ?up|authori[sz]e|allow access|(?:get|send)(?: a)? code/i;
  const STRONG_RE =
    /授权登录|确认授权|同意授权|同意并|一键登录|快捷登录|本机号码|(?:获取|发送|重新发送)(?:短信)?(?:验证码|动态码)/;
  const ACTIONABLE =
    'button,a[href],input,select,textarea,summary,label,[role=button],[role=link],[role=menuitem],[role=option],[role=tab],[role=checkbox],[onclick]';
  const none: LoginContext = { loginField: false, loginControl: false };
  let el = (node.nodeType === 1 ? node : node.parentElement) as Element | null;
  if (!el) return none;
  for (let cur: Element | null = el, hops = 0; cur && hops < 200; hops++) {
    if (cur.matches(ACTIONABLE)) {
      el = cur;
      break;
    }
    const root = cur.getRootNode();
    cur = cur.parentElement ?? ('host' in root ? (root as ShadowRoot).host : null);
  }
  const doc = el.ownerDocument;
  const view = doc.defaultView;
  const tag = el.tagName.toLowerCase();
  const type = (el.getAttribute('type') ?? '').toLowerCase();
  const labels = Array.from((el as HTMLInputElement).labels ?? [])
    .map((label) => label.textContent ?? '')
    .join(' ');
  const labelledBy = (el.getAttribute('aria-labelledby') ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => doc.getElementById(id)?.textContent ?? '')
    .join(' ');
  const identity = [
    el.getAttribute('name'),
    el.id,
    el.getAttribute('placeholder'),
    el.getAttribute('aria-label'),
    el.getAttribute('autocomplete'),
    labels,
    labelledBy,
  ]
    .filter(Boolean)
    .join(' ');
  // A login block: dialogs, fixed / absolute layers smaller than the page, a framed document.
  const blocks: Array<{ block: Element; popup: boolean }> = [];
  const dialog = el.closest('dialog,[role="dialog"],[role="alertdialog"],[aria-modal="true"]');
  if (dialog) blocks.push({ block: dialog, popup: true });
  let fixed = false;
  for (let p = el.parentElement; p && p !== doc.documentElement; p = p.parentElement) {
    const position = view ? view.getComputedStyle(p).position : '';
    if (position === 'fixed') fixed = true;
  }
  for (
    let p = el.parentElement;
    p && p !== doc.body && p !== doc.documentElement;
    p = p.parentElement
  ) {
    const position = view ? view.getComputedStyle(p).position : '';
    if (position !== 'fixed' && position !== 'absolute') continue;
    const box = p.getBoundingClientRect();
    if (view && box.width * box.height > 0.8 * view.innerWidth * view.innerHeight) continue;
    blocks.push({ block: p, popup: fixed });
  }
  if (view && view !== view.top && doc.body) blocks.push({ block: doc.body, popup: true });
  const form = (el as HTMLInputElement).form ?? el.closest('form');
  // Whether each block (and the form, last) has a password or code box.
  const coded = [...blocks.map(({ block }) => block), ...(form ? [form] : [])].map((scope) =>
    Array.from(scope.querySelectorAll('input,textarea')).some(
      (input) =>
        (input.getAttribute('type') ?? '').toLowerCase() === 'password' ||
        CODE_RE.test(
          [
            input.getAttribute('name'),
            input.id,
            input.getAttribute('placeholder'),
            input.getAttribute('aria-label'),
            input.getAttribute('autocomplete'),
          ].join(' '),
        ),
    ),
  );
  const inBlock = blocks.some(({ block, popup }, index) => {
    const text = (block as HTMLElement).innerText ?? block.textContent ?? '';
    return (
      coded[index] || GET_CODE_RE.test(text) || (popup && popupReported && LOGIN_RE.test(text))
    );
  });
  const loginForm = !!form && !!coded[coded.length - 1];
  const typing =
    tag === 'textarea' ||
    tag === 'select' ||
    (el as HTMLElement).isContentEditable ||
    (tag === 'input' &&
      !['submit', 'button', 'image', 'checkbox', 'radio', 'reset'].includes(type));
  const search =
    type === 'search' ||
    el.getAttribute('role') === 'searchbox' ||
    !!el.closest('[role="search"]') ||
    SEARCH_RE.test(identity);
  const loginField =
    typing &&
    !search &&
    (['email', 'tel', 'password'].includes(type) ||
      ACCOUNT_RE.test(identity) ||
      CODE_RE.test(identity) ||
      inBlock);
  const text = [
    typing ? '' : ((el as HTMLElement).innerText ?? el.textContent ?? ''),
    tag === 'input' && !typing ? (el as HTMLInputElement).value : '',
    el.getAttribute('aria-label'),
    el.getAttribute('title'),
    typing ? '' : labels,
  ]
    .filter(Boolean)
    .join(' ')
    .slice(0, 400);
  const loginControl =
    !typing && (STRONG_RE.test(text) || (CONTROL_RE.test(text) && (inBlock || loginForm)));
  return { loginField, loginControl };
}
