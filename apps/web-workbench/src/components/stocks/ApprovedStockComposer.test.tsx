// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { ApprovedStockComposer, stockResearchIntent } from './ApprovedStockComposer';
vi.mock('@/components/CreativeReferenceLibrary', () => ({ CreativeReferenceLibrary: () => null }));
vi.mock('@/lib/upload-file', () => ({
  uploadFile: vi.fn(),
  uploadFailureMessage: () => '上传失败',
}));
afterEach(cleanup);
const props = () => ({
  value: '比较关注股票',
  placeholder: '研究任务',
  assistantStatus: '日期已核验',
  submitting: false,
  submitDisabled: false,
  onValueChange: vi.fn(),
  onSubmit: vi.fn(),
  commands: [],
  onCommand: vi.fn(),
  isCommandDisabled: () => false,
  commandTitle: () => undefined,
});
it('carries user selected period, scope, format and citation preference into research requirements', async () => {
  const p = props(),
    user = userEvent.setup();
  render(
    <ApprovedStockComposer {...p} researchStocks={[{ symbol: '603528', name: '多伦科技' }]} />,
  );
  await user.click(screen.getByRole('button', { name: '我的关注' }));
  await user.click(await screen.findByRole('menuitemradio', { name: '多伦科技 · 603528' }));
  await user.click(screen.getByRole('button', { name: '最近交易日' }));
  await user.click(await screen.findByRole('menuitemradio', { name: '近 5 个交易日' }));
  await user.click(screen.getByRole('button', { name: '要点摘要' }));
  await user.click(await screen.findByRole('menuitemradio', { name: '对比表格' }));
  await user.click(screen.getByRole('button', { name: '引用来源' }));
  await user.click(screen.getByRole('button', { name: '提交股市任务' }));
  const draft = p.onSubmit.mock.calls[0][0];
  expect(draft).toMatchObject({
    scope: '多伦科技 · 603528',
    period: '近 5 个交易日',
    output: '对比表格',
    citeSources: false,
    changed: true,
  });
  expect(stockResearchIntent(p.value, draft)).toContain('不将当前快照当成历史序列');
  expect(stockResearchIntent(p.value, { ...draft, changed: false })).toBe(p.value);
});
it('keeps the unavailable data gate and makes collapsed contents inert', async () => {
  const p = props(),
    user = userEvent.setup();
  const { container } = render(<ApprovedStockComposer {...p} submitDisabled />);
  await user.click(screen.getByRole('button', { name: '提交股市任务' }));
  expect(p.onSubmit).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: '收起输入框' }));
  expect(container.querySelector('.hd-stock-dock-fold')?.hasAttribute('inert')).toBe(true);
});
