// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { useCreativeProject } from './CreativeProjectPicker';
const api = vi.hoisted(() => ({ list: vi.fn(), move: vi.fn() }));
vi.mock('@/lib/trpc', () => ({
  trpc: { projects: { list: { query: api.list } }, tasks: { moveToProject: { mutate: api.move } } },
}));
vi.mock('./CreativePopover', () => ({
  CreativePopover: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div>{children}</div> : null,
}));
function Harness() {
  const project = useCreativeProject();
  return (
    <>
      {project.renderPicker()}
      {project.notice}
      <button onClick={() => void project.associate('existing_task')}>关联已创建任务</button>
    </>
  );
}
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
it('retries a failed move against the existing task and excludes organization projects', async () => {
  api.list.mockResolvedValue([
    { projectId: 'prj_personal', name: '秋季短片', scope: 'personal' },
    {
      projectId: 'prj_team',
      name: '团队项目',
      scope: 'organization',
      organizationId: 'org_1',
      memberRole: 'lead',
    },
  ]);
  api.move.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({});
  const user = userEvent.setup();
  render(<Harness />);
  await user.click(screen.getByRole('button', { name: '选择项目' }));
  await user.click(await screen.findByRole('button', { name: '秋季短片' }));
  expect(screen.queryByRole('button', { name: '团队项目' })).toBeNull();
  await user.click(screen.getByRole('button', { name: '关联已创建任务' }));
  expect(await screen.findByRole('status')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: '重试关联项目' }));
  await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
  expect(api.move.mock.calls).toEqual([
    [{ taskId: 'existing_task', projectId: 'prj_personal' }],
    [{ taskId: 'existing_task', projectId: 'prj_personal' }],
  ]);
});
