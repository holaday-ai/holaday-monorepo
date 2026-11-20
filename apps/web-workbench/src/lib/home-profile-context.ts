import { getAccessToken } from './auth';
import { type HomeProfileApi, HomeProfileJournal } from './home-profile-journal';
import { createPinnedTrpc } from './trpc';

/** Pin the actor for the whole dialog operation; only highlevel intent metadata is durable. */
export async function createHomeProfileContext(expectedOwner: string, mounted: () => void) {
  const token = getAccessToken();
  const current = () => {
    mounted();
    if (!token || getAccessToken() !== token) throw new Error('登录态已切换，请重新打开保存面板。');
  };
  current();
  const client = createPinnedTrpc(token!);
  const owner = await client.auth.me.query(undefined, { signal: AbortSignal.timeout(20_000) });
  current();
  if (owner.userId !== expectedOwner) throw new Error('当前账号已变化，请刷新页面后重试。');
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(owner.userId));
  current();
  const digest = [...new Uint8Array(bytes)].map((v) => v.toString(16).padStart(2, '0')).join('');
  const key = `holaday.home-profile-save.v1.${digest}`;
  const call = async <T>(run: () => Promise<T>): Promise<T> => {
    current();
    const result = await run();
    current();
    return result;
  };
  const api: HomeProfileApi = {
    options: () =>
      call(() =>
        client.browserHome.profileOptions.query(undefined, { signal: AbortSignal.timeout(20_000) }),
      ),
    receipt: (request) =>
      call(() =>
        client.browserHome.profileSaveReceipt.query(request, {
          signal: AbortSignal.timeout(20_000),
        }),
      ),
    save: (request) =>
      call(() =>
        client.browserHome.saveProfile.mutate(request, { signal: AbortSignal.timeout(20_000) }),
      ),
    cancel: (request) =>
      call(() =>
        client.browserHome.cancelProfileSave.mutate(request, {
          signal: AbortSignal.timeout(20_000),
        }),
      ),
    select: (profileId) =>
      call(() =>
        client.browserHome.selectProfile.mutate(
          { profileId },
          { signal: AbortSignal.timeout(20_000) },
        ),
      ),
    forget: (profileId) =>
      call(() =>
        client.browserHome.forgetProfile.mutate(
          { profileId },
          { signal: AbortSignal.timeout(20_000) },
        ),
      ),
  };
  const journal = new HomeProfileJournal({
    key,
    storage: localStorage,
    api,
    current,
    uuid: () => crypto.randomUUID(),
    lock: (run) => {
      if (!navigator.locks) throw new Error('浏览器暂不支持安全保存续接，请更新 Chrome 后重试。');
      return navigator.locks.request(key, () => {
        current();
        return run();
      });
    },
  });
  return { api, journal, current };
}
export type HomeProfileContext = Awaited<ReturnType<typeof createHomeProfileContext>>;
