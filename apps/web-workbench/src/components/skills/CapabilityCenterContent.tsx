import { SkillLogo } from '@/components/SkillLogo';
import {
  groupSkillsByCategory,
  pickCapabilityShowcase,
  skillCardUsageHint,
  skillConnectorLabel,
} from '@/lib/skills-page-state';
import { cn } from '@/lib/utils';
import type { UiSkill } from '@/types/task';
import {
  ArrowRight,
  Check,
  ChevronRight,
  FileInput,
  Link2,
  Loader2,
  LockKeyhole,
  PackageCheck,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import * as React from 'react';

interface CapabilityCenterContentProps {
  skills: readonly UiSkill[];
  activeSkillId: string;
  query: string;
  pendingId: string | null;
  cap: number;
  enabledCount: number;
  summary?: string;
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
  summary,
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
      [skill.name, skill.id, skill.description, ...skill.aliases].some((value) =>
        value.toLowerCase().includes(normalizedQuery),
      ),
    );
  }, [query, skills]);
  const grouped = React.useMemo(() => groupSkillsByCategory(filteredSkills), [filteredSkills]);

  if (!activeSkill) return <></>;

  return (
    <div className="space-y-8">
      <header className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <div className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-[#FFF2F6] px-2.5 py-1 text-[11px] font-semibold tracking-[0.08em] text-[#CF174B]">
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
            HOLADAY 能力
          </div>
          <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.03em] text-foreground">
            能力中心
          </h1>
          <p className="mt-2 max-w-xl text-[13px] leading-6 text-muted-foreground">
            先看 Holaday 能做出什么，再用一个真实示例开始任务。
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
              aria-label="搜索全部能力"
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="搜索全部能力"
              className="h-11 w-full rounded-full border border-[#DCDDDD] bg-white px-10 text-sm text-foreground shadow-[0_8px_24px_rgba(45,39,52,0.05)] outline-none transition-colors placeholder:text-[#ADADAD] focus:border-[#EA1F59]/45 focus:ring-2 focus:ring-[#EA1F59]/10"
            />
          </label>
          {summary && (
            <div className="mt-2 text-right text-[11px] font-medium text-muted-foreground">
              {summary}
            </div>
          )}
        </div>
      </header>

      {notice}

      <section
        aria-labelledby="active-capability-title"
        className="overflow-hidden rounded-[18px] border border-[#F0DDE4] bg-[linear-gradient(135deg,#FFF8FA_0%,#FFFDF9_48%,#F4FBFF_100%)] shadow-[0_18px_50px_rgba(74,45,62,0.08)]"
      >
        <div className="grid lg:grid-cols-[minmax(0,0.95fr)_minmax(360px,1.05fr)]">
          <div className="p-6 sm:p-8 lg:p-10">
            <div className="flex items-center gap-3">
              <SkillLogo logoId={activeSkill.logoId} label={activeSkill.name} size="lg" />
              <div>
                <div className="text-[11px] font-medium tracking-[0.08em] text-[#A45C72]">
                  推荐能力
                </div>
                <h2
                  id="active-capability-title"
                  className="mt-1 text-2xl font-semibold tracking-[-0.02em] text-foreground"
                >
                  {activeSkill.name}
                </h2>
              </div>
            </div>
            <p className="mt-5 max-w-lg text-[15px] leading-7 text-[#595757]">
              {activeSkill.description}
            </p>

            <div className="mt-6">
              <div className="mb-2 text-[12px] font-semibold text-[#7D6670]">从一个示例开始</div>
              <div className="flex flex-wrap gap-2">
                {activeSkill.experience.starterPrompts.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => onStart(activeSkill, prompt)}
                    className="group inline-flex min-h-10 items-center gap-2 rounded-full border border-[#E7D5DD] bg-white/85 px-3.5 py-2 text-left text-[12px] font-medium text-[#51454A] shadow-[0_4px_14px_rgba(79,52,64,0.05)] transition hover:-translate-y-0.5 hover:border-[#EA1F59]/30 hover:text-[#D41B51] hover:shadow-[0_8px_20px_rgba(234,31,89,0.08)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#EA1F59]/20 motion-reduce:transform-none"
                  >
                    {prompt}
                    <ArrowRight
                      className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5 motion-reduce:transform-none"
                      aria-hidden
                    />
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="border-t border-[#EFE2E7] bg-white/66 p-5 sm:p-7 lg:border-l lg:border-t-0">
            <div className="rounded-[14px] border border-white bg-white/90 p-5 shadow-[0_12px_34px_rgba(56,47,52,0.08)]">
              <div className="flex items-center justify-between gap-3">
                <div className="inline-flex items-center gap-2 text-[12px] font-semibold text-[#CF174B]">
                  <Sparkles className="h-4 w-4" aria-hidden />
                  示例结果
                </div>
                <span className="rounded-full bg-[#F2F8FF] px-2.5 py-1 text-[10px] font-medium text-[#4676A8]">
                  预览
                </span>
              </div>
              <p className="mt-4 text-[15px] font-medium leading-7 text-[#343036]">
                {activeSkill.experience.exampleSummary}
              </p>
              <div className="mt-5 h-px bg-[#EFEFEF]" />
              <p className="mt-4 text-[11px] leading-5 text-muted-foreground">
                实际结果会根据你的材料、目标和任务上下文生成。
              </p>
            </div>
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
              className="group flex min-h-[132px] items-start gap-4 rounded-[14px] border border-[#E7E2E5] bg-white p-5 text-left shadow-[0_8px_24px_rgba(56,47,52,0.045)] transition hover:-translate-y-0.5 hover:border-[#DCCAD2] hover:shadow-[0_14px_30px_rgba(56,47,52,0.07)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#EA1F59]/15 motion-reduce:transform-none"
            >
              <SkillLogo logoId={skill.logoId} label={skill.name} size="md" />
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-semibold text-foreground">
                  {skill.name}
                </span>
                <span className="mt-1.5 line-clamp-2 block text-[12px] leading-5 text-muted-foreground">
                  {skill.description}
                </span>
                <span className="mt-3 inline-flex items-center gap-1 text-[12px] font-medium text-[#8269A7]">
                  看示例与使用方式
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

      <section aria-labelledby="capability-details-title">
        <div className="mb-3 flex items-end justify-between gap-4">
          <div>
            <h2 id="capability-details-title" className="text-lg font-semibold text-foreground">
              使用前先看清楚
            </h2>
            <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
              输入、交付和边界都写明白，开始后更容易得到可用结果。
            </p>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <CapabilityDetailCard
            icon={FileInput}
            title="你需要提供"
            items={activeSkill.experience.requiredInputs}
            tone="rose"
          />
          <CapabilityDetailCard
            icon={PackageCheck}
            title="会交付什么"
            items={activeSkill.experience.deliverables}
            tone="blue"
          />
          <CapabilityDetailCard
            icon={Link2}
            title="执行时可能调用"
            items={
              activeSkill.connectors.length > 0
                ? activeSkill.connectors.map(skillConnectorLabel)
                : ['无需外部连接']
            }
            tone="mint"
          />
          <CapabilityDetailCard
            icon={ShieldCheck}
            title="边界说明"
            items={[activeSkill.experience.boundary]}
            tone="violet"
          />
        </div>
      </section>

      <section aria-labelledby="capability-catalogue-title" data-testid="capability-catalogue">
        <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="capability-catalogue-title" className="text-lg font-semibold text-foreground">
              更多可完成的事
            </h2>
            <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
              选择能力查看示例；启用后也可以在任务输入框中用 @ 调用。
            </p>
          </div>
          <div className="text-[12px] font-medium text-muted-foreground">
            {filteredSkills.length} 项能力
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
                          onClick={() => onSelectSkill(skill.id)}
                          className="flex min-w-0 flex-1 items-center gap-3 rounded-[8px] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#EA1F59]/15"
                        >
                          <SkillLogo logoId={skill.logoId} label={skill.name} size="md" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] font-semibold text-foreground">
                              {skill.name}
                            </span>
                            <span className="mt-0.5 block truncate text-[11px] leading-5 text-muted-foreground">
                              {skillCardUsageHint({
                                enabled: skill.enabled,
                                pending,
                                limitBlocked,
                                cap,
                              })}
                            </span>
                          </span>
                        </button>
                        <button
                          type="button"
                          aria-label={`${skill.enabled ? '停用' : '启用'}${skill.name}`}
                          title={`${skill.enabled ? '停用' : '启用'}${skill.name}`}
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

type DetailTone = 'rose' | 'blue' | 'mint' | 'violet';

const DETAIL_TONE: Record<DetailTone, string> = {
  rose: 'bg-[#FFF7F9] text-[#C93A62]',
  blue: 'bg-[#F4FAFF] text-[#437DB1]',
  mint: 'bg-[#F3FCF8] text-[#278269]',
  violet: 'bg-[#F8F6FF] text-[#705BA5]',
};

function CapabilityDetailCard({
  icon: Icon,
  title,
  items,
  tone,
}: {
  icon: LucideIcon;
  title: string;
  items: readonly string[];
  tone: DetailTone;
}): JSX.Element {
  return (
    <div className="rounded-[14px] border border-[#E8E4E6] bg-white p-4 shadow-[0_6px_20px_rgba(56,47,52,0.035)]">
      <div className="flex items-center gap-2.5">
        <span
          className={cn(
            'flex h-8 w-8 items-center justify-center rounded-[10px]',
            DETAIL_TONE[tone],
          )}
        >
          <Icon className="h-4 w-4" aria-hidden />
        </span>
        <h3 className="text-[13px] font-semibold text-foreground">{title}</h3>
      </div>
      <ul className="mt-3 space-y-1.5 text-[11px] leading-5 text-muted-foreground">
        {items.length > 0 ? (
          items.map((item) => (
            <li key={item} className="flex gap-2">
              <span
                className="mt-[8px] h-1 w-1 shrink-0 rounded-full bg-current opacity-45"
                aria-hidden
              />
              <span>{item}</span>
            </li>
          ))
        ) : (
          <li>无需额外材料</li>
        )}
      </ul>
    </div>
  );
}
