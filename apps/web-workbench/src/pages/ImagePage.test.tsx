// @vitest-environment happy-dom

import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImagePage } from './ImagePage';

const mocks = vi.hoisted(() => ({
  createTask: vi.fn(),
  navigate: vi.fn(),
  uploadFile: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('@/stores/task-store', () => ({
  useTaskStore: (selector: (state: { createTask: typeof mocks.createTask }) => unknown) =>
    selector({ createTask: mocks.createTask }),
}));

vi.mock('@/lib/upload-file', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/upload-file')>();
  return { ...actual, uploadFile: mocks.uploadFile };
});

vi.mock('@/components/ui/toast', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui/toast')>();
  return { ...actual, useToast: () => ({ show: mocks.toast }) };
});

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => mocks.navigate };
});

beforeEach(() => {
  mocks.createTask.mockReset();
  mocks.navigate.mockReset();
  mocks.uploadFile.mockReset();
  mocks.toast.mockReset();
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn((file: File) => `blob:${file.name}`),
    revokeObjectURL: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ImagePage task creation', () => {
  it('never uploads more than the five-file task boundary across selections', async () => {
    const user = userEvent.setup();
    mocks.uploadFile.mockImplementation(async (file: File) => ({
      fileId: `file_${file.name}`,
      filename: file.name,
      mimetype: file.type,
      size: file.size,
    }));
    render(<ImagePage />);
    const input = screen.getByLabelText('添加图片');

    await user.upload(
      input,
      [1, 2, 3, 4].map((number) =>
        new File([String(number)], `first-${number}.png`, { type: 'image/png' }),
      ),
    );
    await waitFor(() => expect(mocks.uploadFile).toHaveBeenCalledTimes(4));
    await user.upload(
      input,
      [1, 2, 3].map((number) =>
        new File([String(number)], `second-${number}.png`, { type: 'image/png' }),
      ),
    );

    await waitFor(() => expect(mocks.uploadFile).toHaveBeenCalledTimes(5));
  });

  it('keeps lock-subject submission disabled until a ready subject exists', async () => {
    const user = userEvent.setup();
    render(<ImagePage />);

    await user.click(screen.getByRole('button', { name: /锁定主角/ }));
    await user.type(
      screen.getByRole('textbox', { name: '描述你想要的最终画面' }),
      '把主角放到夏日海边',
    );

    expect(screen.getByRole('button', { name: '开始生成' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByText('请先添加一张清晰的主角图')).toBeTruthy();
  });

  it('orders the selected subject first, creates once, then clears only transient draft fields', async () => {
    const user = userEvent.setup();
    mocks.uploadFile
      .mockResolvedValueOnce({
        fileId: 'file_style',
        filename: 'style.png',
        mimetype: 'image/png',
        size: 100,
      })
      .mockResolvedValueOnce({
        fileId: 'file_subject',
        filename: 'subject.png',
        mimetype: 'image/png',
        size: 200,
      });
    let resolveCreate!: (value: { taskId: string }) => void;
    mocks.createTask.mockReturnValue(
      new Promise((resolve) => {
        resolveCreate = resolve;
      }),
    );
    render(<ImagePage />);

    await user.click(screen.getByRole('button', { name: /锁定主角/ }));
    await user.type(
      screen.getByRole('textbox', { name: '描述你想要的最终画面' }),
      '把主角放到夏日海边',
    );
    await user.upload(screen.getByLabelText('添加图片'), [
      new File(['style'], 'style.png', { type: 'image/png' }),
      new File(['subject'], 'subject.png', { type: 'image/png' }),
    ]);
    await waitFor(() => expect(mocks.uploadFile).toHaveBeenCalledTimes(2));
    await user.click(screen.getByRole('button', { name: '设为主角' }));

    const submit = screen.getByRole('button', { name: '开始生成' });
    expect(submit.hasAttribute('disabled')).toBe(false);
    await user.dblClick(submit);

    expect(mocks.createTask).toHaveBeenCalledTimes(1);
    expect(mocks.createTask).toHaveBeenCalledWith(
      expect.stringContaining('生成图片：把主角放到夏日海边'),
      ['file_subject', 'file_style'],
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      expect.objectContaining({
        model: 'nano_banana_2',
        aspectRatio: '1:1',
        imageCount: 2,
        mode: 'lock_subject',
        subjectFileId: 'file_subject',
        goal: 'lock_subject',
        visiblePrompt: '把主角放到夏日海边',
      }),
    );

    resolveCreate({ taskId: 'tsk_image_created' });
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/image?task=tsk_image_created'));

    expect(
      (screen.getByRole('textbox', { name: '描述你想要的最终画面' }) as HTMLTextAreaElement)
        .value,
    ).toBe('');
    const goals = screen.getByRole('group', { name: '今天想做什么图' });
    expect(
      within(goals).getByRole('button', { name: /锁定主角/ }).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(screen.getByRole('button', { name: '添加主角图' })).toBeTruthy();
  });

  it('retains the complete draft when task creation fails', async () => {
    const user = userEvent.setup();
    mocks.uploadFile.mockResolvedValueOnce({
      fileId: 'file_subject',
      filename: 'subject.png',
      mimetype: 'image/png',
      size: 200,
    });
    mocks.createTask.mockResolvedValueOnce({ error: '服务暂时不可用' });
    render(<ImagePage />);

    await user.click(screen.getByRole('button', { name: /锁定主角/ }));
    await user.type(
      screen.getByRole('textbox', { name: '描述你想要的最终画面' }),
      '把主角放到夏日海边',
    );
    await user.upload(
      screen.getByLabelText('添加图片'),
      new File(['subject'], 'subject.png', { type: 'image/png' }),
    );
    await waitFor(() => expect(screen.getByText('subject.png')).toBeTruthy());
    await user.click(screen.getByRole('button', { name: '开始生成' }));

    expect(
      (screen.getByRole('textbox', { name: '描述你想要的最终画面' }) as HTMLTextAreaElement)
        .value,
    ).toBe('把主角放到夏日海边');
    expect(screen.getByText('subject.png')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('服务暂时不可用');
  });
});
