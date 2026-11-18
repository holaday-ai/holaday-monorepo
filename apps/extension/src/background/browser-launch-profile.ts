import { withDeadline } from '../shared/deadline.js';

const key = 'holaday.browser-launch-profile.v1';
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
let pending: Promise<string> | undefined;

/** Identity of this Chrome profile in this browser session, not authority to act. */
export function browserLaunchSessionId(): Promise<string> {
  if (pending) return pending;
  pending = (async () => {
    if (!chrome.storage?.session) throw new Error('capability_missing');
    const storage = chrome.storage.session;
    const saved = (await withDeadline(storage.get(key), 1500, 'extension_tool_timeout'))[key];
    if (saved !== undefined) {
      if (typeof saved !== 'string' || !uuid.test(saved))
        throw new Error('browser_session_unknown');
      return saved;
    }
    const id = crypto.randomUUID();
    await withDeadline(storage.set({ [key]: id }), 1500, 'extension_tool_timeout');
    if ((await withDeadline(storage.get(key), 1500, 'extension_tool_timeout'))[key] !== id)
      throw new Error('browser_session_unknown');
    return id;
  })().finally(() => {
    pending = undefined;
  });
  return pending;
}
