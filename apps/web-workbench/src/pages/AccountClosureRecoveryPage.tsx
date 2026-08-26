import { FullBrandLogo } from '@/components/BrandLogo';
import { formatExactDateTime, planLabel } from '@/components/settings/AccountClosureSection';
import { Button } from '@/components/ui/button';
import {
  type ClosureStatusSnapshot,
  clearCurrentDeviceClosureData,
  closureCategoryLabel,
  closureCountdownLabel,
  toClosureRecoveryView,
} from '@/lib/account-closure-state';
import { clearClosureRecovery, getClosureRecovery } from '@/lib/auth';
import { SUPPORT_EMAIL } from '@/lib/support-links';
import { trpc } from '@/lib/trpc';
import * as Dialog from '@radix-ui/react-dialog';
import { AlertCircle, CheckCircle2, Clock3, Loader2, ShieldCheck, X } from 'lucide-react';
import * as React from 'react';
import { Link, Navigate, Outlet, useLocation } from 'react-router-dom';

type ApplicationReceipt = Awaited<ReturnType<typeof trpc.accountClosure.applicationReceipt.query>>;
type CancellationChallenge = Awaited<
  ReturnType<typeof trpc.accountClosure.requestCancellationVerification.mutate>
>;

const STATUS_ERROR = '暂时无法读取账号关闭状态，请重新登录后再试。';
const ACTION_ERROR = '暂时无法完成账号关闭操作，请稍后重试。';
const RECOVERY_PATH = '/account/closure-recovery';

export function ClosureRecoveryRouteBoundary(): JSX.Element {
  const location = useLocation();
  const recoveryToken = getClosureRecovery();
  if (recoveryToken && location.pathname !== RECOVERY_PATH) {
    return <Navigate to={RECOVERY_PATH} replace />;
  }
  return <Outlet />;
}

export function AccountClosureRecoveryPage(): JSX.Element {
  const recoveryToken = getClosureRecovery();
  const errorRef = React.useRef<HTMLParagraphElement>(null);
  const [status, setStatus] = React.useState<ClosureStatusSnapshot | null>(null);
  const [receipt, setReceipt] = React.useState<ApplicationReceipt | null>(null);
  const [loading, setLoading] = React.useState(Boolean(recoveryToken));
  const [error, setError] = React.useState<string | null>(null);
  const [now, setNow] = React.useState(() => new Date());
  const [cleanupMessage, setCleanupMessage] = React.useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = React.useState(false);
  const [cancelled, setCancelled] = React.useState(false);

  const load = React.useCallback(async () => {
    if (!recoveryToken) return;
    setLoading(true);
    setError(null);
    try {
      const [nextStatus, nextReceipt] = await Promise.all([
        trpc.accountClosure.status.query({ recoveryToken }),
        trpc.accountClosure.applicationReceipt.query({ recoveryToken }),
      ]);
      setStatus(nextStatus);
      setReceipt(nextReceipt);
    } catch {
      setError(STATUS_ERROR);
    } finally {
      setLoading(false);
    }
  }, [recoveryToken]);

  React.useEffect(() => {
    void load();
  }, [load]);

  React.useEffect(() => {
    if (!error) return;
    errorRef.current?.focus();
  }, [error]);

  React.useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  React.useEffect(() => {
    if (
      status &&
      (status.requestStatus === 'processing' ||
        status.requestStatus === 'needs_attention' ||
        status.requestStatus === 'completed')
    ) {
      clearCurrentDeviceClosureData();
    }
  }, [status]);

  if (!recoveryToken && !cancelled) return <Navigate to="/login" replace />;

  if (cancelled && status) {
    return (
      <RecoveryFrame>
        <StateCard
          icon={<CheckCircle2 className="h-5 w-5 text-emerald-600" />}
          title="关闭申请已撤回"
          description={`账号已恢复。套餐仍按 ${formatPlanExpiry(status.plan.expiresAt)} 到期，冷静期不会增加或顺延 7 天。已取消的运行任务不会自动重跑。`}
        >
          <Button asChild>
            <Link to="/login">重新登录</Link>
          </Button>
        </StateCard>
      </RecoveryFrame>
    );
  }

  if (loading && !status) {
    return (
      <RecoveryFrame>
        <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          正在读取账号关闭状态…
        </div>
      </RecoveryFrame>
    );
  }

  if (error || !status || !receipt) {
    return (
      <RecoveryFrame>
        <div className="mx-auto max-w-md py-10 text-center">
          <AlertCircle className="mx-auto h-7 w-7 text-rose-500" />
          <p
            ref={errorRef}
            role="alert"
            tabIndex={-1}
            className="mt-3 rounded-md text-sm text-foreground outline-none focus:ring-2 focus:ring-rose-300"
          >
            {error ?? STATUS_ERROR}
          </p>
          <div className="mt-5 flex justify-center gap-2">
            <Button variant="outline" onClick={() => void load()}>
              重试
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                clearClosureRecovery();
                window.location.assign('/login');
              }}
            >
              重新登录
            </Button>
          </div>
        </div>
      </RecoveryFrame>
    );
  }

  const view = toClosureRecoveryView(status, receipt.receiptNumber);
  const content = recoveryContent(view.kind);
  return (
    <RecoveryFrame>
      <div className="space-y-5">
        <StateCard icon={content.icon} title={content.title} description={content.description}>
          {view.kind === 'grace' ? (
            <div className="mt-5 grid gap-3 rounded-lg border border-violet-100 bg-violet-50/45 p-4 dark:border-violet-400/15 dark:bg-violet-950/10 sm:grid-cols-2">
              <DataLine
                label="剩余时间"
                value={`剩余 ${closureCountdownLabel(view.graceEndsAt, now)}`}
              />
              <DataLine label="服务端截止时间" value={formatExactDateTime(view.graceEndsAt)} />
            </div>
          ) : null}
          <div className="mt-4 grid gap-3 rounded-lg border border-border p-4 sm:grid-cols-2">
            <DataLine label="申请回执" value={`申请回执 ${view.receiptNumber}`} />
            {view.kind === 'grace' ? (
              <DataLine
                label="原套餐"
                value={`${planLabel(status.plan.name)} 套餐原到期时间：${formatPlanExpiry(status.plan.expiresAt)}`}
              />
            ) : (
              <DataLine label="当前状态" value={content.shortStatus} />
            )}
          </div>
          {view.kind === 'grace' ? (
            <div className="mt-4 space-y-2 text-sm leading-6 text-muted-foreground">
              <p>暂停范围：正常产品访问、新任务和仍在运行的任务。</p>
              <p>
                到期后按类别清理或去标识；受限保留：
                {receipt.restrictedCategoryIds.map(closureCategoryLabel).join('、') || '无'}。
              </p>
              <p>撤回后恢复原套餐与额度，不会增加或顺延 7 天；已取消的运行任务不会自动重跑。</p>
              <p>关闭不会自动退款，必要的账务、争议与安全记录可能去标识后受限保留。</p>
            </div>
          ) : null}
          {view.canCancel && now.getTime() < new Date(view.graceEndsAt).getTime() ? (
            <Button className="mt-5" onClick={() => setCancelOpen(true)}>
              撤回关闭申请
            </Button>
          ) : null}
        </StateCard>

        <section className="rounded-xl border border-border bg-background p-5 shadow-sm">
          <h2 className="text-sm font-semibold">当前设备上的资料</h2>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            可以清除这个浏览器中的登录态、任务缓存、今日能量进度和星座资料。服务器无法远程清除其他设备、浏览器扩展、已下载文件或其他本地副本；请在对应设备或扩展中自行清理。
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                clearCurrentDeviceClosureData();
                setCleanupMessage('已清除当前浏览器中的可识别账号资料。');
              }}
            >
              立即清除本机资料
            </Button>
            {cleanupMessage ? (
              <output className="text-xs text-emerald-700 dark:text-emerald-300">
                {cleanupMessage}
              </output>
            ) : null}
          </div>
        </section>

        <p className="text-center text-xs text-muted-foreground">
          需要协助？联系{' '}
          <a className="underline underline-offset-2" href={`mailto:${SUPPORT_EMAIL}`}>
            {SUPPORT_EMAIL}
          </a>
        </p>
      </div>

      <CancellationDialog
        open={cancelOpen}
        recoveryToken={recoveryToken as string}
        mfaRequired={status.mfaRequired}
        onClose={() => setCancelOpen(false)}
        onCancelled={() => {
          clearClosureRecovery();
          setCancelOpen(false);
          setCancelled(true);
        }}
      />
    </RecoveryFrame>
  );
}

function CancellationDialog({
  open,
  recoveryToken,
  mfaRequired,
  onClose,
  onCancelled,
}: {
  open: boolean;
  recoveryToken: string;
  mfaRequired: boolean;
  onClose(): void;
  onCancelled(): void;
}): JSX.Element {
  const closeRef = React.useRef<HTMLButtonElement>(null);
  const errorRef = React.useRef<HTMLParagraphElement>(null);
  const pendingRef = React.useRef(false);
  const [challenge, setChallenge] = React.useState<CancellationChallenge | null>(null);
  const [code, setCode] = React.useState('');
  const [mfaCode, setMfaCode] = React.useState('');
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  const requestCode = async (): Promise<void> => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    try {
      setChallenge(
        await trpc.accountClosure.requestCancellationVerification.mutate({ recoveryToken }),
      );
    } catch {
      setError(ACTION_ERROR);
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };

  const cancelClosure = async (): Promise<void> => {
    if (pendingRef.current || !challenge || !/^\d{6}$/.test(code)) return;
    if (mfaRequired && mfaCode.trim().length < 6) return;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    try {
      await trpc.accountClosure.cancel.mutate({
        recoveryToken,
        challengeId: challenge.challengeId,
        code,
        ...(mfaRequired ? { mfaCode: mfaCode.trim() } : {}),
      });
      onCancelled();
    } catch {
      setError(ACTION_ERROR);
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && !pending && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[90] bg-slate-950/35 backdrop-blur-sm" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-[91] max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-background p-5 shadow-2xl outline-none sm:p-6"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            closeRef.current?.focus();
          }}
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-lg font-semibold">验证并撤回关闭申请</Dialog.Title>
              <Dialog.Description className="mt-2 text-sm leading-6 text-muted-foreground">
                撤回只恢复本次流程暂停的资源；已取消的运行任务不会自动重跑。
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                ref={closeRef}
                type="button"
                aria-label="关闭撤回验证"
                title="关闭撤回验证"
                disabled={pending}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
              >
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>
          <div className="mt-5 space-y-4">
            <div className="flex flex-col gap-2 rounded-lg border border-border p-3 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-xs text-muted-foreground">
                {challenge
                  ? `验证码已发送至 ${challenge.maskedDestination}`
                  : '发送撤回专用验证码到已验证的邮箱或手机号。'}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() => void requestCode()}
              >
                发送验证码
              </Button>
            </div>
            <LabeledInput
              label="6 位验证码"
              value={code}
              inputMode="numeric"
              onChange={(value) => setCode(value.replace(/\D/g, '').slice(0, 6))}
            />
            {mfaRequired ? (
              <LabeledInput label="MFA 动态码或恢复码" value={mfaCode} onChange={setMfaCode} />
            ) : null}
            {error ? (
              <p
                ref={errorRef}
                role="alert"
                tabIndex={-1}
                className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-800 outline-none focus:ring-2 focus:ring-rose-300"
              >
                {error}
              </p>
            ) : null}
          </div>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="ghost" disabled={pending} onClick={onClose}>
              暂不撤回
            </Button>
            <Button
              disabled={
                pending ||
                !challenge ||
                !/^\d{6}$/.test(code) ||
                (mfaRequired && mfaCode.trim().length < 6)
              }
              onClick={() => void cancelClosure()}
            >
              {pending ? '验证中…' : '确认撤回'}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function RecoveryFrame({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <main className="min-h-dvh bg-[radial-gradient(circle_at_top_left,rgba(238,232,255,0.7),transparent_36%),linear-gradient(180deg,#fbfcff_0%,#fffaf9_100%)] px-4 py-8 text-foreground dark:bg-background sm:py-12">
      <div className="mx-auto max-w-2xl">
        <div className="mb-6 flex justify-center">
          <FullBrandLogo className="h-7" />
        </div>
        {children}
      </div>
    </main>
  );
}

function StateCard({
  icon,
  title,
  description,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  children?: React.ReactNode;
}): JSX.Element {
  return (
    <section className="rounded-2xl border border-border bg-background/95 p-5 shadow-[0_18px_60px_rgba(51,42,84,0.08)] sm:p-7">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted">
          {icon}
        </div>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function DataLine({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-medium">{value}</div>
    </div>
  );
}

function LabeledInput({
  label,
  value,
  inputMode,
  onChange,
}: {
  label: string;
  value: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
  onChange(value: string): void;
}): JSX.Element {
  return (
    <label className="block space-y-1.5 text-sm">
      <span className="font-medium">{label}</span>
      <input
        value={value}
        inputMode={inputMode}
        autoComplete="one-time-code"
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-md border border-input bg-background px-3 outline-none focus:ring-2 focus:ring-primary/25"
      />
    </label>
  );
}

function formatPlanExpiry(value: string | null): string {
  return value ? formatExactDateTime(value) : '无固定到期时间';
}

function recoveryContent(kind: ReturnType<typeof toClosureRecoveryView>['kind']): {
  icon: React.ReactNode;
  title: string;
  description: string;
  shortStatus: string;
} {
  if (kind === 'grace') {
    return {
      icon: <Clock3 className="h-5 w-5 text-violet-600" />,
      title: '账号关闭冷静期',
      description: '正常产品访问和新任务已经停止。截止时间前，你仍可完成验证并撤回。',
      shortStatus: '冷静期',
    };
  }
  if (kind === 'attention') {
    return {
      icon: <ShieldCheck className="h-5 w-5 text-amber-600" />,
      title: '账号关闭正在由专人跟进',
      description: '账号仍保持关闭，系统不会恢复访问或任务。你无需重复提交申请。',
      shortStatus: '人工关注中',
    };
  }
  if (kind === 'completed') {
    return {
      icon: <CheckCircle2 className="h-5 w-5 text-emerald-600" />,
      title: '账号已经关闭',
      description: '服务器端账号关闭已经完成。必要记录可能按受限用途继续保留。',
      shortStatus: '已完成',
    };
  }
  return {
    icon: <Loader2 className="h-5 w-5 animate-spin text-violet-600" />,
    title: '正在完成账号关闭',
    description: '系统正按安全顺序处理账号资料。此阶段已经不能自助撤回。',
    shortStatus: '处理中',
  };
}
