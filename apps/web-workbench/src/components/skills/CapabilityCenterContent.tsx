import { SkillLogo } from '@/components/SkillLogo';
import {
  groupSkillsByCategory,
  matchSkillsForIntent,
  pickCapabilityShowcase,
} from '@/lib/skills-page-state';
import { cn } from '@/lib/utils';
import type { UiSkill } from '@/types/task';
import {
  BarChart3,
  CalendarDays,
  FileText,
  Grid3X3,
  Loader2,
  LockKeyhole,
  MessageSquareText,
  Paperclip,
  Plus,
  Search,
  Send,
  ShieldCheck,
} from 'lucide-react';
import * as React from 'react';

interface CapabilityCenterContentProps {
  skills: readonly UiSkill[];
  activeSkillId: string;
  query: string;
  pendingId: string | null;
  cap: number;
  enabledCount: number;
  notice?: React.ReactNode;
  onQueryChange(query: string): void;
  onSelectSkill(skillId: string): void;
  onStart(skill: UiSkill, prompt: string, skillSource?: 'manual' | 'suggested'): void;
  onToggle(skill: UiSkill): void;
}

const TASK_ICONS = [FileText, BarChart3, ShieldCheck, CalendarDays] as const;

const CATEGORY_LABELS: Readonly<Record<UiSkill['category'], string>> = {
  分析决策: '研究与分析',
  内容运营: '内容与表达',
  管理协作: '工作自动化',
};

const CATEGORY_DISPLAY_ORDER: readonly UiSkill['category'][] = [
  '分析决策',
  '内容运营',
  '管理协作',
];

export function CapabilityCenterContent({
  skills,
  activeSkillId,
  query,
  pendingId,
  cap,
  enabledCount,
  notice,
  onQueryChange,
  onSelectSkill,
  onStart,
  onToggle,
}: CapabilityCenterContentProps): JSX.Element {
  const [intentSelection, setIntentSelection] = React.useState<{
    readonly query: string;
    readonly skillId: string;
  } | null>(null);
  const [previewExpanded, setPreviewExpanded] = React.useState(true);
  const showcase = React.useMemo(() => pickCapabilityShowcase(skills), [skills]);
  const trimmedQuery = query.trim();
  const intentMatch = React.useMemo(
    () => matchSkillsForIntent(skills, trimmedQuery),
    [skills, trimmedQuery],
  );
  const matchedSkill =
    intentMatch.confidence === 'strong' ? intentMatch.matches[0]?.skill : undefined;
  const selectedIntentSkill =
    intentSelection?.query === trimmedQuery
      ? skills.find((skill) => skill.id === intentSelection.skillId)
      : undefined;
  const activeSkill =
    selectedIntentSkill ??
    matchedSkill ??
    skills.find((skill) => skill.id === activeSkillId) ??
    showcase[0] ??
    skills[0];
  const secondaryShowcase = (
    matchedSkill
      ? intentMatch.matches
          .filter((match) => match.score > 0 && match.skill.id !== activeSkill?.id)
          .map((match) => match.skill)
      : showcase.filter((skill) => skill.id !== activeSkill?.id)
  ).slice(0, 2);
  const filteredSkills = skills;
  const grouped = React.useMemo(
    () =>
      [...groupSkillsByCategory(filteredSkills)].sort(
        (a, b) =>
          CATEGORY_DISPLAY_ORDER.indexOf(a.category) -
          CATEGORY_DISPLAY_ORDER.indexOf(b.category),
      ),
    [filteredSkills],
  );
  const commonSkills = React.useMemo(() => skills.filter((skill) => skill.enabled), [skills]);

  if (!activeSkill) return <></>;

  const activeSkillPending = pendingId === activeSkill.id;
  const anotherSkillPending = pendingId !== null && !activeSkillPending;
  const activeSkillBlocked = !activeSkill.enabled && enabledCount >= cap;
  const manualPrimaryBlocked = selectedIntentSkill !== undefined && activeSkillBlocked;
  const suggestionUnavailable = activeSkillPending || anotherSkillPending;
  const primaryActionUnavailable = suggestionUnavailable || manualPrimaryBlocked;
  const manualBlockLabel = cap <= 0 ? '暂不可用' : '已达上限';
  const startActionLabel = activeSkillPending
    ? '准备中…'
    : anotherSkillPending
      ? '请稍候'
      : activeSkillBlocked
        ? cap <= 0
          ? '暂不可用'
          : '已达上限'
        : '开始';
  const startActionAriaPrefix = activeSkillPending
    ? '准备中'
    : anotherSkillPending
      ? '请稍候'
      : activeSkillBlocked
        ? cap <= 0
          ? '暂不可用'
          : '已达上限'
        : '开始任务';
  const startButtonTitle = activeSkillPending
    ? '正在准备这个任务'
    : anotherSkillPending
      ? '请稍候，正在保存其他选择'
      : activeSkillBlocked
        ? cap <= 0
          ? '当前套餐暂不支持开始此任务'
          : '请先从常用技能中移除一项'
        : undefined;

  const taskCandidatePool = [...showcase, ...secondaryShowcase, ...skills];
  const categoryAnchors = CATEGORY_DISPLAY_ORDER.filter(
    (category) => category !== activeSkill.category,
  )
    .map((category) => taskCandidatePool.find((skill) => skill.category === category))
    .filter((skill): skill is UiSkill => skill !== undefined);
  const taskShowcase = Array.from(
    new Map(
      [activeSkill, ...categoryAnchors, ...secondaryShowcase, ...showcase, ...skills].map((skill) => [
        skill.id,
        skill,
      ]),
    ).values(),
  ).slice(0, 4);
  const suggestedTaskItems = taskShowcase.map((skill, index) => ({
    id: `${index === 0 ? 'start' : 'preview'}:${skill.id}`,
    kind: index === 0 ? ('start' as const) : ('preview' as const),
    prompt: skill.experience.starterPrompts[0] ?? skill.name,
    skill,
  }));

  function selectSkill(skill: UiSkill): void {
    if (matchedSkill) {
      setIntentSelection({ query: trimmedQuery, skillId: skill.id });
    }
    onSelectSkill(skill.id);
  }

  return (
    <div className="pb-12 text-[#252326]">
      <header
        data-testid="capability-header"
        className="flex flex-col gap-5 pb-6 sm:flex-row sm:items-start sm:justify-between"
      >
        <div className="min-w-0">
          <h1 className="text-[30px] font-semibold leading-tight tracking-[-0.045em] text-[#242225]">
            技能中心
          </h1>
          <p className="mt-2 text-[13px] leading-6 text-[#777176]">
            说出你想完成的事，我会自动匹配并组合需要的技能。
          </p>
        </div>
        <a
          href="#all-skills"
          className="inline-flex min-h-10 shrink-0 items-center gap-2 self-start rounded-xl px-3 text-[13px] font-medium text-[#3E3A3D] transition-colors hover:bg-[#F4F2F1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#EA1F59]/20"
        >
          全部技能
          <Grid3X3 className="h-[18px] w-[18px] text-[#696369]" aria-hidden />
        </a>
      </header>

      {notice}

      <section
        data-testid="capability-studio"
        aria-label="描述任务"
        className={cn('mt-1 rounded-[20px] bg-[#F5F3F1] p-5 sm:p-6', notice && 'mt-5')}
      >
        <label htmlFor="skill-intent" className="block text-[12px] font-medium text-[#6F696E]">
          现在想完成什么？
        </label>
        <div className="mt-2 flex items-end gap-4">
          <textarea
            id="skill-intent"
            aria-label="描述想完成的任务"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="例如：把零售行业资料整理成一份明天可以直接讲的方案"
            rows={2}
            className="min-h-[68px] flex-1 resize-none bg-transparent text-[17px] font-medium leading-7 tracking-[-0.012em] text-[#292629] outline-none placeholder:text-[#A09A9E] focus-visible:placeholder:text-[#B2ACAF]"
          />
          <button
            type="button"
            aria-label={
              manualPrimaryBlocked
                ? `${manualBlockLabel}：${trimmedQuery}`
                : trimmedQuery
                  ? `提交并查看匹配：${trimmedQuery}`
                  : '提交任务描述'
            }
            title={
              manualPrimaryBlocked
                ? startButtonTitle
                : matchedSkill
                ? '用匹配的技能开始任务'
                : trimmedQuery
                  ? '请再补充一些具体目标'
                  : '先描述你想完成的任务'
            }
            disabled={!matchedSkill || primaryActionUnavailable}
            onClick={() =>
              onStart(
                activeSkill,
                trimmedQuery,
                selectedIntentSkill ? 'manual' : 'suggested',
              )
            }
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[11px] bg-[#EA1F59] text-white shadow-[0_8px_18px_rgba(234,31,89,0.18)] transition duration-200 hover:-translate-y-0.5 hover:bg-[#D91A52] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#EA1F59]/30 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-[#D8D3D5] disabled:shadow-none disabled:hover:translate-y-0 motion-reduce:transform-none"
          >
            {suggestionUnavailable ? (
              <Loader2 className="h-[18px] w-[18px] animate-spin" aria-hidden />
            ) : manualPrimaryBlocked ? (
              <LockKeyhole className="h-[18px] w-[18px]" aria-hidden />
            ) : (
              <Send className="h-[18px] w-[18px]" aria-hidden />
            )}
          </button>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] text-[#817B7F]">
          <span className="inline-flex items-center gap-1.5">
            <Paperclip className="h-4 w-4" aria-hidden />
            开始后可添加附件
          </span>
          <span className="inline-flex items-center gap-1.5">
            <FileText className="h-4 w-4" aria-hidden />
            可使用已有文件
          </span>
          <span className="inline-flex items-center gap-1.5">
            <MessageSquareText className="h-4 w-4" aria-hidden />
            可继续补充要求
          </span>
        </div>
      </section>

      {trimmedQuery && intentMatch.confidence === 'low' && (
        <div role="status" className="mt-5 flex items-start gap-3 px-1 text-[12px] leading-5">
          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[#D3CFD1]" aria-hidden />
          <div>
            <span className="font-semibold text-[#3E3A3D]">还不能确定最适合的能力</span>
            <span className="ml-2 text-[#817B7F]">可以补充具体目标，或从下方任务中选择。</span>
          </div>
        </div>
      )}

      {matchedSkill && (
        <section
          data-testid="intent-understanding"
          aria-labelledby="intent-understanding-title"
          className="mt-6 px-1"
        >
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-[#EA1F59] shadow-[0_0_0_5px_rgba(234,31,89,0.08)]" aria-hidden />
                <h2
                  id="intent-understanding-title"
                  className="text-[14px] font-semibold text-[#2F2B2E]"
                >
                  Holaday 已理解
                </h2>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-3 text-[12px] text-[#777176]">
                <span>这项任务需要</span>
                {intentMatch.matches
                  .filter((match) => match.score > 0)
                  .slice(0, 3)
                  .map(({ skill }, index) => (
                    <React.Fragment key={skill.id}>
                      {index > 0 && (
                        <span className="h-1.5 w-1.5 rounded-full bg-[#EA1F59]" aria-hidden />
                      )}
                      <button
                        type="button"
                        aria-label={`选择匹配技能：${skill.name}`}
                        title={`查看匹配技能：${skill.name}`}
                        aria-pressed={skill.id === activeSkill.id}
                        onClick={() => selectSkill(skill)}
                        className={cn(
                          'inline-flex min-h-9 items-center gap-2 rounded-xl px-2 py-1 text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#EA1F59]/20',
                          skill.id === activeSkill.id
                            ? 'bg-[#F6F3F2] text-[#2F2B2E]'
                            : 'text-[#625C61] hover:bg-[#F6F3F2]',
                        )}
                      >
                        <SkillLogo logoId={skill.logoId} label={skill.name} size="sm" />
                        {skill.name}
                      </button>
                    </React.Fragment>
                  ))}
              </div>
              <p className="mt-3 max-w-3xl text-[12px] leading-6 text-[#777176]">
                {activeSkill.description}
              </p>
              <p className="mt-1 max-w-3xl text-[11px] leading-5 text-[#918B8F]">
                {activeSkill.experience.boundary}
              </p>
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-4">
              <button
                type="button"
                role="switch"
                aria-label="执行预览"
                title={previewExpanded ? '收起执行预览' : '展开执行预览'}
                aria-checked={previewExpanded}
                aria-controls="execution-preview-details"
                onClick={() => setPreviewExpanded((current) => !current)}
                className="inline-flex min-h-10 items-center gap-2 rounded-xl px-2 text-[12px] font-medium text-[#5E585C] transition-colors hover:bg-[#F6F3F2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#EA1F59]/20"
              >
                执行预览
                <span
                  aria-hidden
                  className={cn(
                    'relative h-[22px] w-10 rounded-full transition-colors duration-200',
                    previewExpanded ? 'bg-[#EA1F59]' : 'bg-[#D2CDD0]',
                  )}
                >
                  <span
                    className={cn(
                      'absolute top-[3px] h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200',
                      previewExpanded ? 'translate-x-[21px]' : 'translate-x-[3px]',
                    )}
                  />
                </span>
              </button>
              <button
                type="button"
                aria-label={
                  manualPrimaryBlocked
                    ? `${manualBlockLabel}并无法开始：${trimmedQuery}`
                    : `开始任务：${trimmedQuery}`
                }
                title={
                  manualPrimaryBlocked
                    ? startButtonTitle
                    : suggestionUnavailable
                      ? '请稍候，正在保存常用技能'
                      : '开始任务'
                }
                aria-busy={suggestionUnavailable}
                disabled={primaryActionUnavailable}
                onClick={() =>
                  onStart(
                    activeSkill,
                    trimmedQuery,
                    selectedIntentSkill ? 'manual' : 'suggested',
                  )
                }
                className="inline-flex min-h-10 items-center justify-center rounded-[10px] bg-[#EA1F59] px-5 text-[12px] font-semibold text-white shadow-[0_7px_16px_rgba(234,31,89,0.16)] transition duration-200 hover:-translate-y-0.5 hover:bg-[#D91A52] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#EA1F59]/25 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:translate-y-0 motion-reduce:transform-none"
              >
                {suggestionUnavailable
                  ? '请稍候'
                  : manualPrimaryBlocked
                    ? manualBlockLabel
                    : '开始任务'}
              </button>
            </div>
          </div>

          {previewExpanded && (
            <div
              id="execution-preview-details"
              className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] leading-5 text-[#777176]"
            >
              <p className="mr-2 font-medium text-[#4B464A]">
                {activeSkill.experience.exampleSummary}
              </p>
              {activeSkill.experience.deliverables.map((deliverable) => (
                <span key={deliverable} className="inline-flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#EA1F59]" aria-hidden />
                  {deliverable}
                </span>
              ))}
            </div>
          )}
        </section>
      )}

      <section aria-labelledby="task-starters-title" className="mt-9">
        <h2 id="task-starters-title" className="text-[16px] font-semibold text-[#2E2A2D]">
          不确定从哪开始？
        </h2>
        <div
          data-testid="task-starter-grid"
          className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(min(100%,28rem),1fr))] gap-x-12 gap-y-1"
        >
          {suggestedTaskItems.map((item, index) => {
            const Icon = TASK_ICONS[index % TASK_ICONS.length];
            const itemIsActive = item.skill.id === activeSkill.id;
            const itemPending = pendingId === item.skill.id;
            const itemBlocked = item.kind === 'start' && !item.skill.enabled && enabledCount >= cap;
            const itemDisabled =
              item.kind === 'start' && (itemPending || anotherSkillPending || itemBlocked);
            return (
              <button
                key={item.id}
                type="button"
                aria-label={
                  item.kind === 'preview'
                    ? `预览${item.skill.name}`
                    : `${startActionAriaPrefix}：${item.prompt}`
                }
                title={
                  item.kind === 'preview'
                    ? `预览${item.skill.name}`
                    : startButtonTitle ?? item.prompt
                }
                aria-busy={item.kind === 'start' ? itemPending : undefined}
                disabled={itemDisabled}
                onClick={() => {
                  if (item.kind === 'preview') {
                    selectSkill(item.skill);
                    return;
                  }
                  onStart(item.skill, item.prompt);
                }}
                className="group flex min-h-[70px] w-full items-center gap-3 rounded-[14px] px-2 py-2 text-left transition-colors hover:bg-[#F7F5F3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#EA1F59]/18 disabled:cursor-not-allowed disabled:opacity-55"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] bg-[#F0EEEB] text-[#393538] transition-colors group-hover:bg-white">
                  <Icon className="h-[18px] w-[18px]" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium text-[#302C2F]">
                    {item.prompt}
                  </span>
                  <span className="mt-0.5 line-clamp-1 block text-[11px] leading-5 text-[#858084]">
                    {item.skill.description}
                  </span>
                </span>
                <span className="flex min-w-12 shrink-0 items-center justify-end gap-2 text-[10px] font-medium text-[#8E888C]">
                  {item.kind === 'start' && <span>{startActionLabel}</span>}
                  {itemPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  ) : itemBlocked ? (
                    <LockKeyhole className="h-4 w-4 text-[#A98A37]" aria-hidden />
                  ) : (
                    <span
                      className={cn(
                        'h-2.5 w-2.5 rounded-full transition-all duration-200 group-hover:scale-125',
                        item.kind === 'preview' || !itemIsActive
                          ? 'bg-[#D2CED0] group-hover:bg-[#EA1F59]'
                          : 'bg-[#EA1F59]',
                      )}
                      aria-hidden
                    />
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="common-skills-title" className="mt-8">
        <h2 id="common-skills-title" className="text-[16px] font-semibold text-[#2E2A2D]">
          常用技能
        </h2>
        <div className="mt-3 flex flex-wrap gap-2.5">
          {commonSkills.map((skill) => (
            <button
              key={skill.id}
              type="button"
              aria-label={`打开常用技能：${skill.name}`}
              aria-pressed={skill.id === activeSkill.id}
              title={skill.name}
              onClick={() => selectSkill(skill)}
              className={cn(
                'flex h-11 w-11 items-center justify-center rounded-[12px] transition duration-200 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#EA1F59]/20 motion-reduce:transform-none',
                skill.id === activeSkill.id ? 'bg-[#FFF0F4]' : 'bg-[#F5F3F1] hover:bg-[#EEEAE8]',
              )}
            >
              <SkillLogo logoId={skill.logoId} label={skill.name} size="sm" />
            </button>
          ))}
          <a
            href="#all-skills"
            aria-label="浏览全部技能"
            className="flex h-11 w-11 items-center justify-center rounded-[12px] bg-[#F5F3F1] text-[#777176] transition duration-200 hover:-translate-y-0.5 hover:bg-[#EEEAE8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#EA1F59]/20 motion-reduce:transform-none"
          >
            <Plus className="h-[18px] w-[18px]" aria-hidden />
          </a>
        </div>
      </section>

      <section
        id="all-skills"
        aria-labelledby="capability-catalogue-title"
        data-testid="capability-catalogue"
        className="mt-9 scroll-mt-6"
      >
        <h2 id="capability-catalogue-title" className="sr-only">
          全部技能
        </h2>

        {grouped.length === 0 ? (
          <div className="mt-5 rounded-[14px] bg-[#F7F5F3] px-6 py-10 text-center text-sm text-[#777176]">
            没有找到匹配的技能，换个关键词试试。
          </div>
        ) : (
          <div
            data-testid="capability-catalogue-grid"
            className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,17rem),1fr))] gap-x-12 gap-y-9"
          >
            {grouped.map(({ category, items }) => (
              <div key={category}>
                <h3 className="text-[12px] font-semibold tracking-[0.02em] text-[#4E494D]">
                  {CATEGORY_LABELS[category]}
                </h3>
                <div className="mt-3 space-y-1">
                  {items.map((skill) => {
                    const pending = pendingId === skill.id;
                    const anotherPending = pendingId !== null && !pending;
                    const limitBlocked = !skill.enabled && enabledCount >= cap;
                    return (
                      <div
                        key={skill.id}
                        className={cn(
                          'flex min-h-[64px] items-center gap-2 rounded-[13px] px-1.5 py-1.5 transition-colors hover:bg-[#F7F5F3]',
                          anotherPending && 'opacity-60',
                        )}
                      >
                        <button
                          type="button"
                          aria-label={`查看${skill.name}`}
                          title={`查看${skill.name}`}
                          aria-pressed={skill.id === activeSkill.id}
                          onClick={() => selectSkill(skill)}
                          className="flex min-w-0 flex-1 items-center gap-3 rounded-[10px] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#EA1F59]/18"
                        >
                          <SkillLogo logoId={skill.logoId} label={skill.name} size="sm" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[12px] font-semibold text-[#302C2F]">
                              {skill.name}
                            </span>
                            <span className="mt-0.5 block line-clamp-2 text-[11px] leading-[18px] text-[#858084]">
                              {skill.description}
                            </span>
                          </span>
                        </button>
                        <button
                          type="button"
                          role="switch"
                          aria-label={`${skill.enabled ? '取消常用：' : '设为常用：'}${skill.name}`}
                          title={
                            pending
                              ? '正在保存'
                              : limitBlocked
                                ? '常用技能已达上限'
                                : skill.enabled
                                  ? '从常用技能移除'
                                  : '设为常用技能'
                          }
                          aria-checked={skill.enabled}
                          aria-busy={pending}
                          disabled={pending || anotherPending || limitBlocked}
                          onClick={() => onToggle(skill)}
                          className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-[10px] px-1.5 text-[10px] font-medium text-[#817B7F] transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#EA1F59]/18 disabled:cursor-not-allowed disabled:opacity-55"
                        >
                          <span>常用</span>
                          <span
                            aria-hidden
                            className={cn(
                              'relative h-[18px] w-8 rounded-full transition-colors duration-200',
                              skill.enabled
                                ? 'bg-[#EA1F59]'
                                : limitBlocked
                                  ? 'bg-[#E8D9A7]'
                                  : 'bg-[#D2CDD0]',
                            )}
                          >
                            {pending ? (
                              <Loader2 className="absolute left-2 top-1 h-2.5 w-2.5 animate-spin text-white" />
                            ) : limitBlocked ? (
                              <LockKeyhole className="absolute left-2 top-1 h-2.5 w-2.5 text-[#8E6A11]" />
                            ) : (
                              <span
                                className={cn(
                                  'absolute top-[3px] h-3 w-3 rounded-full bg-white shadow-sm transition-transform duration-200',
                                  skill.enabled ? 'translate-x-[17px]' : 'translate-x-[3px]',
                                )}
                              />
                            )}
                          </span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="mt-10 flex flex-wrap items-center gap-x-5 gap-y-3 text-[11px] leading-5 text-[#858084]">
        <span className="inline-flex items-center gap-2">
          <Search className="h-4 w-4" aria-hidden />
          技能会在任务需要时自动使用；开始前可查看执行方式与所需资料。
        </span>
      </div>
    </div>
  );
}
