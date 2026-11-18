import type { Locator, Page } from 'playwright-crx';
import { collectSensitiveFieldValues } from './observation-redaction.js';

/** Privacy inspection is mandatory. There is deliberately no raw/visible fallback. */
export async function captureMaskedTaskScreenshot(
  page: Page,
  current: () => boolean,
  readDocument: () => Promise<unknown>,
): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let expired = false;
  const valid = () => !expired && current();
  const documentKey = (tree: unknown): string => {
    const root = (tree as { frameTree?: { frame?: { id?: unknown; loaderId?: unknown } } } | null)
      ?.frameTree?.frame;
    if (
      typeof root?.id !== 'string' ||
      !root.id ||
      typeof root.loaderId !== 'string' ||
      !root.loaderId
    )
      throw new Error();
    return JSON.stringify(tree);
  };
  const capture = async () => {
    if (!valid()) throw new Error();
    const before = documentKey(await readDocument());
    const masks: Locator[] = [];
    for (const frame of page.frames()) {
      const values = await frame.evaluate<string[]>(collectSensitiveFieldValues);
      masks.push(
        frame.locator('input, textarea, select, [contenteditable], [data-hd-human-typed]'),
      );
      for (const value of values) masks.push(frame.getByText(value, { exact: false }));
    }
    if (!valid()) throw new Error();
    const bytes = await page.screenshot({
      type: 'jpeg',
      quality: 40,
      fullPage: false,
      mask: masks,
      maskColor: '#000000',
      caret: 'hide',
      timeout: 10_000,
    });
    if (!valid() || before !== documentKey(await readDocument()) || !valid()) throw new Error();
    if (
      bytes.length < 4 ||
      bytes.length > 1024 * 1024 ||
      bytes[0] !== 255 ||
      bytes[1] !== 216 ||
      bytes[bytes.length - 2] !== 255 ||
      bytes[bytes.length - 1] !== 217
    )
      throw new Error();
    return Buffer.from(bytes).toString('base64');
  };
  try {
    return await Promise.race([
      capture(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          expired = true;
          reject(new Error());
        }, 12_000);
      }),
    ]);
  } catch {
    throw new Error('screenshot_unavailable');
  } finally {
    if (timer) clearTimeout(timer);
  }
}
