/**
 * Phase 14 — page context for the Side Panel.
 *
 * Reads the active tab's title / URL / user selection and returns a
 * compact preview the Side Panel renders above the task input. Side
 * Panel uses chrome.scripting.executeScript so we don't need a
 * round-trip through a content-script message channel — the script
 * runs in the page world, returns a structured value.
 *
 * Best-effort: chrome:// pages, signed-out PDF viewers, and other
 * restricted contexts reject executeScript with a permission error.
 * We swallow + return null so the Side Panel just hides the preview
 * box rather than showing a scary error.
 */

import { withDeadline } from './deadline.js';

export interface PageContext {
  tabId: number;
  title: string;
  url: string;
  selectedText: string;
  metaDescription: string;
}

interface PageContextSnippet {
  title: string;
  url: string;
  selectedText: string;
  metaDescription: string;
}

const MAX_CONTEXT_TITLE_CHARS = 512;
const MAX_CONTEXT_URL_CHARS = 2048;
const MAX_CONTEXT_SELECTION_CHARS = 2_000;
const MAX_CONTEXT_META_DESCRIPTION_CHARS = 512;
const PAGE_CONTEXT_READ_TIMEOUT_MS = 1_500;
const PAGE_CONTEXT_TRANSIENT_RETRY_DELAY_MS = 120;
const PAGE_CONTEXT_TAB_QUERY_TIMEOUT_MS = 1_500;
const SENSITIVE_QUERY_PARAM_WORDS = new Set([
  'access',
  'auth',
  'code',
  'email',
  'key',
  'pass',
  'password',
  'refresh',
  'secret',
  'session',
  'sid',
  'token',
]);

function clip(value: unknown, maxChars: number): string {
  const text = typeof value === 'string' ? value : '';
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}

export function sanitizePageContextUrl(value: unknown): string {
  const text = clip(value, MAX_CONTEXT_URL_CHARS).trim();
  if (!text) return '';
  try {
    const url = new URL(text);
    url.hash = '';
    for (const key of Array.from(url.searchParams.keys())) {
      if (isSensitiveQueryParam(key)) url.searchParams.delete(key);
    }
    return clip(url.toString(), MAX_CONTEXT_URL_CHARS);
  } catch {
    return redactSensitiveKeyValueText(text);
  }
}

function isSensitiveQueryParam(key: string): boolean {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  return words.some((word) => SENSITIVE_QUERY_PARAM_WORDS.has(word));
}

function redactSensitiveKeyValueText(text: string): string {
  return text.replace(
    /(^|[?&#\s])([A-Za-z0-9_.-]+)=([^?&#\s]+)/g,
    (match, prefix: string, key: string) =>
      isSensitiveQueryParam(key) ? `${prefix}${key}=redacted` : match,
  );
}

export function sanitizePageContextSnippet(
  snippet: Partial<PageContextSnippet> | null | undefined,
): PageContextSnippet {
  return {
    title: clip(snippet?.title, MAX_CONTEXT_TITLE_CHARS),
    url: sanitizePageContextUrl(snippet?.url),
    selectedText: clip(snippet?.selectedText, MAX_CONTEXT_SELECTION_CHARS),
    metaDescription: clip(snippet?.metaDescription, MAX_CONTEXT_META_DESCRIPTION_CHARS),
  };
}

/** Scoped per-tab to read DOM-side state. Runs in page world. */
function pageWorldExtractor(): PageContextSnippet {
  const meta = document.querySelector('meta[name="description"]');
  const description = meta?.getAttribute('content') ?? '';
  return {
    title: document.title,
    url: location.href,
    selectedText: window.getSelection()?.toString() ?? '',
    metaDescription: description,
  };
}

async function queryActivePageContextTab(): Promise<chrome.tabs.Tab | undefined> {
  const queries: chrome.tabs.QueryInfo[] = [
    { active: true, currentWindow: true },
    { active: true, lastFocusedWindow: true },
    { active: true, windowType: 'normal' },
    { windowType: 'normal' },
  ];
  const candidateGroups = await Promise.all(
    queries.map(async (query, queryIndex) => {
      try {
        const tabs = await withDeadline(
          chrome.tabs.query(query),
          PAGE_CONTEXT_TAB_QUERY_TIMEOUT_MS,
          'page_context_tab_query_timeout',
        );
        return tabs.map((tab, tabIndex) => ({ tab, queryIndex, tabIndex }));
      } catch {
        // Keep falling back; Chrome can reject transiently while focus
        // moves between the popup, side panel, and page window.
        return [];
      }
    }),
  );
  const [best] = candidateGroups
    .flat()
    .filter(({ tab }) => isPageContextTab(tab))
    .sort(compareTabCandidates);

  return best?.tab;
}

function compareTabCandidates(
  a: { tab: chrome.tabs.Tab; queryIndex: number; tabIndex: number },
  b: { tab: chrome.tabs.Tab; queryIndex: number; tabIndex: number },
): number {
  if (a.queryIndex !== b.queryIndex) return a.queryIndex - b.queryIndex;
  const aLastAccessed = typeof a.tab.lastAccessed === 'number' ? a.tab.lastAccessed : 0;
  const bLastAccessed = typeof b.tab.lastAccessed === 'number' ? b.tab.lastAccessed : 0;
  if (aLastAccessed !== bLastAccessed) return bLastAccessed - aLastAccessed;
  return a.tabIndex - b.tabIndex;
}

function isPageContextTab(tab: chrome.tabs.Tab | undefined): tab is chrome.tabs.Tab {
  if (!tab) return false;
  if (typeof tab.id !== 'number') return false;
  const url = getTabContextUrl(tab)?.toLowerCase();
  if (!url) return false;
  return url.startsWith('http://') || url.startsWith('https://') || url.startsWith('chrome-error://');
}

function getTabContextUrl(tab: chrome.tabs.Tab): string {
  const url = tab.url || '';
  const pendingUrl = tab.pendingUrl || '';
  if (/^https?:\/\//i.test(pendingUrl)) return pendingUrl;
  if (/^chrome-error:/i.test(url)) {
    return '';
  }
  return url || pendingUrl;
}

export async function getActivePageContext(): Promise<PageContext | null> {
  const tab = await queryActivePageContextTab();
  if (!tab?.id) return null;

  // chrome:// / chrome-extension:// / file:// pages can't be scripted —
  // skip the executeScript call and surface what the tab metadata
  // already gives us.
  const rawTabUrl = tab.url || tab.pendingUrl || '';
  const tabUrl = getTabContextUrl(tab);
  const restrictedScheme = /^(chrome|chrome-extension|chrome-error|edge|about|file):/i.test(rawTabUrl);
  if (restrictedScheme || !tabUrl) {
    const snippet = sanitizePageContextSnippet({
      title: tab.title ?? '',
      url: tabUrl,
    });
    return {
      tabId: tab.id,
      ...snippet,
    };
  }

  try {
    const results = await readPageContextSnippet(tab.id);
    const snippet = results[0]?.result as PageContextSnippet | undefined;
    if (!snippet) {
      const fallback = sanitizePageContextSnippet({
        title: tab.title ?? '',
        url: tabUrl,
      });
      return {
        tabId: tab.id,
        ...fallback,
      };
    }
    const sanitized = sanitizePageContextSnippet(snippet);
    return {
      tabId: tab.id,
      ...sanitized,
    };
  } catch {
    const fallback = sanitizePageContextSnippet({
      title: tab.title ?? '',
      url: tabUrl,
    });
    return {
      tabId: tab.id,
      ...fallback,
    };
  }
}

async function readPageContextSnippet(tabId: number): Promise<chrome.scripting.InjectionResult<PageContextSnippet>[]> {
  try {
    return await readPageContextSnippetOnce(tabId);
  } catch (err) {
    if (!isTransientPageContextReadError(err)) throw err;
    await new Promise<void>((resolve) => setTimeout(resolve, PAGE_CONTEXT_TRANSIENT_RETRY_DELAY_MS));
    return readPageContextSnippetOnce(tabId);
  }
}

function readPageContextSnippetOnce(
  tabId: number,
): Promise<chrome.scripting.InjectionResult<PageContextSnippet>[]> {
  return withDeadline(
    chrome.scripting.executeScript({
      target: { tabId },
      func: pageWorldExtractor,
    }),
    PAGE_CONTEXT_READ_TIMEOUT_MS,
    'page_context_timeout',
  );
}

function isTransientPageContextReadError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  if (
    lower.includes('permission') ||
    lower.includes('cannot access') ||
    lower.includes('chrome://') ||
    lower.includes('chrome-extension://') ||
    lower.includes('file://') ||
    lower.includes('page_context_timeout')
  ) {
    return false;
  }
  return (
    lower.includes('execution context was destroyed') ||
    lower.includes('receiving end does not exist') ||
    lower.includes('message port closed') ||
    lower.includes('frame was detached') ||
    lower.includes('frame with id') ||
    lower.includes('context invalidated')
  );
}

/**
 * Compose a "context tail" the Side Panel can append to the user's
 * intent before submitting via tasks.create. Empty string when the
 * page has no useful context (about:blank, chrome:// pages).
 */
export function composeContextTail(ctx: PageContext | null): string {
  if (!ctx) return '';
  const lines: string[] = [];
  if (ctx.title || ctx.url) {
    const label = ctx.title ? `${ctx.title} (${ctx.url})` : ctx.url;
    lines.push(`[当前页面] ${label}`);
  }
  if (ctx.selectedText.trim()) {
    const sel = clip(ctx.selectedText.trim(), MAX_CONTEXT_SELECTION_CHARS);
    lines.push(`[选中内容] ${sel}`);
  } else if (ctx.metaDescription.trim()) {
    const desc = clip(ctx.metaDescription.trim(), MAX_CONTEXT_META_DESCRIPTION_CHARS);
    lines.push(`[页面摘要] ${desc}`);
  }
  return lines.length > 0 ? `\n\n${lines.join('\n')}` : '';
}
