import { collectSensitiveFieldValues, redactSensitiveValues } from './observation-redaction.js';

/**
 * Batch 10 fixes — cloud executors mask password / OTP field values in every
 * page text they hand to the model (aria snapshot, extracted text), with the
 * same rules as the extension. Redact first, truncate after; if the sensitive
 * values cannot be read the text is NOT returned (fail closed).
 *
 * The collector is sent as an expression string. Some TS runtimes (tsx /
 * esbuild keepNames) inject `__name(...)` calls into function source; the
 * wrapper defines a no-op `__name` so the in-page code runs either way.
 */
export const SENSITIVE_VALUES_EXPRESSION = `(() => { const __name = (target) => target; return (${collectSensitiveFieldValues.toString()})(); })()`;

export class PageRedactionError extends Error {
  constructor() {
    super('page redaction unavailable');
    this.name = 'PageRedactionError';
  }
}

/** Shown to the model / user instead of an unredacted page. */
export const REDACTION_FAILED_COPY = '页面内容脱敏失败，为保护隐私未回传原文，请稍后重试';

export async function readSensitiveValues(page: {
  evaluate?: (expression: string) => Promise<unknown>;
}): Promise<string[]> {
  if (typeof page.evaluate !== 'function') throw new PageRedactionError();
  let values: unknown;
  try {
    values = await page.evaluate(SENSITIVE_VALUES_EXPRESSION);
  } catch {
    throw new PageRedactionError();
  }
  if (!Array.isArray(values)) throw new PageRedactionError();
  return values.filter((value): value is string => typeof value === 'string');
}

/** Masks every sensitive field value of `page` in `text`. Throws PageRedactionError. */
export async function redactPageText(
  page: { evaluate?: (expression: string) => Promise<unknown> },
  text: string,
): Promise<string> {
  return redactSensitiveValues(text, await readSensitiveValues(page));
}
