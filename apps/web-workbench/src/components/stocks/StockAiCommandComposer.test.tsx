// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StockAiCommandComposer } from './StockAiCommandComposer';

afterEach(cleanup);

const commands = [
  '生成今日关注日报',
  '哪些股票风险升高？',
  '今天 AI 板块怎么看？',
  '比较 603528 和 600497',
];

describe('StockAiCommandComposer', () => {
  it('presents free-form stock research as an AI delegation surface', () => {
    render(
      <StockAiCommandComposer
        value=""
        placeholder="今天想让 AI 帮你看什么？"
        assistantStatus="正在理解你的关注股票"
        commands={commands}
        submitting={false}
        submitDisabled
        onValueChange={vi.fn()}
        onSubmit={vi.fn()}
        onCommand={vi.fn()}
      />,
    );

    expect(screen.getByText('Holaday AI')).toBeTruthy();
    expect(screen.getByText('正在理解你的关注股票')).toBeTruthy();
    expect(screen.getByRole('textbox', { name: '交代股市研究任务' }).getAttribute('placeholder'))
      .toBe('今天想让 AI 帮你看什么？');
    expect(screen.getByRole('button', { name: '提交股市任务' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'AI 研究建议' }).querySelectorAll('button')).toHaveLength(4);
    expect(screen.getByRole('group', { name: 'AI 研究建议' }).className).toContain(
      'overflow-x-auto',
    );
    expect(screen.getByRole('group', { name: 'AI 研究建议' }).className).toContain(
      'sm:grid',
    );
    expect(screen.getByText('整理今日关注')).toBeTruthy();
    expect(screen.getByText('核对风险变化')).toBeTruthy();
    expect(screen.getByText('分析行业主线')).toBeTruthy();
    expect(screen.getByText('比较两只股票')).toBeTruthy();
    for (const command of commands) {
      expect(screen.getByRole('button', { name: command }).className).toContain('min-h-11');
    }
  });

  it('keeps typed delegation and suggested AI actions interactive', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    const onSubmit = vi.fn();
    const onCommand = vi.fn();
    render(
      <StockAiCommandComposer
        value="分析新能源板块"
        placeholder="今天想让 AI 帮你看什么？"
        assistantStatus="正在理解你的关注股票"
        commands={commands}
        submitting={false}
        submitDisabled={false}
        onValueChange={onValueChange}
        onSubmit={onSubmit}
        onCommand={onCommand}
      />,
    );

    await user.type(screen.getByRole('textbox', { name: '交代股市研究任务' }), '变化');
    expect(onValueChange).toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: '提交股市任务' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: '哪些股票风险升高？' }));
    expect(onCommand).toHaveBeenCalledWith('哪些股票风险升高？');
  });
});
