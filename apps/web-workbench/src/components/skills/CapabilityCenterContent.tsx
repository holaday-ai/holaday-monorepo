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
  const suggestedTaskItems = taskShowcase.map((skill) => ({
    id: `example:${skill.id}`,
    prompt: skill.experience.starterPrompts[0] ?? skill.name,
    skill,
  }));

  function selectSkill(skill: UiSkill): void {
    if (matchedSkill) {
      setIntentSelection({ query: trimmedQuery, skillId: skill.id });
    }
    onSelectSkill(skill.id);
  }

  function selectTaskExample(skill: UiSkill, prompt: string): void {
    setIntentSelection({ query: prompt, skillId: skill.id });
    onSelectSkill(skill.id);
    onQueryChange(prompt);
  }

  return (
    <div className="pb-12 text-[#252326]">
      <header
        data-testid="capability-header"
        className="flex items-start justify-between gap-4 pb-6"
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
        <div
          data-testid="intent-composer-row"
          className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-4"
        >
          <textarea
            id="skill-intent"
            aria-label="描述想完成的任务"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="例如：把零售行业资料整理成一份明天可以直接讲的方案"
            rows={3}
            className="min-h-[68px] flex-1 resize-none bg-transparent text-[17px] font-medium leading-7 tracking-[-0.012em] text-[#292629] outline-none placeholder:text-[#A09A9E] focus-visible:placeholder:text-[#B2ACAF]"
          />
          <button
            type="button"
            aria-label={
              suggestionUnavailable
                ? activeSkillPending
                  ? `正在准备任务：${trimmedQuery}`
                  : `正在保存常用技能，请稍候：${trimmedQuery}`
                : manualPrimaryBlocked
                ? `${manualBlockLabel}：${trimmedQuery}`
                : trimmedQuery
                  ? `开始任务：${trimmedQuery}`
                  : '开始任务：请先描述任务'
            }
            aria-busy={suggestionUnavailable}
            title={
              manualPrimaryBlocked
                ? startButtonTitle
                : suggestionUnavailable
                  ? startButtonTitle
                  : trimmedQuery
                    ? matchedSkill
                      ? '用匹配的技能开始任务'
                      : '进入任务后继续确认所需技能'
                    : '先描述你想完成的任务'
            }
            disabled={!trimmedQuery || primaryActionUnavailable}
            onClick={() =>
              onStart(
                activeSkill,
                trimmedQuery,
                selectedIntentSkill ? 'manual' : 'suggested',
              )
            }
            className="inline-flex h-11 shrink-0 items-center justify-center gap-2 self-end rounded-[11px] bg-[#EA1F59] px-4 text-[12px] font-semibold text-white shadow-[0_8px_18px_rgba(234,31,89,0.18)] transition duration-200 hover:-translate-y-0.5 hover:bg-[#D91A52] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#EA1F59]/30 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-[#D8D3D5] disabled:shadow-none disabled:hover:translate-y-0 motion-reduce:transform-none"
          >
            {suggestionUnavailable ? (
              <Loader2 className="h-[18px] w-[18px] animate-spin" aria-hidden />
            ) : manualPrimaryBlocked ? (
              <LockKeyhole className="h-[18px] w-[18px]" aria-hidden />
            ) : (
              <>
                <span>开始任务</span>
                <Send className="h-4 w-4" aria-hidden />
              </>
            )}
          </button>
        </div>
        <p className="mt-4 text-[11px] leading-5 text-[#817B7F]">
          进入任务后，可以继续添加资料和补充要求。
        </p>
      </section>

      {trimmedQuery && intentMatch.confidence === 'low' && (
        <div role="status" className="mt-5 flex items-start gap-3 px-1 text-[12px] leading-5">
          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[#D3CFD1]" aria-hidden />
          <div>
            <span className="font-semibold text-[#3E3A3D]">还不能确定最适合的能力</span>
            <span className="ml-2 text-[#817B7F]">
              可以直接开始，我会在任务中继续确认；也可以从下方选择示例。
            </span>
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
                  className="relative h-[22px] w-10 rounded-full bg-[#D2CDD0] transition duration-200"
                >
                  <span
                    className={cn(
                      'absolute top-[3px] h-4 w-4 rounded-full shadow-sm transition duration-200',
                      previewExpanded
                        ? 'translate-x-[21px] bg-[#EA1F59]'
                        : 'translate-x-[3px] bg-white',
                    )}
                  />
                </span>
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
            const itemIsActive =
              item.skill.id === activeSkill.id && item.prompt === trimmedQuery;
            return (
              <button
                key={item.id}
                type="button"
                aria-label={`选择任务示例：${item.prompt}`}
                title="填入这个任务示例"
                aria-pressed={itemIsActive}
                onClick={() => selectTaskExample(item.skill, item.prompt)}
                className={cn(
                  'group flex min-h-[70px] w-full items-center gap-3 rounded-[14px] px-2 py-2 text-left transition-colors hover:bg-[#F7F5F3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#EA1F59]/18',
                  itemIsActive && 'bg-[#F7F5F3]',
                )}
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
                {itemIsActive && (
                  <span className="shrink-0 rounded-full bg-[#FCE8EE] px-2 py-1 text-[10px] font-medium text-[#B91D4A]">
                    已选择
                  </span>
                )}
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
                          className="inline-flex min-h-10 shrink-0 items-center rounded-[10px] px-2 transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#EA1F59]/18 disabled:cursor-not-allowed disabled:opacity-55"
                        >
                          <span
                            aria-hidden
                            className={cn(
                              'relative h-[18px] w-8 rounded-full bg-[#D2CDD0] transition duration-200',
                              limitBlocked && 'bg-[#EEE8D7]',
                            )}
                          >
                            {pending ? (
                              <Loader2 className="absolute left-2 top-1 h-2.5 w-2.5 animate-spin text-[#8B8589]" />
                            ) : limitBlocked ? (
                              <LockKeyhole className="absolute left-2 top-1 h-2.5 w-2.5 text-[#8E6A11]" />
                            ) : (
                              <span
                                className={cn(
                                  'absolute top-[3px] h-3 w-3 rounded-full shadow-sm transition duration-200',
                                  skill.enabled
                                    ? 'translate-x-[17px] bg-[#EA1F59]'
                                    : 'translate-x-[3px] bg-white',
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
