import { clearAccessToken, setAccessToken } from '@/lib/auth';
// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserHomeFiles } from './BrowserHomeFiles';

const file = {
  fileId: 'fil_owned',
  filename: 'monthly.csv',
  sizeBytes: 23,
  mimetype: 'text/csv',
  createdAt: '2026-11-16T12:00:00.000Z',
  expiresAt: '2099-11-16T12:00:00.000Z',
  origin: 'https://reports.fixture.test',
  taskId: 'tsk_own',
  available: true,
  downloadUrl: 'https://untrusted.fixture.test/steal',
};
const initial = {
  enabled: true,
  files: [file, { ...file, fileId: 'fil_expired', filename: 'expired.csv', available: false }],
  transfers: [
    {
      id: 'receiving',
      state: 'pending',
      filename: 'receiving.csv',
      origin: file.origin,
      taskId: null,
    },
    {
      id: 'unknown',
      state: 'unconfirmed',
      filename: 'unknown.csv',
      origin: file.origin,
      taskId: null,
    },
    { id: 'failed', state: 'failed', filename: 'failed.csv', origin: file.origin, taskId: null },
  ],
};
let payload: unknown;
let list: null | (() => Promise<unknown>);
let requests: { url: string; token: string | null }[];
beforeEach(() => {
  payload = initial;
  list = null;
  requests = [];
  setAccessToken('synthetic-alice');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost');
      const token = new Headers(init?.headers).get('authorization');
      requests.push({ url: url.pathname, token });
      if (url.pathname.startsWith('/api/files/'))
        return new Response('month,revenue\n11,500\n', { headers: { 'content-type': 'text/csv' } });
      const result = url.pathname.includes('auth.me')
        ? { userId: token === 'Bearer synthetic-alice' ? 'usr_alice' : 'usr_bob' }
        : list
          ? await list()
          : payload;
      return new Response(JSON.stringify([{ result: { data: result } }]), {
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
});
afterEach(() => {
  cleanup();
  clearAccessToken();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('owned browser file panel', () => {
  it('lists actual save and transfer states without enabling expired retrieval', async () => {
    render(<BrowserHomeFiles ownerId="usr_alice" receiving />);
    expect(requests).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: '浏览器文件' }));
    expect(await screen.findByText('monthly.csv')).toBeTruthy();
    expect(screen.getAllByText(/23 B/).length).toBe(2);
    expect(screen.getByText('正在接收')).toBeTruthy();
    expect(screen.getByText('保存失败')).toBeTruthy();
    expect(screen.getByText('保存结果待核对')).toBeTruthy();
    expect(screen.getAllByText(/https:\/\/reports.fixture.test/).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: '下载 expired.csv' }).hasAttribute('disabled')).toBe(
      true,
    );
    expect(requests.every((row) => row.token === 'Bearer synthetic-alice')).toBe(true);
  });
  it('uses a canonical owned endpoint and delivers the received bytes through a blob', async () => {
    let delivered: Blob | undefined;
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      delivered = blob as Blob;
      return 'blob:owned';
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<BrowserHomeFiles ownerId="usr_alice" receiving />);
    fireEvent.click(screen.getByRole('button', { name: '浏览器文件' }));
    fireEvent.click(await screen.findByRole('button', { name: '下载 monthly.csv' }));
    await screen.findByText('已交给浏览器下载：monthly.csv');
    expect(await delivered?.text()).toBe('month,revenue\n11,500\n');
    expect(requests.some((row) => row.url === '/api/files/fil_owned/download')).toBe(true);
    expect(requests.some((row) => row.url.includes('steal'))).toBe(false);
  });
  it('discards the old owner response after switching accounts', async () => {
    let finish!: (value: unknown) => void;
    list = () =>
      new Promise((resolve) => {
        finish = resolve;
      });
    const view = render(<BrowserHomeFiles ownerId="usr_alice" receiving />);
    fireEvent.click(screen.getByRole('button', { name: '浏览器文件' }));
    await waitFor(() => expect(finish).toBeTypeOf('function'));
    setAccessToken('synthetic-bob');
    view.rerender(<BrowserHomeFiles ownerId="usr_bob" receiving={false} />);
    finish(initial);
    list = null;
    payload = { enabled: true, files: [], transfers: [] };
    fireEvent.click(screen.getByRole('button', { name: '浏览器文件' }));
    await screen.findByText('还没有保存的浏览器文件。');
    expect(screen.queryByText('monthly.csv')).toBeNull();
    expect(screen.getByText(/当前浏览器尚未启用文件接收/)).toBeTruthy();
  });
  it('rejects the response when only the token changed while reading files', async () => {
    let finish!: (value: unknown) => void;
    list = () =>
      new Promise((resolve) => {
        finish = resolve;
      });
    render(<BrowserHomeFiles ownerId="usr_alice" receiving />);
    fireEvent.click(screen.getByRole('button', { name: '浏览器文件' }));
    await waitFor(() => expect(finish).toBeTypeOf('function'));
    setAccessToken('synthetic-bob');
    finish(initial);
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      '登录态已切换，请重新打开文件面板。',
    );
    expect(screen.queryByText('monthly.csv')).toBeNull();
  });
  it('refuses a mismatch between the displayed owner and authenticated account', async () => {
    render(<BrowserHomeFiles ownerId="usr_bob" receiving />);
    fireEvent.click(screen.getByRole('button', { name: '浏览器文件' }));
    await screen.findByText('当前账号已变化，请刷新页面后重试。');
    expect(requests.some((row) => row.url.includes('browserHome.files'))).toBe(false);
  });
  it('honors a disabled file service response', async () => {
    payload = { enabled: false, files: [], transfers: [] };
    render(<BrowserHomeFiles ownerId="usr_alice" receiving={false} />);
    fireEvent.click(screen.getByRole('button', { name: '浏览器文件' }));
    await screen.findByText('文件功能暂未启用。');
    expect(screen.queryByRole('button', { name: '下载 monthly.csv' })).toBeNull();
  });
});
