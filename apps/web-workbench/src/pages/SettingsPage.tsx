import { ApiKeysSection } from '@/components/ApiKeysSection';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { NotificationsSection } from '@/components/notifications/NotificationsSection';
import { MemorySection } from '@/components/settings/MemorySection';
import { Button } from '@/components/ui/button';
import {
  SETTINGS_SECTIONS,
  type SettingsSectionId,
  normaliseSettingsHash,
  settingsSectionHref,
} from '@/lib/settings-sections';
import { supportMailtoHref } from '@/lib/support-links';
import { cn } from '@/lib/utils';
import { PageContainer, PageHeader, Row, Section } from '@/pages/PageShell';
import { type ThemeMode, useTheme } from '@/stores/theme-store';
import { ChevronRight, Monitor, Moon, Sun } from 'lucide-react';
import * as React from 'react';
import { Link, useLocation } from 'react-router-dom';

/**
 * Settings page — only the rows that actually persist server-side,
 * route to a real support action, or affect runtime behaviour. P2.4
 * audit removed two sections that were UI theatre:
 *   - 语言偏好: no i18n bundle wired, the toggle was a localStorage
 *     write nothing else read.
 *   - 默认交互模式: not connected to the live `browserInteractive`
 *     store; R19 already set the right default (off), so the entry
 *     was duplicate plumbing.
 * If/when those land we re-introduce the sections.
 */
export function SettingsPage(): JSX.Element {
  const { mode, setMode } = useTheme();
  const location = useLocation();
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false);
  const activeSection = normaliseSettingsHash(location.hash) ?? 'appearance';

  React.useEffect(() => {
    const sectionId = normaliseSettingsHash(location.hash);
    if (!sectionId) return;

    const scrollToSection = (): void => {
      document.getElementById(sectionId)?.scrollIntoView({ block: 'start' });
    };

    const frame = window.requestAnimationFrame(scrollToSection);
    const timers = [100, 350, 800, 1400, 2200].map((delay) =>
      window.setTimeout(scrollToSection, delay),
    );
    return () => {
      window.cancelAnimationFrame(frame);
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [location.hash]);

  // Section order (Sweep P2 fix): API Key region was buried below
  // MemorySection which can hold dozens of rows on power-user
  // accounts. Codex pass moved Developer ABOVE Memory so a 3-second
  // scan from the top of /settings reaches the API key controls.
  // Memory drops to the bottom (above 账号) since it's read-only
  // curation; users don't need it on every visit.
  return (
    <PageContainer width="form">
      <PageHeader title="设置" description="外观、角色、开发者、记忆与账号" />
      <SettingsSectionNav active={activeSection} />
      <div className="space-y-6">
        <Section id="appearance" title="外观">
          <Row
            label="主题"
            description="跟随系统、浅色或深色。立即生效，记到本地。"
          >
            <ThemeSwitcher mode={mode} onChange={setMode} />
          </Row>
        </Section>

        <Section id="roles" title="AI 视角">
          <Link
            to="/settings/roles"
            className="-mx-4 flex items-center justify-between gap-4 rounded-md px-4 py-3 transition-colors hover:bg-foreground/[0.04]"
          >
            <div>
              <div className="text-sm font-medium">专业角色</div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                挑选 AI 处理任务时使用的视角（基础版自选 5 个 / 专业版全部 33 个）
              </p>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </Link>
        </Section>

        <div id="api-keys" className="scroll-mt-24">
          <ApiKeysSection />
        </div>

        <MemorySection />

        <div id="notifications" className="scroll-mt-24">
          <NotificationsSection />
        </div>

        <Section id="account" title="账号">
          <Row
            label="删除账号"
            description="删除会清除任务记录、浏览器数据和订阅信息；需要先通过支持渠道确认身份"
          >
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDeleteDialogOpen(true)}
              className="text-red-600 hover:text-red-700"
            >
              申请删除
            </Button>
          </Row>
        </Section>
      </div>

      <ConfirmDialog
        open={deleteDialogOpen}
        title="申请删除账号？"
        description={
          '账号删除不可撤销。我们会通过邮件确认身份、处理订阅和数据删除，再完成账号关闭。'
        }
        confirmLabel="发送删除申请"
        destructive
        onClose={() => setDeleteDialogOpen(false)}
        onConfirm={() => {
          window.location.href = supportMailtoHref({
            subject: '删除 HOLA DAY 账号',
            body: '请协助删除我的 HOLA DAY 账号。\n\n注册邮箱：\n删除原因（选填）：',
          });
          setDeleteDialogOpen(false);
        }}
      />
    </PageContainer>
  );
}

function SettingsSectionNav({ active }: { active: SettingsSectionId }): JSX.Element {
  return (
    <nav
      aria-label="设置分区"
      className="sticky top-3 z-10 mb-5 rounded-lg border border-border bg-background/90 p-1 shadow-sm backdrop-blur"
    >
      <div className="grid grid-cols-3 gap-1 sm:grid-cols-6">
        {SETTINGS_SECTIONS.map((section) => (
          <Link
            key={section.id}
            to={settingsSectionHref(section.id)}
            aria-current={active === section.id ? 'true' : undefined}
            className={cn(
              'flex h-8 items-center justify-center rounded-md px-2.5 text-center text-xs font-medium transition-colors',
              active === section.id
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground',
            )}
          >
            {section.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}

function ThemeSwitcher({
  mode,
  onChange,
}: {
  mode: ThemeMode;
  onChange(m: ThemeMode): void;
}): JSX.Element {
  return (
    <div className="inline-grid grid-cols-3 gap-1 rounded-md bg-muted p-0.5">
      <ThemeOption
        active={mode === 'light'}
        onClick={() => onChange('light')}
        label="浅色"
      >
        <Sun className="h-3.5 w-3.5" />
      </ThemeOption>
      <ThemeOption
        active={mode === 'dark'}
        onClick={() => onChange('dark')}
        label="深色"
      >
        <Moon className="h-3.5 w-3.5" />
      </ThemeOption>
      <ThemeOption
        active={mode === 'system'}
        onClick={() => onChange('system')}
        label="跟随系统"
      >
        <Monitor className="h-3.5 w-3.5" />
      </ThemeOption>
    </div>
  );
}

function ThemeOption({
  active,
  onClick,
  label,
  children,
}: {
  active: boolean;
  onClick(): void;
  label: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={label}
      className={cn(
        'flex h-8 items-center justify-center gap-1 rounded px-3 text-xs transition-colors',
        active
          ? 'bg-background text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
      <span>{label}</span>
    </button>
  );
}
