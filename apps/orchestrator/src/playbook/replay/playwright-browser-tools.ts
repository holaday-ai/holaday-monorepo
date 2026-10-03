import type { Page } from 'playwright';
import type {
  BrowserSnapshot,
  DownloadResult,
  ExtractSchema,
  PlaybookBrowserTools,
  ScreenshotResult,
  ScrollRequest,
  SnapshotElement,
  WaitForCondition,
} from './browser-tools.js';

/**
 * Reference `PlaybookBrowserTools` over a Playwright `Page`.
 *
 * Used by the canary (isolated, cookie-less browser context) and by the
 * local-fixture tests. Production user tasks bind the batch-04 executor
 * instead; this class exists so the replay engine is runnable and testable
 * without that executor.
 *
 * Refs are stamped onto the DOM (`data-hd-ref`) by `snapshot()` and are only
 * valid until the next snapshot — matching the batch-04 contract.
 */

const REF_ATTR = 'data-hd-ref';
const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_ELEMENTS = 400;

/**
 * In-page snapshot walker, shipped as a STRING (the orchestrator compiles
 * without the DOM lib). Stamps `data-hd-ref` on every visible element that has
 * an ARIA role and returns `{ref, role, name, text?, value?}` rows.
 */
function snapshotScript(refAttr: string, max: number): string {
  return `(() => {
    const refAttr = ${JSON.stringify(refAttr)};
    const max = ${Number(max)};
    const out = [];
    const collapse = (s) => (s || '').replace(/\\s+/g, ' ').trim();
    const implicitRole = (el) => {
      const explicit = el.getAttribute('role');
      if (explicit) return (explicit.trim().split(/\\s+/)[0] || '').toLowerCase();
      const tag = el.tagName.toLowerCase();
      if (tag === 'button') return 'button';
      if (tag === 'a' && el.hasAttribute('href')) return 'link';
      if (tag === 'select') return 'combobox';
      if (tag === 'textarea') return 'textbox';
      if (/^h[1-6]$/.test(tag)) return 'heading';
      if (tag === 'img') return 'img';
      if (tag === 'li') return 'listitem';
      if (tag === 'input') {
        const type = (el.getAttribute('type') || 'text').toLowerCase();
        if (type === 'hidden') return '';
        if (type === 'button' || type === 'submit' || type === 'reset' || type === 'file') return 'button';
        if (type === 'checkbox') return 'checkbox';
        if (type === 'radio') return 'radio';
        if (type === 'search') return 'searchbox';
        return 'textbox';
      }
      return '';
    };
    const accessibleName = (el) => {
      const aria = el.getAttribute('aria-label');
      if (aria) return collapse(aria);
      const labelledBy = el.getAttribute('aria-labelledby');
      if (labelledBy) {
        const t = labelledBy.split(/\\s+/).map((id) => (document.getElementById(id) || {}).textContent || '').join(' ');
        if (collapse(t)) return collapse(t);
      }
      const id = el.getAttribute('id');
      if (id) {
        const label = document.querySelector('label[for="' + CSS.escape(id) + '"]');
        if (label && collapse(label.textContent)) return collapse(label.textContent);
      }
      const wrapping = el.closest('label');
      if (wrapping && wrapping !== el && collapse(wrapping.textContent)) return collapse(wrapping.textContent);
      const tag = el.tagName.toLowerCase();
      if (tag === 'input') {
        const type = (el.getAttribute('type') || '').toLowerCase();
        if (type === 'submit' || type === 'button') return collapse(el.value);
      }
      const placeholder = el.getAttribute('placeholder');
      if (placeholder) return collapse(placeholder);
      const alt = el.getAttribute('alt');
      if (alt) return collapse(alt);
      if (tag !== 'input' && tag !== 'select' && tag !== 'textarea') {
        const text = collapse(el.textContent);
        if (text) return text.slice(0, 200);
      }
      return collapse(el.getAttribute('title'));
    };
    const visible = (el) => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    for (const old of Array.from(document.querySelectorAll('[' + refAttr + ']'))) old.removeAttribute(refAttr);
    let n = 0;
    for (const el of Array.from(document.querySelectorAll('*'))) {
      if (out.length >= max) break;
      const role = implicitRole(el);
      if (!role || !visible(el)) continue;
      n += 1;
      const ref = 'e' + n;
      el.setAttribute(refAttr, ref);
      const name = accessibleName(el);
      const text = collapse(el.textContent).slice(0, 200);
      const entry = { ref, role, name };
      if (text && text !== name) entry.text = text;
      const tag = el.tagName.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') {
        entry.value = el.value;
        entry.inputType = tag === 'input' ? (el.getAttribute('type') || 'text').toLowerCase() : tag;
        const ac = el.getAttribute('autocomplete');
        if (ac) entry.autocomplete = ac.toLowerCase();
      }
      out.push(entry);
    }
    return out;
  })()`;
}

export interface PlaywrightBrowserToolsOptions {
  timeoutMs?: number;
}

export class PlaywrightBrowserTools implements PlaybookBrowserTools {
  private readonly timeoutMs: number;

  constructor(
    private readonly page: Page,
    options: PlaywrightBrowserToolsOptions = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async snapshot(): Promise<BrowserSnapshot> {
    const elements = (await this.page.evaluate(
      snapshotScript(REF_ATTR, MAX_ELEMENTS),
    )) as unknown[];
    return {
      url: this.page.url(),
      title: await this.page.title(),
      elements: elements as SnapshotElement[],
    };
  }

  private byRef(ref: string) {
    if (!/^e\d+$/.test(ref)) throw new Error(`invalid ref: ${ref}`);
    return this.page.locator(`[${REF_ATTR}="${ref}"]`);
  }

  async click(ref: string): Promise<void> {
    await this.byRef(ref).click({ timeout: this.timeoutMs });
  }

  async type(ref: string, text: string, submit?: boolean): Promise<void> {
    const target = this.byRef(ref);
    await target.fill(text, { timeout: this.timeoutMs });
    if (submit) await target.press('Enter', { timeout: this.timeoutMs });
  }

  async select(ref: string, value: string): Promise<void> {
    await this.byRef(ref).selectOption(value, { timeout: this.timeoutMs });
  }

  async scroll(request: ScrollRequest): Promise<void> {
    if (request.ref) {
      await this.byRef(request.ref).scrollIntoViewIfNeeded({ timeout: this.timeoutMs });
      return;
    }
    const amount = request.amount ?? 600;
    const dx = request.direction === 'left' ? -amount : request.direction === 'right' ? amount : 0;
    const dy = request.direction === 'up' ? -amount : request.direction === 'down' ? amount : 0;
    await this.page.mouse.wheel(dx, dy);
  }

  async navigate(url: string): Promise<void> {
    await this.page.goto(url, { timeout: this.timeoutMs * 2, waitUntil: 'domcontentloaded' });
  }

  async extract(schema: ExtractSchema): Promise<unknown> {
    // Deterministic, model-free extraction: the fields the schema names are
    // looked up as visible element names/text. Model-backed extraction is the
    // batch-04 executor's job.
    const snap = await this.snapshot();
    const keys = Object.keys((schema.properties as Record<string, unknown> | undefined) ?? schema);
    const out: Record<string, string | null> = {};
    for (const key of keys) {
      const hit = snap.elements.find((e) => e.name.includes(key) || (e.text ?? '').includes(key));
      out[key] = hit ? (hit.text ?? hit.name) : null;
    }
    return out;
  }

  async screenshot(): Promise<ScreenshotResult> {
    const buf = await this.page.screenshot({ type: 'png', timeout: this.timeoutMs });
    return { base64: buf.toString('base64'), mimeType: 'image/png' };
  }

  async wait_for(condition: WaitForCondition): Promise<void> {
    const timeout = condition.timeoutMs ?? this.timeoutMs;
    if ('text' in condition) {
      await this.page.getByText(condition.text, { exact: false }).first().waitFor({ timeout });
    } else if ('ref' in condition) {
      await this.byRef(condition.ref).waitFor({ timeout });
    } else {
      await this.page.waitForLoadState('networkidle', { timeout });
    }
  }

  async back(): Promise<void> {
    await this.page.goBack({ timeout: this.timeoutMs });
  }

  async download(ref: string): Promise<DownloadResult> {
    const [download] = await Promise.all([
      this.page.waitForEvent('download', { timeout: this.timeoutMs }),
      this.byRef(ref).click({ timeout: this.timeoutMs }),
    ]);
    return { fileName: download.suggestedFilename() };
  }

  async upload(ref: string, filePaths: readonly string[]): Promise<void> {
    await this.byRef(ref).setInputFiles([...filePaths], { timeout: this.timeoutMs });
  }
}
