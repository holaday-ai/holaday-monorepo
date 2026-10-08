import type { Page } from 'playwright';
import { stripTrackingFromUrl } from '../../execution/url-identity.js';
import { PageRedactionError, REDACTION_FAILED_COPY, redactPageText } from './page-redaction.js';
import type { UnifiedBrowserAction } from './unified-tools.js';

/** One tool result for the model: text always, an image only for `screenshot`. */
export interface UnifiedToolResult {
  ok: boolean;
  text: string;
  image?: { mediaType: 'image/jpeg'; data: string };
  /** Present on `download`: where the file was saved by the host. */
  download?: { filename: string; path: string };
  /**
   * Present on `snapshot`: absolute link targets on the page (full, before the
   * model-facing shortening) and the shortened forms the model saw. Host-only
   * evidence for grounding the answer's per-item links; never sent to the model.
   */
  links?: string[];
  /** Page URL after the action. */
  url?: string;
}

export interface UnifiedExecutorOptions {
  /** Resolves task attachment ids to local file paths for `upload`. */
  resolveUploads?: (fileIds: readonly string[]) => Promise<string[]>;
  /** Persists a finished download; returns the host path. */
  saveDownload?: (download: import('playwright').Download) => Promise<string>;
  actionTimeoutMs?: number;
  maxSnapshotChars?: number;
  maxExtractChars?: number;
  /** Link URLs in snapshots are cut to this many characters (default 100, 0 = off). */
  maxUrlChars?: number;
}

const DEFAULT_ACTION_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_SNAPSHOT_CHARS = 40_000;
const DEFAULT_MAX_EXTRACT_CHARS = 20_000;
const DEFAULT_MAX_URL_CHARS = 100;
/** How long a click waits to see whether it opened a new tab or navigated. */
const POPUP_WAIT_MS = 1_500;
const URL_LINE = /^(\s*- \/url: )(.*)$/;

/**
 * Link URLs are 20–35% of a real page's AI snapshot (batch 12, eval sites),
 * mostly tracking parameters. Clicks go by ref, so a shortened URL keeps the
 * page readable at a fraction of the tokens.
 */
export function shortenSnapshotUrls(tree: string, maxUrlChars: number): string {
  if (maxUrlChars <= 0) return tree;
  return tree
    .split('\n')
    .map((line) => {
      const match = URL_LINE.exec(line);
      if (!match) return line;
      const short = shortenUrl(match[2] ?? '', maxUrlChars);
      return short === match[2] ? line : `${match[1]}${short}`;
    })
    .join('\n');
}

/**
 * The link the model sees: tracking parameters (utm_*, gclid, spm, …) and
 * in-page anchors removed, everything that identifies the resource kept (ids,
 * search terms, signatures, SPA hash routes). If that is still too long it is
 * cut and marked with `…` — a cut link is never shown as if it were usable,
 * and it is never recorded as observed evidence.
 */
export function shortenUrl(url: string, maxUrlChars: number): string {
  if (maxUrlChars <= 0) return url;
  const cleaned = stripTrackingFromUrl(url);
  if (cleaned.length <= maxUrlChars) return cleaned;
  return `${cleaned.slice(0, maxUrlChars)}…`;
}

/**
 * The observed form of a link for grounding: the page's own URL without
 * tracking parameters (what the model is shown when it fits), never a cut
 * display form. With shortening off the model sees the raw URL, so that is it.
 */
export function observedLinkEvidence(absolute: string, maxUrlChars: number): string {
  return maxUrlChars <= 0 ? absolute : stripTrackingFromUrl(absolute);
}

const MAX_SNAPSHOT_LINKS = 400;
const MAX_EXTRACT_LINKS = 150;
const MAX_LINK_TEXT_CHARS = 60;

/** Visible text links on the page (absolute http(s) hrefs, first occurrence wins). */
async function pageLinks(
  page: Page,
  timeout: number,
): Promise<Array<{ text: string; url: string }>> {
  const collect = page
    .locator('a[href]')
    .evaluateAll(
      (nodes, limits) => {
        const seen = new Set<string>();
        const out: Array<{ text: string; url: string }> = [];
        for (const node of nodes) {
          const anchor = node as HTMLAnchorElement;
          const text = (anchor.innerText || anchor.getAttribute('title') || '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, limits.text);
          if (!text || !/^https?:/i.test(anchor.href) || seen.has(anchor.href)) continue;
          if (anchor.getClientRects().length === 0) continue;
          seen.add(anchor.href);
          out.push({ text, url: anchor.href });
          if (out.length >= limits.count) break;
        }
        return out;
      },
      { text: MAX_LINK_TEXT_CHARS, count: MAX_EXTRACT_LINKS },
    )
    .catch(() => []);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<Array<{ text: string; url: string }>>((resolve) => {
    timer = setTimeout(() => resolve([]), timeout);
  });
  try {
    return await Promise.race([collect, expired]);
  } finally {
    clearTimeout(timer);
  }
}

/** Observed link targets in an AI aria snapshot (absolute, tracking parameters removed). */
export function snapshotLinks(tree: string, pageUrl: string, maxUrlChars: number): string[] {
  const links = new Set<string>();
  for (const line of tree.split('\n')) {
    const href = URL_LINE.exec(line)?.[2]?.trim();
    if (!href || links.size >= MAX_SNAPSHOT_LINKS) continue;
    let absolute: string;
    try {
      absolute = new URL(href, pageUrl).toString();
    } catch {
      continue;
    }
    if (!/^https?:/i.test(absolute)) continue;
    links.add(observedLinkEvidence(absolute, maxUrlChars));
  }
  return [...links];
}

/**
 * Executes unified tool calls on a Playwright page. Refs come from
 * `ariaSnapshot({ mode: 'ai' })` and are resolved with `aria-ref=` locators, so
 * a stale ref fails loudly ("请重新 snapshot") instead of clicking the wrong node.
 * Never throws: failures return `{ ok: false, text }` for the model to replan.
 */
export function createPlaywrightUnifiedExecutor(page: Page, options: UnifiedExecutorOptions = {}) {
  const timeout = options.actionTimeoutMs ?? DEFAULT_ACTION_TIMEOUT_MS;
  const maxSnapshot = options.maxSnapshotChars ?? DEFAULT_MAX_SNAPSHOT_CHARS;
  const maxExtract = options.maxExtractChars ?? DEFAULT_MAX_EXTRACT_CHARS;
  const maxUrlChars = options.maxUrlChars ?? DEFAULT_MAX_URL_CHARS;
  const byRef = (ref: string) => page.locator(`aria-ref=${ref}`);

  const snapshotWithLinks = async (): Promise<{ text: string; links: string[] }> => {
    // Redact before truncating: a secret straddling the cut must not survive.
    const redacted = await redactPageText(
      page as never,
      await page.locator('body').ariaSnapshot({ mode: 'ai', timeout }),
    );
    const tree = shortenSnapshotUrls(redacted, maxUrlChars);
    const header = `URL: ${page.url()}\n标题: ${await page.title()}\n`;
    const visible = tree.length > maxSnapshot ? tree.slice(0, maxSnapshot) : tree;
    const body = visible === tree ? tree : `${visible}\n…（已截断）`;
    // Shortening maps lines 1:1, so the visible lines of the full tree are the
    // links the model saw; links past the cut ground nothing.
    const seen = redacted.split('\n').slice(0, visible.split('\n').length).join('\n');
    return { text: `${header}${body}`, links: snapshotLinks(seen, page.url(), maxUrlChars) };
  };
  const snapshotText = async (): Promise<string> => (await snapshotWithLinks()).text;

  /**
   * A link with target=_blank opens a tab the model never sees, so the page
   * looked unchanged after clicking a product (acceptance A1). Load the new
   * tab's URL in the controlled page and close the tab.
   */
  const clickFollowingNewTab = async (ref: string): Promise<UnifiedToolResult> => {
    const before = page.url();
    const popup = page.waitForEvent('popup', { timeout: POPUP_WAIT_MS }).catch(() => null);
    const navigated = page
      .waitForEvent('framenavigated', { timeout: POPUP_WAIT_MS })
      .then(() => null)
      .catch(() => null);
    await byRef(ref).click({ timeout });
    const opened = await Promise.race([popup, navigated]);
    if (!opened) return done(`已点击 ${ref}`);
    await opened.waitForLoadState('domcontentloaded', { timeout }).catch(() => {});
    const target = opened.url();
    await opened.close().catch(() => {});
    if (!/^https?:/i.test(target) || target === before) return done(`已点击 ${ref}`);
    await page.goto(target, { timeout: Math.max(timeout, 30_000), waitUntil: 'domcontentloaded' });
    return done(`已点击 ${ref}，新标签页内容已在当前页打开：${page.url()}`);
  };

  async function execute(action: UnifiedBrowserAction): Promise<UnifiedToolResult> {
    try {
      switch (action.tool) {
        case 'snapshot': {
          const snapshot = await snapshotWithLinks();
          return { ok: true, text: snapshot.text, links: snapshot.links, url: page.url() };
        }
        case 'click':
          return { ...(await clickFollowingNewTab(action.ref)), url: page.url() };
        case 'type': {
          const target = byRef(action.ref);
          await target.fill(action.text, { timeout });
          if (action.submit) await target.press('Enter', { timeout });
          return done(`已在 ${action.ref} 输入${action.submit ? '并提交' : ''}`);
        }
        case 'select': {
          const target = byRef(action.ref);
          try {
            await target.selectOption({ label: action.value }, { timeout });
          } catch {
            await target.selectOption(action.value, { timeout });
          }
          return done(`已在 ${action.ref} 选择「${action.value}」`);
        }
        case 'scroll':
          if (action.ref) await byRef(action.ref).scrollIntoViewIfNeeded({ timeout });
          else
            await page.mouse.wheel(
              0,
              (action.direction === 'up' ? -1 : 1) * 600 * (action.amount ?? 1),
            );
          return done('已滚动');
        case 'navigate':
          await page.goto(action.url, {
            timeout: Math.max(timeout, 30_000),
            waitUntil: 'domcontentloaded',
          });
          return { ...done(`已打开 ${page.url()}`), url: page.url() };
        case 'extract': {
          const content = (
            await redactPageText(page as never, await page.locator('body').innerText({ timeout }))
          ).slice(0, maxExtract);
          // innerText drops hrefs; list answers need each item's own link.
          const anchors = await pageLinks(page, timeout);
          const links: Array<{ text: string; url: string }> = [];
          for (const anchor of anchors) {
            const text = await redactPageText(page as never, anchor.text);
            if (text) links.push({ text, url: shortenUrl(anchor.url, maxUrlChars) });
          }
          return {
            ok: true,
            text: JSON.stringify({
              instruction: action.instruction,
              fields: action.fields ?? [],
              url: page.url(),
              content,
              links,
            }),
            links: anchors.map((anchor) => observedLinkEvidence(anchor.url, maxUrlChars)),
            url: page.url(),
          };
        }
        case 'screenshot': {
          const buffer = await page.screenshot({ type: 'jpeg', quality: 70, timeout });
          return {
            ok: true,
            text: '当前视口截图',
            image: { mediaType: 'image/jpeg', data: buffer.toString('base64') },
          };
        }
        case 'wait_for': {
          const wait = action.timeoutMs ?? timeout;
          if (action.text) await page.getByText(action.text).first().waitFor({ timeout: wait });
          if (action.ref) await byRef(action.ref).waitFor({ timeout: wait });
          if (action.networkIdle) await page.waitForLoadState('networkidle', { timeout: wait });
          return done('等待条件已满足');
        }
        case 'back':
          await page.goBack({ timeout });
          return done(`已后退到 ${page.url()}`);
        case 'download': {
          if (!options.saveDownload) return fail('当前环境不支持下载文件');
          const [download] = await Promise.all([
            page.waitForEvent('download', { timeout }),
            byRef(action.ref).click({ timeout }),
          ]);
          const path = await options.saveDownload(download);
          return {
            ok: true,
            text: `已下载 ${download.suggestedFilename()}`,
            download: { filename: download.suggestedFilename(), path },
          };
        }
        case 'upload': {
          if (!options.resolveUploads) return fail('当前环境不支持上传附件');
          const paths = await options.resolveUploads(action.fileIds);
          await byRef(action.ref).setInputFiles(paths, { timeout });
          return done(`已上传 ${paths.length} 个文件`);
        }
        case 'click_at':
          await page.mouse.click(action.x, action.y);
          return done(`已点击坐标 (${action.x}, ${action.y})`);
      }
    } catch (error) {
      if (error instanceof PageRedactionError) return fail(REDACTION_FAILED_COPY);
      const message = error instanceof Error ? error.message : String(error);
      if (/aria-ref|not found|No node found/i.test(message))
        return fail('该 ref 已失效，请重新 snapshot 后再操作');
      if (/Timeout/i.test(message)) return fail('操作超时，请重新 snapshot 确认页面状态');
      return fail('操作失败，请重新 snapshot 后换一种方式');
    }
  }

  return { execute, snapshot: snapshotText };
}

function done(text: string): UnifiedToolResult {
  return { ok: true, text };
}

function fail(text: string): UnifiedToolResult {
  return { ok: false, text };
}
