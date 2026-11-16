import { getAccessToken } from './auth';
import { downloadFileAuthed } from './download-file';
import { createPinnedTrpc } from './trpc';

export type HomeFiles = Awaited<
  ReturnType<ReturnType<typeof createPinnedTrpc>['browserHome']['files']['query']>
>;

/** A file dialog never follows a later global account into the same operation. */
export async function createHomeFilesContext(
  ownerId: string,
  mounted: () => void,
  signal: AbortSignal,
) {
  const token = getAccessToken();
  const current = () => {
    mounted();
    signal.throwIfAborted();
    if (!token || getAccessToken() !== token) throw new Error('登录态已切换，请重新打开文件面板。');
  };
  current();
  const client = createPinnedTrpc(token!);
  const requestSignal = () => AbortSignal.any([signal, AbortSignal.timeout(20_000)]);
  const owner = await client.auth.me.query(undefined, { signal: requestSignal() });
  current();
  if (owner.userId !== ownerId) throw new Error('当前账号已变化，请刷新页面后重试。');
  return {
    current,
    list: async (): Promise<HomeFiles> => {
      current();
      const result = await client.browserHome.files.query(undefined, { signal: requestSignal() });
      current();
      return result;
    },
    download: async (file: { fileId: string; filename: string }) => {
      current();
      if (!/^[A-Za-z0-9_-]{1,160}$/.test(file.fileId)) throw new Error('文件标识无效。');
      // Only the owned file endpoint receives the bearer, never a website-supplied URL.
      return downloadFileAuthed({
        url: `/api/files/${file.fileId}/download`,
        filename: file.filename,
        current,
        signal,
      });
    },
  };
}
export type HomeFilesContext = Awaited<ReturnType<typeof createHomeFilesContext>>;
