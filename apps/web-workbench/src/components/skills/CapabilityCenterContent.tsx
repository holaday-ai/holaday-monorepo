import { SkillLogo } from '@/components/SkillLogo';
import { groupSkillsByCategory, pickCapabilityShowcase } from '@/lib/skills-page-state';
import { cn } from '@/lib/utils';
import type { UiSkill } from '@/types/task';
import {
  ArrowRight,
  Check,
  ChevronRight,
  Loader2,
  LockKeyhole,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
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
  onStart(skill: UiSkill, prompt: string): void;
  onToggle(skill: UiSkill): void;
}

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
  const showcase = React.useMemo(() => pickCapabilityShowcase(skills), [skills]);
  const activeSkill =
    skills.find((skill) => skill.id === activeSkillId) ?? showcase[0] ?? skills[0];
  const secondaryShowcase = showcase.filter((skill) => skill.id !== activeSkill?.id).slice(0, 2);
  const filteredSkills = React.useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return skills;
    return skills.filter((skill) =>
      [
        skill.name,
        skill.id,
        skill.description,
        ...skill.aliases,
        ...skill.experience.starterPrompts,
        ...skill.experience.deliverables,
        skill.experience.exampleSummary,
      ].some((value) => value.toLowerCase().includes(normalizedQuery)),
    );
  }, [query, skills]);
  const grouped = React.useMemo(() => groupSkillsByCategory(filteredSkills), [filteredSkills]);

  if (!activeSkill) return <></>;

  const activeSkillPending = pendingId === activeSkill.id;
  const anotherSkillPending = pendingId !== null && !activeSkillPending;
  const activeSkillBlocked = !activeSkill.enabled && enabledCount >= cap;
  const startUnavailable = activeSkillPending || anotherSkillPending || activeSkillBlocked;
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
          : '请先从常用能力中移除一项'
        : undefined;

  return (
    <div className="space-y-7 pb-10">
      <header
        data-testid="capability-header"
        className="flex flex-col gap-5 lg:pr-[200px] xl:flex-row xl:items-end xl:justify-between"
      >
        <div className="min-w-0">
          <div className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-[#FFF2F6] px-2.5 py-1 text-[11px] font-semibold tracking-[0.08em] text-[#CF174B]">
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
            HOLADAY 能力
          </div>
          <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.03em] text-foreground">
            能力中心
          </h1>
          <p className="mt-2 max-w-xl text-[13px] leading-6 text-muted-foreground">
            选择你想完成的事，Holaday 会匹配需要的能力并带你开始。
          </p>
        </div>
        <div className="w-full max-w-sm">
          <label className="relative block">
            <Search
              className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#ADADAD]"
              aria-hidden
            />
            <input
              type="search"
              aria-label="搜索想完成的任务"
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="搜索想完成的任务"
              className="h-11 w-full rounded-full border border-[#DCDDDD] bg-white px-10 text-sm text-foreground shadow-[0_8px_24px_rgba(45,39,52,0.05)] outline-none transition-colors placeholder:text-[#ADADAD] focus:border-[#EA1F59]/45 focus:ring-2 focus:ring-[#EA1F59]/10"
            />
          </label>
        </div>
      </header>

      {notice}

      <section
        data-testid="capability-studio"
        aria-labelledby="active-capability-title"
        className="relative overflow-hidden rounded-[24px] border border-[#E9E3EA] bg-[linear-gradient(132deg,#FFFDFD_0%,#FFFAFC_42%,#F7FAFF_73%,#F4FCFA_100%)] shadow-[0_22px_64px_rgba(73,55,75,0.09)]"
      >
        <div
          className="pointer-events-none absolute -right-28 -top-32 h-80 w-80 rounded-full bg-[#DDEBFF]/70 blur-3xl"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -bottom-36 left-[18%] h-72 w-72 rounded-full bg-[#FFE6EE]/70 blur-3xl"
          aria-hidden
        />

        <div className="relative z-10 grid lg:grid-cols-[minmax(300px,0.72fr)_minmax(460px,1.28fr)]">
          <div className="p-6 sm:p-8 lg:p-9">
            <div className="flex items-center gap-3">
              <SkillLogo logoId={activeSkill.logoId} label={activeSkill.name} size="lg" />
              <div>
                <div className="inline-flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.1em] text-[#D22455]">
                  <Sparkles className="h-3.5 w-3.5" aria-hidden />
                  推荐从这里开始
                </div>
                <h2
                  id="active-capability-title"
                  className="mt-1 text-[25px] font-semibold tracking-[-0.035em] text-foreground"
                >
                  {activeSkill.name}
                </h2>
              </div>
            </div>
            <p className="mt-5 max-w-md text-[14px] leading-7 text-[#5F5961]">
              {activeSkill.description}
            </p>

            <div className="mt-7">
              <div className="mb-2.5 flex items-center justify-between gap-3 text-[11px] font-semibold text-[#756A72]">
                <span>选择一个任务</span>
                <span className="font-normal text-[#A49BA1]">点击后可补充材料和要求</span>
              </div>
              <div className="space-y-2">
                {activeSkill.experience.starterPrompts.map((prompt, index) => (
                  <button
                    key={prompt}
                    type="button"
                    aria-label={`${startActionAriaPrefix}：${prompt}`}
                    title={startButtonTitle ?? prompt}
                    aria-busy={activeSkillPending}
                    disabled={startUnavailable}
                    onClick={() => onStart(activeSkill, prompt)}
                    className="group flex min-h-12 w-full items-center gap-3 rounded-[13px] border border-white/90 bg-white/78 px-3.5 py-2.5 text-left text-[12px] font-medium text-[#443D43] shadow-[0_5px_18px_rgba(66,52,63,0.045)] backdrop-blur-sm transition duration-200 hover:-translate-y-0.5 hover:border-[#EDC8D3] hover:bg-white hover:shadow-[0_10px_24px_rgba(198,56,96,0.09)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#EA1F59]/20 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 disabled:hover:border-white/90 disabled:hover:bg-white/78 disabled:hover:shadow-[0_5px_18px_rgba(66,52,63,0.045)] motion-reduce:transform-none"
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] bg-[#FFF0F4] text-[10px] font-semibold text-[#D92859]">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <span className="min-w-0 flex-1">{prompt}</span>
                    <span className="shrink-0 text-[10px] font-semibold text-[#A36B7B]">
                      {startActionLabel}
                    </span>
                    {activeSkillPending || anotherSkillPending ? (
                      <Loader2
                        className="h-4 w-4 shrink-0 animate-spin text-[#9F9098]"
                        aria-hidden
                      />
                    ) : activeSkillBlocked ? (
                      <LockKeyhole className="h-4 w-4 shrink-0 text-[#A98A37]" aria-hidden />
                    ) : (
                      <ArrowRight
                        className="h-4 w-4 shrink-0 text-[#9F9098] transition-transform group-hover:translate-x-0.5 group-hover:text-[#D92859] motion-reduce:transform-none"
                        aria-hidden
                      />
                    )}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="border-t border-white/85 bg-white/34 p-4 sm:p-6 lg:border-l lg:border-t-0">
            <article className="h-full min-h-[390px] overflow-hidden rounded-[18px] border border-white bg-white/92 shadow-[0_18px_44px_rgba(57,49,60,0.09)] backdrop-blur-lg">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#EEE9EE] px-5 py-3.5">
                <h3 className="text-[14px] font-semibold text-[#2F2930]">完成后你会得到</h3>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[#F1FBF7] px-2.5 py-1 text-[10px] font-semibold text-[#288367]">
                  <Check className="h-3.5 w-3.5" aria-hidden />
                  示例
                </span>
              </div>

              <div className="p-5 sm:p-6">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="max-w-2xl text-[17px] font-semibold leading-7 tracking-[-0.015em] text-[#302B30]">
                      {activeSkill.experience.exampleSummary}
                    </p>
                  </div>
                  <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-[#D94B75]" aria-hidden />
                </div>

                <div className="mt-6 grid gap-2.5 sm:grid-cols-2">
                  {activeSkill.experience.deliverables.map((deliverable, index) => (
                    <div
                      key={deliverable}
                      className={cn(
                        'rounded-[13px] border px-3.5 py-3.5',
                        index % 2 === 0
                          ? 'border-[#E3EBFF] bg-[#F7FAFF]'
                          : 'border-[#E9E2FA] bg-[#FAF8FF]',
                      )}
                    >
                      <div className="text-[12px] font-semibold text-[#403940]">{deliverable}</div>
                    </div>
                  ))}
                </div>

                <div className="mt-6 flex items-start gap-3 border-t border-[#EEE9EE] pt-4">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#6C8FA9]" aria-hidden />
                  <p className="text-[11px] leading-5 text-[#7D747A]">
                    实际内容会根据你的材料和目标生成，开始后可以继续修改。
                  </p>
                </div>
              </div>
            </article>
          </div>
        </div>
      </section>

      {secondaryShowcase.length > 0 && (
        <section aria-label="其他推荐能力" className="grid gap-3 md:grid-cols-2">
          {secondaryShowcase.map((skill) => (
            <button
              key={skill.id}
              type="button"
              aria-label={`预览${skill.name}`}
              title={`预览${skill.name}`}
              onClick={() => onSelectSkill(skill.id)}
              className="group relative flex min-h-[128px] items-start gap-4 overflow-hidden rounded-[17px] border border-[#E9E4EA] bg-white p-5 text-left shadow-[0_10px_28px_rgba(56,47,52,0.045)] transition hover:-translate-y-0.5 hover:border-[#DDCED7] hover:shadow-[0_16px_34px_rgba(56,47,52,0.075)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#EA1F59]/15 motion-reduce:transform-none"
            >
              <span
                className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-[linear-gradient(90deg,#FFB8CA_0%,#C9C4FF_52%,#A9E8DF_100%)] opacity-75"
                aria-hidden
              />
              <SkillLogo logoId={skill.logoId} label={skill.name} size="md" />
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-semibold text-foreground">
                  {skill.name}
                </span>
                <span className="mt-1 line-clamp-2 block text-[12px] leading-5 text-muted-foreground">
                  {skill.experience.exampleSummary}
                </span>
                <span className="mt-3 inline-flex items-center gap-1 text-[12px] font-semibold text-[#8269A7]">
                  看看能做什么
                  <ChevronRight
                    className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5 motion-reduce:transform-none"
                    aria-hidden
                  />
                </span>
              </span>
            </button>
          ))}
        </section>
      )}

      <section aria-labelledby="capability-catalogue-title" data-testid="capability-catalogue">
        <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="capability-catalogue-title" className="text-lg font-semibold text-foreground">
              全部可完成的任务
            </h2>
            <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
              找到你想做的事，点击查看后即可开始。
            </p>
          </div>
          <div className="text-[12px] font-medium text-muted-foreground">
            {filteredSkills.length} 项
          </div>
        </div>

        {grouped.length === 0 ? (
          <div className="rounded-[14px] border border-dashed border-[#DCDDDD] bg-white px-6 py-10 text-center text-sm text-muted-foreground">
            没有找到匹配的能力，换个关键词试试。
          </div>
        ) : (
          <div className="space-y-6">
            {grouped.map(({ category, items }) => (
              <div key={category}>
                <h3 className="mb-2 text-[12px] font-semibold tracking-[0.04em] text-[#7D7478]">
                  {category}
                </h3>
                <div className="grid gap-2 lg:grid-cols-2">
                  {items.map((skill) => {
                    const pending = pendingId === skill.id;
                    const anotherPending = pendingId !== null && !pending;
                    const limitBlocked = !skill.enabled && enabledCount >= cap;
                    return (
                      <div
                        key={skill.id}
                        className={cn(
                          'flex min-h-[84px] items-center gap-3 rounded-[12px] border bg-white p-3 transition',
                          skill.id === activeSkill.id
                            ? 'border-[#E8BFCB] shadow-[0_6px_18px_rgba(234,31,89,0.06)]'
                            : 'border-[#E9E6E8] hover:border-[#DCCFD4]',
                          anotherPending && 'opacity-60',
                        )}
                      >
                        <button
                          type="button"
                          aria-label={`查看${skill.name}`}
                          title={`查看${skill.name}`}
                          aria-pressed={skill.id === activeSkill.id}
                          onClick={() => onSelectSkill(skill.id)}
                          className="flex min-w-0 flex-1 items-center gap-3 rounded-[8px] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#EA1F59]/15"
                        >
                          <SkillLogo logoId={skill.logoId} label={skill.name} size="md" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] font-semibold text-foreground">
                              {skill.name}
                            </span>
                            <span className="mt-0.5 block line-clamp-2 text-[11px] leading-5 text-muted-foreground">
                              {skill.description}
                            </span>
                          </span>
                        </button>
                        <button
                          type="button"
                          aria-label={`${skill.enabled ? '从常用中移除：' : '加入常用：'}${skill.name}`}
                          title={`${skill.enabled ? '从常用中移除' : '加入常用'}`}
                          aria-pressed={skill.enabled}
                          aria-busy={pending}
                          disabled={pending || anotherPending || limitBlocked}
                          onClick={() => onToggle(skill)}
                          className={cn(
                            'flex h-10 w-10 shrink-0 items-center justify-center rounded-full border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#57479C]/20 disabled:cursor-not-allowed disabled:opacity-55',
                            skill.enabled
                              ? 'border-[#F2C4D2] bg-[#FFF3F7] text-[#D51E52]'
                              : limitBlocked
                                ? 'border-[#E9DFC1] bg-[#FFF9EA] text-[#B58B16]'
                                : 'border-[#DED9DC] bg-white text-[#7D7478] hover:border-[#E6B5C4] hover:bg-[#FFF7F9] hover:text-[#D51E52]',
                          )}
                        >
                          {pending ? (
                            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                          ) : limitBlocked ? (
                            <LockKeyhole className="h-4 w-4" aria-hidden />
                          ) : skill.enabled ? (
                            <Check className="h-4 w-4" aria-hidden />
                          ) : (
                            <Plus className="h-4 w-4" aria-hidden />
                          )}
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
    </div>
  );
}
