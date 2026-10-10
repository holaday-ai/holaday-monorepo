/**
 * Batch 06 — the browser tool surface the playbook replay executor drives.
 *
 * This mirrors the batch-04 unified browser tool set EXACTLY (same twelve
 * operations, same argument order), so the batch-04 executor can be bound to
 * it with a thin adapter and no behaviour change:
 *
 *   snapshot · click(ref) · type(ref,text,submit?) · select(ref,value) ·
 *   scroll · navigate · extract(schema) · screenshot ·
 *   wait_for(text|ref|network_idle) · back · download · upload
 *
 * Contract every implementation must honour:
 * - `snapshot()` returns the current page's accessibility view; every element
 *   carries a `ref` that is valid for the other calls until the next snapshot.
 * - Every operation REJECTS on failure (stale ref, timeout, navigation error).
 *   The replay executor treats a rejection as "this step failed" and may hand
 *   the next snapshot to the model for a local repair.
 * - No operation silently retries; retry/repair policy lives in the executor.
 */

export interface SnapshotElement {
  /** Opaque handle valid until the next `snapshot()`. */
  ref: string;
  /** ARIA role (explicit or implicit), lower-case, e.g. `button`, `textbox`, `link`. */
  role: string;
  /** Accessible name (aria-label / label / placeholder / alt / text), whitespace-collapsed. */
  name: string;
  /** Visible text content when it differs from the name (truncated by the implementation). */
  text?: string;
  /** Current value for form controls. */
  value?: string;
  /**
   * `<input type>` / `autocomplete` of form controls. Optional, but capture
   * redaction is fail-safe: a typed value whose field type is unknown is
   * stored redacted (and the trajectory is then not templated).
   */
  inputType?: string;
  autocomplete?: string;
}

export interface BrowserSnapshot {
  url: string;
  title: string;
  elements: SnapshotElement[];
}

export interface ScrollRequest {
  direction: 'up' | 'down' | 'left' | 'right';
  /** Pixels; implementation default when omitted. */
  amount?: number;
  /** Scroll this element into view instead of the page. */
  ref?: string;
}

export type WaitForCondition =
  | { text: string; timeoutMs?: number }
  | { ref: string; timeoutMs?: number }
  | { network_idle: true; timeoutMs?: number };

export interface ScreenshotResult {
  base64: string;
  mimeType: 'image/png' | 'image/jpeg';
}

export interface DownloadResult {
  fileName: string;
  /** Local path when the implementation persisted the file. */
  path?: string;
}

/** A JSON-schema-ish description of what `extract` should return. */
export type ExtractSchema = Record<string, unknown>;

export interface PlaybookBrowserTools {
  snapshot(): Promise<BrowserSnapshot>;
  click(ref: string): Promise<void>;
  type(ref: string, text: string, submit?: boolean): Promise<void>;
  select(ref: string, value: string): Promise<void>;
  scroll(request: ScrollRequest): Promise<void>;
  navigate(url: string): Promise<void>;
  extract(schema: ExtractSchema): Promise<unknown>;
  screenshot(): Promise<ScreenshotResult>;
  wait_for(condition: WaitForCondition): Promise<void>;
  back(): Promise<void>;
  download(ref: string): Promise<DownloadResult>;
  upload(ref: string, filePaths: readonly string[]): Promise<void>;
}

/** The exact operation names, for adapters and contract tests. */
export const PLAYBOOK_BROWSER_TOOL_NAMES = [
  'snapshot',
  'click',
  'type',
  'select',
  'scroll',
  'navigate',
  'extract',
  'screenshot',
  'wait_for',
  'back',
  'download',
  'upload',
] as const satisfies ReadonlyArray<keyof PlaybookBrowserTools>;
