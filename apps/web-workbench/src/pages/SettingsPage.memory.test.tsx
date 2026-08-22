// @vitest-environment happy-dom

import { ToastProvider } from '@/components/ui/toast';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsPage } from './SettingsPage';

const trpcMocks = vi.hoisted(() => ({
  list: vi.fn(),
  delete: vi.fn(),
  clear: vi.fn(),
}));

vi.mock('@/components/ApiKeysSection', () => ({ ApiKeysSection: () => null }));
vi.mock('@/components/notifications/NotificationsSection', () => ({
  NotificationsSection: () => null,
}));
vi.mock('@/stores/theme-store', () => ({
  useTheme: () => ({ mode: 'light', setMode: vi.fn() }),
}));
vi.mock('@/lib/trpc', () => ({
  trpc: {
    memory: {
      list: { query: trpcMocks.list },
      delete: { mutate: trpcMocks.delete },
      clear: { mutate: trpcMocks.clear },
    },
  },
}));

const memoryRows = [
  {
    externalId: 'mem_preference_1',
    category: 'preference',
    keyName: '回答风格',
    value:
      '偏好简洁直接的中文回答，先说明结论，再补充必要证据和下一步；遇到需要产品判断的问题时，要说明取舍，但不要用大段背景铺垫。',
    expiresAt: null,
    updatedAt: '2026-08-22T04:00:00.000Z',
  },
  {
    externalId: 'mem_preference_2',
    category: 'preference',
    keyName: '网站选择',
    value: '用户明确要求不要打开百度。',
    expiresAt: null,
    updatedAt: '2026-08-21T04:00:00.000Z',
  },
  {
    externalId: 'mem_site',
    category: 'site_state',
    keyName: 'OpenAI 新闻页面',
    value: '浏览器访问可能遇到 Cloudflare 验证。',
    expiresAt: '2026-09-01T04:00:00.000Z',
    updatedAt: '2026-08-20T04:00:00.000Z',
  },
  {
    externalId: 'mem_execution',
    category: 'execution_tip',
    keyName: '文件交付',
    value: '生成失败时应解释原因并提供可用替代格式。',
    expiresAt: null,
    updatedAt: '2026-08-19T04:00:00.000Z',
  },
  {
    externalId: 'mem_history_1',
    category: 'task_history',
    keyName: '股市任务',
    value: '已完成关注股票的风险证据核验。',
    expiresAt: null,
    updatedAt: '2026-08-18T04:00:00.000Z',
  },
  {
    externalId: 'mem_history_2',
    category: 'task_history',
    keyName: '今日能量',
    value: '偏好轻松、亮丽但不过度刺激的页面风格。',
    expiresAt: null,
    updatedAt: '2026-08-17T04:00:00.000Z',
  },
];

function renderSettings(): void {
  render(
    <MemoryRouter initialEntries={['/settings']}>
      <ToastProvider>
        <SettingsPage />
      </ToastProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  trpcMocks.list.mockResolvedValue({ memories: memoryRows });
  trpcMocks.delete.mockResolvedValue({ ok: true });
  trpcMocks.clear.mockResolvedValue({ ok: true });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('SettingsPage AI memory library', () => {
  it('summarizes the memory bank before the long list', async () => {
    renderSettings();

    expect(await screen.findByText('6 条记忆')).toBeTruthy();
    expect(screen.getByText('4 类信息')).toBeTruthy();
    expect(screen.getByText('相关任务中按需使用')).toBeTruthy();
  });

  it('filters memories by category with visible counts', async () => {
    const user = userEvent.setup();
    renderSettings();

    expect(await screen.findByRole('button', { name: '全部 6' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '偏好 2' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '网站状态 1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '执行经验 1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '任务历史 2' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: '偏好 2' }));

    expect(screen.getByText('回答风格')).toBeTruthy();
    expect(screen.getByText('网站选择')).toBeTruthy();
    expect(screen.queryByText('OpenAI 新闻页面')).toBeNull();
    expect(screen.getByRole('button', { name: '偏好 2' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('searches memory titles and details locally', async () => {
    const user = userEvent.setup();
    renderSettings();

    const search = await screen.findByRole('searchbox', { name: '搜索 AI 记忆' });
    await user.type(search, '百度');

    expect(screen.getByText('网站选择')).toBeTruthy();
    expect(screen.queryByText('回答风格')).toBeNull();
    expect(screen.queryByText('股市任务')).toBeNull();
  });

  it('keeps long memories compact until the user expands them', async () => {
    const user = userEvent.setup();
    renderSettings();

    const expand = await screen.findByRole('button', { name: '展开 回答风格' });
    expect(expand.getAttribute('aria-expanded')).toBe('false');

    await user.click(expand);

    const collapse = screen.getByRole('button', { name: '收起 回答风格' });
    expect(collapse.getAttribute('aria-expanded')).toBe('true');
  });

  it('shows memory freshness and keeps clear-all inside a danger area', async () => {
    renderSettings();

    expect(await screen.findByText('8月22日更新')).toBeTruthy();
    expect(screen.getAllByText('长期保留').length).toBeGreaterThan(0);
    expect(screen.getByText('有效至 9月1日')).toBeTruthy();

    const dangerArea = screen.getByLabelText('AI 记忆危险操作');
    expect(within(dangerArea).getByRole('button', { name: '清空全部记忆' })).toBeTruthy();
  });

  it('keeps a selected category when deleting one of several matching memories', async () => {
    const user = userEvent.setup();
    renderSettings();

    await user.click(await screen.findByRole('button', { name: '偏好 2' }));
    await user.click(screen.getByRole('button', { name: '删除记忆：回答风格' }));

    expect(await screen.findByRole('button', { name: '偏好 1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '偏好 1' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(screen.queryByText('回答风格')).toBeNull();
    expect(screen.getByText('网站选择')).toBeTruthy();
  });

  it('does not let a slow delete overwrite a newer category selection', async () => {
    let finishDelete!: (value: { ok: boolean }) => void;
    trpcMocks.delete.mockReturnValueOnce(
      new Promise((resolve) => {
        finishDelete = resolve;
      }),
    );
    const user = userEvent.setup();
    renderSettings();

    await user.click(await screen.findByRole('button', { name: '偏好 2' }));
    await user.click(screen.getByRole('button', { name: '删除记忆：回答风格' }));
    await waitFor(() => expect(trpcMocks.delete).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole('button', { name: '任务历史 2' }));
    finishDelete({ ok: true });

    await waitFor(() => expect(screen.queryByText('回答风格')).toBeNull());
    expect(screen.getByRole('button', { name: '任务历史 2' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });
});
