// @vitest-environment happy-dom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UiTask } from '@/types/task';
import { ImageHistory } from './ImageHistory';

const mocks = vi.hoisted(() => ({ list: vi.fn() }));

vi.mock('@/lib/trpc', () => ({ trpc: { tasks: { list: { query: mocks.list } } } }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ show: vi.fn() }) }));
vi.mock('@/stores/task-store', () => ({
  // Rows below are already UiTask-shaped; the store normalizer is not under test.
  normalizeTaskListRows: (rows: unknown) => (Array.isArray(rows) ? rows : []),
  normalizeTaskListCursor: (cursor: unknown) => (typeof cursor === 'number' ? cursor : null),
  useTaskStore: (selector: (state: { togglePin: () => Promise<void> }) => unknown) =>
    selector({ togglePin: async () => {} }),
}));
vi.mock('./ImageResultPanel', () => ({
  ImageResultPanel: ({ row }: { row: { taskId: string } }) => (
    <div data-testid="image-history-row">{row.taskId}</div>
  ),
}));

const pngAttachment = {
  fileId: 'fil_png',
  filename: 'poster.png',
  mimetype: 'image/png',
  sizeBytes: 1024,
  downloadUrl: '/api/files/fil_png/download',
} as unknown as NonNullable<UiTask['attachments']>[number];

function task(overrides: Partial<UiTask>): UiTask {
  return {
    taskId: 'tsk',
    intent: '任务',
    title: null,
    status: 'completed',
    tickCount: 0,
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    ...overrides,
  } as UiTask;
}

beforeEach(() => {
  mocks.list.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('ImageHistory tab isolation', () => {
  it('shows only image tasks from a mixed task list', async () => {
    mocks.list.mockResolvedValue({
      tasks: [
        task({
          taskId: 'tsk_image',
          executionMode: 'image',
          imageOptions: { goal: 'free', model: 'auto', aspectRatio: '1:1', imageCount: 1 } as never,
          attachments: [pngAttachment],
        }),
        // A chat task that happens to produce a PNG must stay out of the image tab.
        task({ taskId: 'tsk_chat', executionMode: 'generate', attachments: [pngAttachment] }),
        task({ taskId: 'tsk_browser', executionMode: 'browser' }),
        task({ taskId: 'tsk_video', videoType: 'normal' }),
      ],
      nextCursor: null,
    });
    render(<ImageHistory onContinue={() => {}} />);
    await waitFor(() => expect(screen.getAllByTestId('image-history-row')).toHaveLength(1));
    expect(screen.getByTestId('image-history-row').textContent).toBe('tsk_image');
  });

  it('shows the image empty state when the page holds only other task kinds', async () => {
    mocks.list.mockResolvedValue({
      tasks: [task({ taskId: 'tsk_chat', executionMode: 'generate' })],
      nextCursor: null,
    });
    render(<ImageHistory onContinue={() => {}} />);
    await waitFor(() => expect(screen.getByText('暂无图片作品，先在上方创建一张。')).toBeTruthy());
    expect(screen.queryByTestId('image-history-row')).toBeNull();
  });
});
