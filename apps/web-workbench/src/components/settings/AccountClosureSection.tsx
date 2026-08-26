import { Button } from '@/components/ui/button';
import { clearCurrentDeviceClosureData, closureCategoryLabel } from '@/lib/account-closure-state';
import { setClosureRecovery } from '@/lib/auth';
import { trpc } from '@/lib/trpc';
import * as Dialog from '@radix-ui/react-dialog';
import { AlertTriangle, ArrowLeft, Loader2, X } from 'lucide-react';
import * as React from 'react';
import { useNavigate } from 'react-router-dom';

type ClosurePreview = Awaited<ReturnType<typeof trpc.accountClosure.preview.query>>;
type ChallengeDelivery = Awaited<ReturnType<typeof trpc.accountClosure.requestVerification.mutate>>;

const GENERIC_ERROR = '暂时无法完成账号关闭操作，请稍后重试。';

export function AccountClosureSection(): JSX.Element {
  const navigate = useNavigate();
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const closeRef = React.useRef<HTMLButtonElement>(null);
  const errorRef = React.useRef<HTMLParagraphElement>(null);
  const pendingRef = React.useRef(false);
  const submittedRef = React.useRef(false);
  const [open, setOpen] = React.useState(false);
  const [step, setStep] = React.useState<1 | 2 | 3>(1);
  const [loading, setLoading] = React.useState(false);
  const [preview, setPreview] = React.useState<ClosurePreview | null>(null);
  const [mfaRequired, setMfaRequired] = React.useState(false);
  const [acknowledgements, setAcknowledgements] = React.useState({
    immediateSignOut: false,
    runningWorkStops: false,
    noAutomaticRefund: false,
  });
  const [challenge, setChallenge] = React.useState<ChallengeDelivery | null>(null);
  const [code, setCode] = React.useState('');
  const [mfaCode, setMfaCode] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  const resetDialog = React.useCallback(() => {
    setOpen(false);
    setStep(1);
    setPreview(null);
    setChallenge(null);
    setCode('');
    setMfaCode('');
    setError(null);
    setAcknowledgements({
      immediateSignOut: false,
      runningWorkStops: false,
      noAutomaticRefund: false,
    });
  }, []);

  const openImpact = async (): Promise<void> => {
    if (loading || pendingRef.current) return;
    setLoading(true);
    setError(null);
    try {
      const [nextPreview, security] = await Promise.all([
        trpc.accountClosure.preview.query(),
        trpc.auth.mfaStatus.query(),
      ]);
      setPreview(nextPreview);
      setMfaRequired(security.enabled);
      setStep(1);
      setOpen(true);
    } catch {
      setError(GENERIC_ERROR);
    } finally {
      setLoading(false);
    }
  };

  const requestVerification = async (): Promise<void> => {
    if (loading || pendingRef.current) return;
    setLoading(true);
    setError(null);
    try {
      setChallenge(await trpc.accountClosure.requestVerification.mutate());
    } catch {
      setError(GENERIC_ERROR);
    } finally {
      setLoading(false);
    }
  };

  const submitClosure = async (): Promise<void> => {
    if (pendingRef.current || submittedRef.current || !challenge || !/^\d{6}$/.test(code)) return;
    if (mfaRequired && mfaCode.trim().length < 6) return;
    pendingRef.current = true;
    submittedRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const result = await trpc.accountClosure.begin.mutate({
        challengeId: challenge.challengeId,
        code,
        ...(mfaRequired ? { mfaCode: mfaCode.trim() } : {}),
        acknowledgements: {
          immediateSignOut: true,
          runningWorkStops: true,
          noAutomaticRefund: true,
        },
      });
      setClosureRecovery(result.recoveryToken);
      clearCurrentDeviceClosureData();
      navigate('/account/closure-recovery', { replace: true });
    } catch {
      submittedRef.current = false;
      setError(GENERIC_ERROR);
    } finally {
      pendingRef.current = false;
      setLoading(false);
    }
  };

  const allAcknowledged = Object.values(acknowledgements).every(Boolean);

  return (
    <div className="mt-5 border-t border-border pt-5">
      <div className="rounded-lg border border-rose-200/80 bg-rose-50/35 p-4 dark:border-rose-400/20 dark:bg-rose-950/10 sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <AlertTriangle className="h-4 w-4 text-rose-500" aria-hidden="true" />
              <span>关闭账号</span>
            </div>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">
              提交后立即退出并停止任务，进入 7
              天冷静期。关闭不会自动退款，必要的账务与争议记录可能受限保留。
            </p>
          </div>
          <Button
            ref={triggerRef}
            type="button"
            variant="outline"
            size="sm"
            disabled={loading}
            onClick={() => void openImpact()}
            className="shrink-0 border-rose-200 text-rose-700 hover:bg-rose-50 hover:text-rose-800 dark:border-rose-400/30 dark:text-rose-300"
          >
            {loading && !open ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            查看关闭影响
          </Button>
        </div>
        {!open && error ? <InlineError ref={errorRef}>{error}</InlineError> : null}
      </div>

      <Dialog.Root
        open={open}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && !loading) resetDialog();
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[90] bg-slate-950/35 backdrop-blur-sm" />
          <Dialog.Content
            className="fixed left-1/2 top-1/2 z-[91] max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-background p-5 shadow-2xl outline-none sm:p-6"
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              closeRef.current?.focus();
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              triggerRef.current?.focus();
            }}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-medium text-rose-600">第 {step} 步，共 3 步</p>
                <Dialog.Title className="mt-1 text-lg font-semibold tracking-tight">
                  关闭账号 · 第 {step} 步
                </Dialog.Title>
              </div>
              <Dialog.Close asChild>
                <button
                  ref={closeRef}
                  type="button"
                  aria-label="关闭账号向导"
                  title="关闭账号向导"
                  disabled={loading}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                >
                  <X className="h-4 w-4" />
                </button>
              </Dialog.Close>
            </div>

            {step === 1 && preview ? <ImpactStep preview={preview} /> : null}
            {step === 2 ? (
              <AcknowledgementStep value={acknowledgements} onChange={setAcknowledgements} />
            ) : null}
            {step === 3 ? (
              <VerificationStep
                challenge={challenge}
                code={code}
                mfaCode={mfaCode}
                mfaRequired={mfaRequired}
                loading={loading}
                onCodeChange={setCode}
                onMfaCodeChange={setMfaCode}
                onSend={() => void requestVerification()}
              />
            ) : null}

            {open && error ? <InlineError ref={errorRef}>{error}</InlineError> : null}

            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
              {step > 1 ? (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={loading}
                  onClick={() => {
                    setError(null);
                    setStep((current) => (current === 3 ? 2 : 1));
                  }}
                >
                  <ArrowLeft className="h-4 w-4" />
                  返回
                </Button>
              ) : (
                <span />
              )}
              {step === 1 ? (
                <Button type="button" onClick={() => setStep(2)}>
                  继续
                </Button>
              ) : step === 2 ? (
                <Button type="button" disabled={!allAcknowledged} onClick={() => setStep(3)}>
                  继续验证
                </Button>
              ) : (
                <Button
                  type="button"
                  disabled={
                    loading ||
                    !challenge ||
                    !/^\d{6}$/.test(code) ||
                    (mfaRequired && mfaCode.trim().length < 6)
                  }
                  onClick={() => void submitClosure()}
                  className="bg-rose-600 text-white hover:bg-rose-700"
                >
                  {loading ? '处理中…' : '确认关闭账号'}
                </Button>
              )}
            </div>
            <Dialog.Description className="sr-only">
              三步确认账号关闭影响、关键后果和身份验证。
            </Dialog.Description>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

function ImpactStep({ preview }: { preview: ClosurePreview }): JSX.Element {
  const counts = [
    `${preview.counts.activeTasks} 个运行中任务`,
    `${preview.counts.futureTasks} 个未来任务`,
    `${preview.counts.files} 个文件`,
    `${preview.counts.stockItems} 个股票关注项`,
    `${preview.counts.notificationChannels} 个通知渠道`,
  ];
  return (
    <div className="mt-5 space-y-4">
      <p className="text-sm leading-6 text-muted-foreground">
        提交后会立即退出登录并停止新的任务。你可以在服务端截止时间前撤回；到期后清理不可恢复。
      </p>
      <div className="grid gap-2 rounded-lg border border-border bg-muted/35 p-4 sm:grid-cols-2">
        <DataLine label="最终处理时间" value={formatExactDateTime(preview.graceEndsAt)} />
        <DataLine
          label="当前套餐"
          value={`${planLabel(preview.plan.name)} · ${preview.plan.expiresAt ? formatExactDateTime(preview.plan.expiresAt) : '无固定到期时间'}`}
        />
      </div>
      <ul className="grid gap-2 text-sm sm:grid-cols-2">
        {counts.map((count) => (
          <li key={count} className="rounded-md border border-border px-3 py-2">
            {count}
          </li>
        ))}
      </ul>
      <div className="rounded-md bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900 dark:bg-amber-950/25 dark:text-amber-200">
        关闭不会自动退款。受限保留类别：
        {preview.retainedCategoryIds.map(closureCategoryLabel).join('、') || '无'}。
      </div>
    </div>
  );
}

function AcknowledgementStep({
  value,
  onChange,
}: {
  value: { immediateSignOut: boolean; runningWorkStops: boolean; noAutomaticRefund: boolean };
  onChange(value: {
    immediateSignOut: boolean;
    runningWorkStops: boolean;
    noAutomaticRefund: boolean;
  }): void;
}): JSX.Element {
  const rows = [
    ['immediateSignOut', '我知道提交后会立即退出登录'] as const,
    ['runningWorkStops', '我知道正在运行的任务会停止'] as const,
    ['noAutomaticRefund', '我知道关闭不会自动退款'] as const,
  ];
  return (
    <fieldset className="mt-5 space-y-3">
      <legend className="text-sm leading-6 text-muted-foreground">
        请逐项确认。无需输入长句，也不会要求你说明私人原因。
      </legend>
      {rows.map(([key, label]) => (
        <label
          key={key}
          className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 text-sm leading-5 hover:bg-muted/35"
        >
          <input
            type="checkbox"
            checked={value[key]}
            onChange={(event) => onChange({ ...value, [key]: event.target.checked })}
            className="mt-0.5 h-4 w-4 rounded border-border accent-rose-600"
          />
          <span>{label}</span>
        </label>
      ))}
    </fieldset>
  );
}

function VerificationStep({
  challenge,
  code,
  mfaCode,
  mfaRequired,
  loading,
  onCodeChange,
  onMfaCodeChange,
  onSend,
}: {
  challenge: ChallengeDelivery | null;
  code: string;
  mfaCode: string;
  mfaRequired: boolean;
  loading: boolean;
  onCodeChange(value: string): void;
  onMfaCodeChange(value: string): void;
  onSend(): void;
}): JSX.Element {
  return (
    <div className="mt-5 space-y-4">
      <div className="flex flex-col gap-2 rounded-lg border border-border p-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs leading-5 text-muted-foreground">
          {challenge
            ? `验证码已发送至 ${challenge.maskedDestination}`
            : '向账号已验证的邮箱或手机号发送专用验证码。'}
        </p>
        <Button type="button" variant="outline" size="sm" disabled={loading} onClick={onSend}>
          发送验证码
        </Button>
      </div>
      <label className="block space-y-1.5 text-sm">
        <span className="font-medium">6 位验证码</span>
        <input
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          onChange={(event) => onCodeChange(event.target.value.replace(/\D/g, '').slice(0, 6))}
          className="h-10 w-full rounded-md border border-input bg-background px-3 outline-none focus:ring-2 focus:ring-primary/25"
        />
      </label>
      {mfaRequired ? (
        <label className="block space-y-1.5 text-sm">
          <span className="font-medium">MFA 动态码或恢复码</span>
          <input
            autoComplete="one-time-code"
            value={mfaCode}
            onChange={(event) => onMfaCodeChange(event.target.value)}
            className="h-10 w-full rounded-md border border-input bg-background px-3 outline-none focus:ring-2 focus:ring-primary/25"
          />
        </label>
      ) : null}
    </div>
  );
}

const InlineError = React.forwardRef<HTMLParagraphElement, { children: React.ReactNode }>(
  function InlineError({ children }, ref) {
    return (
      <p
        ref={ref}
        role="alert"
        tabIndex={-1}
        className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800 outline-none focus:ring-2 focus:ring-rose-300 dark:border-rose-400/25 dark:bg-rose-950/20 dark:text-rose-200"
      >
        {children}
      </p>
    );
  },
);

function DataLine({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-medium">{value}</div>
    </div>
  );
}

function planLabel(plan: string): string {
  return plan === 'pro' ? 'Pro' : plan === 'basic' ? '基础版' : plan === 'free' ? '免费版' : plan;
}

export function formatExactDateTime(value: string): string {
  const formatter = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(new Date(value))
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}年${parts.month}月${parts.day}日 ${parts.hour}:${parts.minute}`;
}

export { planLabel };
