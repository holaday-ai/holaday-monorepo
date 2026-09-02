import type { DraftAttachment } from '@/components/AttachmentChip';
import { CapabilityCenterContent } from '@/components/skills/CapabilityCenterContent';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { pageActionError, pageErrorMessage } from '@/lib/page-error-copy';
import {
  normalizeSkillRows,
  normalizeSkillToggleResponse,
  pickCapabilityShowcase,
  readySkillTaskAttachments,
  reserveSkillTaskAttachmentSlots,
  skillLoadErrorCopy,
  skillTaskDraft,
} from '@/lib/skills-page-state';
import { supportMailtoHref } from '@/lib/support-links';
import { trpc } from '@/lib/trpc';
import { uploadFailureMessage, uploadFile } from '@/lib/upload-file';
import { PageContainer, PageHeader, PageLoadingPanel } from '@/pages/PageShell';
import type { UiSkill } from '@/types/task';
import { AlertCircle, Sparkles } from 'lucide-react';
import * as React from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';

const ATTACHMENT_BYTE_CAPS: Readonly<Record<string, number>> = {
  basic: 5 * 1024 * 1024,
  pro: 10 * 1024 * 1024,
};
const MAX_ATTACHMENTS = 5;

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
  const planId = outletCtx?.me?.plan ?? 'free';
  const attachmentsAllowed = planId !== 'free';
  const attachmentByteCap =
    ATTACHMENT_BYTE_CAPS[planId] ?? ATTACHMENT_BYTE_CAPS.basic ?? 5 * 1024 * 1024;
  const [skills, setSkills] = React.useState<UiSkill[]>([]);
  const [activeSkillId, setActiveSkillId] = React.useState('');
  const [query, setQuery] = React.useState('');
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [pendingId, setPendingId] = React.useState<string | null>(null);
  const [attachments, setAttachments] = React.useState<DraftAttachment[]>([]);
  const attachmentCountRef = React.useRef(0);

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

  async function setSkillEnabled(skill: UiSkill, desired: boolean): Promise<boolean> {
    if (pendingId) return false;
    if (skill.enabled === desired) return true;

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
        response.enabled
          ? `已加入常用技能「${skill.name}」`
          : `已从常用技能中移除「${skill.name}」`,
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
    if (attachments.some((attachment) => attachment.status === 'uploading')) {
      toast.show('文件上传中，请稍候');
      return;
    }
    navigate('/', {
      state: {
        newTask: true,
        skillTaskDraft: skillTaskDraft(skill, prompt, skillSource),
        attachFiles: readySkillTaskAttachments(attachments),
      },
    });
  }

  async function addAttachments(files: FileList): Promise<void> {
    if (!attachmentsAllowed) {
      toast.show('免费版暂不支持文件上传，升级基础版后即可使用');
      return;
    }
    const incoming = Array.from(files);
    if (incoming.length === 0) return;
    const acceptedFiles: File[] = [];
    for (const file of incoming) {
      if (file.size > attachmentByteCap) {
        toast.show(
          `文件「${file.name}」超过 ${(attachmentByteCap / (1024 * 1024)).toFixed(0)}MB 上限`,
          'error',
        );
        continue;
      }
      acceptedFiles.push(file);
    }
    if (acceptedFiles.length === 0) return;

    const reservedCount = reserveSkillTaskAttachmentSlots(
      attachmentCountRef.current,
      acceptedFiles.length,
      MAX_ATTACHMENTS,
    );
    if (reservedCount === null) {
      toast.show(`最多附 ${MAX_ATTACHMENTS} 个文件`);
      return;
    }
    attachmentCountRef.current = reservedCount;
    const drafts = acceptedFiles.map((file) => {
      const clientId =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      return {
        file,
        draft: {
          clientId,
          fileId: '',
          filename: file.name,
          mimetype: file.type || 'application/octet-stream',
          size: file.size,
          status: 'uploading' as const,
        },
      };
    });
    setAttachments((current) => [...current, ...drafts.map(({ draft }) => draft)]);

    for (const { file, draft } of drafts) {
      try {
        const uploaded = await uploadFile(file);
        if (!mountedRef.current) return;
        setAttachments((current) =>
          current.map((attachment) =>
            attachment.clientId === draft.clientId
              ? {
                  ...attachment,
                  fileId: uploaded.fileId,
                  filename: uploaded.filename,
                  mimetype: uploaded.mimetype,
                  size: uploaded.size,
                  status: 'ready',
                }
              : attachment,
          ),
        );
      } catch (error) {
        if (!mountedRef.current) return;
        const message = uploadFailureMessage(error);
        setAttachments((current) =>
          current.map((attachment) =>
            attachment.clientId === draft.clientId
              ? { ...attachment, status: 'error', errorMessage: message }
              : attachment,
          ),
        );
        toast.show(message, 'error');
      }
    }
  }

  function removeAttachment(index: number): void {
    attachmentCountRef.current = Math.max(0, attachmentCountRef.current - 1);
    setAttachments((current) => current.filter((_, currentIndex) => currentIndex !== index));
  }

  return (
    <PageContainer width="wide" className="max-w-[1180px]">
      {loading ? (
        <>
          <PageHeader
            title="技能中心"
            description="说出你想完成的事，Holaday 会匹配所需技能并带你开始"
          />
          <PageLoadingPanel label="任务选项加载中" description="正在准备可完成的任务与示例" />
        </>
      ) : loadError ? (
        <>
          <PageHeader
            title="技能中心"
            description="说出你想完成的事，Holaday 会匹配所需技能并带你开始"
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
                    body: '技能中心的任务选项加载失败，请协助排查。\n\n注册邮箱：\n出现时间：',
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
            title="技能中心"
            description="说出你想完成的事，Holaday 会匹配所需技能并带你开始"
          />
          <div className="flex flex-col items-center gap-3 rounded-[12px] border border-dashed border-[#DCDDDD] bg-white px-6 py-12 text-center">
            <Sparkles className="h-8 w-8 text-muted-foreground/40" aria-hidden />
            <div className="text-sm font-medium text-foreground/80">暂时没有可开始的任务</div>
            <div className="max-w-md text-xs leading-5 text-muted-foreground">
              你可以稍后重试，或联系支持确认技能目录状态。
            </div>
            <Button asChild variant="outline" size="sm" className="mt-1">
              <a
                href={supportMailtoHref({
                  subject: '可用任务为空',
                  body: '技能中心没有显示可用任务，请协助确认。\n\n注册邮箱：',
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
          attachments={attachments}
          attachmentsAllowed={attachmentsAllowed}
          onQueryChange={setQuery}
          onSelectSkill={setActiveSkillId}
          onStart={onStart}
          onToggle={(skill) => void onToggle(skill)}
          onAddAttachments={(files) => void addAttachments(files)}
          onRemoveAttachment={removeAttachment}
        />
      )}
    </PageContainer>
  );
}
