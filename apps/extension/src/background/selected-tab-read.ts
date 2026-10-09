import type { ServerMessage } from '@holaday/shared-types';
import { withDeadline } from '../shared/deadline.js';
import { getCurrentWsToken } from './ws-client.js';

type ToolCall = Extract<ServerMessage, { type: 'server.extension.tool_call' }>;
type Target = NonNullable<ToolCall['args']>['target'];
const MAX_TABS = 100;
const MAX_TEXT = 8000;
const SELECTION_TTL_MS = 10 * 60 * 1000;
const MAX_SELECTIONS = 500;
const selections = new Map<
  string,
  {
    tabId: number;
    url: string;
    ownerToken: string | null;
    expiresAt: number;
  }
>();

function rememberSelection(tab: chrome.tabs.Tab, ownerToken: string | null): string {
  const now = Date.now();
  for (const [id, selection] of selections) {
    if (selection.expiresAt <= now || selection.ownerToken !== ownerToken) selections.delete(id);
  }
  while (selections.size >= MAX_SELECTIONS) {
    const oldest = selections.keys().next().value;
    if (oldest === undefined) break;
    selections.delete(oldest);
  }
  const id = crypto.randomUUID();
  selections.set(id, {
    tabId: tab.id as number,
    url: tab.url ?? '',
    ownerToken,
    expiresAt: now + SELECTION_TTL_MS,
  });
  return id;
}

export function resetTabSelectionsForTests(): void {
  selections.clear();
}

/** Only display origin. Signed credentials can occur in any path/query field;
 * exact page identity is kept privately in the selection map, not in this label. */
function publicWebUrl(raw: string | undefined): string {
  try {
    const url = new URL(raw ?? '');
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
    return url.origin;
  } catch {
    return '';
  }
}

export async function listReadableTabs() {
  const ownerToken = getCurrentWsToken();
  const tabs = await withDeadline(
    chrome.tabs.query({ windowType: 'normal' }),
    1500,
    'extension_tool_timeout',
  );
  const webTabs = tabs.filter((tab) => tab.id !== undefined && publicWebUrl(tab.url));
  return {
    tabs: webTabs.slice(0, MAX_TABS).map((tab) => ({
      tabId: tab.id as number,
      selectionId: rememberSelection(tab, ownerToken),
      url: publicWebUrl(tab.url),
      title: (tab.title ?? '').slice(0, 512),
      active: tab.active === true,
    })),
    truncated: webTabs.length > MAX_TABS,
  };
}

/** Read in-place. No reload, new tab, foreground switch, cookies or storage APIs. */
async function selectedTabState(target: Target) {
  if (!target) throw new Error('target_required');
  const selection = selections.get(target.selectionId);
  if (
    !selection ||
    selection.tabId !== target.tabId ||
    selection.ownerToken !== getCurrentWsToken() ||
    selection.expiresAt <= Date.now()
  ) {
    if (selection) selections.delete(target.selectionId);
    throw new Error('target_changed');
  }
  let tab: chrome.tabs.Tab;
  try {
    tab = await withDeadline(chrome.tabs.get(target.tabId), 2000, 'extension_tool_timeout');
  } catch (error) {
    if (error instanceof Error && /no tab|invalid tab|tab.*closed/i.test(error.message)) {
      throw new Error('target_closed');
    }
    throw error;
  }
  const expectedUrl = publicWebUrl(target.expectedUrl);
  if (
    !expectedUrl ||
    tab.url !== selection.url ||
    selection.ownerToken !== getCurrentWsToken() ||
    selection.expiresAt <= Date.now() ||
    publicWebUrl(tab.url) !== expectedUrl ||
    (tab.pendingUrl && tab.pendingUrl !== tab.url)
  )
    throw new Error('target_changed');

  return { tab, selection };
}
/** Validate the user's selected page without reading its DOM or credentials. */
export async function validateSelectedTab(target: Target) {
  return (await selectedTabState(target)).tab;
}

export async function readSelectedTab(target: Target) {
  const { tab, selection } = await selectedTabState(target);
  if (!target) throw new Error('target_required');
  // Metadata and text come from the same document. Check the *raw* URL in-page
  // before reading and again on return; a navigation during dispatch is not a
  // successful read of the selected document. No page-provided code is executed.
  const [frame] = await withDeadline(
    chrome.scripting.executeScript({
      target: { tabId: target.tabId },
      world: 'ISOLATED',
      func: (rawUrl: string, limit: number) => {
        const url = location.href;
        if (url !== rawUrl) return { url, title: '', bodyText: '' };
        const text = document.body?.innerText ?? '';
        return {
          url,
          title: document.title.slice(0, 512),
          bodyText: text.slice(0, limit),
          truncated: text.length > limit,
        };
      },
      args: [tab.url ?? '', MAX_TEXT],
    }),
    5000,
    'extension_tool_timeout',
  );
  const value: unknown = frame?.result;
  if (!value || typeof value !== 'object') throw new Error('read_unavailable');
  const result = value as {
    url?: unknown;
    title?: unknown;
    bodyText?: unknown;
    truncated?: unknown;
  };
  if (
    typeof result.url !== 'string' ||
    result.url !== selection.url ||
    selection.expiresAt <= Date.now() ||
    selection.ownerToken !== getCurrentWsToken()
  )
    throw new Error('target_changed');
  if (typeof result.bodyText !== 'string' || typeof result.title !== 'string') {
    throw new Error('read_unavailable');
  }
  return {
    tabId: target.tabId,
    finalUrl: publicWebUrl(result.url),
    title: result.title.slice(0, 512),
    bodyText: result.bodyText.slice(0, MAX_TEXT),
    truncated: result.truncated === true || result.bodyText.length > MAX_TEXT,
  };
}
