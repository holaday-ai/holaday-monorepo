import type { Page } from 'playwright';
import { PageRedactionError, REDACTION_FAILED_COPY, redactPageText } from './page-redaction.js';
import type { UnifiedBrowserAction } from './unified-tools.js';

/** One tool result for the model: text always, an image only for `screenshot`. */
export interface UnifiedToolResult {
  ok: boolean;
  text: string;
  image?: { mediaType: 'image/jpeg'; data: string };
  /** Present on `download`: where the file was saved by the host. */
  download?: { filename: string; path: string };
}

export interface UnifiedExecutorOptions {
  /** Resolves task attachment ids to local file paths for `upload`. */
  resolveUploads?: (fileIds: readonly string[]) => Promise<string[]>;
  /** Persists a finished download; returns the host path. */
  saveDownload?: (download: import('playwright').Download) => Promise<string>;
  actionTimeoutMs?: number;
  maxSnapshotChars?: number;
  maxExtractChars?: number;
}

const DEFAULT_ACTION_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_SNAPSHOT_CHARS = 40_000;
const DEFAULT_MAX_EXTRACT_CHARS = 20_000;

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
  const byRef = (ref: string) => page.locator(`aria-ref=${ref}`);

  const snapshotText = async (): Promise<string> => {
    // Redact before truncating: a secret straddling the cut must not survive.
    const tree = await redactPageText(
      page as never,
      await page.locator('body').ariaSnapshot({ mode: 'ai', timeout }),
    );
    const header = `URL: ${page.url()}\n标题: ${await page.title()}\n`;
    const body = tree.length > maxSnapshot ? `${tree.slice(0, maxSnapshot)}\n…（已截断）` : tree;
    return `${header}${body}`;
  };

  async function execute(action: UnifiedBrowserAction): Promise<UnifiedToolResult> {
    try {
      switch (action.tool) {
        case 'snapshot':
          return { ok: true, text: await snapshotText() };
        case 'click':
          await byRef(action.ref).click({ timeout });
          return done(`已点击 ${action.ref}`);
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
          return done(`已打开 ${page.url()}`);
        case 'extract': {
          const content = (
            await redactPageText(page as never, await page.locator('body').innerText({ timeout }))
          ).slice(0, maxExtract);
          return {
            ok: true,
            text: JSON.stringify({
              instruction: action.instruction,
              fields: action.fields ?? [],
              url: page.url(),
              content,
            }),
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
