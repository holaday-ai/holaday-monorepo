import {
  BROWSER_LAUNCH_JOURNAL_PREFIX,
  type BrowserLaunchCreationReceipt,
  BrowserLaunchJournal,
  type BrowserLaunchJournalDependencies,
  pollBrowserTaskPreparation,
  resolveBrowserLaunchTarget,
} from '@holaday/shared-types';
import { withDeadline } from '../shared/deadline.js';
import type { ChromeDiscovery } from './task-launch.js';

export const sidePanelLaunchJournal = new BrowserLaunchJournal({
  all: async () =>
    Object.entries(
      await withDeadline(chrome.storage.local.get(null), 1500, 'storage_launch_timeout'),
    )
      .filter(([key]) => key.startsWith(BROWSER_LAUNCH_JOURNAL_PREFIX))
      .map(([, value]) => value),
  put: (entry) =>
    withDeadline(
      chrome.storage.local.set({
        [`${BROWSER_LAUNCH_JOURNAL_PREFIX}${entry.clientRequestId}`]: entry,
      }),
      1500,
      'storage_launch_timeout',
    ),
  remove: (id) =>
    withDeadline(
      chrome.storage.local.remove(`${BROWSER_LAUNCH_JOURNAL_PREFIX}${id}`),
      1500,
      'storage_launch_timeout',
    ),
  lock: (run) => {
    if (!navigator.locks) throw new Error('浏览器暂不支持安全任务续接，请更新 Chrome。');
    return navigator.locks.request('holaday-browser-launch-v1', run);
  },
});
export type SidePanelBrowserRequest = <T>(
  procedure: string,
  input?: unknown,
  query?: boolean,
) => Promise<T>;
export function sidePanelLaunchDependencies(
  request: SidePanelBrowserRequest,
  current: () => Promise<void>,
  onLoading?: () => void,
): BrowserLaunchJournalDependencies<{ taskId: string; status?: string }> {
  const resolve: BrowserLaunchJournalDependencies<{ taskId: string }>['resolve'] = async (
    source,
  ) => {
    const discovery = await request<ChromeDiscovery>('localChromeTabs');
    await current();
    return resolveBrowserLaunchTarget(source, discovery.tabs);
  };
  return {
    current,
    receipt: (clientRequestId) =>
      request<BrowserLaunchCreationReceipt>('localChromeLaunchReceipt', { clientRequestId }, true),
    resolve,
    prepare: (selection, preparationId, resumeOnly, mode) =>
      pollBrowserTaskPreparation({
        source: selection,
        preparationId,
        current,
        onLoading,
        prepare: ({ preparationReadiness, ...target }, id) =>
          request('localChromeTaskTab', {
            selection: target,
            preparationId: id,
            resumeOnly,
            mode,
            ...(preparationReadiness ? { reportReadiness: true } : {}),
          }),
      }),
    create: (body) => request<{ taskId: string; status?: string }>('create', body),
    release: async (entry) => {
      const target = await resolve(entry.source);
      await current();
      await request('localChromeLaunchAcknowledge', {
        taskId: entry.taskId,
        preparationId: entry.preparationId,
        extensionClientId: target.extensionClientId,
        launchBrowserSessionId: entry.source.browserSessionId,
      });
    },
  };
}
