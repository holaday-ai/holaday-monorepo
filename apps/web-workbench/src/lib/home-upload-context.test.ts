// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { clearAccessToken, setAccessToken } from './auth';
import { createHomeUploadContext } from './home-upload-context';

const instanceId = 'd69dce46-b473-45b2-84a1-608713ee2cf6';
const requestId = '4657792a-e8c9-4ff6-bdb2-179afcb260ed';
let requests: { url: string; token: string | null; body?: string }[];
let upload: (() => Promise<void>) | undefined;
beforeEach(() => {
  requests = [];
  upload = undefined;
  setAccessToken('synthetic-alice');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost');
      const token = new Headers(init?.headers).get('authorization');
      requests.push({
        url: url.toString(),
        token,
        ...(typeof init?.body === 'string' ? { body: init.body } : {}),
      });
      if (url.pathname === '/api/files/upload') {
        await upload?.();
        return new Response(
          JSON.stringify({
            fileId: 'fil_owned',
            filename: 'report.csv',
            mimetype: 'text/csv',
            size: 2,
          }),
        );
      }
      const result = url.pathname.includes('auth.me')
        ? { userId: 'usr_alice' }
        : { enabled: true, changed: false, session: { instanceId, request: null } };
      return new Response(JSON.stringify([{ result: { data: result } }]), {
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
});
afterEach(() => {
  clearAccessToken();
  vi.unstubAllGlobals();
});
it('pins actor and original instance for queries, existing upload API and selection', async () => {
  const bound = await createHomeUploadContext(
    'usr_alice',
    instanceId,
    () => {},
    new AbortController().signal,
  );
  await bound.list();
  const file = await bound.upload(
    new File(['ok'], 'report.csv', { type: 'text/csv' }),
    new AbortController().signal,
  );
  await bound.choose(requestId, [file.fileId]);
  expect(requests.every((request) => request.token === 'Bearer synthetic-alice')).toBe(true);
  expect(requests.find((request) => request.url.includes('fileRequest'))?.url).toContain(
    instanceId,
  );
  expect(requests.find((request) => request.url.includes('chooseFiles'))?.body).toContain(
    'fil_owned',
  );
});
it('stops after account change during file upload; teardown cancels only the old pinned request', async () => {
  let release!: () => void;
  upload = () =>
    new Promise<void>((done) => {
      release = done;
    });
  const bound = await createHomeUploadContext(
    'usr_alice',
    instanceId,
    () => {},
    new AbortController().signal,
  );
  const flow = (async () => {
    const stored = await bound.upload(new File(['ok'], 'report.csv'), new AbortController().signal);
    return bound.choose(requestId, [stored.fileId]);
  })();
  const result = expect(flow).rejects.toThrow('登录态已切换');
  await vi.waitFor(() =>
    expect(requests.some((request) => request.url.includes('/api/files/upload'))).toBe(true),
  );
  setAccessToken('synthetic-bob');
  release();
  await result;
  expect(requests.some((request) => request.url.includes('chooseFiles'))).toBe(false);
  await bound.cancelOnLeave(requestId);
  const cancelled = requests.find((request) => request.url.includes('cancelFiles'))!;
  expect(cancelled.token).toBe('Bearer synthetic-alice');
  expect(cancelled.body).toContain(instanceId);
  expect(cancelled.body).toContain(requestId);
  expect(cancelled.body).not.toContain('fileIds');
});
it('rejects an owner mismatch before any file upload', async () => {
  await expect(
    createHomeUploadContext('usr_bob', instanceId, () => {}, new AbortController().signal),
  ).rejects.toThrow('当前账号已变化');
  expect(requests.some((request) => request.url.includes('/api/files/upload'))).toBe(false);
});
