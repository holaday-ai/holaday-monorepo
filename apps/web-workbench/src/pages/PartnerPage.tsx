import {
  AlertCircle,
  ArrowUpRight,
  CalendarCheck,
  Copy,
  CreditCard,
  Gift,
  Loader2,
  RefreshCw,
  Shield,
  Wallet,
} from 'lucide-react';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import {
  clampRechargeAmountCnyCents,
  formatApiUnits,
  formatHolaCreditCents,
  formatPartnerCnyCents,
  kycStatusLabel,
  normalizePartnerDashboard,
  partnerActionErrorMessage,
  partnerDraftKeyAfterSuccess,
  partnerDraftKeyFor,
  partnerRechargeGate,
  partnerWithdrawalGate,
  type PartnerIdempotencyDraft,
  type PartnerEnabledState,
  type PartnerPageState,
  PARTNER_PAYMENT_PROVIDERS,
  normalizePartnerPaymentProvider,
  partnerPaymentProviderHint,
  partnerPaymentProviderLabel,
  partnerPaymentIntentDisplay,
  type PartnerPaymentProvider,
} from '@/lib/partner-page-state';
import { trpc } from '@/lib/trpc';
import { PageContainer, PageHeader, PageLoadingPanel, Row, Section } from '@/pages/PageShell';

interface PartnerOrderSummary {
  readonly orderExternalId: string;
  readonly provider: string;
  readonly orderKind: string;
  readonly amountCnyCents: number;
  readonly status: string;
  readonly paymentIntent?: unknown;
}

interface PartnerRechargePreview {
  readonly amountCnyCents: number;
  readonly rollingThirtyDayCnyCents: number;
  readonly tier: {
    readonly minCnyCents: number;
    readonly maxCnyCents: number;
    readonly multiplierBps: number;
  };
  readonly apiUnits: number;
}

interface PartnerWithdrawalSummary {
  readonly withdrawalExternalId: string;
  readonly amountCreditCents: number;
  readonly status: string;
  readonly reviewDueAt: Date | string;
  readonly bankAccountFingerprint: string;
  readonly riskScore: number;
}

interface PartnerReferralSummary {
  readonly referralExternalId: string;
  readonly inviterExternalId: string;
  readonly inviteeExternalId: string;
  readonly status: string;
  readonly assisted: boolean;
}

interface PartnerKycSubmissionSummary {
  readonly kycExternalId: string;
  readonly status: string;
  readonly country: string;
  readonly provider: string;
  readonly providerRef: string | null;
  readonly bankCardVerified: boolean;
  readonly reviewedAt: Date | string | null;
}

type PartnerAction =
  | 'membership'
  | 'preview'
  | 'recharge'
  | 'orderStatus'
  | 'withdrawal'
  | 'invite'
  | 'kyc'
  | 'activity';

export function PartnerPage(): JSX.Element {
  const toast = useToast();
  const mountedRef = React.useRef(false);
  const requestIdRef = React.useRef(0);
  const mutationInFlightRef = React.useRef(false);
  const [state, setState] = React.useState<PartnerPageState | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [pendingAction, setPendingAction] = React.useState<PartnerAction | null>(null);
  const [membershipOrder, setMembershipOrder] = React.useState<PartnerOrderSummary | null>(null);
  const [rechargePreview, setRechargePreview] = React.useState<PartnerRechargePreview | null>(null);
  const [rechargeOrder, setRechargeOrder] = React.useState<PartnerOrderSummary | null>(null);
  const [withdrawal, setWithdrawal] = React.useState<PartnerWithdrawalSummary | null>(null);
  const [referral, setReferral] = React.useState<PartnerReferralSummary | null>(null);
  const [kycSubmission, setKycSubmission] = React.useState<PartnerKycSubmissionSummary | null>(null);
  const [rechargeAmountInput, setRechargeAmountInput] = React.useState('10000');
  const [withdrawalAmountInput, setWithdrawalAmountInput] = React.useState('');
  const [bankFingerprint, setBankFingerprint] = React.useState('');
  const [inviteCodeInput, setInviteCodeInput] = React.useState('');
  const [assistedInvite, setAssistedInvite] = React.useState(false);
  const [kycProviderRef, setKycProviderRef] = React.useState('');
  const [kycBankFingerprint, setKycBankFingerprint] = React.useState('');
  const [membershipProvider, setMembershipProvider] = React.useState<PartnerPaymentProvider>('wechat');
  const [rechargeProvider, setRechargeProvider] = React.useState<PartnerPaymentProvider>('wechat');
  const [membershipIdempotencyKey, setMembershipIdempotencyKey] = React.useState(() =>
    idempotencyKey('partner-membership-wechat'),
  );
  const [rechargeDraft, setRechargeDraft] = React.useState<PartnerIdempotencyDraft>(() =>
    partnerDraftKeyFor({
      current: null,
      prefix: 'partner-recharge',
      fingerprint: rechargeFingerprint(10_000_00, 'wechat'),
      makeKey: idempotencyKey,
    }),
  );
  const [withdrawalDraft, setWithdrawalDraft] = React.useState<PartnerIdempotencyDraft>(() =>
    partnerDraftKeyFor({
      current: null,
      prefix: 'partner-withdrawal',
      fingerprint: withdrawalFingerprint(0, ''),
      makeKey: idempotencyKey,
    }),
  );

  const refresh = React.useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setLoadError(null);
    try {
      const dashboard = normalizePartnerDashboard(await trpc.partner.dashboard.query());
      if (!mountedRef.current || requestId !== requestIdRef.current) return;
      setState(dashboard);
    } catch (err) {
      if (!mountedRef.current || requestId !== requestIdRef.current) return;
      setLoadError(partnerActionErrorMessage(err, '请稍后重试。'));
    } finally {
      if (mountedRef.current && requestId === requestIdRef.current) setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    mountedRef.current = true;
    void refresh();
    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
    };
  }, [refresh]);

  const rechargeAmountCnyCents = React.useMemo(
    () => clampRechargeAmountCnyCents(rechargeAmountInput),
    [rechargeAmountInput],
  );
  const rechargeDraftFingerprint = React.useMemo(
    () => rechargeFingerprint(rechargeAmountCnyCents, rechargeProvider),
    [rechargeAmountCnyCents, rechargeProvider],
  );
  const withdrawalDraftFingerprint = React.useMemo(
    () => withdrawalFingerprint(amountInputToCreditCents(withdrawalAmountInput), bankFingerprint),
    [bankFingerprint, withdrawalAmountInput],
  );
  const isMutating = pendingAction !== null;

  React.useEffect(() => {
    setRechargeDraft((current) =>
      partnerDraftKeyFor({
        current,
        prefix: 'partner-recharge',
        fingerprint: rechargeDraftFingerprint,
        makeKey: idempotencyKey,
      }),
    );
  }, [rechargeDraftFingerprint]);

  React.useEffect(() => {
    setWithdrawalDraft((current) =>
      partnerDraftKeyFor({
        current,
        prefix: 'partner-withdrawal',
        fingerprint: withdrawalDraftFingerprint,
        makeKey: idempotencyKey,
      }),
    );
  }, [withdrawalDraftFingerprint]);

  const updateMembershipProvider = React.useCallback((provider: PartnerPaymentProvider) => {
    setMembershipProvider(provider);
    setMembershipIdempotencyKey(idempotencyKey(`partner-membership-${provider}`));
  }, []);

  const refreshAction = (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="border-[#DCDDDD] bg-white text-[#595757] hover:border-[#ADADAD] hover:bg-white hover:text-[#EA1F59]"
      onClick={() => void refresh()}
      disabled={loading || isMutating}
    >
      {loading ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
      ) : (
        <RefreshCw className="h-3.5 w-3.5" aria-hidden />
      )}
      刷新
    </Button>
  );

  async function createMembershipOrder(): Promise<void> {
    if (!beginMutation('membership')) return;
    try {
      const order = await trpc.partner.createMembershipOrder.mutate({
        provider: membershipProvider,
        idempotencyKey: membershipIdempotencyKey,
      });
      setMembershipOrder(order);
      setMembershipIdempotencyKey(idempotencyKey(`partner-membership-${membershipProvider}`));
      toast.show(`会员订单已创建，${partnerPaymentProviderHint(membershipProvider)}`, 'info', 2500);
    } catch (err) {
      handleActionError(err, '会员订单创建失败');
    } finally {
      endMutation();
    }
  }

  async function previewRecharge(): Promise<void> {
    if (!beginMutation('preview')) return;
    const amountCnyCents = normalizeRechargeInput();
    try {
      const preview = await trpc.partner.rechargePreview.query({
        amountCnyCents,
      });
      setRechargePreview(preview);
      toast.show('充值预览已更新', 'info', 1800);
    } catch (err) {
      handleActionError(err, '充值预览失败');
    } finally {
      endMutation();
    }
  }

  async function createRechargeOrder(): Promise<void> {
    if (!beginMutation('recharge')) return;
    const amountCnyCents = normalizeRechargeInput();
    const fingerprint = rechargeFingerprint(amountCnyCents, rechargeProvider);
    const draft = partnerDraftKeyFor({
      current: rechargeDraft,
      prefix: 'partner-recharge',
      fingerprint,
      makeKey: idempotencyKey,
    });
    setRechargeDraft(draft);
    try {
      const order = await trpc.partner.createRechargeOrder.mutate({
        amountCnyCents,
        provider: rechargeProvider,
        idempotencyKey: draft.key,
      });
      setRechargeOrder(order);
      setRechargeDraft(
        partnerDraftKeyAfterSuccess({
          prefix: 'partner-recharge',
          fingerprint,
          makeKey: idempotencyKey,
        }),
      );
      toast.show(`充值订单已创建，${partnerPaymentProviderHint(rechargeProvider)}`, 'info', 2500);
    } catch (err) {
      handleActionError(err, '充值订单创建失败');
    } finally {
      endMutation();
    }
  }

  async function refreshOrderStatus(
    order: PartnerOrderSummary,
    setOrder: (value: PartnerOrderSummary) => void,
  ): Promise<void> {
    if (!beginMutation('orderStatus')) return;
    try {
      const latest = await trpc.partner.orderStatus.query({
        orderExternalId: order.orderExternalId,
      });
      setOrder(latest);
      toast.show(latest.status === order.status ? '订单状态已刷新' : '订单状态已更新', 'info', 1800);
      if (latest.status !== 'pending') {
        await refresh();
      }
    } catch (err) {
      handleActionError(err, '订单状态刷新失败');
    } finally {
      endMutation();
    }
  }

  async function requestWithdrawal(): Promise<void> {
    const amountCreditCents = amountInputToCreditCents(withdrawalAmountInput);
    const fingerprint = bankFingerprint.trim();
    if (amountCreditCents <= 0) {
      toast.show('请填写大于 0 的 HOLA Credit 提现金额', 'error');
      return;
    }
    if (!fingerprint) {
      toast.show('请填写银行账户指纹', 'error');
      return;
    }

    if (!beginMutation('withdrawal')) return;
    const fingerprintKey = withdrawalFingerprint(amountCreditCents, fingerprint);
    const draft = partnerDraftKeyFor({
      current: withdrawalDraft,
      prefix: 'partner-withdrawal',
      fingerprint: fingerprintKey,
      makeKey: idempotencyKey,
    });
    setWithdrawalDraft(draft);
    try {
      const result = await trpc.partner.requestWithdrawal.mutate({
        amountCreditCents,
        bankAccountFingerprint: fingerprint,
        idempotencyKey: draft.key,
      });
      setWithdrawal(result);
      setWithdrawalDraft(
        partnerDraftKeyAfterSuccess({
          prefix: 'partner-withdrawal',
          fingerprint: fingerprintKey,
          makeKey: idempotencyKey,
        }),
      );
      toast.show('提现申请已提交，需完成审核后出款', 'info', 2800);
      await refresh();
    } catch (err) {
      handleActionError(err, '提现申请失败');
    } finally {
      endMutation();
    }
  }

  async function recordInvite(): Promise<void> {
    const inviterExternalId = inviteCodeInput.trim();
    if (!inviterExternalId) {
      toast.show('请填写好友的邀请码', 'error');
      return;
    }

    if (!beginMutation('invite')) return;
    try {
      const result = await trpc.partner.recordInvite.mutate({
        inviterExternalId,
        assisted: assistedInvite,
      });
      setReferral(result);
      setInviteCodeInput('');
      toast.show('邀请归因已登记', 'info', 2200);
    } catch (err) {
      handleActionError(err, '邀请登记失败');
    } finally {
      endMutation();
    }
  }

  async function submitKyc(): Promise<void> {
    const bankAccountFingerprint = kycBankFingerprint.trim();
    if (!bankAccountFingerprint) {
      toast.show('请填写实名银行卡指纹', 'error');
      return;
    }

    if (!beginMutation('kyc')) return;
    try {
      const providerRef = kycProviderRef.trim() || undefined;
      const result = await trpc.partner.submitKyc.mutate({
        providerRef,
        bankAccountFingerprint,
      });
      setKycSubmission(result);
      setKycProviderRef('');
      setKycBankFingerprint('');
      toast.show(result.status === 'passed' ? '实名认证已通过' : '实名材料已提交复核', 'info', 2200);
      await refresh();
    } catch (err) {
      handleActionError(err, '实名提交失败');
    } finally {
      endMutation();
    }
  }

  async function claimDailyActivity(): Promise<void> {
    if (!state?.enabled) return;
    if (state.activity.checkedInToday) {
      toast.show('今日活跃已记录', 'info', 1600);
      return;
    }

    if (!beginMutation('activity')) return;
    try {
      const result = await trpc.partner.claimDailyActivity.mutate();
      const normalized = normalizePartnerDashboard({
        enabled: true,
        activity: result,
      });
      if (normalized.enabled) {
        setState((current) =>
          current?.enabled
            ? {
                ...current,
                activity: normalized.activity,
              }
            : current,
        );
      }
      toast.show('今日活跃已记录', 'info', 1800);
    } catch (err) {
      handleActionError(err, '今日活跃记录失败');
    } finally {
      endMutation();
    }
  }

  async function copyInviteCode(): Promise<void> {
    if (!state?.enabled || !state.inviteCode) return;
    try {
      await navigator.clipboard.writeText(state.inviteCode);
      toast.show('邀请码已复制', 'info', 1600);
    } catch {
      toast.show('复制失败，请手动选择邀请码', 'error');
    }
  }

  function normalizeRechargeInput(): number {
    const amountCnyCents = clampRechargeAmountCnyCents(rechargeAmountInput);
    setRechargeAmountInput(String(amountCnyCents / 100));
    return amountCnyCents;
  }

  function handleActionError(err: unknown, fallback: string): void {
    const message = partnerActionErrorMessage(err, fallback);
    setActionError(message);
    toast.show(message, 'error');
  }

  function beginMutation(action: PartnerAction): boolean {
    if (mutationInFlightRef.current) {
      toast.show('已有操作处理中，请稍候', 'info', 1800);
      return false;
    }
    mutationInFlightRef.current = true;
    setPendingAction(action);
    setActionError(null);
    return true;
  }

  function endMutation(): void {
    mutationInFlightRef.current = false;
    setPendingAction(null);
  }

  return (
    <PageContainer width="wide">
      <PageHeader
        title="合伙人计划"
        description="查看 HOLADAY 合伙人账本、充值预览、订单和提现审核进度。"
        action={refreshAction}
      />

      {loadError && state != null && (
        <StatusPanel
          tone="error"
          title="刷新失败，正在显示上次账本"
          body={loadError}
          action={
            <Button type="button" size="sm" onClick={() => void refresh()} disabled={loading || isMutating}>
              重试
            </Button>
          }
        />
      )}

      {actionError && (
        <StatusPanel tone="error" title="操作未完成" body={actionError} className="mb-5" />
      )}

      {loading && state == null ? (
        <PageLoadingPanel label="合伙人账本加载中" description="正在读取会员、KYC 和账本余额" />
      ) : state == null ? (
        <StatusPanel
          tone="error"
          title="合伙人账本暂时无法加载"
          body={loadError ?? '请稍后重试。'}
          action={
            <Button type="button" size="sm" onClick={() => void refresh()} disabled={loading || isMutating}>
              重试
            </Button>
          }
        />
      ) : !state.enabled ? (
        <Section className="rounded-[8px] border-[#DCDDDD] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-[#DCDDDD] bg-white text-[#595757]">
              <Shield className="h-4 w-4" aria-hidden />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-medium text-foreground/85">{state.title}</div>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{state.description}</p>
            </div>
          </div>
        </Section>
      ) : (
        <PartnerWorkbench
          state={state}
          rechargeAmountInput={rechargeAmountInput}
          rechargeAmountCnyCents={rechargeAmountCnyCents}
          onRechargeAmountInputChange={setRechargeAmountInput}
          onRechargeSliderChange={(value) => setRechargeAmountInput(String(value / 100))}
          membershipProvider={membershipProvider}
          onMembershipProviderChange={updateMembershipProvider}
          rechargeProvider={rechargeProvider}
          onRechargeProviderChange={setRechargeProvider}
          onMembershipOrder={() => void createMembershipOrder()}
          onPreviewRecharge={() => void previewRecharge()}
          onCreateRechargeOrder={() => void createRechargeOrder()}
          onRefreshMembershipOrder={(order) => void refreshOrderStatus(order, setMembershipOrder)}
          onRefreshRechargeOrder={(order) => void refreshOrderStatus(order, setRechargeOrder)}
          onRequestWithdrawal={() => void requestWithdrawal()}
          onRecordInvite={() => void recordInvite()}
          onClaimDailyActivity={() => void claimDailyActivity()}
          onCopyInviteCode={() => void copyInviteCode()}
          onSubmitKyc={() => void submitKyc()}
          membershipOrder={membershipOrder}
          rechargePreview={rechargePreview}
          rechargeOrder={rechargeOrder}
          withdrawalAmountInput={withdrawalAmountInput}
          onWithdrawalAmountInputChange={setWithdrawalAmountInput}
          bankFingerprint={bankFingerprint}
          onBankFingerprintChange={setBankFingerprint}
          withdrawal={withdrawal}
          inviteCodeInput={inviteCodeInput}
          onInviteCodeInputChange={setInviteCodeInput}
          assistedInvite={assistedInvite}
          onAssistedInviteChange={setAssistedInvite}
          referral={referral}
          kycProviderRef={kycProviderRef}
          onKycProviderRefChange={setKycProviderRef}
          kycBankFingerprint={kycBankFingerprint}
          onKycBankFingerprintChange={setKycBankFingerprint}
          kycSubmission={kycSubmission}
          pendingAction={pendingAction}
          isMutating={isMutating}
        />
      )}
    </PageContainer>
  );
}

function PartnerWorkbench({
  state,
  rechargeAmountInput,
  rechargeAmountCnyCents,
  onRechargeAmountInputChange,
  onRechargeSliderChange,
  membershipProvider,
  onMembershipProviderChange,
  rechargeProvider,
  onRechargeProviderChange,
  onMembershipOrder,
  onPreviewRecharge,
  onCreateRechargeOrder,
  onRefreshMembershipOrder,
  onRefreshRechargeOrder,
  onRequestWithdrawal,
  onRecordInvite,
  onClaimDailyActivity,
  onCopyInviteCode,
  onSubmitKyc,
  membershipOrder,
  rechargePreview,
  rechargeOrder,
  withdrawalAmountInput,
  onWithdrawalAmountInputChange,
  bankFingerprint,
  onBankFingerprintChange,
  withdrawal,
  inviteCodeInput,
  onInviteCodeInputChange,
  assistedInvite,
  onAssistedInviteChange,
  referral,
  kycProviderRef,
  onKycProviderRefChange,
  kycBankFingerprint,
  onKycBankFingerprintChange,
  kycSubmission,
  pendingAction,
  isMutating,
}: {
  state: PartnerEnabledState;
  rechargeAmountInput: string;
  rechargeAmountCnyCents: number;
  onRechargeAmountInputChange: (value: string) => void;
  onRechargeSliderChange: (value: number) => void;
  membershipProvider: PartnerPaymentProvider;
  onMembershipProviderChange: (value: PartnerPaymentProvider) => void;
  rechargeProvider: PartnerPaymentProvider;
  onRechargeProviderChange: (value: PartnerPaymentProvider) => void;
  onMembershipOrder: () => void;
  onPreviewRecharge: () => void;
  onCreateRechargeOrder: () => void;
  onRefreshMembershipOrder: (order: PartnerOrderSummary) => void;
  onRefreshRechargeOrder: (order: PartnerOrderSummary) => void;
  onRequestWithdrawal: () => void;
  onRecordInvite: () => void;
  onClaimDailyActivity: () => void;
  onCopyInviteCode: () => void;
  onSubmitKyc: () => void;
  membershipOrder: PartnerOrderSummary | null;
  rechargePreview: PartnerRechargePreview | null;
  rechargeOrder: PartnerOrderSummary | null;
  withdrawalAmountInput: string;
  onWithdrawalAmountInputChange: (value: string) => void;
  bankFingerprint: string;
  onBankFingerprintChange: (value: string) => void;
  withdrawal: PartnerWithdrawalSummary | null;
  inviteCodeInput: string;
  onInviteCodeInputChange: (value: string) => void;
  assistedInvite: boolean;
  onAssistedInviteChange: (value: boolean) => void;
  referral: PartnerReferralSummary | null;
  kycProviderRef: string;
  onKycProviderRefChange: (value: string) => void;
  kycBankFingerprint: string;
  onKycBankFingerprintChange: (value: string) => void;
  kycSubmission: PartnerKycSubmissionSummary | null;
  pendingAction: PartnerAction | null;
  isMutating: boolean;
}): JSX.Element {
  const membershipActive = state.membership.status === 'active';
  const kycSubmitBlocked = !membershipActive || state.kycStatus === 'passed' || state.kycStatus === 'pending';
  const rechargeGate = partnerRechargeGate(state);
  const withdrawalGate = partnerWithdrawalGate(state, {
    amountCreditCents: amountInputToCreditCents(withdrawalAmountInput),
    bankAccountFingerprint: bankFingerprint,
  });
  const kycHint =
    !membershipActive
      ? '完成年度会员后可进行实名银行卡认证。'
      : state.kycStatus === 'passed'
        ? '银行卡实名认证已通过。'
        : state.kycStatus === 'pending'
          ? '银行卡认证已提交，等待认证结果。'
          : state.kycStatus === 'review_required'
            ? '认证证据不足，需补充流水或等待人工复核。'
            : state.kycStatus === 'rejected'
              ? '实名未通过，可重新提交。'
              : '可提交实名银行卡认证。';

  return (
    <div className="space-y-6">
      <Section
        title="状态与余额"
        description="HOLA Credit 和 API Units 仅用于合伙人账本展示。"
        className="rounded-[8px] border-[#DCDDDD] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]"
      >
        <div className="grid gap-x-8 lg:grid-cols-2">
          <Row label="会员状态" description="年费会员是充值和提现的前置条件">
            <StatusValue icon={<CreditCard className="h-3.5 w-3.5" />} value={state.membership.label} />
          </Row>
          <Row label="会员到期" description="到期后需要重新开通年费会员">
            <span className="text-sm tabular-nums text-foreground/80">{state.membership.expiresAtLabel}</span>
          </Row>
          <Row label="KYC 状态" description="通过后才能创建充值订单和提现申请">
            <StatusValue icon={<Shield className="h-3.5 w-3.5" />} value={state.kycLabel} />
          </Row>
          <Row label="可用 HOLA Credit" description="可用于后续合伙人账本操作">
            <span className="text-sm font-medium tabular-nums">{formatHolaCreditCents(state.ledger.availableCreditCents)}</span>
          </Row>
          <Row label="锁定 HOLA Credit" description="仍处于累计或释放周期内">
            <span className="text-sm tabular-nums">{formatHolaCreditCents(state.ledger.lockedCreditCents)}</span>
          </Row>
          <Row label="可提现 HOLA Credit" description="可提交提现申请的余额">
            <span className="text-sm font-medium tabular-nums">{formatHolaCreditCents(state.ledger.withdrawableCreditCents)}</span>
          </Row>
          <Row label="待出款 HOLA Credit" description="已提交但尚未完成审批或出款">
            <span className="text-sm tabular-nums">{formatHolaCreditCents(state.ledger.pendingWithdrawalCreditCents)}</span>
          </Row>
          <Row label="冻结 HOLA Credit" description="风险复核或异常状态下冻结">
            <span className="text-sm tabular-nums">{formatHolaCreditCents(state.ledger.frozenCreditCents)}</span>
          </Row>
        </div>
      </Section>

      <Section
        title="每日活跃"
        description="签到只影响后续 API Units 分配权重，不会直接发放 HOLA Credit。"
        className="rounded-[8px] border-[#DCDDDD] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]"
      >
        <div className="grid gap-x-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <div className="grid gap-x-8 lg:grid-cols-3">
            <Row label="今日状态" description={state.activity.activityDate || '—'}>
              <StatusValue icon={<CalendarCheck className="h-3.5 w-3.5" />} value={state.activity.checkedInLabel} />
            </Row>
            <Row label="近 7 日签到" description="用于计算每日活跃系数">
              <span className="text-sm font-medium tabular-nums text-foreground/85">{state.activity.loginDays} 天</span>
            </Row>
            <Row label="活跃系数" description="参与每日锁定增量分配权重">
              <span className="text-sm font-medium tabular-nums text-foreground/85">
                {state.activity.activityMultiplierLabel}
              </span>
            </Row>
          </div>
          <div className="mt-3 flex justify-end lg:mt-0">
            <Button
              type="button"
              size="sm"
              onClick={onClaimDailyActivity}
              disabled={isMutating || !membershipActive || state.activity.checkedInToday}
            >
              {pendingAction === 'activity' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <CalendarCheck className="h-3.5 w-3.5" aria-hidden />
              )}
              {state.activity.checkedInToday ? '今日已签到' : '记录活跃'}
            </Button>
          </div>
        </div>
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section
          title="最近订单"
          description="会员和充值订单的确认状态。"
          className="rounded-[8px] border-[#DCDDDD] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]"
        >
          <RecentOrdersTable rows={state.orders} />
        </Section>

        <Section
          title="提现进度"
          description="提现申请的复核和出款状态。"
          className="rounded-[8px] border-[#DCDDDD] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]"
        >
          <RecentWithdrawalsTable rows={state.withdrawals} />
        </Section>
      </div>

      <Section
        title="实名认证"
        description="年度会员开通后完成实名银行卡认证，通过后才能充值和提现。"
        className="rounded-[8px] border-[#DCDDDD] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]"
      >
        <div className="grid gap-3 lg:grid-cols-3">
          <Row label="当前状态" description={kycHint}>
            <StatusValue icon={<Shield className="h-3.5 w-3.5" />} value={state.kycLabel} />
          </Row>
          <label className="min-w-0 text-xs font-medium text-[#595757]">
            银行卡认证指纹
            <Input
              className="mt-1 font-mono text-xs"
              placeholder="bank_fp_..."
              value={kycBankFingerprint}
              disabled={isMutating || kycSubmitBlocked}
              onChange={(event) => onKycBankFingerprintChange(event.target.value)}
            />
          </label>
          <label className="min-w-0 text-xs font-medium text-[#595757]">
            银行卡认证流水号
            <Input
              className="mt-1 font-mono text-xs"
              placeholder="bankcard-flow-..."
              value={kycProviderRef}
              disabled={isMutating || kycSubmitBlocked}
              onChange={(event) => onKycProviderRefChange(event.target.value)}
            />
          </label>
        </div>
        <div className="mt-3 flex justify-end">
          <Button
            type="button"
            size="sm"
            onClick={onSubmitKyc}
            disabled={isMutating || kycSubmitBlocked}
          >
            {pendingAction === 'kyc' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Shield className="h-3.5 w-3.5" aria-hidden />
            )}
            提交认证
          </Button>
        </div>
        {kycSubmission ? (
          <KycSubmissionSummary submission={kycSubmission} />
        ) : (
          state.kycProfile && <KycProfileSummary profile={state.kycProfile} />
        )}
      </Section>

      <Section
        title="邀请好友赚 HOLA Credit"
        description="普通邀请按好友充值额 20% 入账，代充值或协助充值按 10% 入账。"
        className="rounded-[8px] border-[#DCDDDD] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]"
      >
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <label className="min-w-0 text-xs font-medium text-[#595757]">
            我的邀请码
            <div className="mt-1 flex gap-2">
              <Input value={state.inviteCode || '—'} readOnly className="font-mono text-xs" />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0 border-[#DCDDDD] bg-white text-[#595757] hover:border-[#ADADAD] hover:bg-white hover:text-[#EA1F59]"
                onClick={onCopyInviteCode}
                disabled={!state.inviteCode}
                aria-label="复制我的邀请码"
              >
                <Copy className="h-3.5 w-3.5" aria-hidden />
                复制
              </Button>
            </div>
          </label>
          <label className="min-w-0 text-xs font-medium text-[#595757]">
            好友邀请码
            <Input
              className="mt-1 font-mono text-xs"
              placeholder="usr_..."
              value={inviteCodeInput}
              disabled={isMutating}
              onChange={(event) => onInviteCodeInputChange(event.target.value)}
            />
          </label>
        </div>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-[#DCDDDD] accent-[#EA1F59]"
              checked={assistedInvite}
              disabled={isMutating}
              onChange={(event) => onAssistedInviteChange(event.target.checked)}
            />
            代充值或协助充值
          </label>
          <Button
            type="button"
            size="sm"
            onClick={onRecordInvite}
            disabled={isMutating || inviteCodeInput.trim().length === 0}
          >
            {pendingAction === 'invite' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Gift className="h-3.5 w-3.5" aria-hidden />
            )}
            登记邀请
          </Button>
        </div>
        {referral && <ReferralSummary referral={referral} />}
      </Section>

      <Section
        title="最近批次"
        description="展示最近创建的合伙人账本批次和释放窗口。"
        className="rounded-[8px] border-[#DCDDDD] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]"
      >
        {state.lots.length === 0 ? (
          <div className="border-y border-dashed border-[#DCDDDD] py-8 text-center">
            <div className="text-sm font-medium text-foreground/80">暂无批次</div>
            <div className="mt-1 text-xs text-muted-foreground">完成充值确认后，批次会显示在这里。</div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[760px] w-full text-left text-xs">
              <thead className="border-b border-[#EFEFEF] text-[11px] text-muted-foreground">
                <tr>
                  <th scope="col" className="pb-2 pr-4 font-medium">批次</th>
                  <th scope="col" className="pb-2 pr-4 font-medium">状态</th>
                  <th scope="col" className="pb-2 pr-4 font-medium">本金</th>
                  <th scope="col" className="pb-2 pr-4 font-medium">锁定增量</th>
                  <th scope="col" className="pb-2 pr-4 font-medium">已释放</th>
                  <th scope="col" className="pb-2 pr-4 font-medium">释放窗口</th>
                  <th scope="col" className="pb-2 font-medium">风险</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EFEFEF]">
                {state.lots.map((lot) => (
                  <tr key={lot.key}>
                    <td className="py-3 pr-4 font-medium text-foreground/80">{lot.externalId}</td>
                    <td className="py-3 pr-4">{lot.statusLabel}</td>
                    <td className="py-3 pr-4 tabular-nums">{formatHolaCreditCents(lot.principalCreditCents)}</td>
                    <td className="py-3 pr-4 tabular-nums">{formatHolaCreditCents(lot.lockedBonusCreditCents)}</td>
                    <td className="py-3 pr-4 tabular-nums">
                      {formatHolaCreditCents(lot.releasedPrincipalCreditCents + lot.releasedBonusCreditCents)}
                    </td>
                    <td className="py-3 pr-4 tabular-nums">
                      {lot.releaseStartsAtLabel} 至 {lot.releaseEndsAtLabel}
                    </td>
                    <td className="py-3">{lot.riskLabel}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section
          title="年费会员订单"
          description="选择支付渠道创建年费订单；渠道回调或后台确认后生效。"
          className="rounded-[8px] border-[#DCDDDD] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]"
        >
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(150px,180px)_auto] sm:items-end">
            <div className="min-w-0 text-xs leading-5 text-muted-foreground">
              {partnerPaymentProviderHint(membershipProvider)}
            </div>
            <label className="min-w-0 text-xs font-medium text-[#595757]">
              支付渠道
              <PartnerPaymentProviderSelect
                value={membershipProvider}
                onChange={onMembershipProviderChange}
                disabled={isMutating}
                ariaLabel="年费会员支付渠道"
              />
            </label>
            <Button
              type="button"
              size="sm"
              className="sm:self-end"
              onClick={onMembershipOrder}
              disabled={isMutating}
            >
              {pendingAction === 'membership' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <CreditCard className="h-3.5 w-3.5" aria-hidden />
              )}
              创建会员订单
            </Button>
          </div>
          {membershipOrder && (
            <OrderSummary
              order={membershipOrder}
              onRefresh={() => onRefreshMembershipOrder(membershipOrder)}
              refreshing={pendingAction === 'orderStatus'}
            />
          )}
        </Section>

        <Section
          title="提现申请"
          description="提交后进入审核，审批和出款都不是立即完成。"
          className="rounded-[8px] border-[#DCDDDD] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="min-w-0 text-xs font-medium text-[#595757]">
              提现金额
              <Input
                className="mt-1"
                type="number"
                inputMode="decimal"
                placeholder="例如 5000"
                value={withdrawalAmountInput}
                disabled={isMutating}
                onChange={(event) => onWithdrawalAmountInputChange(event.target.value)}
              />
            </label>
            <label className="min-w-0 text-xs font-medium text-[#595757]">
              银行账户指纹
              <Input
                className="mt-1"
                placeholder="bank_fp_..."
                value={bankFingerprint}
                disabled={isMutating}
                onChange={(event) => onBankFingerprintChange(event.target.value)}
              />
            </label>
          </div>
          <div className="mt-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
            <span>{withdrawalGate.reason}</span>
            <Button
              type="button"
              size="sm"
              onClick={onRequestWithdrawal}
              disabled={isMutating || withdrawalGate.blocked}
            >
              {pendingAction === 'withdrawal' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
              )}
              提交申请
            </Button>
          </div>
          {withdrawal && <WithdrawalSummary withdrawal={withdrawal} />}
        </Section>
      </div>

      <Section
        title="充值预览与订单"
        description="单笔 ¥10,000 至 ¥200,000，预览会计入过去 30 天已完成充值和当前金额。"
        className="rounded-[8px] border-[#DCDDDD] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]"
      >
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div className="min-w-0">
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(150px,180px)_auto] sm:items-end">
              <label className="min-w-0 text-xs font-medium text-[#595757]">
                充值金额
                <Input
                  className="mt-1"
                  type="number"
                  inputMode="numeric"
                  min={10000}
                  max={200000}
                  step={1}
                  value={rechargeAmountInput}
                  disabled={isMutating}
                  onChange={(event) => onRechargeAmountInputChange(event.target.value)}
                  onBlur={() => onRechargeAmountInputChange(String(rechargeAmountCnyCents / 100))}
                />
              </label>
              <label className="min-w-0 text-xs font-medium text-[#595757]">
                支付渠道
                <PartnerPaymentProviderSelect
                  value={rechargeProvider}
                  onChange={onRechargeProviderChange}
                  disabled={isMutating}
                  ariaLabel="充值支付渠道"
                />
              </label>
              <div className="text-sm font-semibold tabular-nums text-foreground sm:pb-2">
                {formatPartnerCnyCents(rechargeAmountCnyCents)}
              </div>
            </div>
            <input
              className="mt-4 h-2 w-full accent-[#EA1F59]"
              type="range"
              min={10000_00}
              max={200000_00}
              step={100}
              value={rechargeAmountCnyCents}
              disabled={isMutating}
              onChange={(event) => onRechargeSliderChange(Number(event.target.value))}
              aria-label="充值金额"
            />
            <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
              <span>¥10,000</span>
              <span>¥200,000</span>
            </div>
          </div>
          <div className="flex flex-col gap-2 lg:items-end">
            <div className="max-w-[260px] text-xs leading-5 text-muted-foreground lg:text-right">
              {rechargeGate.blocked ? rechargeGate.reason : partnerPaymentProviderHint(rechargeProvider)}
            </div>
            <div className="flex flex-wrap gap-2 lg:justify-end">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="border-[#DCDDDD] bg-white text-[#595757] hover:border-[#ADADAD] hover:bg-white hover:text-[#EA1F59]"
                onClick={onPreviewRecharge}
                disabled={isMutating || rechargeGate.blocked}
              >
                {pendingAction === 'preview' && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
                预览
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={onCreateRechargeOrder}
                disabled={isMutating || rechargeGate.blocked}
              >
                {pendingAction === 'recharge' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <Wallet className="h-3.5 w-3.5" aria-hidden />
                )}
                创建充值订单
              </Button>
            </div>
          </div>
        </div>
        {rechargePreview && <RechargePreviewSummary preview={rechargePreview} />}
        {rechargeOrder && (
          <OrderSummary
            order={rechargeOrder}
            onRefresh={() => onRefreshRechargeOrder(rechargeOrder)}
            refreshing={pendingAction === 'orderStatus'}
          />
        )}
      </Section>
    </div>
  );
}

function PartnerPaymentProviderSelect({
  value,
  onChange,
  disabled,
  ariaLabel,
}: {
  value: PartnerPaymentProvider;
  onChange: (value: PartnerPaymentProvider) => void;
  disabled: boolean;
  ariaLabel: string;
}): JSX.Element {
  return (
    <select
      className="mt-1 h-9 w-full rounded-[8px] border border-[#DCDDDD] bg-white px-3 text-sm text-foreground outline-none transition focus:border-[#EA1F59] disabled:cursor-not-allowed disabled:bg-[#F7F7F7] disabled:text-muted-foreground"
      value={value}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(event) => onChange(normalizePartnerPaymentProvider(event.target.value))}
    >
      {PARTNER_PAYMENT_PROVIDERS.map((provider) => (
        <option key={provider} value={provider}>
          {partnerPaymentProviderLabel(provider)}
        </option>
      ))}
    </select>
  );
}

function StatusValue({ icon, value }: { icon: React.ReactNode; value: string }): JSX.Element {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 text-sm font-medium text-foreground/85">
      <span className="text-[#EA1F59]">{icon}</span>
      <span className="min-w-0 truncate">{value}</span>
    </span>
  );
}

function StatusPanel({
  tone,
  title,
  body,
  action,
  className,
}: {
  tone: 'error' | 'info';
  title: string;
  body: string;
  action?: React.ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`mb-6 rounded-[8px] border border-[#DCDDDD] bg-white px-4 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.03)] ${className ?? ''}`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-2">
          <AlertCircle
            className={`mt-0.5 h-4 w-4 shrink-0 ${tone === 'error' ? 'text-[#EA1F59]' : 'text-[#595757]'}`}
            aria-hidden
          />
          <div className="min-w-0">
            <div className="text-sm font-medium text-foreground/85">{title}</div>
            <div className="mt-0.5 text-xs leading-5 text-muted-foreground">{body}</div>
          </div>
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
    </div>
  );
}

function OrderSummary({
  order,
  onRefresh,
  refreshing,
}: {
  order: PartnerOrderSummary;
  onRefresh?: () => void;
  refreshing?: boolean;
}): JSX.Element {
  const paymentIntent = partnerPaymentIntentDisplay(order.paymentIntent);
  return (
    <div className="mt-4 border-t border-[#EFEFEF] pt-4">
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-xs font-medium text-foreground/80">订单摘要</div>
        {onRefresh && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-fit border-[#DCDDDD] bg-white text-[#595757] hover:border-[#ADADAD] hover:bg-white hover:text-[#EA1F59]"
            onClick={onRefresh}
            disabled={refreshing}
          >
            {refreshing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            )}
            刷新状态
          </Button>
        )}
      </div>
      <dl className="grid gap-3 text-xs sm:grid-cols-2">
        <SummaryItem label="订单编号" value={order.orderExternalId} />
        <SummaryItem label="类型" value={order.orderKind === 'membership' ? '年费会员' : '充值'} />
        <SummaryItem label="渠道" value={partnerPaymentProviderLabel(order.provider)} />
        <SummaryItem label="状态" value={orderStatusLabel(order.status)} />
        <SummaryItem label="金额" value={formatPartnerCnyCents(order.amountCnyCents)} />
        {paymentIntent && <SummaryItem label="支付意图" value={`${paymentIntent.label} · ${paymentIntent.detail}`} />}
      </dl>
    </div>
  );
}

function RechargePreviewSummary({ preview }: { preview: PartnerRechargePreview }): JSX.Element {
  const multiplier = `${(preview.tier.multiplierBps / 10_000).toFixed(2)}x`;
  return (
    <dl className="mt-4 grid gap-3 border-t border-[#EFEFEF] pt-4 text-xs sm:grid-cols-2 lg:grid-cols-4">
      <SummaryItem label="当前金额" value={formatPartnerCnyCents(preview.amountCnyCents)} />
      <SummaryItem label="30 天滚动金额" value={formatPartnerCnyCents(preview.rollingThirtyDayCnyCents)} />
      <SummaryItem label="阶梯倍率" value={multiplier} />
      <SummaryItem label="API Units" value={formatApiUnits(preview.apiUnits)} />
    </dl>
  );
}

function WithdrawalSummary({ withdrawal }: { withdrawal: PartnerWithdrawalSummary }): JSX.Element {
  return (
    <dl className="mt-4 grid gap-3 border-t border-[#EFEFEF] pt-4 text-xs sm:grid-cols-2">
      <SummaryItem label="申请编号" value={withdrawal.withdrawalExternalId} />
      <SummaryItem label="金额" value={formatHolaCreditCents(withdrawal.amountCreditCents)} />
      <SummaryItem label="状态" value={withdrawalStatusLabel(withdrawal.status)} />
      <SummaryItem label="预计复核时间" value={formatDateTime(withdrawal.reviewDueAt)} />
      <SummaryItem label="银行指纹" value={withdrawal.bankAccountFingerprint || '—'} />
      <SummaryItem label="风险分" value={String(withdrawal.riskScore)} />
    </dl>
  );
}

function RecentOrdersTable({ rows }: { rows: PartnerEnabledState['orders'] }): JSX.Element {
  if (rows.length === 0) {
    return <EmptyInlineState title="暂无订单" body="会员或充值订单创建后会显示在这里。" />;
  }
  return (
    <div className="overflow-x-auto">
      <table className="min-w-[680px] w-full text-left text-xs">
        <thead className="border-b border-[#EFEFEF] text-[11px] text-muted-foreground">
          <tr>
            <th scope="col" className="pb-2 pr-4 font-medium">订单</th>
            <th scope="col" className="pb-2 pr-4 font-medium">类型</th>
            <th scope="col" className="pb-2 pr-4 font-medium">金额</th>
            <th scope="col" className="pb-2 pr-4 font-medium">状态</th>
            <th scope="col" className="pb-2 pr-4 font-medium">说明</th>
            <th scope="col" className="pb-2 font-medium">创建</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#EFEFEF]">
          {rows.map((row) => (
            <tr key={row.key}>
              <td className="py-3 pr-4 font-mono text-[11px] text-foreground/75">{row.orderExternalId}</td>
              <td className="py-3 pr-4 text-muted-foreground">{row.orderKind === 'membership' ? '年费会员' : '充值'}</td>
              <td className="py-3 pr-4 tabular-nums">{formatPartnerCnyCents(row.amountCnyCents)}</td>
              <td className="py-3 pr-4">{row.statusLabel}</td>
              <td className="max-w-[240px] py-3 pr-4 text-muted-foreground">{row.statusHelp}</td>
              <td className="py-3 text-muted-foreground">{row.createdAtLabel}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RecentWithdrawalsTable({ rows }: { rows: PartnerEnabledState['withdrawals'] }): JSX.Element {
  if (rows.length === 0) {
    return <EmptyInlineState title="暂无提现" body="提现申请提交后会显示在这里。" />;
  }
  return (
    <div className="overflow-x-auto">
      <table className="min-w-[760px] w-full text-left text-xs">
        <thead className="border-b border-[#EFEFEF] text-[11px] text-muted-foreground">
          <tr>
            <th scope="col" className="pb-2 pr-4 font-medium">申请</th>
            <th scope="col" className="pb-2 pr-4 font-medium">金额</th>
            <th scope="col" className="pb-2 pr-4 font-medium">状态</th>
            <th scope="col" className="pb-2 pr-4 font-medium">说明</th>
            <th scope="col" className="pb-2 pr-4 font-medium">银行指纹</th>
            <th scope="col" className="pb-2 pr-4 font-medium">复核</th>
            <th scope="col" className="pb-2 font-medium">风险</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#EFEFEF]">
          {rows.map((row) => (
            <tr key={row.key}>
              <td className="py-3 pr-4 font-mono text-[11px] text-foreground/75">{row.withdrawalExternalId}</td>
              <td className="py-3 pr-4 tabular-nums">{formatHolaCreditCents(row.amountCreditCents)}</td>
              <td className="py-3 pr-4">{row.statusLabel}</td>
              <td className="max-w-[240px] py-3 pr-4 text-muted-foreground">{row.statusHelp}</td>
              <td className="py-3 pr-4 text-muted-foreground">
                <span className="block max-w-[160px] truncate" title={row.bankAccountFingerprint}>
                  {row.bankAccountFingerprint || '—'}
                </span>
              </td>
              <td className="py-3 pr-4 text-muted-foreground">{row.reviewDueAtLabel}</td>
              <td className="py-3 tabular-nums text-muted-foreground">{row.riskScore}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EmptyInlineState({ title, body }: { title: string; body: string }): JSX.Element {
  return (
    <div className="border-y border-dashed border-[#DCDDDD] py-8 text-center">
      <div className="text-sm font-medium text-foreground/80">{title}</div>
      <div className="mt-1 text-xs text-muted-foreground">{body}</div>
    </div>
  );
}

function ReferralSummary({ referral }: { referral: PartnerReferralSummary }): JSX.Element {
  return (
    <dl className="mt-4 grid gap-3 border-t border-[#EFEFEF] pt-4 text-xs sm:grid-cols-2 lg:grid-cols-4">
      <SummaryItem label="邀请编号" value={referral.referralExternalId} />
      <SummaryItem label="邀请人" value={referral.inviterExternalId} />
      <SummaryItem label="当前账号" value={referral.inviteeExternalId} />
      <SummaryItem label="奖励类型" value={referral.assisted ? '代充值 10%' : '普通邀请 20%'} />
    </dl>
  );
}

function KycSubmissionSummary({ submission }: { submission: PartnerKycSubmissionSummary }): JSX.Element {
  return (
    <dl className="mt-4 grid gap-3 border-t border-[#EFEFEF] pt-4 text-xs sm:grid-cols-2 lg:grid-cols-5">
      <SummaryItem label="实名编号" value={submission.kycExternalId} />
      <SummaryItem label="状态" value={kycStatusLabel(submission.status)} />
      <SummaryItem label="认证方式" value={submission.provider} />
      <SummaryItem label="流水号" value={submission.providerRef ?? '—'} />
      <SummaryItem label="银行卡实名" value={submission.bankCardVerified ? '已绑定' : '未绑定'} />
    </dl>
  );
}

function KycProfileSummary({ profile }: { profile: NonNullable<PartnerEnabledState['kycProfile']> }): JSX.Element {
  return (
    <dl className="mt-4 grid gap-3 border-t border-[#EFEFEF] pt-4 text-xs sm:grid-cols-2 lg:grid-cols-5">
      <SummaryItem label="实名编号" value={profile.kycExternalId} />
      <SummaryItem label="状态" value={profile.statusLabel} />
      <SummaryItem label="认证方式" value={profile.provider} />
      <SummaryItem label="流水号" value={profile.providerRef ?? '—'} />
      <SummaryItem label="银行卡实名" value={profile.bankCardVerified ? '已绑定' : '未绑定'} />
      <SummaryItem label="复核日期" value={profile.reviewedAtLabel} />
    </dl>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words font-medium text-foreground/85">{value}</dd>
    </div>
  );
}

function idempotencyKey(prefix: string): string {
  const suffix =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}:${suffix}`;
}

function amountInputToCreditCents(value: string): number {
  const parsed = Number(value.trim());
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.floor(parsed * 100);
}

function rechargeFingerprint(amountCnyCents: number, provider: PartnerPaymentProvider): string {
  return `amountCnyCents=${amountCnyCents};provider=${provider}`;
}

function withdrawalFingerprint(amountCreditCents: number, bankAccountFingerprint: string): string {
  return `amountCreditCents=${amountCreditCents};bank=${bankAccountFingerprint.trim()}`;
}

function orderStatusLabel(status: string): string {
  if (status === 'pending') return '待确认';
  if (status === 'completed') return '已完成';
  if (status === 'review_required') return '待复核';
  if (status === 'cancelled') return '已取消';
  return status;
}

function withdrawalStatusLabel(status: string): string {
  if (status === 'requested') return '已提交';
  if (status === 'reviewing') return '审核中';
  if (status === 'approved') return '已批准';
  if (status === 'paid') return '已出款';
  if (status === 'rejected') return '未通过';
  if (status === 'returned') return '已退回';
  return status;
}

function formatDateTime(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}
