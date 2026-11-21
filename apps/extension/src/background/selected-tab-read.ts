import type { ServerMessage, TaskTabLoadingReceipt } from '@holaday/shared-types';
import { withDeadline } from '../shared/deadline.js';
import { browserLaunchSessionId } from './browser-launch-profile.js';
import { TASK_TAB_JOURNAL_PREFIX, TaskTabJournal } from './task-tab-journal.js';
import {
  getAuthenticatedExtensionClientId,
  getAuthenticatedExtensionUserId,
  getCurrentWsToken,
} from './ws-client.js';

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
    ownership: 'selected' | 'task';
  }
>();

function rememberSelection(
  tab: chrome.tabs.Tab,
  ownerToken: string | null,
  ownership: 'selected' | 'task' = 'selected',
): string {
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
    ownership,
  });
  return id;
}

export function resetTabSelectionsForTests(): void {
  selections.clear();
  taskTabPreparations.clear();
  recoveryFlights.clear();
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

export async function selectedTabOwnership(target: Target): Promise<'selected' | 'task'> {
  return (await selectedTabState(target)).selection.ownership;
}

type ReadyTaskTab = {
  taskTabCreated: boolean;
  tabId: number;
  selectionId: string;
  url: string;
  title: string;
};
type PreparedTaskTab = ReadyTaskTab | TaskTabLoadingReceipt;
function loadingReceipt(
  target: NonNullable<Target>,
  preparationId: string,
  tabId: number,
  launchBrowserSessionId?: string,
): TaskTabLoadingReceipt {
  return {
    taskTabStatus: 'loading',
    taskTabCreated: true,
    preparationId,
    sourceTabId: target.tabId,
    sourceOrigin: new URL(target.expectedUrl).origin,
    tabId,
    ...(launchBrowserSessionId ? { launchBrowserSessionId } : {}),
  };
}
function requestedReadiness(result: PreparedTaskTab, reportReadiness: boolean): PreparedTaskTab {
  if ('taskTabStatus' in result && !reportReadiness) throw new Error('task_tab_not_ready');
  return result;
}
interface TaskTabPreparation {
  owner: string;
  target: string;
  expiresAt: number;
  settled: boolean;
  retainOnExpiry: boolean;
  observationFailed: boolean;
  observe?: () => Promise<PreparedTaskTab>;
  result: Promise<PreparedTaskTab>;
}
const taskTabPreparations = new Map<string, TaskTabPreparation>();

function settlePreparation(entry: TaskTabPreparation): void {
  void entry.result.then(
    (result) => {
      entry.settled = true;
      entry.observationFailed = 'taskTabStatus' in result;
      entry.retainOnExpiry = entry.observationFailed;
    },
    (error) => {
      entry.settled = true;
      // A known created page can be observed again. An uncertain create or a
      // changed target/account stays rejected and must never be recreated.
      entry.observationFailed =
        entry.observe !== undefined &&
        error instanceof Error &&
        ['task_tab_not_ready', 'extension_tool_timeout'].includes(error.message);
    },
  );
}

/** Only Chrome metadata is read. The raw, potentially signed URL stays in this worker. */
export async function prepareIndependentTaskTab(
  target: Target,
  preparationId: string | undefined,
  recoverable = false,
  resumeOnly = false,
  mode: 'current' | 'independent' = 'independent',
  expectedBrowserSessionId?: string,
  reportReadiness = false,
): Promise<PreparedTaskTab> {
  if (recoverable) {
    if (expectedBrowserSessionId && (await browserLaunchSessionId()) !== expectedBrowserSessionId)
      throw new Error('target_changed');
    return requestedReadiness(
      await prepareRecoverableTaskTab(
        target,
        preparationId,
        resumeOnly,
        mode,
        expectedBrowserSessionId,
      ),
      reportReadiness,
    );
  }
  if (mode === 'current' || resumeOnly || expectedBrowserSessionId)
    throw new Error('capability_missing');
  const owner = getCurrentWsToken();
  if (!owner || !target || !preparationId || !/^[a-f0-9-]{36}$/i.test(preparationId))
    throw new Error('target_required');
  const key = JSON.stringify([owner, preparationId]);
  const fingerprint = JSON.stringify(target);
  const existing = taskTabPreparations.get(key);
  if (existing) {
    if (existing.target !== fingerprint) throw new Error('target_changed');
    if (existing.settled && existing.observationFailed && existing.observe) {
      existing.settled = false;
      existing.observationFailed = false;
      existing.result = existing.observe();
      settlePreparation(existing);
    }
    const prepared = await existing.result;
    // A timed-out caller can safely retry, but never receive a different owner's handle.
    if (getCurrentWsToken() !== owner) throw new Error('target_changed');
    return requestedReadiness(prepared, reportReadiness);
  }
  for (const [id, item] of taskTabPreparations) {
    if (
      item.settled &&
      ((!item.retainOnExpiry && item.expiresAt <= Date.now()) || item.owner !== owner)
    )
      taskTabPreparations.delete(id);
  }
  if (taskTabPreparations.size >= 64) throw new Error('browser_busy');
  const entry: TaskTabPreparation = {
    owner,
    target: fingerprint,
    expiresAt: Date.now() + SELECTION_TTL_MS,
    settled: false,
    retainOnExpiry: false,
    observationFailed: false,
    result: Promise.resolve(null) as unknown as Promise<PreparedTaskTab>,
  };
  taskTabPreparations.set(key, entry);
  entry.result = (async () => {
    const source = await validateSelectedTab(target);
    const raw = new URL(source.url ?? '');
    if (!/^https?:$/.test(raw.protocol) || raw.username || raw.password)
      throw new Error('target_changed');
    if (getCurrentWsToken() !== owner) throw new Error('target_changed');
    entry.retainOnExpiry = true;
    const created = await chrome.tabs.create({ url: source.url, active: false });
    if (created.id === undefined || created.id === target.tabId)
      throw new Error('tab_create_failed');
    const tabId = created.id;
    entry.observe = async () => {
      const deadline = Date.now() + 8000;
      for (;;) {
        if (getCurrentWsToken() !== owner) throw new Error('target_changed');
        const tab = await withDeadline(chrome.tabs.get(tabId), 1500, 'extension_tool_timeout');
        if (getCurrentWsToken() !== owner) throw new Error('target_changed');
        if (tab.id !== tabId) throw new Error('target_changed');
        for (const candidate of [tab.url, tab.pendingUrl]) {
          if (candidate && publicWebUrl(candidate) !== raw.origin)
            throw new Error('origin_grant_required');
        }
        const origin = publicWebUrl(tab.url);
        if (!tab.pendingUrl && tab.status !== 'loading') {
          if (origin && origin !== raw.origin) throw new Error('origin_grant_required');
          if (origin === raw.origin) {
            return {
              taskTabCreated: true as const,
              tabId,
              selectionId: rememberSelection(tab, owner, 'task'),
              url: origin,
              title: (tab.title ?? '').slice(0, 512),
            };
          }
        }
        if (Date.now() >= deadline) return loadingReceipt(target, preparationId, tabId);
        await new Promise<void>((resolve) => setTimeout(resolve, 50));
      }
    };
    return entry.observe();
  })();
  // Keep unknown/late creation outcomes in the dedupe map. Never create a second tab on retry.
  settlePreparation(entry);
  return requestedReadiness(await entry.result, reportReadiness);
}

const recoveryFlights = new Map<string, { source: string; promise: Promise<PreparedTaskTab> }>();
async function prepareRecoverableTaskTab(
  target: Target,
  preparationId: string | undefined,
  resumeOnly: boolean,
  mode: 'current' | 'independent',
  expectedBrowserSessionId?: string,
): Promise<PreparedTaskTab> {
  const owner = getAuthenticatedExtensionUserId();
  const token = getCurrentWsToken();
  const connection = getAuthenticatedExtensionClientId();
  if (!owner || !token || !connection || !chrome.storage.session || !target || !preparationId)
    throw new Error('capability_missing');
  const origin = new URL(target.expectedUrl).origin;
  if (origin !== target.expectedUrl) throw new Error('target_changed');
  const source = JSON.stringify([target.tabId, origin, mode, expectedBrowserSessionId]);
  const key = JSON.stringify([owner, preparationId]);
  const existing = recoveryFlights.get(key);
  if (existing) {
    if (existing.source !== source) throw new Error('target_changed');
    return existing.promise;
  }
  const current = () =>
    getCurrentWsToken() === token &&
    getAuthenticatedExtensionUserId() === owner &&
    getAuthenticatedExtensionClientId() === connection;
  const journal = taskTabJournal(owner, current, target);
  const promise = journal
    .prepare({ tabId: target.tabId, origin }, preparationId, resumeOnly, mode, true)
    .then((tab) => {
      if (!current()) throw new Error('target_changed');
      if (tab.taskTabStatus === 'loading')
        return loadingReceipt(target, preparationId, tab.id!, expectedBrowserSessionId);
      return {
        taskTabCreated: mode === 'independent',
        tabId: tab.id!,
        selectionId: rememberSelection(
          tab as chrome.tabs.Tab,
          token,
          mode === 'current' ? 'selected' : 'task',
        ),
        url: origin,
        title: (tab.title ?? '').slice(0, 512),
      };
    })
    .finally(() => {
      recoveryFlights.delete(key);
    });
  recoveryFlights.set(key, { source, promise });
  return promise;
}

function taskTabJournal(owner: string, current: () => boolean, target?: Target): TaskTabJournal {
  return new TaskTabJournal({
    owner: () => owner,
    current,
    read: async (name) => (await chrome.storage.session.get(name))[name],
    write: async (name, entry) => {
      await chrome.storage.session.set({ [name]: entry });
    },
    count: async () =>
      Object.entries(await chrome.storage.session.get(null)).filter(
        ([name, value]) =>
          name.startsWith(TASK_TAB_JOURNAL_PREFIX) &&
          (value as { phase?: unknown })?.phase !== 'released',
      ).length,
    source: () => validateSelectedTab(target),
    get: (tabId) => withDeadline(chrome.tabs.get(tabId), 2000, 'extension_tool_timeout'),
    find: async (marker) =>
      (await chrome.tabs.query({ windowType: 'normal' })).filter(
        (tab) => tab.url === marker || tab.pendingUrl === marker,
      ),
    create: (url) => chrome.tabs.create({ url, active: false }),
    navigate: (tabId, url) => chrome.tabs.update(tabId, { url }),
    marker: (nonce) => `${chrome.runtime.getURL('task-launch.html')}#${nonce}`,
    wait: () => new Promise((resolve) => setTimeout(resolve, 50)),
  });
}

export async function releasePreparedTaskTab(
  preparationId?: string,
  expectedBrowserSessionId?: string,
): Promise<void> {
  const owner = getAuthenticatedExtensionUserId();
  const token = getCurrentWsToken();
  const connection = getAuthenticatedExtensionClientId();
  if (
    !owner ||
    !token ||
    !connection ||
    !preparationId ||
    !expectedBrowserSessionId ||
    (await browserLaunchSessionId()) !== expectedBrowserSessionId
  )
    throw new Error('target_changed');
  if (recoveryFlights.has(JSON.stringify([owner, preparationId]))) throw new Error('browser_busy');
  await taskTabJournal(
    owner,
    () =>
      getCurrentWsToken() === token &&
      getAuthenticatedExtensionUserId() === owner &&
      getAuthenticatedExtensionClientId() === connection,
  ).release(preparationId);
}
