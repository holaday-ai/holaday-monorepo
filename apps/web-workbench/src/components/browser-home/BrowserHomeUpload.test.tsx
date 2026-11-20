// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserHomeUpload } from './BrowserHomeUpload';

const hooks = vi.hoisted(() => ({
  upload: vi.fn(),
  choose: vi.fn(),
  cancel: vi.fn(),
  leave: vi.fn(),
  list: vi.fn(),
  factory: vi.fn(),
  current: vi.fn(),
}));
const instanceId = 'd69dce46-b473-45b2-84a1-608713ee2cf6';
const request = {
  id: '4657792a-e8c9-4ff6-bdb2-179afcb260ed',
  state: 'awaiting_files' as string,
  origin: 'https://fixture.test',
  formOrigin: 'https://receiver.test',
  accept: '.csv',
  multiple: false,
  expiresAt: Date.now() + 120_000,
};
let state = { instanceId, request };
vi.mock('@/lib/home-upload-context', () => ({
  createHomeUploadContext: (...args: unknown[]) => hooks.factory(...args),
}));
beforeEach(() => {
  vi.clearAllMocks();
  hooks.current.mockImplementation(() => {});
  state = { instanceId, request: { ...request, state: 'awaiting_files' } };
  hooks.list.mockImplementation(async () => ({
    enabled: true,
    changed: false,
    session: { ...state, request: { ...state.request } },
  }));
  hooks.upload.mockResolvedValue({ fileId: 'fil_report' });
  hooks.choose.mockImplementation(async () => {
    state.request.state = 'handed_to_page';
    return { ...state, request: { ...state.request } };
  });
  hooks.cancel.mockImplementation(async () => {
    state.request.state = 'cancelled';
    return { ...state, request: { ...state.request } };
  });
  hooks.factory.mockImplementation(
    async (_owner: string, _instance: string, mounted: () => void, signal: AbortSignal) => ({
      current: () => {
        mounted();
        signal.throwIfAborted();
        hooks.current();
      },
      list: hooks.list,
      upload: hooks.upload,
      choose: hooks.choose,
      cancel: hooks.cancel,
      cancelOnLeave: hooks.leave,
    }),
  );
});
afterEach(cleanup);
const file = () => new File(['sku,qty\nA-731,31\n'], 'report.csv', { type: 'text/csv' });

describe('Home website file selection', () => {
  it('clears prior source metadata when its pinned actor is no longer current', async () => {
    render(<BrowserHomeUpload ownerId="usr_alice" instanceId={instanceId} />);
    await screen.findByText('https://fixture.test');
    hooks.current.mockImplementation(() => {
      throw new Error('登录态已切换');
    });
    hooks.list.mockRejectedValue(new Error('登录态已切换'));
    fireEvent.click(screen.getByRole('button', { name: '核对文件状态' }));
    await screen.findByRole('alert');
    expect(screen.queryByText('https://fixture.test')).toBeNull();
    expect(hooks.leave).toHaveBeenCalledWith(request.id);
    expect(hooks.choose).not.toHaveBeenCalled();
  });
  it('names the actual origins and sends only the stored file id for that exact request', async () => {
    render(<BrowserHomeUpload ownerId="usr_alice" instanceId={instanceId} />);
    expect(await screen.findByText('https://fixture.test')).toBeTruthy();
    expect(screen.getByText(/https:\/\/receiver.test/)).toBeTruthy();
    expect(screen.getByText(/可能立即接收/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('选择文件交给网站'), { target: { files: [file()] } });
    await screen.findByText(/已交给页面/);
    expect(hooks.choose).toHaveBeenCalledWith(request.id, ['fil_report']);
    expect(hooks.upload).toHaveBeenCalledOnce();
    expect(screen.queryByText(/网站已保存/)).toBeNull();
  });
  it('cancels while local upload is pending and does not hand a late response to the site', async () => {
    let release!: (value: { fileId: string }) => void;
    hooks.upload.mockImplementation(
      () =>
        new Promise((done) => {
          release = done;
        }),
    );
    render(<BrowserHomeUpload ownerId="usr_alice" instanceId={instanceId} />);
    await screen.findByText('https://fixture.test');
    fireEvent.change(screen.getByLabelText('选择文件交给网站'), { target: { files: [file()] } });
    await waitFor(() => expect(hooks.upload).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button', { name: '取消文件选择' }));
    await screen.findByText(/已取消/);
    release({ fileId: 'fil_late' });
    await new Promise((done) => setTimeout(done, 20));
    expect(hooks.choose).not.toHaveBeenCalled();
  });
  it('stops local work when the exact server request expires during upload', async () => {
    let release!: (value: { fileId: string }) => void;
    hooks.upload.mockImplementation(
      () =>
        new Promise((done) => {
          release = done;
        }),
    );
    render(<BrowserHomeUpload ownerId="usr_alice" instanceId={instanceId} />);
    fireEvent.change(await screen.findByLabelText('选择文件交给网站'), {
      target: { files: [file()] },
    });
    await waitFor(() => expect(hooks.upload).toHaveBeenCalledOnce());
    state.request.state = 'expired';
    fireEvent.click(screen.getByRole('button', { name: '核对文件状态' }));
    await screen.findByText(/文件选择已过期/);
    release({ fileId: 'fil_late' });
    await new Promise((done) => setTimeout(done, 20));
    expect(hooks.choose).not.toHaveBeenCalled();
  });
  it('cancels the server request when the local native picker is cancelled', async () => {
    render(<BrowserHomeUpload ownerId="usr_alice" instanceId={instanceId} />);
    const input = await screen.findByLabelText('选择文件交给网站');
    fireEvent(input, new Event('cancel', { bubbles: true }));
    await waitFor(() => expect(hooks.cancel).toHaveBeenCalledWith(request.id));
    expect(hooks.upload).not.toHaveBeenCalled();
  });
  it('keeps an unknown receipt explicit and only checks status when refreshed', async () => {
    hooks.choose.mockImplementation(async () => {
      state.request.state = 'unknown';
      return { ...state, request: { ...state.request } };
    });
    render(<BrowserHomeUpload ownerId="usr_alice" instanceId={instanceId} />);
    fireEvent.change(await screen.findByLabelText('选择文件交给网站'), {
      target: { files: [file()] },
    });
    await screen.findByText(/交付结果待核对/);
    fireEvent.click(screen.getByRole('button', { name: '核对文件状态' }));
    await waitFor(() => expect(hooks.list.mock.calls.length).toBeGreaterThan(1));
    expect(hooks.choose).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: '选择文件' })).toBeNull();
  });
  it('abandons old account work and cancels only its original request on unmount', async () => {
    let release!: (value: { fileId: string }) => void;
    hooks.upload.mockImplementation(
      () =>
        new Promise((done) => {
          release = done;
        }),
    );
    const view = render(<BrowserHomeUpload ownerId="usr_alice" instanceId={instanceId} />);
    fireEvent.change(await screen.findByLabelText('选择文件交给网站'), {
      target: { files: [file()] },
    });
    await waitFor(() => expect(hooks.upload).toHaveBeenCalledOnce());
    view.unmount();
    release({ fileId: 'fil_late' });
    await waitFor(() => expect(hooks.leave).toHaveBeenCalledWith(request.id));
    expect(hooks.choose).not.toHaveBeenCalled();
  });
});
