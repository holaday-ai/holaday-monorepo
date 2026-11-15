/**
 * G2i (DEPLOY-R5 core-08, coordinator ruling Q-4): agreeing is the user's, never the assistant's.
 *
 * The B side of the A/B ticked large_form's 「I accept the terms」 while filling the form. The
 * assistant now never ticks or clicks an agreement / consent / terms / privacy / subscribe /
 * marketing checkbox, radio or switch, nor an 「Accept all」 / 「同意」 button, unless the user's
 * own request explicitly asks to agree to that kind of thing. Declining (「拒绝」「仅必要」
 * 「不同意」, unticking a pre-ticked box) stays open. Mailbox and phone boxes are typed only
 * with a value the user gave (login boxes and passwords keep their own, stricter rules).
 *
 * Pure: page signals in, a refusal out. The gate turns a refusal into a skipped step whose
 * message the model reads.
 */

export type ConsentKind = 'terms' | 'marketing' | 'cookie';

/** What a click acts on when it toggles or accepts something (read from the page). */
export interface ConsentTarget {
  kind: ConsentKind;
  /** Short page label, for the model's message. */
  label: string;
}

/** A declining / opting-out label: always the user's side, never refused. */
const DECLINE_RE =
  /不同意|不接受|不允许|不订阅|不接收|不需要|拒绝|退订|取消订阅|仅必要|仅限必要|只接受必要|必要的?\s*cookie|仅.{0,4}必需|disagree|do\s*not|don['’]?t|decline|reject|refuse|deny|necessary|essential|required\s+only|only\s+required|opt[\s-]*out|unsubscribe|no,?\s*thanks/i;
/** A banner's other buttons: choosing what to allow is not accepting. */
const SETTINGS_RE =
  /manage|settings|preferences|customi[sz]e|more\s+options|设置|管理|自定义|偏好/i;
const COOKIE_RE = /cookie/i;
const MARKETING_RE =
  /订阅|营销|推广(?:信息|短信|邮件|消息|内容)|优惠(?:信息|活动|资讯)|促销(?:信息|活动)|广告(?:信息|推送)|newsletter|subscri|marketing|promotional|opt[\s-]*in|(?:send|email)\s+me|keep\s+me\s+(?:updated|informed)/i;
/**
 * 复审 P1: an agreement is an agree / accept verb WITH a terms / policy object. A lone
 * 「同意」「Agree」 (a survey scale), 「Accepts PayPal」 or 「Privacy Screen」 is no agreement.
 */
const AGREE_VERB_RE =
  /同意|接受|已阅读|已读|阅读并|已知悉|知悉并|\b(?:agree[ds]?|accept(?:ed)?|acknowledge[ds]?|i\s+have\s+read|i['’]ve\s+read)\b/i;
const TERMS_OBJECT_RE =
  /条款|协议|政策|须知|声明|免责|\b(?:terms|conditions|polic(?:y|ies)|eula|agreement|privacy\s+(?:notice|statement))\b/i;
/** Consenting in so many words (「I consent to…」), with no scale or product reading. */
const CONSENT_WORD_RE = /\bi\s+(?:hereby\s+)?consent\b|\bconsent\s+to\b/i;
/** A button that accepts / agrees as a whole (cookie banners, privacy popups). */
const ACCEPT_BUTTON_RE =
  /^(?:我?同意|我?接受|同意(?:全部|所有|并继续|并关闭)?|(?:全部|所有)(?:同意|接受|允许)|接受(?:全部|所有)(?:cookie)?|允许(?:全部|所有)(?:cookie)?|(?:i\s*)?(?:accept|agree)(?:\s*(?:all|and\s+(?:continue|close)|&\s*(?:continue|close)))?(?:\s*cookies?)?|allow\s*(?:all)?\s*cookies?|allow\s+all|accept\s+(?:the\s+)?(?:terms|privacy\s+policy))$/i;

function clean(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function short(value: string): string {
  return value.length > 60 ? `${value.slice(0, 60)}…` : value;
}

/** Kind of an agreement-like label, or null for an ordinary one (a product filter, 「Testing」). */
export function consentKindOf(label: string): ConsentKind | null {
  // 「accept_terms」「privacy-policy」: names read as words.
  const text = clean(label.replace(/[_-]+/g, ' '));
  if (!text || DECLINE_RE.test(text)) return null;
  if (COOKIE_RE.test(text)) return 'cookie';
  if (MARKETING_RE.test(text)) return 'marketing';
  if ((AGREE_VERB_RE.test(text) && TERMS_OBJECT_RE.test(text)) || CONSENT_WORD_RE.test(text))
    return 'terms';
  return null;
}

/**
 * A plain element (div / span / li) whose own short text agrees — a custom checkbox drawn
 * without checkbox semantics (「我已阅读并同意《用户协议》」). Cookie wording in running text
 * (「We use cookies…」) is no control.
 */
export function consentSentence(text: string | null | undefined): ConsentTarget | null {
  const value = clean(text);
  if (!value || value.length > 120) return null;
  const kind = consentKindOf(value);
  return kind && kind !== 'cookie' ? { kind, label: short(value) } : null;
}

/**
 * A click that ticks a checkbox / radio / switch named like an agreement. Unticking one that is
 * already ticked lowers what is agreed to and is not refused.
 */
export function consentToggle(toggle: { label: string; checked: boolean }): ConsentTarget | null {
  if (toggle.checked) return null;
  const kind = consentKindOf(toggle.label);
  return kind ? { kind, label: short(clean(toggle.label)) } : null;
}

/** A button (not a toggle) whose own name accepts: 「Accept all」「同意」「Allow all cookies」. */
export function consentButton(labels: Array<string | null | undefined>): ConsentTarget | null {
  for (const raw of labels) {
    const text = clean(raw);
    if (!text || text.length > 40 || DECLINE_RE.test(text) || SETTINGS_RE.test(text)) continue;
    if (!ACCEPT_BUTTON_RE.test(text)) continue;
    const kind: ConsentKind = COOKIE_RE.test(text)
      ? 'cookie'
      : /^(?:accept|allow|接受|允许|全部|所有)/i.test(text) && /all|全部|所有/i.test(text)
        ? 'cookie'
        : 'terms';
    return { kind, label: short(text) };
  }
  return null;
}

// English 「check」「select」 are left out: 「check the return policy」 is a read, not an agreement.
const VERB =
  '勾选|勾上|打勾|打钩|选中|点选|同意|接受|允许|订阅|开通|\\b(?:accept|agree|consent|tick|allow|subscribe|sign\\s*up|opt\\s*in)\\b';
const OBJECT: Record<ConsentKind, string> = {
  terms: '条款|协议|隐私|政策|同意|terms|conditions|privacy|policy|agreement|consent|accept|agree',
  marketing: '订阅|营销|推广|优惠信息|newsletter|subscri|marketing|promotional|offers|updates',
  cookie: 'cookie',
};
/** A negation in the same clause, just before the verb. */
const NEGATION_RE =
  /(?:(?:不|别|勿|无需|不用|不必|没|没有)(?:要|需要|用|必|去)?|\b(?:don['’]?t|do\s+not|never|without|not|no))\s*$/i;

/**
 * The user's own request explicitly asks to agree to this kind of thing: an affirmative verb
 * (勾选 / 同意 / accept / tick / subscribe …) with its object (条款 / 隐私 / newsletter / cookie …)
 * in one clause, not negated (「不要勾选同意条款」 is no request).
 */
export function userAskedToConsent(intent: string | null | undefined, kind: ConsentKind): boolean {
  const text = intent ?? '';
  if (!text.trim()) return false;
  const re = new RegExp(`(${VERB})([^。；;！!？?\\n]{0,24}?)(${OBJECT[kind]})`, 'gi');
  for (const match of text.matchAll(re)) {
    const before = text.slice(0, match.index ?? 0);
    const clause = before.split(/[，,。；;！!？?\n]/).pop() ?? '';
    if (NEGATION_RE.test(clause)) continue;
    return true;
  }
  return false;
}

const KIND_NAME: Record<ConsentKind, string> = {
  terms: '同意条款 / 协议 / 隐私',
  marketing: '订阅 / 营销推送',
  cookie: '接受 Cookie',
};

/** What the model reads when an agreement is refused (the step did not run). */
export function consentRefusalMessage(target: ConsentTarget): string {
  return `「${target.label}」是${KIND_NAME[target.kind]}类的选项，表示用户本人同意，用户没有明确要求同意，所以没有勾选/点击，这一步没有执行。表单里其他普通字段照常填写；在答案里如实写明这一项没勾、原因是要用户本人决定。关 Cookie 或隐私提示可以点「拒绝」「仅必要」「不同意」、× 或「关闭」，或者不理它直接继续读页面；任务确实必须同意才能继续时调用 request_human 请用户自己勾选。`;
}

/** A mailbox / phone box (not a search box). Login boxes are refused before this. */
const CONTACT_LABEL_RE =
  /e-?mail|邮箱|电子邮件|邮件地址|电邮|phone|telephone|mobile|\btel\b|手机|电话|联系方式/i;
const SEARCH_RE = /搜索|search|查找|keyword/i;

export function contactField(field: {
  inputType?: string | null;
  label?: string | null;
  ariaLabel?: string | null;
  placeholder?: string | null;
  name?: string | null;
}): 'email' | 'phone' | null {
  const type = clean(field.inputType).toLowerCase();
  if (type === 'email') return 'email';
  if (type === 'tel') return 'phone';
  if (type === 'search' || type === 'password' || type === 'hidden') return null;
  const signals = [field.label, field.ariaLabel, field.placeholder, field.name].map(clean);
  if (signals.some((value) => SEARCH_RE.test(value))) return null;
  const hit = signals.find((value) => CONTACT_LABEL_RE.test(value));
  if (!hit) return null;
  return /e-?mail|邮箱|邮件|电邮/i.test(hit) ? 'email' : 'phone';
}

function squash(value: string): string {
  return value.replace(/\s+/g, '').toLowerCase();
}

const EMAIL_TOKEN_RE =
  /[^\s@，,。；;：:<>()（）「」『』《》"'“”‘’]+@[^\s@，,。；;：:<>()（）「」『』《》"'“”‘’]+/g;
const PHONE_TOKEN_RE = /\+?\d[\d\s\-().]{3,}\d/g;

/**
 * The typed value is one the user gave in the request (or the box is being cleared). 复审 P2:
 * a whole value, not a fragment — an e-mail equals a mailbox the user wrote; a phone number
 * equals one the user wrote, digits only (「138-0000-0000」 = 「13800000000」).
 */
export function userGaveValue(
  intent: string | null | undefined,
  typed: string,
  kind: 'email' | 'phone' = 'email',
): boolean {
  const value = squash(typed);
  if (value === '') return true;
  const text = intent ?? '';
  if (kind === 'phone') {
    const digits = value.replace(/\D/g, '');
    if (digits.length < 5) return false;
    return [...text.matchAll(PHONE_TOKEN_RE)].some(
      (match) => match[0].replace(/\D/g, '') === digits,
    );
  }
  return [...text.matchAll(EMAIL_TOKEN_RE)].some(
    (match) => squash(match[0]).replace(/[.。]+$/, '') === value,
  );
}

export function contactRefusalMessage(kind: 'email' | 'phone'): string {
  const name = kind === 'email' ? '邮箱' : '电话 / 手机号';
  return `这是${name}框，属于用户本人的联系信息，用户没有在请求里给出要填的值，不代填（也不编一个），这一步没有执行。表单里其他普通字段照常填写；在答案里如实写明这一项留空、原因是要用户本人提供。`;
}
