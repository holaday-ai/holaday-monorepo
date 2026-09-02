// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SkillsPage } from './SkillsPage';

const { listSkills, showToast, toastApi, toggleSkill, uploadFileMock } = vi.hoisted(() => {
  const show = vi.fn();
  return {
    listSkills: vi.fn(),
    showToast: show,
    toastApi: { show },
    toggleSkill: vi.fn(),
    uploadFileMock: vi.fn(),
  };
});

vi.mock('@/lib/trpc', () => ({
  trpc: {
    skills: {
      list: { query: listSkills },
      toggle: { mutate: toggleSkill },
    },
  },
}));

vi.mock('@/components/ui/toast', () => ({
  useToast: () => toastApi,
}));

vi.mock('@/lib/upload-file', () => ({
  uploadFile: uploadFileMock,
  uploadFailureMessage: () => '上传失败，请稍后重试。',
}));

const skillRow = {
  id: 'data-report-insight',
  name: '数据报表解读',
  logoId: 'data-report-insight',
  category: '分析决策',
  description: '把零散数据变成清晰结论。',
  aliases: ['数据分析', '报表'],
  maturity: 'workflow',
  connectors: ['spreadsheet'],
  experience: {
    starterPrompts: ['分析这份周报并找出异常', '整理管理层摘要', '提炼关键变化'],
    requiredInputs: ['表格或报表'],
    deliverables: ['关键指标摘要'],
    boundary: '结论基于你提供的数据。',
    exampleSummary: '找出异常并解释变化。',
  },
  enabled: true,
};

function renderPage(plan = 'basic'): void {
  render(
    <MemoryRouter initialEntries={['/skills']}>
      <Routes>
        <Route element={<Outlet context={{ me: { plan } }} />}>
          <Route path="/skills" element={<SkillsPage />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  listSkills.mockResolvedValue([skillRow]);
  toggleSkill.mockResolvedValue({ skillId: skillRow.id, enabled: true });
  uploadFileMock.mockReturnValue(new Promise(() => {}));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('SkillsPage attachments', () => {
  it('reserves an attachment batch before uploads finish so rapid selections cannot exceed five', async () => {
    renderPage();

    const input = await screen.findByLabelText('选择任务附件');
    expect((input as HTMLInputElement).disabled).toBe(false);
    const firstBatch = [1, 2, 3, 4].map(
      (index) => new File([`file-${index}`], `report-${index}.txt`, { type: 'text/plain' }),
    );
    const secondBatch = [5, 6].map(
      (index) => new File([`file-${index}`], `report-${index}.txt`, { type: 'text/plain' }),
    );

    fireEvent.change(input, { target: { files: firstBatch } });
    fireEvent.change(input, { target: { files: secondBatch } });

    expect(uploadFileMock).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith('最多附 5 个文件');
    for (const file of firstBatch) expect(screen.getByText(file.name)).toBeTruthy();
    for (const file of secondBatch) expect(screen.queryByText(file.name)).toBeNull();
  });
});
