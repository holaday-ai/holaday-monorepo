import { PlaywrightCrxAdapter } from '@holaday/browser-driver/crx';
import type { UserBrowserProtocol, ServerMessage } from '@holaday/shared-types';
import { SelectedChromeSession } from './selected-chrome-session.js';
import { readSelectedTab } from './selected-tab-read.js';
import { getCurrentWsToken } from './ws-client.js';

type Target = NonNullable<
  Extract<ServerMessage, { type: 'server.extension.tool_call' }>['args']
>['target'];

/** Local runtime boundary. WS/Qwen activation is a separate integration gate. */
export function createSelectedChromeBridge() {
  const session = new SelectedChromeSession({
    makeDriver: (tabId, options) =>
      new PlaywrightCrxAdapter({
        attachToTabId: tabId,
        userBrowserRoutingV2: options?.v2,
        allowedOrigins: options?.origins,
      }),
    newTab: async (url) => {
      const tab = await chrome.tabs.create({ url, active: false });
      if (tab.id === undefined) throw new Error('tab_create_failed');
      return tab.id;
    },
    owner: getCurrentWsToken,
  });
  if (typeof chrome !== 'undefined') {
    chrome.tabs?.onRemoved?.addListener?.((tabId) => session.markTabClosed(tabId));
  }
  return {
    open: (
      taskId: string,
      target: Target,
      options?: { protocol?: UserBrowserProtocol; grantedOrigins?: readonly string[] },
    ) => {
      if (!target) return Promise.resolve({ ok: false as const, error: 'target_required' });
      return session.open({
        taskId,
        tabId: target.tabId,
        ...options,
        validate: async () => {
          await readSelectedTab(target);
        },
      });
    },
    observe: session.observe.bind(session),
    describe: session.describe.bind(session),
    tabs: session.tabs.bind(session),
    execute: session.execute.bind(session),
    close: session.close.bind(session),
    // Trusted lifecycle hook only; do not dispatch a client-supplied stop here.
    stopTask: session.stopTask.bind(session),
  };
}
