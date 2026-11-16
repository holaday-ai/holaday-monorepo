import {
  BROWSER_LAUNCH_JOURNAL_PREFIX,
  BrowserLaunchJournal,
  type BrowserLaunchJournalDependencies,
  resolveBrowserLaunchTarget,
} from '@holaday/shared-types';
import { getAccessToken } from './auth';
import { createPinnedTrpc } from './trpc';

export const webBrowserLaunchJournal = new BrowserLaunchJournal({
  all: async () =>
    Object.keys(localStorage)
      .filter((k) => k.startsWith(BROWSER_LAUNCH_JOURNAL_PREFIX))
      .map((key) => JSON.parse(localStorage.getItem(key)!)),
  put: async (entry) => {
    localStorage.setItem(
      `${BROWSER_LAUNCH_JOURNAL_PREFIX}${entry.clientRequestId}`,
      JSON.stringify(entry),
    );
  },
  remove: async (id) => {
    localStorage.removeItem(`${BROWSER_LAUNCH_JOURNAL_PREFIX}${id}`);
  },
  lock: (run) => {
    if (!navigator.locks) throw new Error('浏览器暂不支持安全任务续接，请更新 Chrome。');
    return navigator.locks.request('holaday-browser-launch-v1', run);
  },
});
export function hasWebBrowserLaunchRecords(): boolean {
  if (typeof localStorage === 'undefined') return false;
  return Object.keys(localStorage).some((k) => k.startsWith(BROWSER_LAUNCH_JOURNAL_PREFIX));
}
export async function webBrowserLaunchContext(current: () => void) {
  const token = getAccessToken();
  if (!token) throw new Error('请重新登录后继续任务。');
  const client = createPinnedTrpc(token);
  const assertCurrent = async () => {
    current();
    if (getAccessToken() !== token) throw new Error('登录态已切换，请查看原账号的任务。');
  };
  await assertCurrent();
  const owner = await client.auth.me.query();
  await assertCurrent();
  type Response = Awaited<ReturnType<typeof client.tasks.create.mutate>>;
  const resolve: BrowserLaunchJournalDependencies<Response>['resolve'] = async (source) => {
    const discovery = await client.tasks.localChromeTabs.query();
    await assertCurrent();
    return resolveBrowserLaunchTarget(source, discovery.tabs);
  };
  const deps: BrowserLaunchJournalDependencies<Response> = {
    current: assertCurrent,
    receipt: (clientRequestId) => client.tasks.localChromeLaunchReceipt.query({ clientRequestId }),
    resolve,
    prepare: (selection, preparationId, resumeOnly, mode) =>
      client.tasks.localChromeTaskTab.mutate({ selection, preparationId, resumeOnly, mode }),
    create: (body) =>
      client.tasks.create.mutate(body as Parameters<typeof client.tasks.create.mutate>[0]),
    release: async (entry) => {
      const target = await resolve(entry.source);
      await assertCurrent();
      await client.tasks.localChromeLaunchAcknowledge.mutate({
        taskId: entry.taskId!,
        preparationId: entry.preparationId,
        extensionClientId: target.extensionClientId,
        launchBrowserSessionId: entry.source.browserSessionId,
      });
    },
  };
  return { ownerId: owner.userId, deps };
}
