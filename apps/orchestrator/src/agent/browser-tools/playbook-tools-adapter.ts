import type { Page } from 'playwright';
import type {
  BrowserSnapshot,
  PlaybookBrowserTools,
  SnapshotElement,
} from '../../playbook/replay/browser-tools.js';
import type { UnifiedToolResult } from './playwright-unified-executor.js';
import type { UnifiedBrowserAction } from './unified-tools.js';

const SNAPSHOT_LINE_RE = /-\s+([a-z]+)(?:\s+"([^"]*)")?[^\n]*?\[ref=(e\d+)\]/g;
const INPUT_ROLES = /^(textbox|searchbox|combobox|spinbutton)$/;

/** Parses the unified `snapshot` text (Playwright AI aria snapshot) into elements. */
export async function parseUnifiedSnapshot(page: Page, text: string): Promise<BrowserSnapshot> {
  const elements: SnapshotElement[] = [...text.matchAll(SNAPSHOT_LINE_RE)].map(
    ([, role, name, ref]) => ({
      ref: ref as string,
      role: role as string,
      name: name ?? '',
    }),
  );
  // Capture redaction needs the input type (password/email/…) of fields.
  for (const element of elements) {
    if (!INPUT_ROLES.test(element.role)) continue;
    const locator = page.locator(`aria-ref=${element.ref}`);
    const type = await locator.getAttribute('type', { timeout: 500 }).catch(() => null);
    const autocomplete = await locator
      .getAttribute('autocomplete', { timeout: 500 })
      .catch(() => null);
    element.inputType = type ?? 'text';
    if (autocomplete) element.autocomplete = autocomplete;
  }
  return { url: page.url(), title: await page.title(), elements };
}

/**
 * Binds batch 06's replay interface (throws on failure so the replay executor
 * can trigger a local repair) to the batch 04 unified executor.
 */
export function playbookToolsFromUnifiedExecutor(
  page: Page,
  execute: (action: UnifiedBrowserAction) => Promise<UnifiedToolResult>,
): PlaybookBrowserTools {
  const run = async (action: UnifiedBrowserAction): Promise<UnifiedToolResult> => {
    const result = await execute(action);
    if (!result.ok) throw new Error(result.text);
    return result;
  };
  return {
    async snapshot() {
      return parseUnifiedSnapshot(page, (await run({ tool: 'snapshot' })).text);
    },
    click: async (ref) => void (await run({ tool: 'click', ref })),
    type: async (ref, text, submit) =>
      void (await run({ tool: 'type', ref, text, ...(submit ? { submit } : {}) })),
    select: async (ref, value) => void (await run({ tool: 'select', ref, value })),
    scroll: async (request) =>
      void (await run({
        tool: 'scroll',
        ...(request.direction === 'up' || request.direction === 'down'
          ? { direction: request.direction }
          : {}),
        ...(request.ref ? { ref: request.ref } : {}),
        ...(request.amount ? { amount: request.amount } : {}),
      })),
    navigate: async (url) => void (await run({ tool: 'navigate', url })),
    extract: async (schema) =>
      JSON.parse(
        (
          await run({
            tool: 'extract',
            instruction: JSON.stringify(schema),
            fields: Object.keys(schema),
          })
        ).text,
      ),
    screenshot: async () => {
      const result = await run({ tool: 'screenshot' });
      return { base64: result.image?.data ?? '', mimeType: 'image/jpeg' };
    },
    wait_for: async (condition) =>
      void (await run(
        'network_idle' in condition
          ? {
              tool: 'wait_for',
              networkIdle: true,
              ...(condition.timeoutMs ? { timeoutMs: condition.timeoutMs } : {}),
            }
          : { tool: 'wait_for', ...condition },
      )),
    back: async () => void (await run({ tool: 'back' })),
    download: async (ref) => {
      const result = await run({ tool: 'download', ref });
      return {
        fileName: result.download?.filename ?? '',
        ...(result.download?.path ? { path: result.download.path } : {}),
      };
    },
    upload: async (ref, filePaths) =>
      void (await run({ tool: 'upload', ref, fileIds: [...filePaths] })),
  };
}
