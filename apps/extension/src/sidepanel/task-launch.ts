import {
  type BrowserTaskLaunches,
  type BrowserTaskModeChoice,
  resolveBrowserTaskMode,
} from '@holaday/shared-types';
import { type PageContext, composeContextTail } from '../shared/page-context.js';

export interface ChromeLaunchTarget {
  extensionClientId: string;
  tabId: number;
  expectedUrl: string;
  selectionId: string;
  launchBrowserSessionId?: string;
}
export interface ChromeDiscovery {
  backgroundTaskTabs?: boolean;
  launchRecovery?: boolean;
  tabs: Array<ChromeLaunchTarget & { taskTabStart?: boolean; launchRecoveryReady?: boolean }>;
}
export interface SidePanelLaunchDependencies {
  discover(): Promise<ChromeDiscovery>;
  connection(): Promise<string | null>;
  prepare(selection: ChromeLaunchTarget, preparationId: string): Promise<ChromeLaunchTarget>;
  assertSession(): Promise<void>;
  legacyContext(): Promise<PageContext | null>;
  launches: BrowserTaskLaunches<ChromeLaunchTarget>;
}
export function chromeLaunchTarget(tab: ChromeLaunchTarget): ChromeLaunchTarget {
  return {
    extensionClientId: tab.extensionClientId,
    tabId: tab.tabId,
    expectedUrl: tab.expectedUrl,
    selectionId: tab.selectionId,
    ...(tab.launchBrowserSessionId ? { launchBrowserSessionId: tab.launchBrowserSessionId } : {}),
  };
}

export async function prepareSidePanelLaunch(
  input: {
    intent: string;
    page: PageContext | null;
    session: number;
    choice?: BrowserTaskModeChoice;
  },
  deps: SidePanelLaunchDependencies,
): Promise<{
  key?: string;
  body: { intent: string; localChrome?: ChromeLaunchTarget; clientRequestId?: string };
}> {
  const discovery = await deps.discover();
  await deps.assertSession();
  if (!discovery.backgroundTaskTabs) {
    const tail = composeContextTail(await deps.legacyContext());
    await deps.assertSession();
    return { body: { intent: input.intent + tail } };
  }
  const connection = await deps.connection();
  await deps.assertSession();
  const page = input.page;
  const origin = page ? new URL(page.url).origin : null;
  const source = discovery.tabs.find(
    (tab) =>
      connection &&
      tab.extensionClientId === connection &&
      tab.tabId === page?.tabId &&
      new URL(tab.expectedUrl).origin === origin,
  );
  if (!source) throw new Error('页面或 Chrome 连接已改变，请重新选择页面后发送。');
  const mode = resolveBrowserTaskMode(input.intent, input.choice);
  if (mode === 'independent' && !source.taskTabStart)
    throw new Error('请更新并重新连接 HOLADAY Chrome 扩展后使用独立任务页。');
  const key = JSON.stringify([
    input.session,
    input.intent,
    connection,
    source.tabId,
    page?.url,
    mode,
  ]);
  const attempt = deps.launches.attempt(key);
  const target = await deps.launches.prepare(key, (id) =>
    mode === 'current'
      ? Promise.resolve(chromeLaunchTarget(source))
      : deps.prepare(chromeLaunchTarget(source), id),
  );
  await deps.assertSession();
  return {
    key,
    body: {
      intent: input.intent,
      localChrome: chromeLaunchTarget(target),
      clientRequestId: attempt.clientRequestId,
    },
  };
}
