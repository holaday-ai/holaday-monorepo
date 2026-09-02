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
  attachments: [],
  attachmentsAllowed: true,
  onQueryChange: vi.fn(),
  onSelectSkill: vi.fn(),
  onStart: vi.fn(),
  onToggle: vi.fn(),
  onAddAttachments: vi.fn(),
  onRemoveAttachment: vi.fn(),
};

describe('CapabilityCenterContent', () => {
  it('presents the skill centre as an outcome-first task composer', () => {
    render(<CapabilityCenterContent {...baseProps} />);

    expect(screen.getByRole('heading', { level: 1, name: '技能中心' })).toBeTruthy();
    expect(
      screen.getByText('说出你想完成的事，我会自动匹配并组合需要的技能。'),
    ).toBeTruthy();
    expect(screen.getByRole('textbox', { name: '描述想完成的任务' })).toBeTruthy();
    const starters = screen.getByRole('region', { name: '不确定从哪开始？' });
    expect(within(starters).getByText('分析这份周报并找出异常')).toBeTruthy();
    expect(within(starters).getByText('为新品规划一周社媒内容')).toBeTruthy();
    expect(within(starters).getByText('检查这份合同的主要风险')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: '常用技能' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: '全部技能' })).toBeTruthy();
    expect(screen.getByText('为新品规划一周社媒内容')).toBeTruthy();
    expect(screen.getByRole('button', { name: '添加附件' })).toBeTruthy();
    expect(screen.getByText('附件会随任务一起分析')).toBeTruthy();
    expect(screen.queryByText('开始后可添加附件')).toBeNull();
    expect(screen.queryByText('可使用已有文件')).toBeNull();
    expect(screen.queryByText('支持语音补充')).toBeNull();
    expect(screen.queryByText('如何工作')).toBeNull();
    expect(screen.queryByText('能力准备轨道')).toBeNull();
    expect(screen.queryByText('执行时可能调用')).toBeNull();
    expect(screen.queryByText('会自动匹配；可在输入框 @ 调用')).toBeNull();
    expect(screen.queryByText('交付内容')).toBeNull();
    expect(
      screen.getByRole('button', { name: '查看数据报表解读' }).getAttribute('aria-pressed'),
    ).toBe('true');
    const header = screen.getByTestId('capability-header');
    expect(header.className).toContain('justify-between');
    expect(header.className).not.toContain('flex-col');
    const composerRow = screen.getByTestId('intent-composer-row');
    expect(composerRow.className).toContain('flex-col');
    expect(composerRow.className).toContain('sm:flex-row');
  });

  it('sizes multi-column sections from their own available width instead of the window breakpoint', () => {
    render(<CapabilityCenterContent {...baseProps} />);

    const taskGrid = screen.getByTestId('task-starter-grid');
    const catalogueGrid = screen.getByTestId('capability-catalogue-grid');

    expect(taskGrid.className).toContain(
      'grid-cols-[repeat(auto-fit,minmax(min(100%,28rem),1fr))]',
    );
    expect(taskGrid.className).not.toContain('md:grid-cols-2');
    expect(catalogueGrid.className).toContain(
      'grid-cols-[repeat(auto-fit,minmax(min(100%,17rem),1fr))]',
    );
    expect(catalogueGrid.className).not.toContain('lg:grid-cols-3');
  });

  it('lets users reveal or hide the execution preview for an understood task', async () => {
    const user = userEvent.setup();
    render(
      <CapabilityCenterContent
        {...baseProps}
        query="帮我分析销售数据，找出复购率下降原因"
      />,
    );

    const understood = screen.getByTestId('intent-understanding');
    expect(within(understood).getByText('Holaday 已理解')).toBeTruthy();
    const preview = within(understood).getByRole('switch', { name: '执行预览' });
    expect(preview.getAttribute('aria-checked')).toBe('true');
    const previewTrack = preview.querySelector('span[aria-hidden]');
    expect(previewTrack?.className).toContain('bg-[#E9A6B9]');
    expect(previewTrack?.querySelector('span')?.className).toContain('left-[3px]');
    expect(previewTrack?.querySelector('span')?.className).toContain('translate-x-[18px]');
    expect(previewTrack?.querySelector('span')?.className).toContain('bg-white');
    expect(within(understood).getByText('关键指标摘要')).toBeTruthy();
    expect(within(understood).getByText('异常与趋势说明')).toBeTruthy();

    await user.click(preview);
    expect(preview.getAttribute('aria-checked')).toBe('false');
    expect(within(understood).queryByText('关键指标摘要')).toBeNull();
    expect(within(understood).queryByText('异常与趋势说明')).toBeNull();
  });

  it('presents every starter as a consistent task example instead of mixing preview and start', () => {
    render(<CapabilityCenterContent {...baseProps} activeSkillId="social-media-strategy" />);

    expect(screen.getAllByText('从目标到选题，生成一周内容计划。').length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText('能力可预览，启用后使用')).toBeNull();
    expect(
      screen.getByRole('button', { name: '选择任务示例：为新品规划一周社媒内容' }),
    ).toBeTruthy();
    expect(screen.queryByText('开始')).toBeNull();
  });

  it('keeps task examples usable while a common-skill change is saving', () => {
    render(
      <CapabilityCenterContent
        {...baseProps}
        query="分析本月销售数据"
        pendingId="data-report-insight"
      />,
    );

    const starters = screen.getAllByRole('button', { name: /选择任务示例：/ });
    expect(starters).toHaveLength(3);
    expect(starters.every((starter) => !starter.hasAttribute('disabled'))).toBe(true);
    const start = screen.getByRole('button', { name: '正在准备任务：分析本月销售数据' });
    expect(start.hasAttribute('disabled')).toBe(true);
    expect(start.getAttribute('aria-busy')).toBe('true');
  });

  it('keeps a selected example as a task label and leaves the prompt for extra requirements', async () => {
    const user = userEvent.setup();
    const onStart = vi.fn();
    const onSelectSkill = vi.fn();
    function Harness(): JSX.Element {
      const [query, setQuery] = React.useState('');
      return (
        <CapabilityCenterContent
          {...baseProps}
          query={query}
          onQueryChange={setQuery}
          onStart={onStart}
          onSelectSkill={onSelectSkill}
        />
      );
    }
    render(<Harness />);

    await user.click(
      screen.getByRole('button', { name: '选择任务示例：为新品规划一周社媒内容' }),
    );
    expect(
      (screen.getByRole('textbox', { name: '描述想完成的任务' }) as HTMLTextAreaElement).value,
    ).toBe('');
    expect(screen.getByText('已选任务')).toBeTruthy();
    expect(screen.getByText('将调用')).toBeTruthy();
    expect(screen.getAllByText('社交媒体策略').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: '移除已选任务' })).toBeTruthy();
    expect(screen.queryByText('还不能确定最适合的能力')).toBeNull();
    expect(onStart).not.toHaveBeenCalled();
    expect(onSelectSkill).toHaveBeenCalledWith('social-media-strategy');
  });

  it('starts a selected example without requiring duplicate prompt text', async () => {
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

    await user.click(
      screen.getByRole('button', { name: '选择任务示例：为新品规划一周社媒内容' }),
    );
    const start = screen.getByRole('button', {
      name: '开始任务：为新品规划一周社媒内容',
    });
    expect(start.hasAttribute('disabled')).toBe(false);
    await user.click(start);

    expect(onStart).toHaveBeenCalledWith(
      skills[1],
      '为新品规划一周社媒内容',
      'manual',
    );
  });

  it('keeps the selected task while letting the user change which skill will run it', async () => {
    const user = userEvent.setup();
    const onStart = vi.fn();
    function Harness(): JSX.Element {
      const [query, setQuery] = React.useState('');
      const [activeSkillId, setActiveSkillId] = React.useState('data-report-insight');
      return (
        <CapabilityCenterContent
          {...baseProps}
          activeSkillId={activeSkillId}
          query={query}
          onQueryChange={setQuery}
          onSelectSkill={setActiveSkillId}
          onStart={onStart}
        />
      );
    }
    render(<Harness />);

    await user.click(
      screen.getByRole('button', { name: '选择任务示例：为新品规划一周社媒内容' }),
    );
    await user.click(screen.getByRole('button', { name: '查看合同风险审查' }));
    await user.click(
      screen.getByRole('button', { name: '开始任务：为新品规划一周社媒内容' }),
    );

    expect(onStart).toHaveBeenCalledWith(
      skills[2],
      '为新品规划一周社媒内容',
      'manual',
    );
  });

  it('combines selected task and optional extra requirements only when starting', async () => {
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

    await user.click(
      screen.getByRole('button', { name: '选择任务示例：检查这份合同的主要风险' }),
    );
    await user.type(
      screen.getByRole('textbox', { name: '描述想完成的任务' }),
      '重点看自动续费和违约责任',
    );
    await user.click(
      screen.getByRole('button', { name: '开始任务：检查这份合同的主要风险' }),
    );

    expect(onStart).toHaveBeenCalledWith(
      skills[2],
      '检查这份合同的主要风险\n补充要求：重点看自动续费和违约责任',
      'manual',
    );
  });

  it('removes a selected task without mutating the extra-requirements prompt', async () => {
    const user = userEvent.setup();
    function Harness(): JSX.Element {
      const [query, setQuery] = React.useState('');
      return (
        <CapabilityCenterContent {...baseProps} query={query} onQueryChange={setQuery} />
      );
    }
    render(<Harness />);

    await user.click(
      screen.getByRole('button', { name: '选择任务示例：分析这份周报并找出异常' }),
    );
    await user.click(screen.getByRole('button', { name: '移除已选任务' }));

    expect(screen.queryByText('已选任务')).toBeNull();
    expect(screen.getByRole('button', { name: '开始任务：请先描述任务' }).hasAttribute('disabled')).toBe(true);
  });

  it('hands chosen files to the real attachment callback before starting', async () => {
    const user = userEvent.setup();
    const onAddAttachments = vi.fn();
    render(
      <CapabilityCenterContent {...baseProps} onAddAttachments={onAddAttachments} />,
    );

    const input = screen.getByLabelText('选择任务附件') as HTMLInputElement;
    const file = new File(['sales'], '销售数据.csv', { type: 'text/csv' });
    await user.upload(input, file);

    expect(onAddAttachments).toHaveBeenCalledTimes(1);
    expect(Array.from(onAddAttachments.mock.calls[0]?.[0] ?? [])).toEqual([file]);
  });

  it('lets users search and choose any skill beside the attachment control', async () => {
    const user = userEvent.setup();
    const onStart = vi.fn();

    function Harness(): JSX.Element {
      const [activeSkillId, setActiveSkillId] = React.useState('data-report-insight');
      const [query, setQuery] = React.useState('帮我核对合同');
      return (
        <CapabilityCenterContent
          {...baseProps}
          activeSkillId={activeSkillId}
          query={query}
          onQueryChange={setQuery}
          onSelectSkill={setActiveSkillId}
          onStart={onStart}
        />
      );
    }

    render(<Harness />);

    const attachmentControl = screen.getByRole('button', { name: '添加附件' });
    const skillControl = screen.getByRole('button', { name: '选择技能：自动匹配' });
    expect(attachmentControl.parentElement).toBe(skillControl.parentElement);

    await user.click(skillControl);
    expect(screen.getByRole('menuitem', { name: '自动匹配' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /数据报表解读/ })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /社交媒体策略/ })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /合同风险审查/ })).toBeTruthy();

    await user.type(screen.getByRole('searchbox', { name: '搜索技能' }), '合同');
    expect(screen.queryByRole('menuitem', { name: /数据报表解读/ })).toBeNull();
    expect(screen.getByRole('menuitem', { name: /合同风险审查/ })).toBeTruthy();

    await user.click(screen.getByRole('menuitem', { name: /合同风险审查/ }));
    const composer = screen.getByTestId('capability-studio');
    expect(within(composer).getByText('将调用')).toBeTruthy();
    expect(within(composer).getAllByText('合同风险审查').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('button', { name: '选择技能：合同风险审查' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: '开始任务：帮我核对合同' }));
    expect(onStart).toHaveBeenCalledWith(skills[2], '帮我核对合同', 'manual');
  });

  it('keeps skill picker labels readable when a light menu row receives focus', async () => {
    const user = userEvent.setup();
    render(<CapabilityCenterContent {...baseProps} />);

    await user.click(screen.getByRole('button', { name: '选择技能：自动匹配' }));

    const automaticItem = screen.getByRole('menuitem', { name: '自动匹配' });
    const reportItem = screen.getByRole('menuitem', { name: /数据报表解读/ });

    for (const item of [automaticItem, reportItem]) {
      expect(item.className).toContain('focus:text-[#302C2F]');
      expect(item.className).not.toContain('focus:text-accent-foreground');
    }

    expect(
      within(automaticItem).getByText('根据任务和附件选择最合适的技能').className,
    ).toContain('text-[#746E72]');
    expect(
      within(reportItem).getByText('把零散数据变成清晰结论。').className,
    ).toContain('text-[#746E72]');
  });

  it('returns an explicit skill choice to automatic matching', async () => {
    const user = userEvent.setup();
    const onStart = vi.fn();

    function Harness(): JSX.Element {
      const [activeSkillId, setActiveSkillId] = React.useState('data-report-insight');
      const [query, setQuery] = React.useState('分析这份销售报表');
      return (
        <CapabilityCenterContent
          {...baseProps}
          activeSkillId={activeSkillId}
          query={query}
          onQueryChange={setQuery}
          onSelectSkill={setActiveSkillId}
          onStart={onStart}
        />
      );
    }

    render(<Harness />);
    await user.click(screen.getByRole('button', { name: '选择技能：自动匹配' }));
    await user.click(screen.getByRole('menuitem', { name: /合同风险审查/ }));
    expect(screen.getByRole('button', { name: '选择技能：合同风险审查' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: '选择技能：合同风险审查' }));
    await user.click(screen.getByRole('menuitem', { name: '自动匹配' }));

    expect(screen.getByRole('button', { name: '选择技能：自动匹配' })).toBeTruthy();
    expect(within(screen.getByTestId('capability-studio')).queryByText('将调用')).toBeNull();
    await user.click(screen.getByRole('button', { name: '开始任务：分析这份销售报表' }));
    expect(onStart).toHaveBeenCalledWith(skills[0], '分析这份销售报表', 'suggested');
  });

  it('closes the skill picker with Escape while search is focused', async () => {
    const user = userEvent.setup();
    render(<CapabilityCenterContent {...baseProps} />);

    await user.click(screen.getByRole('button', { name: '选择技能：自动匹配' }));
    const searchbox = screen.getByRole('searchbox', { name: '搜索技能' });
    await user.click(searchbox);
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('searchbox', { name: '搜索技能' })).toBeNull();
  });

  it('keeps the full catalogue available while focusing a strong matched capability', async () => {
    const user = userEvent.setup();

    function Harness(): JSX.Element {
      const [query, setQuery] = React.useState('');
      return <CapabilityCenterContent {...baseProps} query={query} onQueryChange={setQuery} />;
    }

    render(<Harness />);
    await user.type(screen.getByRole('textbox', { name: '描述想完成的任务' }), '合同');

    expect(screen.getByText('发现 3 项高风险条款，并给出逐条修改方向。')).toBeTruthy();
    expect(
      within(screen.getByTestId('intent-understanding')).getByRole('button', {
        name: '选择匹配技能：合同风险审查',
      }),
    ).toBeTruthy();
    const catalogue = screen.getByTestId('capability-catalogue');
    expect(within(catalogue).getByText('合同风险审查')).toBeTruthy();
    expect(within(catalogue).getByText('数据报表解读')).toBeTruthy();
    expect(within(catalogue).getByText('社交媒体策略')).toBeTruthy();
  });

  it('finds capabilities from the task and outcome language shown to users', async () => {
    const user = userEvent.setup();

    function Harness(): JSX.Element {
      const [query, setQuery] = React.useState('');
      return <CapabilityCenterContent {...baseProps} query={query} onQueryChange={setQuery} />;
    }

    render(<Harness />);
    const search = screen.getByRole('textbox', { name: '描述想完成的任务' });
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
    const search = screen.getByRole('textbox', { name: '描述想完成的任务' });
    const intent = '帮我分析销售数据，找出复购率下降原因';
    await user.type(search, intent);

    expect(screen.getByText('Holaday 已理解')).toBeTruthy();
    expect(screen.getByText('结论基于你提供的数据，不替代专业审计。')).toBeTruthy();
    const start = screen.getByRole('button', {
      name: `开始任务：${intent}`,
    });
    await user.click(start);

    expect(onStart).toHaveBeenCalledWith(skills[0], intent, 'suggested');
  });

  it('keeps explicitly selected skills available even when they are not common', async () => {
    const user = userEvent.setup();

    function Harness(): JSX.Element {
      const [query, setQuery] = React.useState('合同和数据');
      return (
        <CapabilityCenterContent
          {...baseProps}
          query={query}
          onQueryChange={setQuery}
          onStart={vi.fn()}
        />
      );
    }

    render(<Harness />);
    await user.click(
      within(screen.getByTestId('intent-understanding')).getByRole('button', {
        name: '选择匹配技能：合同风险审查',
      }),
    );

    const startAction = screen.getByRole('button', { name: '开始任务：合同和数据' });
    expect(startAction.hasAttribute('disabled')).toBe(false);
  });

  it('shows a directly selected catalogue skill above the prompt and submits that skill', async () => {
    const user = userEvent.setup();
    const onStart = vi.fn();
    function Harness(): JSX.Element {
      const [activeSkillId, setActiveSkillId] = React.useState('data-report-insight');
      const [query, setQuery] = React.useState('');
      return (
        <CapabilityCenterContent
          {...baseProps}
          activeSkillId={activeSkillId}
          query={query}
          onQueryChange={setQuery}
          onSelectSkill={setActiveSkillId}
          onStart={onStart}
        />
      );
    }
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: '查看合同风险审查' }));
    await user.type(screen.getByRole('textbox', { name: '描述想完成的任务' }), '分析销售数据');

    const composer = screen.getByTestId('capability-studio');
    expect(within(composer).getByText('将调用')).toBeTruthy();
    expect(within(composer).getAllByText('合同风险审查').length).toBeGreaterThanOrEqual(1);
    const start = screen.getByRole('button', { name: '开始任务：分析销售数据' });
    expect(start.getAttribute('title')).toBe('用已选技能开始任务');
    await user.click(start);
    expect(onStart).toHaveBeenCalledWith(skills[2], '分析销售数据', 'manual');
  });

  it('keeps every capability available when the request is too vague to match honestly', async () => {
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
    await user.type(screen.getByRole('textbox', { name: '描述想完成的任务' }), '帮我处理一下');

    expect(screen.getByText('还不能确定最适合的能力')).toBeTruthy();
    const start = screen.getByRole('button', { name: '开始任务：帮我处理一下' });
    expect(start.hasAttribute('disabled')).toBe(false);
    await user.click(start);
    expect(onStart).toHaveBeenCalledWith(skills[0], '帮我处理一下', 'suggested');
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
    await user.type(screen.getByRole('textbox', { name: '描述想完成的任务' }), '周报');

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
      const [query, setQuery] = React.useState('分析数据并规划社媒内容');
      return (
        <CapabilityCenterContent
          {...baseProps}
          activeSkillId={activeSkillId}
          query={query}
          onQueryChange={setQuery}
          onSelectSkill={setActiveSkillId}
          onStart={onStart}
        />
      );
    }

    render(<Harness />);
    expect(screen.getByTestId('intent-understanding')).toBeTruthy();

    await user.click(
      screen.getByRole('button', { name: '选择任务示例：分析这份周报并找出异常' }),
    );

    expect(screen.getAllByText('数据报表解读').length).toBeGreaterThan(0);
    expect(screen.getByText('已选任务')).toBeTruthy();
    expect(screen.getAllByText('分析这份周报并找出异常').length).toBeGreaterThan(0);

    expect(onStart).not.toHaveBeenCalled();
  });

  it('exposes one clear toggle action for each catalogue capability', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<CapabilityCenterContent {...baseProps} onToggle={onToggle} />);

    await user.click(screen.getByRole('switch', { name: '设为常用：社交媒体策略' }));
    expect(onToggle).toHaveBeenCalledWith(skills[1]);
    expect(
      screen
        .getByRole('switch', { name: '取消常用：数据报表解读' })
        .getAttribute('aria-checked'),
    ).toBe('true');
    const enabledSwitch = screen.getByRole('switch', { name: '取消常用：数据报表解读' });
    expect(within(enabledSwitch).queryByText('常用')).toBeNull();
    const enabledTrack = enabledSwitch.querySelector('span[aria-hidden]');
    expect(enabledTrack?.className).toContain('bg-[#E9A6B9]');
    expect(enabledTrack?.className).toContain('h-[18px] w-8');
    expect(enabledTrack?.querySelector('span')?.className).toContain('left-[3px]');
    expect(enabledTrack?.querySelector('span')?.className).toContain('translate-x-[14px]');
    expect(enabledTrack?.querySelector('span')?.className).toContain('bg-white');
    const disabledTrack = screen
      .getByRole('switch', { name: '设为常用：社交媒体策略' })
      .querySelector('span[aria-hidden]');
    expect(disabledTrack?.className).toContain('bg-[#D2CDD0]');
    expect(disabledTrack?.querySelector('span')?.className).toContain('translate-x-0');
    expect(screen.queryByRole('link', { name: '浏览全部技能' })).toBeNull();
  });
});
