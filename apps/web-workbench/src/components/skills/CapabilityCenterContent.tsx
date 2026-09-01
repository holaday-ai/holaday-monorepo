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

        <div
          role="status"
          aria-label="能力运行状态"
          className="relative z-10 flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-white/80 bg-white/55 px-5 py-3 text-[11px] text-[#6D6570] backdrop-blur-md sm:px-7"
        >
          <span
            className={cn(
              'inline-flex items-center gap-2 font-semibold',
              activeSkill.enabled ? 'text-[#2D715F]' : 'text-[#826A32]',
            )}
          >
            <span className="relative flex h-2 w-2" aria-hidden>
              {activeSkill.enabled && (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#4CC39A]/45 motion-reduce:animate-none" />
              )}
              <span
                className={cn(
                  'relative inline-flex h-2 w-2 rounded-full',
                  activeSkill.enabled ? 'bg-[#35A980]' : 'bg-[#D6A64B]',
                )}
              />
            </span>
            {activeSkill.enabled ? 'AI 能力已就绪' : '能力可预览，启用后使用'}
          </span>
          <span className="h-3 w-px bg-[#DDD8DE]" aria-hidden />
          <span>结果为可编辑草稿</span>
          <span className="h-3 w-px bg-[#DDD8DE]" aria-hidden />
          <span>不会自动提交</span>
        </div>

        <div className="relative z-10 grid lg:grid-cols-[minmax(300px,0.72fr)_minmax(460px,1.28fr)]">
          <div className="p-6 sm:p-8 lg:p-9">
            <div className="flex items-center gap-3">
              <SkillLogo logoId={activeSkill.logoId} label={activeSkill.name} size="lg" />
              <div>
                <div className="inline-flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.1em] text-[#D22455]">
                  <Sparkles className="h-3.5 w-3.5" aria-hidden />
                  主推荐能力
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
                <span>示例（可直接使用）</span>
                <span className="font-normal text-[#A49BA1]">选择后先进入草稿</span>
              </div>
              <div className="space-y-2">
                {activeSkill.experience.starterPrompts.map((prompt, index) => (
                  <button
                    key={prompt}
                    type="button"
                    aria-label={prompt}
                    title={prompt}
                    onClick={() => onStart(activeSkill, prompt)}
                    className="group flex min-h-12 w-full items-center gap-3 rounded-[13px] border border-white/90 bg-white/78 px-3.5 py-2.5 text-left text-[12px] font-medium text-[#443D43] shadow-[0_5px_18px_rgba(66,52,63,0.045)] backdrop-blur-sm transition duration-200 hover:-translate-y-0.5 hover:border-[#EDC8D3] hover:bg-white hover:shadow-[0_10px_24px_rgba(198,56,96,0.09)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#EA1F59]/20 motion-reduce:transform-none"
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] bg-[#FFF0F4] text-[10px] font-semibold text-[#D92859]">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <span className="min-w-0 flex-1">{prompt}</span>
                    <ArrowRight
                      className="h-4 w-4 shrink-0 text-[#9F9098] transition-transform group-hover:translate-x-0.5 group-hover:text-[#D92859] motion-reduce:transform-none"
                      aria-hidden
                    />
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="border-t border-white/85 bg-white/34 p-4 sm:p-6 lg:border-l lg:border-t-0">
            <article className="h-full min-h-[390px] overflow-hidden rounded-[18px] border border-white bg-white/92 shadow-[0_18px_44px_rgba(57,49,60,0.09)] backdrop-blur-lg">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#EEE9EE] px-5 py-3.5">
                <div>
                  <div className="text-[10px] font-semibold tracking-[0.08em] text-[#8E78B8]">
                    示例结果
                  </div>
                  <h3 className="mt-0.5 text-[14px] font-semibold text-[#2F2930]">结果预览</h3>
                </div>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[#F1FBF7] px-2.5 py-1 text-[10px] font-semibold text-[#288367]">
                  <Check className="h-3.5 w-3.5" aria-hidden />
                  可继续编辑
                </span>
              </div>

              <div className="p-5 sm:p-6">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-[10px] font-semibold tracking-[0.08em] text-[#A49AA1]">
                      {activeSkill.name} · 示例摘要
                    </p>
                    <p className="mt-2 max-w-2xl text-[17px] font-semibold leading-7 tracking-[-0.015em] text-[#302B30]">
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
                      <div className="text-[10px] font-semibold text-[#8F8290]">交付内容</div>
                      <div className="mt-1.5 text-[12px] font-semibold text-[#403940]">
                        {deliverable}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-6 flex items-start gap-3 border-t border-[#EEE9EE] pt-4">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#6C8FA9]" aria-hidden />
                  <p className="text-[11px] leading-5 text-[#7D747A]">
                    实际结果会根据你的材料、目标和任务上下文生成；开始前仍可补充要求。
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
                <span className="mt-1.5 block text-[10px] font-semibold tracking-[0.04em] text-[#A36B7B]">
                  示例结果
                </span>
                <span className="mt-1 line-clamp-2 block text-[12px] leading-5 text-muted-foreground">
                  {skill.experience.exampleSummary}
                </span>
                <span className="mt-3 inline-flex items-center gap-1 text-[12px] font-semibold text-[#8269A7]">
                  切换到这个能力
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

      <section
        aria-labelledby="capability-details-title"
        data-testid="capability-readiness-rail"
        className="overflow-hidden rounded-[18px] border border-[#E8E4E8] bg-white shadow-[0_10px_30px_rgba(56,47,52,0.035)]"
      >
        <div className="flex flex-col gap-1 border-b border-[#EEE9ED] bg-[linear-gradient(90deg,#FFF9FB_0%,#FBFBFF_48%,#F7FCFB_100%)] px-5 py-4 sm:flex-row sm:items-end sm:justify-between sm:px-6">
          <div>
            <h2 id="capability-details-title" className="text-[15px] font-semibold text-foreground">
              能力准备轨道
            </h2>
            <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
              输入、交付和边界都写明白，开始后更容易得到可用结果。
            </p>
          </div>
          <span className="text-[10px] font-semibold tracking-[0.08em] text-[#A28E98]">
            START WITH CLARITY
          </span>
        </div>
        <div className="grid divide-y divide-[#EEE9ED] md:grid-cols-2 md:divide-x md:divide-y-0 xl:grid-cols-4">
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
                          aria-pressed={skill.id === activeSkill.id}
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
  rose: 'bg-[#FFF1F5] text-[#C93A62]',
  blue: 'bg-[#F1F7FF] text-[#437DB1]',
  mint: 'bg-[#EFFAF5] text-[#278269]',
  violet: 'bg-[#F5F2FF] text-[#705BA5]',
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
    <div className="min-h-[154px] bg-white p-4 sm:p-5">
      <div className="flex items-center gap-2.5">
        <span
          className={cn(
            'flex h-8 w-8 items-center justify-center rounded-[10px] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.72)]',
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
