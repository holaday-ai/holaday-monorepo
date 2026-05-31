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
const PAGE_CONTEXT_TAB_QUERY_TIMEOUT_MS = 1_500;
const SENSITIVE_QUERY_PARAM_RE =
  /(^|[_-])(access|auth|code|email|key|pass|password|refresh|secret|session|sid|token)([_-]|$)/i;

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
      if (SENSITIVE_QUERY_PARAM_RE.test(key)) url.searchParams.delete(key);
    }
    return clip(url.toString(), MAX_CONTEXT_URL_CHARS);
  } catch {
    return text;
  }
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
  ];
  const candidates: chrome.tabs.Tab[] = [];

  for (const query of queries) {
    try {
      const [tab] = await withDeadline(
        chrome.tabs.query(query),
        PAGE_CONTEXT_TAB_QUERY_TIMEOUT_MS,
        'page_context_tab_query_timeout',
      );
      if (tab) candidates.push(tab);
    } catch {
      // Keep falling back; Chrome can reject transiently while focus
      // moves between the popup, side panel, and page window.
    }
  }

  return candidates.find(isWebPageTab);
}

function isWebPageTab(tab: chrome.tabs.Tab): boolean {
  if (typeof tab.id !== 'number') return false;
  if (!tab.url) return false;
  return tab.url.startsWith('http://') || tab.url.startsWith('https://');
}

export async function getActivePageContext(): Promise<PageContext | null> {
  const tab = await queryActivePageContextTab();
  if (!tab?.id) return null;

  // chrome:// / chrome-extension:// / file:// pages can't be scripted —
  // skip the executeScript call and surface what the tab metadata
  // already gives us.
  const restrictedScheme = /^(chrome|chrome-extension|edge|about|file):/i.test(tab.url ?? '');
  if (restrictedScheme || !tab.url) {
    const snippet = sanitizePageContextSnippet({
      title: tab.title ?? '',
      url: tab.url ?? '',
    });
    return {
      tabId: tab.id,
      ...snippet,
    };
  }

  try {
    const results = await withDeadline(
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: pageWorldExtractor,
      }),
      PAGE_CONTEXT_READ_TIMEOUT_MS,
      'page_context_timeout',
    );
    const snippet = results[0]?.result as PageContextSnippet | undefined;
    if (!snippet) {
      const fallback = sanitizePageContextSnippet({
        title: tab.title ?? '',
        url: tab.url ?? '',
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
      url: tab.url ?? '',
    });
    return {
      tabId: tab.id,
      ...fallback,
    };
  }
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
  }
  return lines.length > 0 ? `\n\n${lines.join('\n')}` : '';
}
