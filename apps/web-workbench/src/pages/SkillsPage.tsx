import { CapabilityCenterContent } from '@/components/skills/CapabilityCenterContent';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { pageActionError, pageErrorMessage } from '@/lib/page-error-copy';
import {
  normalizeSkillRows,
  normalizeSkillToggleResponse,
  pickCapabilityShowcase,
  skillLimitBannerCopy,
  skillLimitMessage,
  skillLoadErrorCopy,
  skillStartDecision,
  skillTaskDraft,
} from '@/lib/skills-page-state';
import { supportMailtoHref } from '@/lib/support-links';
import { trpc } from '@/lib/trpc';
import { PageContainer, PageHeader, PageLoadingPanel } from '@/pages/PageShell';
import type { UiSkill } from '@/types/task';
import { AlertCircle, Sparkles } from 'lucide-react';
import * as React from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';

/** Per-plan skill caps. Mirrors PLAN_CATALOGUE.rolesAllowed in shared-types. */
const SKILL_CAPS: Record<string, number> = {
  free: 0,
  basic: 5,
  pro: 33,
};

/**
 * Capability discovery and task-start page. It keeps the server-backed skill
 * selection model, but leads with outcomes and editable example tasks instead
 * of presenting the catalogue as a settings screen.
 */
export function SkillsPage(): JSX.Element {
  const toast = useToast();
  const navigate = useNavigate();
  const mountedRef = React.useRef(false);
  const requestIdRef = React.useRef(0);
  const outletCtx = useOutletContext<{ me?: { plan?: string } | null } | null>();
  const planId = (outletCtx?.me?.plan ?? 'free') as keyof typeof SKILL_CAPS;
  const cap = SKILL_CAPS[planId] ?? 0;
  const [skills, setSkills] = React.useState<UiSkill[]>([]);
  const [activeSkillId, setActiveSkillId] = React.useState('');
  const [query, setQuery] = React.useState('');
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [pendingId, setPendingId] = React.useState<string | null>(null);
  const enabledCount = React.useMemo(
    () => skills.reduce((count, skill) => count + (skill.enabled ? 1 : 0), 0),
    [skills],
  );
  const atLimit = enabledCount >= cap;

  const refresh = React.useCallback(
    async (options: { silent?: boolean } = {}) => {
      const requestId = ++requestIdRef.current;
      setLoading(true);
      setLoadError(null);
      try {
        const list = normalizeSkillRows(await trpc.skills.list.query());
        if (!mountedRef.current || requestId !== requestIdRef.current) return;
        setSkills(list);
        setActiveSkillId((current) => {
          if (list.some((skill) => skill.id === current)) return current;
          return pickCapabilityShowcase(list)[0]?.id ?? list[0]?.id ?? '';
        });
      } catch (error) {
        if (!mountedRef.current || requestId !== requestIdRef.current) return;
        setLoadError(pageErrorMessage(error));
        if (!options.silent) toast.show('任务选项暂时无法加载', 'error');
      } finally {
        if (mountedRef.current && requestId === requestIdRef.current) setLoading(false);
      }
    },
    [toast],
  );

  React.useEffect(() => {
    mountedRef.current = true;
    void refresh({ silent: true });
    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
    };
  }, [refresh]);

  const loadErrorCopy = skillLoadErrorCopy(loadError);
  const limitBanner = atLimit ? skillLimitBannerCopy({ cap, enabledCount, planId }) : null;

  async function setSkillEnabled(skill: UiSkill, desired: boolean): Promise<boolean> {
    if (pendingId) return false;
    if (skill.enabled === desired) return true;
    if (desired && enabledCount >= cap) {
      toast.show(skillLimitMessage({ cap, planId }), 'error');
      return false;
    }

    setPendingId(skill.id);
    setSkills((current) =>
      current.map((item) => (item.id === skill.id ? { ...item, enabled: desired } : item)),
    );
    try {
      const response = normalizeSkillToggleResponse(
        await trpc.skills.toggle.mutate({ skillId: skill.id }),
        desired,
      );
      setSkills((current) =>
        current.map((item) =>
          item.id === skill.id ? { ...item, enabled: response.enabled } : item,
        ),
      );
      toast.show(
        response.enabled ? `已加入常用「${skill.name}」` : `已从常用中移除「${skill.name}」`,
      );
      return response.enabled === desired;
    } catch (error) {
      setSkills((current) =>
        current.map((item) => (item.id === skill.id ? { ...item, enabled: skill.enabled } : item)),
      );
      toast.show(pageActionError('保存失败', error), 'error');
      return false;
    } finally {
      if (mountedRef.current) setPendingId(null);
    }
  }

  async function onToggle(skill: UiSkill): Promise<void> {
    await setSkillEnabled(skill, !skill.enabled);
  }

  async function onStart(
    skill: UiSkill,
    prompt: string,
    skillSource: 'manual' | 'suggested' = 'manual',
  ): Promise<void> {
    if (pendingId) return;
    if (skillSource === 'manual') {
      const decision = skillStartDecision({
        enabled: skill.enabled,
        enabledCount,
        cap,
      });
      if (decision === 'blocked') {
        toast.show(skillLimitMessage({ cap, planId }), 'error');
        return;
      }
      if (decision === 'enable-and-start') {
        const enabled = await setSkillEnabled(skill, true);
        if (!enabled) return;
      }
    }
    navigate('/', {
      state: {
        newTask: true,
        skillTaskDraft: skillTaskDraft(skill, prompt, skillSource),
      },
    });
  }

  const notice =
    limitBanner && planId !== 'pro' ? (
      <div className="flex flex-col gap-3 rounded-[12px] border border-[#F0E2B9] bg-[#FFFBEE] px-4 py-3 text-[12px] text-foreground sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="font-semibold">{limitBanner.title}</div>
          <div className="mt-0.5 leading-5 text-muted-foreground">{limitBanner.body}</div>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="shrink-0 bg-white"
          onClick={() => navigate('/plan')}
        >
          查看套餐
        </Button>
      </div>
    ) : undefined;

  return (
    <PageContainer width="wide" className="max-w-[1180px]">
      {loading ? (
        <>
          <PageHeader
            title="能力中心"
            description="选择想完成的事，Holaday 会匹配所需能力并带你开始"
          />
          <PageLoadingPanel label="任务选项加载中" description="正在准备可完成的任务与示例" />
        </>
      ) : loadError ? (
        <>
          <PageHeader
            title="能力中心"
            description="选择想完成的事，Holaday 会匹配所需能力并带你开始"
          />
          <div className="flex flex-col items-center gap-3 rounded-[12px] border border-[#DCDDDD] bg-white px-6 py-12 text-center">
            <AlertCircle className="h-8 w-8 text-primary" aria-hidden />
            <div className="text-sm font-medium text-foreground/80">{loadErrorCopy.title}</div>
            <div className="max-w-md text-xs leading-5 text-muted-foreground">
              {loadErrorCopy.body}
            </div>
            <div className="mt-1 flex flex-wrap justify-center gap-2">
              <Button type="button" size="sm" onClick={() => void refresh()}>
                重试
              </Button>
              <Button asChild variant="outline" size="sm">
                <a
                  href={supportMailtoHref({
                    subject: '任务选项加载失败',
                    body: '能力中心的任务选项加载失败，请协助排查。\n\n注册邮箱：\n出现时间：',
                  })}
                >
                  联系支持
                </a>
              </Button>
            </div>
          </div>
        </>
      ) : skills.length === 0 ? (
        <>
          <PageHeader
            title="能力中心"
            description="选择想完成的事，Holaday 会匹配所需能力并带你开始"
          />
          <div className="flex flex-col items-center gap-3 rounded-[12px] border border-dashed border-[#DCDDDD] bg-white px-6 py-12 text-center">
            <Sparkles className="h-8 w-8 text-muted-foreground/40" aria-hidden />
            <div className="text-sm font-medium text-foreground/80">暂时没有可开始的任务</div>
            <div className="max-w-md text-xs leading-5 text-muted-foreground">
              你可以稍后重试，或联系支持确认套餐和可用任务。
            </div>
            <Button asChild variant="outline" size="sm" className="mt-1">
              <a
                href={supportMailtoHref({
                  subject: '可用任务为空',
                  body: '能力中心没有显示可用任务，请协助确认。\n\n注册邮箱：',
                })}
              >
                联系支持
              </a>
            </Button>
          </div>
        </>
      ) : (
        <CapabilityCenterContent
          skills={skills}
          activeSkillId={activeSkillId}
          query={query}
          pendingId={pendingId}
          cap={cap}
          enabledCount={enabledCount}
          notice={notice}
          onQueryChange={setQuery}
          onSelectSkill={setActiveSkillId}
          onStart={onStart}
          onToggle={(skill) => void onToggle(skill)}
        />
      )}
    </PageContainer>
  );
}
