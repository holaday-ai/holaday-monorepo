// @vitest-environment happy-dom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VideoPage } from './VideoPage';

const mocks = vi.hoisted(() => ({
  createTask: vi.fn(),
  refreshTasks: vi.fn(),
  selectTask: vi.fn(),
  togglePin: vi.fn(),
  toast: vi.fn(),
  capabilityQuery: vi.fn(),
  taskListQuery: vi.fn(),
  onboardingStatusQuery: vi.fn(),
}));

vi.mock('@/stores/task-store', () => ({
  useTaskStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      tasks: [],
      refreshTasks: mocks.refreshTasks,
      selectTask: mocks.selectTask,
      togglePin: mocks.togglePin,
      createTask: mocks.createTask,
      progressByTask: {},
      subStatusByTask: {},
      streamingByTask: {},
      awaitingUserByTask: {},
      stepsByTask: {},
    }),
}));

vi.mock('@/components/ui/toast', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui/toast')>();
  return { ...actual, useToast: () => ({ show: mocks.toast }) };
});

vi.mock('@/lib/trpc', () => ({
  trpc: {
    videoEditing: {
      capability: { query: mocks.capabilityQuery },
      createProject: { mutate: vi.fn() },
    },
    tasks: {
      list: { query: mocks.taskListQuery },
      confirmVideo: { mutate: vi.fn() },
    },
    videoOnboarding: {
      status: { query: mocks.onboardingStatusQuery },
      authorize: { mutate: vi.fn() },
      deleteAssets: { mutate: vi.fn() },
      enrollVoice: { mutate: vi.fn() },
      setBaseVideo: { mutate: vi.fn() },
    },
  },
}));

function renderPage(): void {
  render(
    <MemoryRouter initialEntries={['/video']}>
      <VideoPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mocks.createTask.mockReset().mockResolvedValue({ taskId: 'tsk_video_scenario' });
  mocks.refreshTasks.mockReset();
  mocks.selectTask.mockReset();
  mocks.togglePin.mockReset();
  mocks.toast.mockReset();
  mocks.capabilityQuery.mockReset().mockResolvedValue({ enabled: false });
  mocks.taskListQuery.mockReset().mockResolvedValue({ tasks: [], nextCursor: null });
  mocks.onboardingStatusQuery.mockReset().mockResolvedValue({
    hasVoice: false,
    hasBaseVideo: false,
    authorized: false,
    baseVideoIssue: null,
  });
});

afterEach(() => {
  cleanup();
});

describe('VideoPage scenario-first production wiring', () => {
  it('switches all four scenario cards onto their real production lanes without side effects', async () => {
    const user = userEvent.setup();
    renderPage();

    const prompt = await screen.findByRole('textbox', { name: '告诉 HOLA DAY 你的重点' });
    expect((prompt as HTMLTextAreaElement).value).toContain('香水产品的高光短片');

    await user.click(screen.getByRole('button', { name: /生活方式 Vlog/ }));
    expect(
      (screen.getByRole('textbox', { name: '告诉 HOLA DAY 你的重点' }) as HTMLTextAreaElement)
        .value,
    ).toContain('清晨湖畔散步');

    await user.click(screen.getByRole('button', { name: /复刻一段动作/ }));
    expect(screen.getByRole('heading', { name: '主角照片' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '参考视频' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /IP 人物口播/ }));
    expect(await screen.findByRole('heading', { name: 'IP人物视频素材准备' })).toBeTruthy();

    expect(mocks.createTask).not.toHaveBeenCalled();
  });

  it('submits the selected lifestyle scenario through the existing quote-before-charge task options', async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByRole('textbox', { name: '告诉 HOLA DAY 你的重点' });
    await user.click(screen.getByRole('button', { name: /生活方式 Vlog/ }));
    await user.click(screen.getByRole('button', { name: '生成这条视频' }));

    await waitFor(() => expect(mocks.createTask).toHaveBeenCalledTimes(1));
    const call = mocks.createTask.mock.calls[0];
    expect(call?.[0]).toContain('清晨湖畔散步');
    expect(call?.[6]).toEqual({
      tab: 'normal',
      model: 'veo_fast',
      style: 'auto',
      aspectRatio: '9:16',
      resolution: '1080p',
      durationSeconds: 8,
    });
    expect(mocks.toast).toHaveBeenCalledWith('已提交，请确认报价后开始制作', 'info', 3000);
  });
});
