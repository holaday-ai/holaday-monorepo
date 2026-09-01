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
  it('shows what Holaday can complete without exposing internal capability mechanics', () => {
    render(<CapabilityCenterContent {...baseProps} />);

    const header = screen.getByTestId('capability-header');
    expect(header.className).toContain('lg:pr-[200px]');
    expect(header.className).toContain('xl:flex-row');
    expect(screen.getByRole('heading', { level: 1, name: '能力中心' })).toBeTruthy();
    expect(screen.getByText('选择你想完成的事，Holaday 会匹配需要的能力并带你开始。')).toBeTruthy();
    expect(screen.getByRole('searchbox', { name: '搜索想完成的任务' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3, name: '完成后你会得到' })).toBeTruthy();
    expect(screen.getByText('销售额环比增长 18.7%，但复购率连续两周回落。')).toBeTruthy();
    expect(screen.getByText('选择一个任务')).toBeTruthy();
    expect(screen.getByText('全部可完成的任务')).toBeTruthy();
    expect(screen.getByText('围绕新品卖点安排 7 天内容节奏，并标出互动重点。')).toBeTruthy();
    expect(screen.queryByText('能力准备轨道')).toBeNull();
    expect(screen.queryByText('执行时可能调用')).toBeNull();
    expect(screen.queryByText('会自动匹配；可在输入框 @ 调用')).toBeNull();
    expect(screen.queryByText('交付内容')).toBeNull();
    expect(
      screen.getByRole('button', { name: '查看数据报表解读' }).getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('keeps the selected task focused on starting and its expected outcome', () => {
    render(<CapabilityCenterContent {...baseProps} />);

    const studio = screen.getByTestId('capability-studio');
    expect(within(studio).getByText('推荐从这里开始')).toBeTruthy();
    expect(within(studio).getByText('点击后可补充材料和要求')).toBeTruthy();
    expect(within(studio).getByRole('heading', { level: 3, name: '完成后你会得到' })).toBeTruthy();
    expect(within(studio).getByText('关键指标摘要')).toBeTruthy();
    expect(within(studio).getByText('异常与趋势说明')).toBeTruthy();
    expect(within(studio).queryByText('AI 能力已就绪')).toBeNull();
    expect(within(studio).queryByText('结果为可编辑草稿')).toBeNull();
    expect(within(studio).queryByText('不会自动提交')).toBeNull();
  });

  it('presents a disabled capability as a task choice without configuration copy', () => {
    render(<CapabilityCenterContent {...baseProps} activeSkillId="social-media-strategy" />);

    expect(screen.getAllByText('从目标到选题，生成一周内容计划。')).toHaveLength(2);
    expect(screen.queryByText('能力可预览，启用后使用')).toBeNull();
    expect(screen.getByRole('button', { name: '开始任务：为新品规划一周社媒内容' })).toBeTruthy();
  });

  it('does not promise a task can start when the common-capability limit is full', () => {
    render(
      <CapabilityCenterContent
        {...baseProps}
        activeSkillId="social-media-strategy"
        cap={1}
        enabledCount={1}
      />,
    );

    const starter = screen.getByRole('button', { name: '已达上限：为新品规划一周社媒内容' });
    expect(starter.hasAttribute('disabled')).toBe(true);
    expect(within(starter).getByText('已达上限')).toBeTruthy();
    expect(starter.getAttribute('title')).toBe('请先从常用能力中移除一项');
  });

  it('disables task starters and exposes progress while the selected capability is preparing', () => {
    render(<CapabilityCenterContent {...baseProps} pendingId="data-report-insight" />);

    const starters = screen.getAllByRole('button', { name: /准备中：/ });
    expect(starters).toHaveLength(3);
    for (const starter of starters) {
      expect(starter.hasAttribute('disabled')).toBe(true);
      expect(within(starter).getByText('准备中…')).toBeTruthy();
    }
  });

  it('explains that another selection is saving instead of promising an immediate start', () => {
    render(<CapabilityCenterContent {...baseProps} pendingId="social-media-strategy" />);

    const starter = screen.getByRole('button', { name: '请稍候：分析这份周报并找出异常' });
    expect(starter.hasAttribute('disabled')).toBe(true);
    expect(within(starter).getByText('请稍候')).toBeTruthy();
  });

  it('announces when the current plan cannot start a disabled capability', () => {
    render(
      <CapabilityCenterContent
        {...baseProps}
        activeSkillId="social-media-strategy"
        cap={0}
        enabledCount={0}
      />,
    );

    const starter = screen.getByRole('button', {
      name: '暂不可用：为新品规划一周社媒内容',
    });
    expect(starter.hasAttribute('disabled')).toBe(true);
    expect(within(starter).getByText('暂不可用')).toBeTruthy();
    expect(starter.getAttribute('title')).toBe('当前套餐暂不支持开始此任务');
  });

  it('starts from an explicit sample and lets the user switch the showcase capability', async () => {
    const user = userEvent.setup();
    const onStart = vi.fn();
    const onSelectSkill = vi.fn();
    render(
      <CapabilityCenterContent {...baseProps} onStart={onStart} onSelectSkill={onSelectSkill} />,
    );

    await user.click(screen.getByRole('button', { name: '开始任务：分析这份周报并找出异常' }));
    expect(onStart).toHaveBeenCalledWith(skills[0], '分析这份周报并找出异常');

    await user.click(screen.getByRole('button', { name: '预览社交媒体策略' }));
    expect(onSelectSkill).toHaveBeenCalledWith('social-media-strategy');
  });

  it('filters the complete catalogue and focuses a strong matched capability', async () => {
    const user = userEvent.setup();

    function Harness(): JSX.Element {
      const [query, setQuery] = React.useState('');
      return <CapabilityCenterContent {...baseProps} query={query} onQueryChange={setQuery} />;
    }

    render(<Harness />);
    await user.type(screen.getByRole('searchbox', { name: '搜索想完成的任务' }), '合同');

    expect(screen.getByText('发现 3 项高风险条款，并给出逐条修改方向。')).toBeTruthy();
    expect(screen.getByText('相关能力：合同风险审查')).toBeTruthy();
    const catalogue = screen.getByTestId('capability-catalogue');
    expect(within(catalogue).getByText('合同风险审查')).toBeTruthy();
    expect(within(catalogue).queryByText('数据报表解读')).toBeNull();
    expect(within(catalogue).queryByText('社交媒体策略')).toBeNull();
  });

  it('finds capabilities from the task and outcome language shown to users', async () => {
    const user = userEvent.setup();

    function Harness(): JSX.Element {
      const [query, setQuery] = React.useState('');
      return <CapabilityCenterContent {...baseProps} query={query} onQueryChange={setQuery} />;
    }

    render(<Harness />);
    const search = screen.getByRole('searchbox', { name: '搜索想完成的任务' });
    const catalogue = screen.getByTestId('capability-catalogue');

    await user.type(search, '周报');
    expect(within(catalogue).getByText('数据报表解读')).toBeTruthy();
    expect(within(catalogue).getByText('社交媒体策略')).toBeTruthy();
    expect(within(catalogue).getByText('合同风险审查')).toBeTruthy();

    await user.clear(search);
    await user.type(search, '复购率');
    expect(within(catalogue).getByText('数据报表解读')).toBeTruthy();
  });

  it('prepares the user own request with a related capability for review in the composer', async () => {
    const user = userEvent.setup();
    const onStart = vi.fn();

    function Harness(): JSX.Element {
      const [query, setQuery] = React.useState('');
      return (
        <CapabilityCenterContent
          {...baseProps}
          query={query}
          onQueryChange={setQuery}
          onStart={onStart}
        />
      );
    }

    render(<Harness />);
    const search = screen.getByRole('searchbox', { name: '搜索想完成的任务' });
    const intent = '帮我分析销售数据，找出复购率下降原因';
    await user.type(search, intent);

    expect(screen.getByText('为你匹配')).toBeTruthy();
    expect(screen.getByText('相关能力：数据报表解读')).toBeTruthy();
    expect(screen.getByText('能力范围：结论基于你提供的数据，不替代专业审计。')).toBeTruthy();
    expect(screen.getByText('会先带入任务输入框，由你确认后发送。')).toBeTruthy();
    const start = screen.getByRole('button', {
      name: `用数据报表解读准备任务：${intent}`,
    });
    await user.click(start);

    expect(onStart).toHaveBeenCalledWith(skills[0], intent, 'suggested');
  });

  it('keeps every capability available when the request is too vague to match honestly', async () => {
    const user = userEvent.setup();

    function Harness(): JSX.Element {
      const [query, setQuery] = React.useState('');
      return <CapabilityCenterContent {...baseProps} query={query} onQueryChange={setQuery} />;
    }

    render(<Harness />);
    await user.type(screen.getByRole('searchbox', { name: '搜索想完成的任务' }), '帮我处理一下');

    expect(screen.getByText('还不能确定最适合的能力')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /用.+开始：帮我处理一下/ })).toBeNull();
    const catalogue = screen.getByTestId('capability-catalogue');
    expect(within(catalogue).getByText('数据报表解读')).toBeTruthy();
    expect(within(catalogue).getByText('社交媒体策略')).toBeTruthy();
    expect(within(catalogue).getByText('合同风险审查')).toBeTruthy();
  });

  it('keeps the full catalogue when a low-confidence request happens to match visible copy', async () => {
    const user = userEvent.setup();

    function Harness(): JSX.Element {
      const [query, setQuery] = React.useState('');
      return <CapabilityCenterContent {...baseProps} query={query} onQueryChange={setQuery} />;
    }

    render(<Harness />);
    await user.type(screen.getByRole('searchbox', { name: '搜索想完成的任务' }), '周报');

    expect(screen.getByText('还不能确定最适合的能力')).toBeTruthy();
    const catalogue = screen.getByTestId('capability-catalogue');
    expect(within(catalogue).getByText('数据报表解读')).toBeTruthy();
    expect(within(catalogue).getByText('社交媒体策略')).toBeTruthy();
    expect(within(catalogue).getByText('合同风险审查')).toBeTruthy();
  });

  it('lets users switch from the strongest match to a recommended candidate', async () => {
    const user = userEvent.setup();
    const onStart = vi.fn();

    function Harness(): JSX.Element {
      const [activeSkillId, setActiveSkillId] = React.useState('data-report-insight');
      return (
        <CapabilityCenterContent
          {...baseProps}
          activeSkillId={activeSkillId}
          query="分析数据并规划社媒内容"
          onSelectSkill={setActiveSkillId}
          onStart={onStart}
        />
      );
    }

    render(<Harness />);
    expect(screen.getByText('相关能力：社交媒体策略')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: '预览数据报表解读' }));

    expect(screen.getByText('已选择能力：数据报表解读')).toBeTruthy();
    expect(screen.getByText('销售额环比增长 18.7%，但复购率连续两周回落。')).toBeTruthy();

    await user.click(
      screen.getByRole('button', {
        name: '用数据报表解读准备任务：分析数据并规划社媒内容',
      }),
    );
    expect(onStart).toHaveBeenCalledWith(
      skills[0],
      '分析数据并规划社媒内容',
      'manual',
    );
  });

  it('exposes one clear toggle action for each catalogue capability', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<CapabilityCenterContent {...baseProps} onToggle={onToggle} />);

    await user.click(screen.getByRole('button', { name: '加入常用：社交媒体策略' }));
    expect(onToggle).toHaveBeenCalledWith(skills[1]);
    expect(
      screen
        .getByRole('button', { name: '从常用中移除：数据报表解读' })
        .getAttribute('aria-pressed'),
    ).toBe('true');
  });
});
