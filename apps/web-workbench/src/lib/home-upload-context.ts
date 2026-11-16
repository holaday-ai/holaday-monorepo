import { getAccessToken } from './auth';
import { createPinnedTrpc } from './trpc';
import { uploadFile } from './upload-file';

export type HomeUploadSession = NonNullable<
  Awaited<
    ReturnType<ReturnType<typeof createPinnedTrpc>['browserHome']['fileRequest']['query']>
  >['session']
>;

/** Pin the actor and original browser instance for the entire local file-picker operation. */
export async function createHomeUploadContext(
  ownerId: string,
  instanceId: string,
  mounted: () => void,
  signal: AbortSignal,
) {
  const token = getAccessToken();
  const current = () => {
    mounted();
    signal.throwIfAborted();
    if (!token || getAccessToken() !== token) throw new Error('登录态已切换，请重新打开云浏览器。');
  };
  current();
  const client = createPinnedTrpc(token!);
  const requestSignal = () => AbortSignal.any([signal, AbortSignal.timeout(20_000)]);
  const owner = await client.auth.me.query(undefined, { signal: requestSignal() });
  current();
  if (owner.userId !== ownerId) throw new Error('当前账号已变化，请刷新页面后重试。');
  return {
    current,
    list: async () => {
      current();
      const result = await client.browserHome.fileRequest.query(
        { instanceId },
        { signal: requestSignal() },
      );
      current();
      return result;
    },
    upload: (file: File, selectionSignal: AbortSignal) => {
      const active = () => {
        current();
        selectionSignal.throwIfAborted();
      };
      return uploadFile(file, {
        token: token!,
        current: active,
        signal: AbortSignal.any([signal, selectionSignal, AbortSignal.timeout(60_000)]),
      });
    },
    choose: async (requestId: string, fileIds: string[]) => {
      current();
      const result = await client.browserHome.chooseFiles.mutate(
        { instanceId, requestId, fileIds },
        { signal: requestSignal() },
      );
      current();
      return result;
    },
    cancel: async (requestId: string) => {
      current();
      const result = await client.browserHome.cancelFiles.mutate(
        { instanceId, requestId },
        { signal: requestSignal() },
      );
      current();
      return result;
    },
    // Cleanup carries only the original request identity through the pinned actor. It sends no file.
    cancelOnLeave: (requestId: string) =>
      client.browserHome.cancelFiles
        .mutate({ instanceId, requestId }, { signal: AbortSignal.timeout(5000) })
        .catch(() => undefined),
  };
}
export type HomeUploadContext = Awaited<ReturnType<typeof createHomeUploadContext>>;
