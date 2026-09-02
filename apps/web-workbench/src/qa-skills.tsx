import { FullBrandLogo } from '@/components/BrandLogo';
import type { DraftAttachment } from '@/components/AttachmentChip';
import { CapabilityCenterContent } from '@/components/skills/CapabilityCenterContent';
import { QA_SKILLS } from '@/qa-skills-data';
import type { UiSkill } from '@/types/task';
import {
  CalendarDays,
  CirclePlus,
  Folder,
  Image,
  Layers3,
  MoonStar,
  Sparkles,
  TrendingUp,
  Video,
} from 'lucide-react';
import React from 'react';
import ReactDOM from 'react-dom/client';
import '@/index.css';

const NAV_ITEMS = [
  { label: '新任务', icon: CirclePlus },
  { label: '技能中心', icon: Sparkles, active: true },
  { label: '股市任务', icon: TrendingUp },
  { label: '今日能量', icon: MoonStar },
  { label: '视频任务', icon: Video },
  { label: '图片任务', icon: Image },
  { label: '规划任务', icon: CalendarDays },
  { label: '文件库', icon: Folder },
  { label: '项目', icon: Layers3 },
];

function Preview(): JSX.Element {
  const [skills, setSkills] = React.useState<UiSkill[]>(QA_SKILLS);
  const [query, setQuery] = React.useState('');
  const [activeSkillId, setActiveSkillId] = React.useState('market-competitor-insight');
  const [attachments, setAttachments] = React.useState<DraftAttachment[]>([]);

  return (
    <div className="min-h-screen bg-[#FEFDFC] text-[#252326]">
      <aside className="fixed inset-y-0 left-0 hidden w-[276px] bg-[#FCFBFA] px-4 py-5 md:flex md:flex-col">
        <FullBrandLogo className="h-[26px]" />
        <nav className="mt-9 space-y-1" aria-label="QA 主导航">
          {NAV_ITEMS.map(({ label, icon: Icon, active }) => (
            <div
              key={label}
              className={
                active
                  ? 'flex h-11 items-center gap-3 rounded-xl bg-[#FFF0F4] px-3 text-[13px] font-semibold text-[#322E31]'
                  : 'flex h-11 items-center gap-3 rounded-xl px-3 text-[13px] text-[#5F5A5E]'
              }
            >
              <Icon className={active ? 'h-[17px] w-[17px] text-[#EA1F59]' : 'h-[17px] w-[17px]'} aria-hidden />
              {label}
            </div>
          ))}
        </nav>
      </aside>
      <main className="px-5 py-8 md:ml-[276px] md:px-10 lg:px-12">
        <div className="mx-auto w-full max-w-[1240px]">
          <CapabilityCenterContent
            skills={skills}
            activeSkillId={activeSkillId}
            query={query}
            pendingId={null}
            attachments={attachments}
            attachmentsAllowed
            onQueryChange={setQuery}
            onSelectSkill={setActiveSkillId}
            onStart={() => undefined}
            onToggle={(selected) =>
              setSkills((current) =>
                current.map((item) =>
                  item.id === selected.id ? { ...item, enabled: !item.enabled } : item,
                ),
              )
            }
            onAddAttachments={(files) =>
              setAttachments((current) => [
                ...current,
                ...Array.from(files).map((file, index) => ({
                  clientId: `${file.name}-${index}`,
                  fileId: `preview-${file.name}-${index}`,
                  filename: file.name,
                  mimetype: file.type || 'application/octet-stream',
                  size: file.size,
                  status: 'ready' as const,
                })),
              ])
            }
            onRemoveAttachment={(index) =>
              setAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index))
            }
          />
        </div>
      </main>
    </div>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('QA root is missing');
ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <Preview />
  </React.StrictMode>,
);
