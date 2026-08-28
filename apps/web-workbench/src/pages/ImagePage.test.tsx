// @vitest-environment happy-dom

import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImagePage } from './ImagePage';

const mocks = vi.hoisted(() => ({
  createTask: vi.fn(),
  refreshTasks: vi.fn(),
  tasks: [] as Array<Record<string, unknown>>,
  selectedTaskId: null as string | null,
  navigate: vi.fn(),
  uploadFile: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('@/stores/task-store', () => ({
  useTaskStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      createTask: mocks.createTask,
      refreshTasks: mocks.refreshTasks,
      tasks: mocks.tasks,
      selectedTaskId: mocks.selectedTaskId,
    }),
}));

vi.mock('@/lib/upload-file', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/upload-file')>();
  return { ...actual, uploadFile: mocks.uploadFile };
});

vi.mock('@/components/ui/toast', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui/toast')>();
  return { ...actual, useToast: () => ({ show: mocks.toast }) };
});

vi.mock('@/components/image/ImageHistory', () => ({
  ImageHistory: () => <div data-testid="image-history" />,
}));

vi.mock('@/components/image/ImageResultPanel', () => ({
  ImageResultPanel: () => <div data-testid="image-result" />,
}));

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => mocks.navigate };
});

beforeEach(() => {
  window.history.replaceState({}, '', '/image');
  mocks.createTask.mockReset();
  mocks.refreshTasks.mockReset();
  mocks.tasks = [];
  mocks.selectedTaskId = null;
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
  it('uses one page-level heading and keeps the goal question at level two', () => {
    render(<ImagePage />);

    const pageHeadings = screen.getAllByRole('heading', { level: 1 });
    expect(pageHeadings).toHaveLength(1);
    expect(pageHeadings[0]?.textContent).toBe('图片任务');
    expect(screen.getByRole('heading', { level: 2, name: '今天想做什么图？' })).toBeTruthy();
  });

  it('groups generation settings and submission inside the creation region', () => {
    render(<ImagePage />);

    const creationRegion = screen.getByRole('region', { name: '图片创作区' });
    expect(within(creationRegion).getByRole('button', { name: /生成设置/ })).toBeTruthy();
    expect(within(creationRegion).getByRole('button', { name: '开始生成' })).toBeTruthy();
  });

  it('refreshes a completed image task once when its result metadata has not arrived yet', async () => {
    window.history.replaceState({}, '', '/image?task=tsk_image_sync');
    mocks.tasks = [
      {
        taskId: 'tsk_image_sync',
        intent: '生成图片：夏日商品海报',
        title: null,
        status: 'completed',
        tickCount: 1,
        createdAt: new Date('2026-08-28T06:00:00.000Z'),
        executionMode: 'image',
        imageOptions: {
          model: 'nano_banana_2',
          aspectRatio: '4:3',
          imageCount: 2,
          mode: 'free',
          goal: 'commercial',
          commercialUse: 'product',
          visiblePrompt: '夏日商品海报',
        },
      },
    ];

    render(<ImagePage />);

    await waitFor(() => expect(mocks.refreshTasks).toHaveBeenCalledTimes(1));
  });

  it('refreshes again when navigation switches between completed tasks with the same status', async () => {
    window.history.replaceState({}, '', '/image?task=tsk_image_first');
    mocks.tasks = [
      {
        taskId: 'tsk_image_first',
        intent: '生成图片：第一张',
        title: null,
        status: 'completed',
        tickCount: 1,
        createdAt: new Date('2026-08-28T06:00:00.000Z'),
        executionMode: 'image',
        imageOptions: {
          model: 'nano_banana_2',
          aspectRatio: '1:1',
          imageCount: 1,
          mode: 'free',
          goal: 'inspiration',
          visiblePrompt: '第一张',
        },
      },
    ];

    const view = render(<ImagePage />);
    await waitFor(() => expect(mocks.refreshTasks).toHaveBeenCalledTimes(1));

    window.history.replaceState({}, '', '/image?task=tsk_image_second');
    mocks.tasks = [
      {
        ...mocks.tasks[0],
        taskId: 'tsk_image_second',
        intent: '生成图片：第二张',
        imageOptions: {
          ...(mocks.tasks[0]?.imageOptions as Record<string, unknown>),
          visiblePrompt: '第二张',
        },
      },
    ];
    view.rerender(<ImagePage />);

    await waitFor(() => expect(mocks.refreshTasks).toHaveBeenCalledTimes(2));
  });

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
      [1, 2, 3, 4].map(
        (number) => new File([String(number)], `first-${number}.png`, { type: 'image/png' }),
      ),
    );
    await waitFor(() => expect(mocks.uploadFile).toHaveBeenCalledTimes(4));
    await user.upload(
      input,
      [1, 2, 3].map(
        (number) => new File([String(number)], `second-${number}.png`, { type: 'image/png' }),
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

  it('replaces the current subject when a new anchor image is chosen', async () => {
    const user = userEvent.setup();
    mocks.uploadFile
      .mockResolvedValueOnce({
        fileId: 'file_first_subject',
        filename: 'first-subject.png',
        mimetype: 'image/png',
        size: 100,
      })
      .mockResolvedValueOnce({
        fileId: 'file_second_subject',
        filename: 'second-subject.png',
        mimetype: 'image/png',
        size: 120,
      });
    render(<ImagePage />);

    await user.click(screen.getByRole('button', { name: /锁定主角/ }));
    const input = screen.getByLabelText('添加图片');
    await user.upload(input, new File(['first'], 'first-subject.png', { type: 'image/png' }));
    await waitFor(() => expect(screen.getByText('first-subject.png')).toBeTruthy());

    expect(screen.getByRole('button', { name: '更换主角图' })).toBeTruthy();
    await user.upload(input, new File(['second'], 'second-subject.png', { type: 'image/png' }));

    await waitFor(() => expect(screen.getByText('second-subject.png')).toBeTruthy());
    expect(screen.queryByText('first-subject.png')).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:first-subject.png');
  });

  it('freezes subject and goal mutations while a replacement upload is pending', async () => {
    const user = userEvent.setup();
    let resolveReplacement!: (value: {
      fileId: string;
      filename: string;
      mimetype: string;
      size: number;
    }) => void;
    mocks.uploadFile
      .mockResolvedValueOnce({
        fileId: 'file_first_subject',
        filename: 'first-subject.png',
        mimetype: 'image/png',
        size: 100,
      })
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveReplacement = resolve;
        }),
      );
    render(<ImagePage />);

    await user.click(screen.getByRole('button', { name: /锁定主角/ }));
    const input = screen.getByLabelText('添加图片');
    await user.upload(input, new File(['first'], 'first-subject.png', { type: 'image/png' }));
    await waitFor(() => expect(screen.getByText('first-subject.png')).toBeTruthy());

    await user.upload(input, new File(['second'], 'second-subject.png', { type: 'image/png' }));
    await waitFor(() => expect(screen.getByText('second-subject.png')).toBeTruthy());

    expect(screen.getByRole('button', { name: '移除主角图' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: '更换主角图' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: /灵感创作/ }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: '设为主角' }).hasAttribute('disabled')).toBe(true);
    expect(
      screen.getByRole('button', { name: '移除附件：first-subject.png' }).hasAttribute('disabled'),
    ).toBe(true);

    resolveReplacement({
      fileId: 'file_second_subject',
      filename: 'second-subject.png',
      mimetype: 'image/png',
      size: 120,
    });

    await waitFor(() => expect(screen.queryByText('first-subject.png')).toBeNull());
    expect(screen.getByText('second-subject.png')).toBeTruthy();
  });

  it('keeps the current subject when its replacement upload fails', async () => {
    const user = userEvent.setup();
    mocks.uploadFile
      .mockResolvedValueOnce({
        fileId: 'file_first_subject',
        filename: 'first-subject.png',
        mimetype: 'image/png',
        size: 100,
      })
      .mockRejectedValueOnce(new Error('上传失败'));
    render(<ImagePage />);

    await user.click(screen.getByRole('button', { name: /锁定主角/ }));
    const input = screen.getByLabelText('添加图片');
    await user.upload(input, new File(['first'], 'first-subject.png', { type: 'image/png' }));
    await waitFor(() => expect(screen.getByText('first-subject.png')).toBeTruthy());

    await user.upload(input, new File(['second'], 'second-subject.png', { type: 'image/png' }));

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('上传失败'));
    expect(screen.getByText('first-subject.png')).toBeTruthy();
    expect(screen.queryByText('second-subject.png')).toBeNull();
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith('blob:first-subject.png');
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
    await waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith('/image?task=tsk_image_created'),
    );

    expect(
      (screen.getByRole('textbox', { name: '描述你想要的最终画面' }) as HTMLTextAreaElement).value,
    ).toBe('');
    const goals = screen.getByRole('group', { name: '今天想做什么图' });
    expect(
      within(goals)
        .getByRole('button', { name: /锁定主角/ })
        .getAttribute('aria-pressed'),
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
      (screen.getByRole('textbox', { name: '描述你想要的最终画面' }) as HTMLTextAreaElement).value,
    ).toBe('把主角放到夏日海边');
    expect(screen.getByText('subject.png')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('服务暂时不可用');
  });
});
