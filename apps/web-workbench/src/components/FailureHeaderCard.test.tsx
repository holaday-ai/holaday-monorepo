// @vitest-environment happy-dom

import { useTaskFailureContext } from '@/hooks/useTaskFailureContext';
import {
  type TaskFailureContext,
  canLoadFailureContext,
  refundStatusCopy,
  retryAttachmentNote,
} from '@/lib/task-failure-recovery';
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FailureHeaderCard } from './FailureHeaderCard';

const mocks = vi.hoisted(() => ({ failureContext: vi.fn() }));

vi.mock('@/lib/trpc', () => ({
  trpc: { taskRecovery: { failureContext: { query: mocks.failureContext } } },
}));

afterEach(() => {
  cleanup();
});
beforeEach(() => {
  mocks.failureContext.mockReset();
});

function context(overrides: Partial<TaskFailureContext> = {}): TaskFailureContext {
  return {
    taskId: 'tsk_failed',
    refund: { state: 'refunded', refundedAt: '2026-10-04T08:00:00.000Z' },
    inputFiles: [{ fileId: 'fil_a', filename: '报价单.xlsx', mimetype: 'application/vnd.ms-excel' }],
    unavailableInputCount: 0,
    ...overrides,
  };
}

describe('FailureHeaderCard', () => {
  it('shows the friendly reason with refund status and attachment note', async () => {
    const onRetry = vi.fn();
    render(
      <FailureHeaderCard
        status="failed"
        errorText="429 rate limit exceeded"
        onRetry={onRetry}
        refund={refundStatusCopy('refunded')}
        attachmentNote={retryAttachmentNote(context())}
      />,
    );
    expect(screen.getByRole('alert').textContent).not.toContain('429 rate limit exceeded');
    const refund = screen.getByTestId('failure-refund-status');
    expect(refund.textContent).toContain('额度已退还');
    expect(refund.dataset.tone).toBe('positive');
    expect(screen.getByTestId('failure-retry-attachments').textContent).toContain('原来的 1 个附件');
    await userEvent.click(screen.getByRole('button', { name: '重新执行任务' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('omits the refund line when the task was never charged', () => {
    render(<FailureHeaderCard status="failed" errorText="boom" refund={refundStatusCopy('not_charged')} />);
    expect(screen.queryByTestId('failure-refund-status')).toBeNull();
  });

  it('hides the attachment note when retry is not offered', () => {
    render(
      <FailureHeaderCard
        status="failed"
        errorText="FILE_FORMAT_UNSUPPORTED:dwg"
        attachmentNote={retryAttachmentNote(context())}
      />,
    );
    expect(screen.queryByTestId('failure-retry-attachments')).toBeNull();
    expect(screen.queryByRole('button', { name: '重新执行任务' })).toBeNull();
  });

  it('disables the retry button while a retry is in flight', () => {
    render(<FailureHeaderCard status="failed" errorText="boom" onRetry={() => {}} retrying />);
    expect((screen.getByRole('button', { name: '正在重新执行任务' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('task failure recovery copy', () => {
  it('maps every ledger state to honest copy', () => {
    expect(refundStatusCopy('pending')?.label).toBe('额度退还中');
    expect(refundStatusCopy('not_refundable')?.label).toBe('额度不退还');
    expect(refundStatusCopy('contact_support')?.detail).toContain('support@holaday.ai');
    expect(refundStatusCopy(undefined)).toBeNull();
  });

  it('describes partially expired attachments', () => {
    expect(retryAttachmentNote(context({ unavailableInputCount: 2 }))).toBe(
      '重新执行会带上 1 个附件；另有 2 个已失效，需要重新上传。',
    );
    expect(retryAttachmentNote(context({ inputFiles: [], unavailableInputCount: 1 }))).toContain('需要重新上传');
    expect(retryAttachmentNote(context({ inputFiles: [] }))).toBeNull();
  });

  it('only loads context for persisted failed or cancelled tasks', () => {
    expect(canLoadFailureContext('tsk_1', 'failed')).toBe(true);
    expect(canLoadFailureContext('tsk_1', 'cancelled')).toBe(true);
    expect(canLoadFailureContext('tsk_1', 'completed')).toBe(false);
    expect(canLoadFailureContext('local_pending_x', 'failed')).toBe(false);
    expect(canLoadFailureContext(undefined, 'failed')).toBe(false);
  });
});

describe('useTaskFailureContext', () => {
  it('loads once for a failed task and reuses it on ensure()', async () => {
    mocks.failureContext.mockResolvedValue(context());
    const { result } = renderHook(() => useTaskFailureContext('tsk_failed', 'failed'));
    await waitFor(() => expect(result.current.context?.refund.state).toBe('refunded'));
    let ensured: TaskFailureContext | null = null;
    await act(async () => {
      ensured = await result.current.ensure();
    });
    expect(ensured).toEqual(context());
    expect(mocks.failureContext).toHaveBeenCalledTimes(1);
    expect(mocks.failureContext).toHaveBeenCalledWith({ taskId: 'tsk_failed' });
  });

  it('does not query for running tasks', async () => {
    const running = renderHook(() => useTaskFailureContext('tsk_live', 'executing'));
    expect(mocks.failureContext).not.toHaveBeenCalled();
    expect(await running.result.current.ensure()).toBeNull();
  });

  it('degrades to null when the context request fails', async () => {
    mocks.failureContext.mockRejectedValue(new Error('network'));
    const failed = renderHook(() => useTaskFailureContext('tsk_failed', 'failed'));
    let ensured: TaskFailureContext | null = context();
    await act(async () => {
      ensured = await failed.result.current.ensure();
    });
    expect(ensured).toBeNull();
    expect(failed.result.current.context).toBeNull();
  });
});

describe('media quality failure recovery', () => {
  it('shows the verified refund state and an accessible regenerate action without browser advice', async () => {
    const retry = vi.fn();
    render(<FailureHeaderCard status="failed" errorText="画面出现了未要求的文字或品牌，视频未交付。请调整描述后重新生成。" executionMode="video_creation" refund={refundStatusCopy('refunded')} onRetry={retry} />);
    expect(screen.getByTestId('failure-refund-status').textContent).toContain('额度已退还');
    expect(screen.queryByText(/换个网址/)).toBeNull();
    await userEvent.setup().click(screen.getByRole('button', { name: '重新生成' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
