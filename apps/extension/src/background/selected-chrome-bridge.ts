import { PlaywrightCrxAdapter } from '@holaday/browser-driver/crx';
import type { ServerMessage } from '@holaday/shared-types';
import { SelectedChromeSession } from './selected-chrome-session.js';
import { readSelectedTab } from './selected-tab-read.js';
import { getCurrentWsToken } from './ws-client.js';

type Target = NonNullable<
  Extract<ServerMessage, { type: 'server.extension.tool_call' }>['args']
>['target'];

/** Local runtime boundary. WS/Qwen activation is a separate integration gate. */
export function createSelectedChromeBridge() {
  const session = new SelectedChromeSession({
    makeDriver: (tabId) => new PlaywrightCrxAdapter({ attachToTabId: tabId }),
    owner: getCurrentWsToken,
  });
  return {
    open: (taskId: string, target: Target) => {
      if (!target) return Promise.resolve({ ok: false as const, error: 'target_required' });
      return session.open({
        taskId,
        tabId: target.tabId,
        validate: async () => {
          await readSelectedTab(target);
        },
      });
    },
    observe: session.observe.bind(session),
    execute: session.execute.bind(session),
    close: session.close.bind(session),
    // Trusted lifecycle hook only; do not dispatch a client-supplied stop here.
    stopTask: session.stopTask.bind(session),
  };
}
