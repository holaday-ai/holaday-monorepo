/// <reference lib="dom" />

/** What a click or typing target is to a login / sign-up / authorization step. */
export interface LoginContext {
  /** An account, password or code box, or any box of a login block. */
  loginField: boolean;
  /** A login, sign-up, authorize, 「同意并…」, send-code or next-step control of such a step. */
  loginControl: boolean;
  /** The target sits in a login block or a login form (a key there may submit the login). */
  loginBlock: boolean;
}

/**
 * FIX-36 复审 #1/#2 (red line: never type an account or phone number, never log in or
 * authorize for the user). Runs IN THE PAGE on the action's target — `evaluate`d by the cloud
 * gate and `toString()`ed into the user-browser extension's reads — so it stays
 * self-contained: no imports, no closures, no named inner helpers.
 *
 * A login block is any of: the smallest ancestor (below <body>) holding a visible password or
 * code box, when it has at most 6 visible fields or says 注册 / 登录 / 手机号 (a full-screen
 * mask's plain inner box, a sign-up box); a dialog, a fixed layer with at most 6 fields (not a
 * bar stuck to the top), an absolute layer smaller than the page, or a framed document, that
 * has a password / code box or a 「获取验证码」 control; a dialog, fixed layer or framed
 * document that says 登录 / 注册 in a few words or holds a code box hidden until 「发送」;
 * any of these that says 登录 / 注册 while the page probe reports a login popup
 * (`popupReported`). Never a page header / nav.
 * A login field: a box naming an account / user name on its own; a password / code box
 * (「6位数字」 included); a phone / mailbox box only inside a login block or login form (a
 * contact or booking form's phone and e-mail stay fillable); any box of a login block. Search
 * boxes never.
 * A login control: 「授权登录 / 一键登录 / 同意并… / 获取验证码」 anywhere; 登录 / 注册 / 授权 /
 * 下一步 / 继续 / Next / Continue, and 发送 / 获取 / 重新获取 / a countdown, inside a login
 * block or login form.
 */
export function readLoginContext(node: Node, popupReported: boolean): LoginContext {
  const ACCOUNT_RE =
    /账号|帐号|账户|用户名|登录名|username|user ?name|user ?id|login ?(?:id|name)|account|(?:^|[\s_-])login(?:$|[\s_-])/i;
  const CONTACT_RE = /手机|电话|邮箱|e-?mail|phone|mobile/i;
  const SEARCH_RE = /搜索|search|查找|keyword|(?:^|\s)(?:q|wd|kw|k|key|query)(?:\s|$)/i;
  const CODE_RE =
    /验证码|短信码|动态码|校验码|安全码|口令|otp|one-time|verification ?code|passcode|\d\s*位数字|\d[- ]?digit/i;
  const GET_CODE_RE =
    /(?:获取|发送|重新发送|重发|免费获取)(?:短信)?(?:验证码|动态码)|(?:get|send)(?: a)? (?:verification )?code/i;
  const LOGIN_RE = /登录|登入|注册|sign ?in|log ?in|sign ?up/i;
  const SIGNUP_RE = /注册|登录|登入|手机号|sign ?up|sign ?in|log ?in|register/i;
  const CONTROL_RE =
    /登录|登入|注册|授权|同意并|下一步|继续|(?:获取|发送)(?:短信)?验证码|sign ?in|log ?in|sign ?up|authori[sz]e|allow access|\bnext\b|\bcontinue\b|(?:get|send)(?: a)? code/i;
  const CODE_CONTROL_RE =
    /^\s*(?:发送|获取|重新获取|重新发送|重发|\d+\s*(?:s|秒)|\(?\d+\)?\s*秒后)|倒计时|\b(?:re)?send\b|\bget\b/i;
  const STRONG_RE =
    /授权登录|确认授权|同意授权|同意并|一键登录|快捷登录|本机号码|(?:获取|发送|重新发送)(?:短信)?(?:验证码|动态码)/;
  const ACTIONABLE =
    'button,a[href],input,select,textarea,summary,label,[role=button],[role=link],[role=menuitem],[role=option],[role=tab],[role=checkbox],[onclick]';
  const FIELDS =
    'input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=submit]):not([type=button]):not([type=image]):not([type=reset]),textarea,select';
  const HEADER = 'header,nav,[role="banner"],[role="navigation"]';
  const none: LoginContext = { loginField: false, loginControl: false, loginBlock: false };
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
  const dialog = el.closest('dialog,[role="dialog"],[role="alertdialog"],[aria-modal="true"]');
  const form = (el as HTMLInputElement).form ?? el.closest('form');
  const framed = !!view && view !== view.top && !!doc.body;
  const ancestors: Element[] = [];
  for (
    let p = el.parentElement;
    p && p !== doc.body && p !== doc.documentElement;
    p = p.parentElement
  )
    ancestors.push(p);
  // Per scope: its visible fields, and whether one is a password or code box (hidden boxes —
  // a closed popup kept in the DOM — do not count).
  const scopes: Element[] = [
    ...ancestors,
    ...(dialog ? [dialog] : []),
    ...(form ? [form] : []),
    ...(framed ? [doc.body] : []),
  ];
  const scans = new Map(
    scopes.map((scope) => {
      const all = Array.from(scope.querySelectorAll(FIELDS));
      const fields = all.filter((field) => (field as HTMLElement).getClientRects().length > 0);
      return [
        scope,
        {
          fields: fields.length,
          // 复审 #3: a popup's code box hidden until 「发送」 is still its code box.
          codedAny: all.some(
            (field) =>
              (field.getAttribute('type') ?? '').toLowerCase() === 'password' ||
              CODE_RE.test(
                [
                  field.getAttribute('name'),
                  field.id,
                  field.getAttribute('placeholder'),
                  field.getAttribute('aria-label'),
                  field.getAttribute('autocomplete'),
                ].join(' '),
              ),
          ),
          // A step-one login (an account box and 下一步, no password yet) is a login too.
          account: fields.some((field) =>
            ACCOUNT_RE.test(
              [
                field.getAttribute('name'),
                field.id,
                field.getAttribute('placeholder'),
                field.getAttribute('aria-label'),
                field.getAttribute('autocomplete'),
                ...Array.from((field as HTMLInputElement).labels ?? []).map(
                  (label) => label.textContent ?? '',
                ),
              ].join(' '),
            ),
          ),
          coded: fields.some(
            (field) =>
              (field.getAttribute('type') ?? '').toLowerCase() === 'password' ||
              CODE_RE.test(
                [
                  field.getAttribute('name'),
                  field.id,
                  field.getAttribute('placeholder'),
                  field.getAttribute('aria-label'),
                  field.getAttribute('autocomplete'),
                ].join(' '),
              ),
          ),
        },
      ] as const;
    }),
  );
  // `modal`: a popup-like layer (a dialog, a fixed layer, a framed document) — one that says
  // 登录 / 注册 in a few words, or holds a (hidden) code box, is a login block by itself, with
  // or without the page probe (复审 #3).
  const blocks: Array<{
    block: Element;
    popup: boolean;
    modal: boolean;
    coded: boolean;
    codedAny: boolean;
    account: boolean;
  }> = [];
  if (dialog)
    blocks.push({
      block: dialog,
      popup: true,
      modal: true,
      coded: !!scans.get(dialog)?.coded,
      codedAny: !!scans.get(dialog)?.codedAny,
      account: !!scans.get(dialog)?.account,
    });
  let fixedAbove = false;
  for (let p = el.parentElement; p && p !== doc.documentElement; p = p.parentElement)
    if (view && view.getComputedStyle(p).position === 'fixed') fixedAbove = true;
  let anchored = false;
  for (const p of ancestors) {
    const position = view ? view.getComputedStyle(p).position : '';
    const found = scans.get(p) ?? { fields: 0, coded: false, codedAny: false, account: false };
    if (!anchored && found.coded) {
      anchored = true;
      // A sign-up box has more boxes than a login: one that says 注册 / 登录 / 手机号 counts
      // whatever its size (复审 #3).
      if (found.fields <= 6 || SIGNUP_RE.test((p as HTMLElement).innerText ?? ''))
        blocks.push({
          block: p,
          popup: false,
          modal: false,
          coded: true,
          codedAny: true,
          account: false,
        });
    }
    const box = p.getBoundingClientRect();
    // A bar stuck to the top (under ~120px) is the page's header, not a popup (复审 #3).
    const topBar = position === 'fixed' && box.top <= 4 && box.height < 120;
    if (position === 'fixed' && found.fields <= 6 && !topBar)
      blocks.push({ block: p, popup: true, modal: true, ...found });
    else if (position === 'absolute') {
      if (!view || box.width * box.height <= 0.8 * view.innerWidth * view.innerHeight)
        blocks.push({ block: p, popup: fixedAbove, modal: false, ...found });
    }
  }
  // FIX-37 (coordinator fixture R as written): a sign-up form with no container at all — the
  // box and a visible password box both sit right under <body>, and the page says 注册 / 登录 /
  // 手机号. Only then is <body> the block; real pages wrap their forms, so nothing else widens.
  if (
    !anchored &&
    doc.body &&
    el.parentElement === doc.body &&
    Array.from(doc.body.children).some(
      (child) =>
        child.matches('input[type="password" i]') &&
        (child as HTMLElement).getClientRects().length > 0,
    ) &&
    SIGNUP_RE.test(doc.body.innerText ?? '')
  )
    blocks.push({
      block: doc.body,
      popup: false,
      modal: false,
      coded: true,
      codedAny: true,
      account: false,
    });
  if (framed)
    blocks.push({
      block: doc.body,
      popup: true,
      modal: true,
      coded: !!scans.get(doc.body)?.coded,
      codedAny: !!scans.get(doc.body)?.codedAny,
      account: !!scans.get(doc.body)?.account,
    });
  const inBlock = blocks.some(({ block, popup, modal, coded, codedAny, account }) => {
    const text = (block as HTMLElement).innerText ?? block.textContent ?? '';
    const header = block.matches(HEADER) || !!block.closest(HEADER);
    return (
      coded ||
      (popup && account) ||
      GET_CODE_RE.test(text) ||
      (modal && !header && text.length <= 400 && (LOGIN_RE.test(text) || codedAny)) ||
      (popup && popupReported && LOGIN_RE.test(text) && !header)
    );
  });
  const loginForm = !!form && !!(scans.get(form)?.coded || scans.get(form)?.account);
  const loginBlock = inBlock || loginForm;
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
    (type === 'password' ||
      ACCOUNT_RE.test(identity) ||
      CODE_RE.test(identity) ||
      inBlock ||
      (loginForm && (['email', 'tel'].includes(type) || CONTACT_RE.test(identity))));
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
    !typing &&
    (STRONG_RE.test(text) ||
      (loginBlock && CONTROL_RE.test(text)) ||
      (loginBlock && CODE_CONTROL_RE.test(text)));
  return { loginField, loginControl, loginBlock };
}
