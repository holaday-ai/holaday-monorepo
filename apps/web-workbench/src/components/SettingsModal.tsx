import { CreditCard, Monitor, Moon, Sun, User as UserIcon, X } from 'lucide-react';
import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { type ThemeMode, useTheme } from '@/stores/theme-store';

interface Props {
  open: boolean;
  onClose(): void;
  displayName: string;
  email: string | null;
  phone?: string | null;
  plan: string;
}

type Tab = 'profile' | 'preferences' | 'billing';

/**
 * O12 — Tabbed settings modal anchored to the sidebar's user menu.
 * Three tabs: 个人资料 / 设置 / 计划与账单. Theme switch lives under
 * 设置. ESC + backdrop click + ✕ all dismiss. Read-only profile for
 * now; rename + avatar upload land in a follow-up.
 */
export function SettingsModal({
  open,
  onClose,
  displayName,
  email,
  phone,
  plan,
}: Props): JSX.Element | null {
  const [activeTab, setActiveTab] = React.useState<Tab>('preferences');
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
      className="fixed inset-0 z-50 flex items-center justify-center"
    >
      <button
        type="button"
        aria-label="关闭设置"
        onClick={onClose}
        className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-fade-in"
      />
      <div className="relative z-10 mx-4 flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl animate-fade-in">
        <header className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 id="settings-title" className="text-sm font-semibold">
            设置
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="rounded p-1 text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="flex flex-1 min-h-0">
          {/* Sidebar tabs */}
          <nav className="w-44 shrink-0 border-r border-border bg-muted/40 p-2 text-sm">
            <TabButton
              active={activeTab === 'profile'}
              onClick={() => setActiveTab('profile')}
              icon={<UserIcon className="h-3.5 w-3.5" />}
              label="个人资料"
            />
            <TabButton
              active={activeTab === 'preferences'}
              onClick={() => setActiveTab('preferences')}
              icon={<Monitor className="h-3.5 w-3.5" />}
              label="设置"
            />
            <TabButton
              active={activeTab === 'billing'}
              onClick={() => setActiveTab('billing')}
              icon={<CreditCard className="h-3.5 w-3.5" />}
              label="计划与账单"
            />
          </nav>
          <div className="flex-1 overflow-y-auto p-5 text-sm">
            {activeTab === 'profile' && (
              <ProfileTab displayName={displayName} email={email} phone={phone} />
            )}
            {activeTab === 'preferences' && <PreferencesTab />}
            {activeTab === 'billing' && <BillingTab plan={plan} onClose={onClose} />}
          </div>
        </div>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left transition-colors',
        active
          ? 'bg-foreground text-background'
          : 'text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground',
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function ProfileTab({
  displayName,
  email,
  phone,
}: {
  displayName: string;
  email: string | null;
  phone?: string | null;
}): JSX.Element {
  return (
    <div className="space-y-4">
      <Field label="昵称" value={displayName || '—'} />
      <Field label="邮箱" value={email || '未绑定'} />
      <Field
        label="手机号"
        value={phone ? phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2') : '未绑定'}
      />
      <p className="text-xs text-muted-foreground">
        修改昵称 / 头像 / 绑定邮箱即将上线。
      </p>
    </div>
  );
}

function PreferencesTab(): JSX.Element {
  const { mode, setMode } = useTheme();
  return (
    <div className="space-y-5">
      <div>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          外观
        </div>
        <div className="flex flex-wrap gap-2">
          <ThemeChoice
            mode="light"
            current={mode}
            onSelect={setMode}
            icon={<Sun className="h-3.5 w-3.5" />}
            label="浅色"
          />
          <ThemeChoice
            mode="dark"
            current={mode}
            onSelect={setMode}
            icon={<Moon className="h-3.5 w-3.5" />}
            label="深色"
          />
          <ThemeChoice
            mode="system"
            current={mode}
            onSelect={setMode}
            icon={<Monitor className="h-3.5 w-3.5" />}
            label="跟随系统"
          />
        </div>
      </div>
    </div>
  );
}

function ThemeChoice({
  mode,
  current,
  onSelect,
  icon,
  label,
}: {
  mode: ThemeMode;
  current: ThemeMode;
  onSelect: (m: ThemeMode) => void;
  icon: React.ReactNode;
  label: string;
}): JSX.Element {
  const active = mode === current;
  return (
    <button
      type="button"
      onClick={() => onSelect(mode)}
      aria-pressed={active}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors',
        active
          ? 'border-foreground bg-foreground text-background'
          : 'border-border text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground',
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function BillingTab({
  plan,
  onClose,
}: {
  plan: string;
  onClose: () => void;
}): JSX.Element {
  const navigate = useNavigate();
  const planLabel =
    plan === 'pro' ? '专业版' : plan === 'basic' ? '基础版' : '免费版';
  return (
    <div className="space-y-4">
      <Field label="当前计划" value={planLabel} />
      <button
        type="button"
        onClick={() => {
          onClose();
          navigate('/plan');
        }}
        className="rounded-md bg-foreground px-4 py-2 text-xs font-medium text-background hover:bg-foreground/85"
      >
        查看计划与账单
      </button>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div>
      <div className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="text-sm">{value}</div>
    </div>
  );
}
