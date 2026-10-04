/// <reference lib="dom" />
// MIRROR of packages/browser-driver/src/observation-redaction.ts (batch 10 fixes).
// The orchestrator runs compiled from dist/ and does not take a runtime
// dependency on the browser-driver package, so the module is mirrored here.
// observation-redaction.mirror.test.ts fails if the two copies drift.
/**
 * Selected-tab observation redaction.
 *
 * Playwright's `ariaSnapshot()` renders the CURRENT VALUE of every textbox,
 * including `<input type="password">` and one-time-code fields
 * (`- textbox "密码": hunter2`). The selected-Chrome observation is shipped to
 * the orchestrator and the model, so secrets the user typed into their own
 * page (login, human handoff, OTP) must be masked before the observation
 * leaves the extension.
 *
 * Two parts:
 *  - `collectSensitiveFieldValues` runs IN THE PAGE (passed to
 *    `page.evaluate`) and returns the non-empty values of sensitive fields.
 *  - `redactSensitiveValues` is pure: it masks those values in the snapshot
 *    text (line-based for textbox lines, plus substring masking).
 *
 * Signals mirror the orchestrator's capture redaction
 * (`apps/orchestrator/src/playbook/action-capture-redaction.ts`) plus Chinese
 * labels (密码 / 验证码 / 口令 / 动态码 / 校验码). Over-redaction is acceptable;
 * leaking a secret is not.
 */

export const REDACTED_OBSERVATION_VALUE = '[REDACTED]';

/** Values shorter than this are only masked on their own textbox line, not
 *  everywhere, so a 1-2 character secret cannot blank unrelated text. */
const MIN_GLOBAL_MASK_LENGTH = 3;

/**
 * Runs inside the page (serialised by Playwright). Must stay self-contained:
 * no closures over module scope.
 */
export function collectSensitiveFieldValues(): string[] {
  const SENSITIVE_AUTOCOMPLETE = [
    'current-password',
    'new-password',
    'one-time-code',
    'cc-number',
    'cc-csc',
    'cc-exp',
  ];
  const SENSITIVE_TEXT =
    /password|passwd|passcode|otp|cvv|cvc|card|ssn|密码|验证码|口令|动态码|校验码|安全码/i;
  const values = new Set<string>();

  const labelText = (el: HTMLInputElement | HTMLTextAreaElement): string => {
    const parts: string[] = [];
    try {
      for (const label of Array.from(el.labels ?? [])) parts.push(label.textContent ?? '');
    } catch {
      /* labels unsupported for this input type */
    }
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      for (const id of labelledBy.split(/\s+/)) {
        parts.push(el.ownerDocument.getElementById(id)?.textContent ?? '');
      }
    }
    return parts.join(' ');
  };

  const isSensitive = (el: HTMLInputElement | HTMLTextAreaElement): boolean => {
    const type = (el.getAttribute('type') ?? '').toLowerCase();
    if (type === 'password') return true;
    const autocomplete = (el.getAttribute('autocomplete') ?? '').toLowerCase().split(/\s+/);
    if (autocomplete.some((token) => SENSITIVE_AUTOCOMPLETE.includes(token))) return true;
    const haystack = [
      el.getAttribute('name'),
      el.id,
      el.getAttribute('aria-label'),
      el.getAttribute('placeholder'),
      labelText(el),
    ]
      .filter(Boolean)
      .join(' ');
    return SENSITIVE_TEXT.test(haystack);
  };

  const visit = (root: Document | ShadowRoot): void => {
    for (const el of Array.from(root.querySelectorAll('input, textarea'))) {
      const field = el as HTMLInputElement | HTMLTextAreaElement;
      if (field.value && isSensitive(field)) values.add(field.value);
    }
    for (const host of Array.from(root.querySelectorAll('*'))) {
      if (host.shadowRoot) visit(host.shadowRoot);
    }
  };
  visit(document);
  return [...values];
}

const TEXTBOX_LINE = /^(\s*- textbox(?: "(?:[^"\\]|\\.)*")?(?: \[[^\]]*\])*): (.*)$/;

function unquote(raw: string): string {
  if (raw.startsWith('"') && raw.endsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed === 'string') return parsed;
    } catch {
      /* not a JSON string; compare raw */
    }
  }
  return raw;
}

/** Pure: mask every sensitive value in an observation text field. */
export function redactSensitiveValues(text: string, sensitiveValues: readonly string[]): string {
  const values = sensitiveValues.filter((value) => value.length > 0);
  if (values.length === 0 || text.length === 0) return text;
  const exact = new Set(values);
  const byLine = text
    .split('\n')
    .map((line) => {
      const match = TEXTBOX_LINE.exec(line);
      if (!match) return line;
      const value = unquote(match[2] ?? '');
      return exact.has(value) || exact.has(value.trim())
        ? `${match[1]}: ${REDACTED_OBSERVATION_VALUE}`
        : line;
    })
    .join('\n');
  const needles = new Set<string>();
  for (const value of values) {
    if (value.length < MIN_GLOBAL_MASK_LENGTH) continue;
    needles.add(value);
    const escaped = JSON.stringify(value).slice(1, -1);
    if (escaped !== value) needles.add(escaped);
  }
  let out = byLine;
  for (const needle of [...needles].sort((a, b) => b.length - a.length)) {
    out = out.split(needle).join(REDACTED_OBSERVATION_VALUE);
  }
  return out;
}
