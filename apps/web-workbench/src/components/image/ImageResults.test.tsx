// @vitest-environment happy-dom

import type { ImageHistoryRow } from '@/lib/image-history-row';
import type { UiTask } from '@/types/task';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImageResultPanel } from './ImageResultPanel';

const mocks = vi.hoisted(() => ({
  saveOutput: vi.fn(),
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    files: {
      saveOutput: { mutate: mocks.saveOutput },
    },
  },
}));

vi.mock('@/components/FileDownloadCard', () => ({
  FileDownloadCard: ({ payload }: { payload: { filename: string } }) => (
    <div data-testid="download-card">{payload.filename}</div>
  ),
}));

function row(overrides: Partial<ImageHistoryRow> = {}): ImageHistoryRow {
  return {
    taskId: 'tsk_image',
    title: '海边主角图',
    intent: '生成图片：把背景换成海边',
    status: 'completed',
    createdAt: new Date('2026-08-28T00:00:00.000Z'),
    starred: false,
    starredAt: null,
    imageOptions: {
      goal: 'lock_subject',
      mode: 'lock_subject',
      model: 'nano_banana_pro',
      style: 'vibrant',
      aspectRatio: '3:4',
      imageCount: 2,
      subjectFileId: 'file_subject',
      changeTargets: ['background'],
      visiblePrompt: '把背景换成海边',
    },
    subjectConsistency: { checked: 2, passed: 2, failed: 0 },
    downloads: [
      {
        fileId: 'file_result',
        filename: 'result.png',
        downloadUrl: '/api/files/file_result/download',
        size: 123,
        expiresAt: '2099-09-01T00:00:00.000Z',
      },
    ],
    ...overrides,
  };
}

function task(overrides: Partial<UiTask> = {}): UiTask {
  return {
    taskId: 'tsk_image',
    intent: '生成图片：把背景换成海边',
    title: null,
    status: 'executing',
    tickCount: 0,
    createdAt: new Date(),
    executionMode: 'image',
    ...overrides,
  };
}

beforeEach(() => {
  mocks.saveOutput.mockReset();
});

afterEach(cleanup);

describe('ImageResultPanel', () => {
  it.each([
    ['queued', '正在排队'],
    ['executing', '正在生成'],
    ['failed', '生成失败'],
  ] as const)('renders the truthful %s state', (status, copy) => {
    render(<ImageResultPanel task={task({ status })} onContinue={vi.fn()} />);
    expect(screen.getByText(copy)).toBeTruthy();
    expect(screen.getByRole('status').getAttribute('aria-live')).toBe('polite');
  });

  it('shows a verified badge only for a complete positive consistency check', () => {
    const { rerender } = render(
      <ImageResultPanel task={task({ status: 'completed' })} row={row()} onContinue={vi.fn()} />,
    );
    expect(screen.getByText('已核对主角一致性')).toBeTruthy();

    rerender(
      <ImageResultPanel
        task={task({ status: 'partial_success' })}
        row={row({
          status: 'partial_success',
          subjectConsistency: { checked: 2, passed: 1, failed: 1 },
        })}
        onContinue={vi.fn()}
      />,
    );
    expect(screen.queryByText('已核对主角一致性')).toBeNull();
    expect(screen.getByText('已筛除 1 张')).toBeTruthy();
  });

  it('does not turn every compact history card into a live region', () => {
    const { container } = render(
      <ImageResultPanel row={row()} compact onContinue={vi.fn()} />,
    );

    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it('saves an available output once and disables duplicate submission', async () => {
    const user = userEvent.setup();
    mocks.saveOutput.mockResolvedValue({ ok: true });
    render(
      <ImageResultPanel task={task({ status: 'completed' })} row={row()} onContinue={vi.fn()} />,
    );

    await user.click(screen.getByRole('button', { name: '保存 result.png 到文件库' }));

    expect(mocks.saveOutput).toHaveBeenCalledWith({ fileId: 'file_result' });
    expect(
      screen.getByRole('button', { name: 'result.png 已保存到文件库' }).hasAttribute('disabled'),
    ).toBe(true);
  });

  it('keeps useful continuation actions on an expired result without rendering a stale download', () => {
    const activeDownload = row().downloads[0];
    if (!activeDownload) throw new Error('expected active image download');
    const expired = row({
      downloads: [
        {
          ...activeDownload,
          expiresAt: '2026-08-27T00:00:00.000Z',
        },
      ],
    });
    render(
      <ImageResultPanel
        task={task({ status: 'completed' })}
        row={expired}
        now={Date.parse('2026-08-28T00:00:00.000Z')}
        onContinue={vi.fn()}
      />,
    );

    expect(screen.getByText('成片已过期')).toBeTruthy();
    expect(screen.queryByTestId('download-card')).toBeNull();
    expect(screen.getByRole('button', { name: '保持主角' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '复用设置' })).toBeTruthy();
  });

  it('keeps every result and history action at least 44px tall', () => {
    const resultSource = readFileSync(
      resolve(process.cwd(), 'src/components/image/ImageResultPanel.tsx'),
      'utf8',
    );
    const historySource = readFileSync(
      resolve(process.cwd(), 'src/components/image/ImageHistory.tsx'),
      'utf8',
    );

    expect(resultSource).not.toContain('min-h-10');
    expect(historySource).not.toContain('min-h-10');
  });
});
