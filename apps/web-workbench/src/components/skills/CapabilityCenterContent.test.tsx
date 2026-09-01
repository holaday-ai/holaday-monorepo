// @vitest-environment happy-dom

import type { UiSkill } from '@/types/task';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CapabilityCenterContent } from './CapabilityCenterContent';

afterEach(cleanup);

const skills: UiSkill[] = [
  {
    id: 'data-report-insight',
    name: '数据报表解读',
    logoId: 'data-report-insight',
    category: '分析决策',
    description: '把零散数据变成清晰结论。',
    aliases: ['数据分析', '报表'],
    maturity: 'workflow',
    connectors: ['spreadsheet', 'database'],
    experience: {
      starterPrompts: [
        '分析这份周报并找出异常',
        '把这些数据整理成管理层摘要',
        '提炼本月最重要的三个变化',
      ],
      requiredInputs: ['表格、报表或数据链接', '你最关心的问题'],
      deliverables: ['关键指标摘要', '异常与趋势说明'],
      boundary: '结论基于你提供的数据，不替代专业审计。',
      exampleSummary: '销售额环比增长 18.7%，但复购率连续两周回落。',
    },
    enabled: true,
  },
  {
    id: 'social-media-strategy',
    name: '社交媒体策略',
    logoId: 'social-media-strategy',
    category: '内容运营',
    description: '从目标到选题，生成一周内容计划。',
    aliases: ['社媒', '内容规划'],
    maturity: 'workflow',
    connectors: ['browser'],
    experience: {
      starterPrompts: ['为新品规划一周社媒内容', '梳理品牌账号的内容方向', '复盘近期内容表现'],
      requiredInputs: ['品牌目标', '受众信息'],
      deliverables: ['内容主题', '发布节奏'],
      boundary: '发布前需要你确认品牌口径。',
      exampleSummary: '围绕新品卖点安排 7 天内容节奏，并标出互动重点。',
    },
    enabled: false,
  },
  {
    id: 'contract-risk-review',
    name: '合同风险审查',
    logoId: 'contract-risk-review',
    category: '管理协作',
    description: '识别关键条款风险并给出修改建议。',
    aliases: ['合同', '法务'],
    maturity: 'template',
    connectors: ['document-parser'],
    experience: {
      starterPrompts: [
        '检查这份合同的主要风险',
        '提炼双方义务与时间节点',
        '列出需要法务确认的条款',
      ],
      requiredInputs: ['合同文件'],
      deliverables: ['风险清单', '修改建议'],
      boundary: '结果仅供辅助审阅，不构成法律意见。',
      exampleSummary: '发现 3 项高风险条款，并给出逐条修改方向。',
    },
    enabled: false,
  },
];

const baseProps = {
  skills,
  activeSkillId: 'data-report-insight',
  query: '',
  pendingId: null,
  cap: 5,
  enabledCount: 1,
  onQueryChange: vi.fn(),
  onSelectSkill: vi.fn(),
  onStart: vi.fn(),
  onToggle: vi.fn(),
};

describe('CapabilityCenterContent', () => {
  it('explains what the selected capability can do before asking the user to start', () => {
    render(<CapabilityCenterContent {...baseProps} />);

    const header = screen.getByTestId('capability-header');
    expect(header.className).toContain('lg:pr-[200px]');
    expect(header.className).toContain('xl:flex-row');
    expect(screen.getByRole('heading', { level: 1, name: '能力中心' })).toBeTruthy();
    expect(screen.getAllByText('示例结果')).toHaveLength(3);
    expect(screen.getByText('销售额环比增长 18.7%，但复购率连续两周回落。')).toBeTruthy();
    expect(screen.getByText('你需要提供')).toBeTruthy();
    expect(screen.getByText('会交付什么')).toBeTruthy();
    expect(screen.getByText('执行时可能调用')).toBeTruthy();
    expect(screen.getByText('边界说明')).toBeTruthy();
    expect(screen.getByText('表格')).toBeTruthy();
    expect(screen.getByText('数据库')).toBeTruthy();
    expect(screen.getByText('围绕新品卖点安排 7 天内容节奏，并标出互动重点。')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: '查看数据报表解读' }).getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('presents the selected capability as a truthful AI workbench', () => {
    render(<CapabilityCenterContent {...baseProps} />);

    const studio = screen.getByTestId('capability-studio');
    const status = within(studio).getByRole('status', { name: '能力运行状态' });

    expect(within(status).getByText('AI 能力已就绪')).toBeTruthy();
    expect(within(status).getByText('结果为可编辑草稿')).toBeTruthy();
    expect(within(status).getByText('不会自动提交')).toBeTruthy();
    expect(within(studio).getByRole('heading', { level: 3, name: '结果预览' })).toBeTruthy();
    expect(within(studio).getByText('关键指标摘要')).toBeTruthy();
    expect(within(studio).getByText('异常与趋势说明')).toBeTruthy();
    expect(screen.getByTestId('capability-readiness-rail')).toBeTruthy();
  });

  it('does not claim a disabled capability is ready to run', () => {
    render(<CapabilityCenterContent {...baseProps} activeSkillId="social-media-strategy" />);

    const status = screen.getByRole('status', { name: '能力运行状态' });
    expect(within(status).getByText('能力可预览，启用后使用')).toBeTruthy();
    expect(within(status).queryByText('AI 能力已就绪')).toBeNull();
  });

  it('starts from an explicit sample and lets the user switch the showcase capability', async () => {
    const user = userEvent.setup();
    const onStart = vi.fn();
    const onSelectSkill = vi.fn();
    render(
      <CapabilityCenterContent {...baseProps} onStart={onStart} onSelectSkill={onSelectSkill} />,
    );

    await user.click(screen.getByRole('button', { name: '分析这份周报并找出异常' }));
    expect(onStart).toHaveBeenCalledWith(skills[0], '分析这份周报并找出异常');

    await user.click(screen.getByRole('button', { name: '预览社交媒体策略' }));
    expect(onSelectSkill).toHaveBeenCalledWith('social-media-strategy');
  });

  it('filters the complete catalogue without changing the selected showcase', async () => {
    const user = userEvent.setup();

    function Harness(): JSX.Element {
      const [query, setQuery] = React.useState('');
      return <CapabilityCenterContent {...baseProps} query={query} onQueryChange={setQuery} />;
    }

    render(<Harness />);
    await user.type(screen.getByRole('searchbox', { name: '搜索全部能力' }), '合同');

    expect(screen.getByText('销售额环比增长 18.7%，但复购率连续两周回落。')).toBeTruthy();
    const catalogue = screen.getByTestId('capability-catalogue');
    expect(within(catalogue).getByText('合同风险审查')).toBeTruthy();
    expect(within(catalogue).queryByText('数据报表解读')).toBeNull();
    expect(within(catalogue).queryByText('社交媒体策略')).toBeNull();
  });

  it('exposes one clear toggle action for each catalogue capability', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<CapabilityCenterContent {...baseProps} onToggle={onToggle} />);

    await user.click(screen.getByRole('button', { name: '启用社交媒体策略' }));
    expect(onToggle).toHaveBeenCalledWith(skills[1]);
    expect(
      screen.getByRole('button', { name: '停用数据报表解读' }).getAttribute('aria-pressed'),
    ).toBe('true');
  });
});
