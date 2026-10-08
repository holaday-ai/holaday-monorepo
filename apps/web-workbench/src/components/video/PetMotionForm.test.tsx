// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PetMotionForm } from './PetMotionForm';
const mocks = vi.hoisted(() => ({ createTask: vi.fn(), uploadFile: vi.fn(), toast: vi.fn() }));
vi.mock('@/stores/task-store', () => ({
  useTaskStore: (select: (state: unknown) => unknown) => select({ createTask: mocks.createTask }),
}));
vi.mock('@/lib/upload-file', () => ({
  uploadFile: mocks.uploadFile,
  uploadFailureMessage: () => '上传失败',
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ show: mocks.toast }) }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
describe('existing pet i2v submission', () => {
  it('passes the owner uploaded photo and explicit pet model without a clone clip; only quotes once', async () => {
    mocks.uploadFile.mockResolvedValue({ fileId: 'file_pet', filename: 'cat.png' });
    let finish!: (value: { taskId: string }) => void;
    mocks.createTask.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const created = vi.fn();
    const user = userEvent.setup();
    render(<PetMotionForm onTaskCreated={created} />);
    await user.upload(
      screen.getByLabelText('宠物照片'),
      new File(['photo'], 'cat.png', { type: 'image/png' }),
    );
    await user.type(screen.getByLabelText('宠物动作'), '轻轻眨眼');
    const button = screen.getByRole('button', { name: '获取宠物视频报价' });
    await user.dblClick(button);
    expect(mocks.createTask).toHaveBeenCalledTimes(1);
    expect(mocks.createTask.mock.calls[0]?.[6]).toEqual({
      tab: 'pet',
      petModel: 'wan_i2v',
      petImageFileId: 'file_pet',
      durationSeconds: 5,
      resolution: '1080p',
      aspectRatio: '9:16',
    });
    finish({ taskId: 'tsk_pet' });
    await waitFor(() => expect(created).toHaveBeenCalledWith('tsk_pet'));
  });
});
