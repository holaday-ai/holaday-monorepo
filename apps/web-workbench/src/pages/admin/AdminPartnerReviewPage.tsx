import {
  Banknote,
  CheckCircle2,
  Clipboard,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import * as React from 'react';
import { Link } from 'react-router-dom';
import { useToast } from '@/components/ui/toast';
import { pageActionError, pageErrorMessage } from '@/lib/page-error-copy';
import { trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import {
  formatDateTime,
  formatInteger,
  truncate,
  useMountedRef,
} from './admin-shared';
import {
  formatPartnerCreditCents,
  formatPartnerMoneyCents,
  filterAdminPartnerOverview,
  normalizeAdminPartnerOverview,
  normalizePartnerReconciliation,
  partnerReconciliationCsv,
  partnerKycQueueReviewPayload,
  partnerOrderActionLabel,
  partnerRiskCloseResolutionKindLabel,
  partnerRiskEventSeverityLabel,
  partnerRiskEventTypeLabel,
  partnerRiskLotActionPayload,
  partnerRiskLotQueueAction,
  partnerReviewStatusToken,
  type AdminPartnerStatusKind,
  type PartnerRiskLotCloseResolutionKind,
  type PartnerReconciliationState,
} from './admin-partner-state';

type OverviewState = ReturnType<typeof normalizeAdminPartnerOverview>;
type EnabledOverviewState = Extract<OverviewState, { enabled: true }>;
type KycStatusInput = 'pending' | 'passed' | 'review_required' | 'rejected';

export function AdminPartnerReviewPage(): JSX.Element {
  const mountedRef = useMountedRef();
  const toast = useToast();
  const requestIdRef = React.useRef(0);
  const reconciliationRequestIdRef = React.useRef(0);
  const [data, setData] = React.useState<OverviewState | null>(null);
  const [reconciliation, setReconciliation] = React.useState<PartnerReconciliationState | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [reconciliationLoading, setReconciliationLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [reconciliationError, setReconciliationError] = React.useState<string | null>(null);
  const [pendingAction, setPendingAction] = React.useState<string | null>(null);
  const [reconciliationTo, setReconciliationTo] = React.useState(() => isoDay(new Date()));
  const [reconciliationFrom, setReconciliationFrom] = React.useState(() => isoDay(addDays(new Date(), -6)));
  const [kycUserExternalId, setKycUserExternalId] = React.useState('');
  const [kycStatus, setKycStatus] = React.useState<KycStatusInput>('passed');
  const [kycProvider, setKycProvider] = React.useState('manual');
  const [kycProviderRef, setKycProviderRef] = React.useState('');
  const [kycBankCardHash, setKycBankCardHash] = React.useState('');
  const [kycNote, setKycNote] = React.useState('');
  const [orderReviewNotes, setOrderReviewNotes] = React.useState<Record<string, string>>({});
  const [withdrawalReasons, setWithdrawalReasons] = React.useState<Record<string, string>>({});
  const [payoutIds, setPayoutIds] = React.useState<Record<string, string>>({});
  const [riskLotNotes, setRiskLotNotes] = React.useState<Record<string, string>>({});
  const [riskLotResolutionKinds, setRiskLotResolutionKinds] = React.useState<
    Record<string, PartnerRiskLotCloseResolutionKind>
  >({});
  const [riskLotResolutionRefs, setRiskLotResolutionRefs] = React.useState<Record<string, string>>({});
  const [queueSearch, setQueueSearch] = React.useState('');
  const [serverQueueSearch, setServerQueueSearch] = React.useState('');

  const refresh = React.useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const query = serverQueueSearch.trim();
      const res = normalizeAdminPartnerOverview(
        await trpc.admin.partner.overview.query(query ? { query } : undefined),
      );
      if (mountedRef.current && requestIdRef.current === requestId) setData(res);
    } catch (err) {
      if (mountedRef.current && requestIdRef.current === requestId) {
        setError(pageErrorMessage(err));
      }
    } finally {
      if (mountedRef.current && requestIdRef.current === requestId) setLoading(false);
    }
  }, [mountedRef, serverQueueSearch]);

  const refreshReconciliation = React.useCallback(async () => {
    const requestId = ++reconciliationRequestIdRef.current;
    setReconciliationLoading(true);
    setReconciliationError(null);
    try {
      const res = normalizePartnerReconciliation(
        await trpc.admin.partner.reconciliation.query({
          from: reconciliationFrom || undefined,
          to: reconciliationTo || undefined,
        }),
      );
      if (mountedRef.current && reconciliationRequestIdRef.current === requestId) setReconciliation(res);
    } catch (err) {
      if (mountedRef.current && reconciliationRequestIdRef.current === requestId) {
        setReconciliationError(pageErrorMessage(err));
      }
    } finally {
      if (mountedRef.current && reconciliationRequestIdRef.current === requestId) setReconciliationLoading(false);
    }
  }, [mountedRef, reconciliationFrom, reconciliationTo]);

  React.useEffect(() => {
    const handle = window.setTimeout(() => {
      if (mountedRef.current) setServerQueueSearch(queueSearch.trim().slice(0, 100));
    }, 300);
    return () => window.clearTimeout(handle);
  }, [mountedRef, queueSearch]);

  React.useEffect(() => {
    void refresh();
    return () => {
      requestIdRef.current += 1;
    };
  }, [refresh]);

  React.useEffect(() => {
    void refreshReconciliation();
    return () => {
      reconciliationRequestIdRef.current += 1;
    };
  }, [refreshReconciliation]);

  async function runAction(actionKey: string, action: () => Promise<void>, success: string): Promise<void> {
    if (pendingAction) {
      toast.show('已有审核动作处理中', 'info', 1600);
      return;
    }
    setPendingAction(actionKey);
    try {
      await action();
      toast.show(success, 'info', 2200);
      await refresh();
      await refreshReconciliation();
    } catch (err) {
      toast.show(pageActionError('操作失败', err), 'error');
    } finally {
      if (mountedRef.current) setPendingAction(null);
    }
  }

  async function submitManualKyc(): Promise<void> {
    const userExternalId = kycUserExternalId.trim();
    const provider = kycProvider.trim() || 'manual';
    if (!userExternalId) {
      toast.show('请填写用户 ID', 'error');
      return;
    }
    await runAction(
      `kyc-manual:${userExternalId}`,
      async () => {
        await trpc.admin.partner.setKycStatus.mutate({
          userExternalId,
          status: kycStatus,
          provider,
          providerRef: kycProviderRef.trim() || undefined,
          bankCardHash: kycBankCardHash.trim() || undefined,
          note: kycNote.trim() || undefined,
        });
        setKycProviderRef('');
        setKycBankCardHash('');
        setKycNote('');
      },
      '实名状态已更新',
    );
  }

  async function copyReconciliationCsv(): Promise<void> {
    if (!reconciliation?.enabled) return;
    try {
      await navigator.clipboard.writeText(partnerReconciliationCsv(reconciliation));
      toast.show('对账 CSV 已复制', 'info', 1600);
    } catch (err) {
      toast.show(pageActionError('复制失败', err), 'error');
    }
  }

  const enabled = data?.enabled ? data : null;
  const visibleData = React.useMemo(
    () => (enabled ? filterAdminPartnerOverview(enabled, queueSearch) : null),
    [enabled, queueSearch],
  );

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">合伙人审核</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            KYC、订单确认、提现复核与风险批次
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading || pendingAction !== null}
          className="inline-flex h-9 items-center gap-2 rounded-[8px] border border-[#DCDDDD] bg-white px-3 text-[13px] font-medium text-[#595757] transition-colors hover:border-[#ADADAD] hover:text-[#EA1F59] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          )}
          刷新
        </button>
      </header>

      {error && (
        <div className="mb-4 rounded-[8px] border border-[#EA1F59]/20 bg-[#EA1F59]/5 px-4 py-3 text-sm">
          <div className="font-medium text-[#EA1F59]">数据暂时无法加载</div>
          <div className="mt-1 text-xs text-[#595757]">{error}</div>
        </div>
      )}

      {loading && !data ? (
        <div className="rounded-[8px] border border-[#DCDDDD] bg-white py-12 text-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
          加载中…
        </div>
      ) : data?.enabled === false ? (
        <div className="rounded-[8px] border border-[#DCDDDD] bg-white px-5 py-8 text-sm text-muted-foreground">
          合伙人账本未启用
        </div>
      ) : enabled && visibleData?.enabled ? (
        <EnabledAdminPartnerReview
          data={visibleData}
          reconciliation={reconciliation}
          reconciliationLoading={reconciliationLoading}
          reconciliationError={reconciliationError}
          reconciliationFrom={reconciliationFrom}
          reconciliationTo={reconciliationTo}
          queueSearch={queueSearch}
          pendingAction={pendingAction}
          kycUserExternalId={kycUserExternalId}
          kycStatus={kycStatus}
          kycProvider={kycProvider}
          kycProviderRef={kycProviderRef}
          kycBankCardHash={kycBankCardHash}
          kycNote={kycNote}
          orderReviewNotes={orderReviewNotes}
          withdrawalReasons={withdrawalReasons}
          payoutIds={payoutIds}
          riskLotNotes={riskLotNotes}
          riskLotResolutionKinds={riskLotResolutionKinds}
          riskLotResolutionRefs={riskLotResolutionRefs}
          setKycUserExternalId={setKycUserExternalId}
          setKycStatus={setKycStatus}
          setKycProvider={setKycProvider}
          setKycProviderRef={setKycProviderRef}
          setKycBankCardHash={setKycBankCardHash}
          setKycNote={setKycNote}
          setOrderReviewNotes={setOrderReviewNotes}
          setWithdrawalReasons={setWithdrawalReasons}
          setPayoutIds={setPayoutIds}
          setRiskLotNotes={setRiskLotNotes}
          setRiskLotResolutionKinds={setRiskLotResolutionKinds}
          setRiskLotResolutionRefs={setRiskLotResolutionRefs}
          setReconciliationFrom={setReconciliationFrom}
          setReconciliationTo={setReconciliationTo}
          setQueueSearch={setQueueSearch}
          refreshReconciliation={refreshReconciliation}
          copyReconciliationCsv={copyReconciliationCsv}
          submitManualKyc={submitManualKyc}
          runAction={runAction}
        />
      ) : null}
    </div>
  );
}

function EnabledAdminPartnerReview({
  data,
  reconciliation,
  reconciliationLoading,
  reconciliationError,
  reconciliationFrom,
  reconciliationTo,
  queueSearch,
  pendingAction,
  kycUserExternalId,
  kycStatus,
  kycProvider,
  kycProviderRef,
  kycBankCardHash,
  kycNote,
  orderReviewNotes,
  withdrawalReasons,
  payoutIds,
  riskLotNotes,
  riskLotResolutionKinds,
  riskLotResolutionRefs,
  setKycUserExternalId,
  setKycStatus,
  setKycProvider,
  setKycProviderRef,
  setKycBankCardHash,
  setKycNote,
  setOrderReviewNotes,
  setWithdrawalReasons,
  setPayoutIds,
  setRiskLotNotes,
  setRiskLotResolutionKinds,
  setRiskLotResolutionRefs,
  setReconciliationFrom,
  setReconciliationTo,
  setQueueSearch,
  refreshReconciliation,
  copyReconciliationCsv,
  submitManualKyc,
  runAction,
}: {
  data: EnabledOverviewState;
  reconciliation: PartnerReconciliationState | null;
  reconciliationLoading: boolean;
  reconciliationError: string | null;
  reconciliationFrom: string;
  reconciliationTo: string;
  queueSearch: string;
  pendingAction: string | null;
  kycUserExternalId: string;
  kycStatus: KycStatusInput;
  kycProvider: string;
  kycProviderRef: string;
  kycBankCardHash: string;
  kycNote: string;
  orderReviewNotes: Record<string, string>;
  withdrawalReasons: Record<string, string>;
  payoutIds: Record<string, string>;
  riskLotNotes: Record<string, string>;
  riskLotResolutionKinds: Record<string, PartnerRiskLotCloseResolutionKind>;
  riskLotResolutionRefs: Record<string, string>;
  setKycUserExternalId: (value: string) => void;
  setKycStatus: (value: KycStatusInput) => void;
  setKycProvider: (value: string) => void;
  setKycProviderRef: (value: string) => void;
  setKycBankCardHash: (value: string) => void;
  setKycNote: (value: string) => void;
  setOrderReviewNotes: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setWithdrawalReasons: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setPayoutIds: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setRiskLotNotes: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setRiskLotResolutionKinds: React.Dispatch<React.SetStateAction<Record<string, PartnerRiskLotCloseResolutionKind>>>;
  setRiskLotResolutionRefs: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setReconciliationFrom: (value: string) => void;
  setReconciliationTo: (value: string) => void;
  setQueueSearch: (value: string) => void;
  refreshReconciliation: () => Promise<void>;
  copyReconciliationCsv: () => Promise<void>;
  submitManualKyc: () => Promise<void>;
  runAction: (actionKey: string, action: () => Promise<void>, success: string) => Promise<void>;
}): JSX.Element {
  return (
    <div className="space-y-5">
      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-10">
        <MetricCard label="待实名" value={data.metrics.pendingKycCount} />
        <MetricCard label="待确认订单" value={data.metrics.pendingOrderCount} />
        <MetricCard label="需复核订单" value={data.metrics.reviewRequiredOrderCount} />
        <MetricCard label="待提现复核" value={data.metrics.pendingWithdrawalCount} />
        <MetricCard label="待出款" value={data.metrics.approvedWithdrawalCount} />
        <MetricCard label="已出款" value={data.metrics.paidWithdrawalCount} />
        <MetricCard label="已拒绝" value={data.metrics.rejectedWithdrawalCount} />
        <MetricCard label="已退回" value={data.metrics.returnedWithdrawalCount} />
        <MetricCard label="风险批次" value={data.metrics.riskLotCount} tone={data.metrics.riskLotCount > 0 ? 'danger' : 'normal'} />
        <MetricCard label="风险事件" value={data.metrics.riskEventCount} tone={data.metrics.riskEventCount > 0 ? 'danger' : 'normal'} />
      </section>

      <ReconciliationPanel
        state={reconciliation}
        loading={reconciliationLoading}
        error={reconciliationError}
        from={reconciliationFrom}
        to={reconciliationTo}
        setFrom={setReconciliationFrom}
        setTo={setReconciliationTo}
        onRefresh={() => void refreshReconciliation()}
        onCopy={() => void copyReconciliationCsv()}
      />

      <ManualKycPanel
        userExternalId={kycUserExternalId}
        status={kycStatus}
        provider={kycProvider}
        providerRef={kycProviderRef}
        bankCardHash={kycBankCardHash}
        note={kycNote}
        pending={pendingAction?.startsWith('kyc-manual') ?? false}
        setUserExternalId={setKycUserExternalId}
        setStatus={setKycStatus}
        setProvider={setKycProvider}
        setProviderRef={setKycProviderRef}
        setBankCardHash={setKycBankCardHash}
        setNote={setKycNote}
        onSubmit={submitManualKyc}
      />

      <section className="rounded-[8px] border border-[#DCDDDD] bg-white p-4">
        <label className="flex min-w-0 items-center gap-2 rounded-[8px] border border-[#DCDDDD] px-3 focus-within:border-[#EA1F59] focus-within:ring-2 focus-within:ring-[#EA1F59]/15">
          <Search className="h-4 w-4 shrink-0 text-[#595757]" aria-hidden />
          <input
            value={queueSearch}
            onChange={(event) => setQueueSearch(event.target.value)}
            placeholder="搜索用户、订单、提现或批次"
            className="h-9 min-w-0 flex-1 bg-transparent text-[13px] outline-none"
          />
        </label>
      </section>

      <KycQueue rows={data.kycProfiles} pendingAction={pendingAction} runAction={runAction} />
      <OrderQueue
        rows={data.orders}
        pendingAction={pendingAction}
        orderReviewNotes={orderReviewNotes}
        setOrderReviewNotes={setOrderReviewNotes}
        runAction={runAction}
      />
      <WithdrawalQueue
        rows={data.withdrawals}
        pendingAction={pendingAction}
        withdrawalReasons={withdrawalReasons}
        payoutIds={payoutIds}
        setWithdrawalReasons={setWithdrawalReasons}
        setPayoutIds={setPayoutIds}
        runAction={runAction}
      />
      <WithdrawalHistory rows={data.withdrawalHistory} />
      <RiskLotQueue
        rows={data.riskLots}
        pendingAction={pendingAction}
        riskLotNotes={riskLotNotes}
        riskLotResolutionKinds={riskLotResolutionKinds}
        riskLotResolutionRefs={riskLotResolutionRefs}
        setRiskLotNotes={setRiskLotNotes}
        setRiskLotResolutionKinds={setRiskLotResolutionKinds}
        setRiskLotResolutionRefs={setRiskLotResolutionRefs}
        runAction={runAction}
      />
      <RiskEventHistory rows={data.riskEvents} />
    </div>
  );
}

function ReconciliationPanel({
  state,
  loading,
  error,
  from,
  to,
  setFrom,
  setTo,
  onRefresh,
  onCopy,
}: {
  state: PartnerReconciliationState | null;
  loading: boolean;
  error: string | null;
  from: string;
  to: string;
  setFrom: (value: string) => void;
  setTo: (value: string) => void;
  onRefresh: () => void;
  onCopy: () => void;
}): JSX.Element {
  const enabled = state?.enabled ? state : null;
  const metrics = enabled?.metrics;
  return (
    <section className="rounded-[8px] border border-[#DCDDDD] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
      <div className="flex flex-col gap-3 border-b border-[#EFEFEF] px-5 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold">对账</h2>
          <div className="mt-0.5 text-[12px] text-muted-foreground">
            {enabled ? `${enabled.range.from} 至 ${enabled.range.to} · ${enabled.range.basis}` : '—'}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
            className="h-9 rounded-[8px] border border-[#DCDDDD] px-3 text-[13px] outline-none focus:border-[#EA1F59] focus:ring-2 focus:ring-[#EA1F59]/15"
            aria-label="对账开始日期"
          />
          <input
            type="date"
            value={to}
            onChange={(event) => setTo(event.target.value)}
            className="h-9 rounded-[8px] border border-[#DCDDDD] px-3 text-[13px] outline-none focus:border-[#EA1F59] focus:ring-2 focus:ring-[#EA1F59]/15"
            aria-label="对账结束日期"
          />
          <ActionButton icon={RefreshCw} label="刷新" compact pending={loading} onClick={onRefresh} />
          <ActionButton icon={Clipboard} label="复制 CSV" compact pending={loading} onClick={onCopy} />
        </div>
      </div>

      <div className="space-y-4 px-5 py-4">
        {error && (
          <div className="rounded-[8px] border border-[#EA1F59]/20 bg-[#EA1F59]/5 px-3 py-2 text-[13px] text-[#EA1F59]">
            {error}
          </div>
        )}
        {loading && !enabled ? (
          <div className="py-5 text-center text-[13px] text-muted-foreground">
            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
            加载中…
          </div>
        ) : state?.enabled === false ? (
          <div className="py-5 text-[13px] text-muted-foreground">合伙人账本未启用</div>
        ) : metrics ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
              <ReconciliationMetric label="订单数" value={formatInteger(metrics.orderCount)} />
              <ReconciliationMetric label="完成订单" value={formatInteger(metrics.completedOrderCount)} />
              <ReconciliationMetric label="年费收入" value={formatPartnerMoneyCents(metrics.membershipRevenueCnyCents)} />
              <ReconciliationMetric label="充值本金" value={formatPartnerMoneyCents(metrics.rechargePrincipalCnyCents)} />
              <ReconciliationMetric label="已出款" value={formatPartnerCreditCents(metrics.paidWithdrawalCreditCents)} />
              <ReconciliationMetric
                label="需复核订单"
                value={formatInteger(metrics.reviewRequiredOrderCount)}
                tone={metrics.reviewRequiredOrderCount > 0 ? 'danger' : 'normal'}
              />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-[13px]">
                <thead>
                  <tr className="border-b border-[#EFEFEF] text-left text-[11px] uppercase text-muted-foreground">
                    <th className="py-2 pr-4 font-medium">渠道</th>
                    <th className="py-2 pr-4 font-medium">订单数</th>
                    <th className="py-2 pr-4 font-medium">完成</th>
                    <th className="py-2 pr-4 font-medium">完成金额</th>
                    <th className="py-2 font-medium">需复核</th>
                  </tr>
                </thead>
                <tbody>
                  {enabled.providerBreakdown.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-5 text-center text-muted-foreground">
                        暂无数据
                      </td>
                    </tr>
                  ) : (
                    enabled.providerBreakdown.map((row) => (
                      <tr key={row.provider} className="border-b border-[#EFEFEF] last:border-b-0">
                        <td className="py-2 pr-4 font-medium">{row.provider}</td>
                        <td className="py-2 pr-4 tabular-nums">{formatInteger(row.orderCount)}</td>
                        <td className="py-2 pr-4 tabular-nums">{formatInteger(row.completedOrderCount)}</td>
                        <td className="py-2 pr-4 tabular-nums">{formatPartnerMoneyCents(row.completedAmountCnyCents)}</td>
                        <td className="py-2 tabular-nums">{formatInteger(row.reviewRequiredOrderCount)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}

function ReconciliationMetric({
  label,
  value,
  tone = 'normal',
}: {
  label: string;
  value: string;
  tone?: 'normal' | 'danger';
}): JSX.Element {
  return (
    <div className="min-w-0">
      <div className="text-[12px] text-muted-foreground">{label}</div>
      <div className={cn('mt-1 truncate text-[16px] font-semibold tabular-nums', tone === 'danger' && 'text-[#EA1F59]')}>
        {value}
      </div>
    </div>
  );
}

function ManualKycPanel({
  userExternalId,
  status,
  provider,
  providerRef,
  bankCardHash,
  note,
  pending,
  setUserExternalId,
  setStatus,
  setProvider,
  setProviderRef,
  setBankCardHash,
  setNote,
  onSubmit,
}: {
  userExternalId: string;
  status: KycStatusInput;
  provider: string;
  providerRef: string;
  bankCardHash: string;
  note: string;
  pending: boolean;
  setUserExternalId: (value: string) => void;
  setStatus: (value: KycStatusInput) => void;
  setProvider: (value: string) => void;
  setProviderRef: (value: string) => void;
  setBankCardHash: (value: string) => void;
  setNote: (value: string) => void;
  onSubmit: () => Promise<void>;
}): JSX.Element {
  return (
    <section className="rounded-[8px] border border-[#DCDDDD] bg-white p-4">
      <div className="mb-3 flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-[#EA1F59]" aria-hidden />
        <h2 className="text-[15px] font-semibold">实名状态</h2>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[1.2fr_0.8fr_0.9fr_1fr_1fr_1.2fr_auto]">
        <input
          value={userExternalId}
          onChange={(e) => setUserExternalId(e.target.value)}
          placeholder="用户 ID"
          className="h-9 rounded-[8px] border border-[#DCDDDD] px-3 text-[13px] outline-none focus:border-[#EA1F59] focus:ring-2 focus:ring-[#EA1F59]/15"
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as KycStatusInput)}
          className="h-9 rounded-[8px] border border-[#DCDDDD] bg-white px-3 text-[13px] outline-none focus:border-[#EA1F59] focus:ring-2 focus:ring-[#EA1F59]/15"
        >
          <option value="passed">已通过</option>
          <option value="pending">待实名</option>
          <option value="review_required">需复核</option>
          <option value="rejected">已拒绝</option>
        </select>
        <input
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
          placeholder="provider"
          className="h-9 rounded-[8px] border border-[#DCDDDD] px-3 text-[13px] outline-none focus:border-[#EA1F59] focus:ring-2 focus:ring-[#EA1F59]/15"
        />
        <input
          value={providerRef}
          onChange={(e) => setProviderRef(e.target.value)}
          placeholder="认证流水"
          className="h-9 rounded-[8px] border border-[#DCDDDD] px-3 text-[13px] outline-none focus:border-[#EA1F59] focus:ring-2 focus:ring-[#EA1F59]/15"
        />
        <input
          value={bankCardHash}
          onChange={(e) => setBankCardHash(e.target.value)}
          placeholder="银行卡哈希"
          className="h-9 rounded-[8px] border border-[#DCDDDD] px-3 text-[13px] outline-none focus:border-[#EA1F59] focus:ring-2 focus:ring-[#EA1F59]/15"
        />
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="备注"
          className="h-9 rounded-[8px] border border-[#DCDDDD] px-3 text-[13px] outline-none focus:border-[#EA1F59] focus:ring-2 focus:ring-[#EA1F59]/15"
        />
        <ActionButton
          icon={ShieldCheck}
          label="更新"
          pending={pending}
          onClick={() => void onSubmit()}
        />
      </div>
    </section>
  );
}

function KycQueue({
  rows,
  pendingAction,
  runAction,
}: {
  rows: EnabledOverviewState['kycProfiles'];
  pendingAction: string | null;
  runAction: (actionKey: string, action: () => Promise<void>, success: string) => Promise<void>;
}): JSX.Element {
  return (
    <QueueSection title="实名队列" empty="暂无实名复核">
      <DataTable
        headers={['用户', '状态', '国家', 'provider', '认证流水', '审核信息', '更新时间', '操作']}
        empty={rows.length === 0}
        colSpan={8}
      >
        {rows.map((row) => {
          const reviewer = row.reviewerUserId > 0 ? `审核人 #${row.reviewerUserId}` : '';
          const reviewSummary = [row.reviewNote, reviewer, row.reviewSource].filter(Boolean).join(' / ');
          return (
            <tr key={row.kycExternalId} className="border-b border-[#EFEFEF] last:border-b-0 hover:bg-[#EFEFEF]/35">
              <UserCell userExternalId={row.userExternalId} email={row.email} displayName={row.displayName} />
              <td className="px-3 py-3"><StatusBadge kind="kyc" status={row.status} /></td>
              <td className="px-3 py-3 text-muted-foreground">{row.country}</td>
              <td className="px-3 py-3 text-muted-foreground">{truncate(row.provider, 24)}</td>
              <td className="px-3 py-3 text-muted-foreground">{truncate(row.providerRef, 28) || '—'}</td>
              <td className="px-3 py-3 text-muted-foreground">{truncate(reviewSummary, 40) || '—'}</td>
              <td className="px-3 py-3 text-muted-foreground">{formatDateTime(row.updatedAt as string | Date | null)}</td>
              <td className="px-5 py-3">
                <div className="flex flex-wrap gap-2">
                  <ActionButton
                    icon={CheckCircle2}
                    label="通过"
                    compact
                    pending={pendingAction === `kyc-pass:${row.userExternalId}`}
                    onClick={() =>
                      void runAction(
                        `kyc-pass:${row.userExternalId}`,
                        async () => {
                          await trpc.admin.partner.setKycStatus.mutate(
                            partnerKycQueueReviewPayload(row, 'passed', '后台审核通过'),
                          );
                        },
                        '实名已通过',
                      )
                    }
                  />
                  <ActionButton
                    icon={XCircle}
                    label="拒绝"
                    compact
                    tone="danger"
                    pending={pendingAction === `kyc-reject:${row.userExternalId}`}
                    onClick={() =>
                      void runAction(
                        `kyc-reject:${row.userExternalId}`,
                        async () => {
                          await trpc.admin.partner.setKycStatus.mutate(
                            partnerKycQueueReviewPayload(row, 'rejected', '后台审核拒绝'),
                          );
                        },
                        '实名已拒绝',
                      )
                    }
                  />
                </div>
              </td>
            </tr>
          );
        })}
      </DataTable>
    </QueueSection>
  );
}

function OrderQueue({
  rows,
  pendingAction,
  orderReviewNotes,
  setOrderReviewNotes,
  runAction,
}: {
  rows: EnabledOverviewState['orders'];
  pendingAction: string | null;
  orderReviewNotes: Record<string, string>;
  setOrderReviewNotes: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  runAction: (actionKey: string, action: () => Promise<void>, success: string) => Promise<void>;
}): JSX.Element {
  return (
    <QueueSection title="订单确认" empty="暂无待确认订单">
      <DataTable
        headers={['用户', '类型', '金额', '状态', '复核依据', 'provider', '创建时间', '操作']}
        empty={rows.length === 0}
        colSpan={8}
      >
        {rows.map((row) => {
          const reviewRequired = row.status === 'review_required';
          const actionKey = `${reviewRequired ? 'order-approve' : 'order'}:${row.orderExternalId}`;
          const reviewNote = orderReviewNotes[row.orderExternalId] ?? '';
          const reviewSummary =
            [row.reviewReason, row.reviewErrorName, row.reviewErrorMessage].filter(Boolean).join(' / ') ||
            row.reviewApprovalNote;
          return (
            <tr key={row.orderExternalId} className="border-b border-[#EFEFEF] last:border-b-0 hover:bg-[#EFEFEF]/35">
              <UserCell userExternalId={row.userExternalId} email={row.email} displayName={row.displayName} />
              <td className="px-3 py-3 text-muted-foreground">{row.orderKind === 'membership' ? '年费会员' : '充值'}</td>
              <td className="px-3 py-3 tabular-nums">{formatPartnerMoneyCents(row.amountCnyCents)}</td>
              <td className="px-3 py-3"><StatusBadge kind="order" status={row.status} /></td>
              <td className="px-3 py-3 text-muted-foreground">{truncate(reviewSummary, 36) || '—'}</td>
              <td className="px-3 py-3 text-muted-foreground">{row.provider}</td>
              <td className="px-3 py-3 text-muted-foreground">{formatDateTime(row.createdAt as string | Date | null)}</td>
              <td className="px-5 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  {reviewRequired && (
                    <input
                      value={reviewNote}
                      onChange={(event) =>
                        setOrderReviewNotes((current) => ({
                          ...current,
                          [row.orderExternalId]: event.target.value,
                        }))
                      }
                      placeholder="放行备注"
                      className="h-8 w-40 rounded-[8px] border border-[#DCDDDD] px-2 text-[12px] outline-none focus:border-[#EA1F59] focus:ring-2 focus:ring-[#EA1F59]/15"
                    />
                  )}
                  <ActionButton
                    icon={CheckCircle2}
                    label={partnerOrderActionLabel(row.status)}
                    compact
                    pending={pendingAction === actionKey}
                    onClick={() =>
                      void runAction(
                        actionKey,
                        async () => {
                          if (reviewRequired) {
                            await trpc.admin.partner.approveReviewRequiredOrder.mutate({
                              orderExternalId: row.orderExternalId,
                              note: reviewNote.trim() || '后台复核放行',
                            });
                            return;
                          }
                          const result = await trpc.admin.partner.confirmOrder.mutate({
                            orderExternalId: row.orderExternalId,
                          });
                          if (result.status === 'review_required') {
                            throw new Error('订单仍需人工复核');
                          }
                        },
                        reviewRequired ? '订单已放行' : '订单已确认',
                      )
                    }
                  />
                </div>
              </td>
            </tr>
          );
        })}
      </DataTable>
    </QueueSection>
  );
}

function WithdrawalQueue({
  rows,
  pendingAction,
  withdrawalReasons,
  payoutIds,
  setWithdrawalReasons,
  setPayoutIds,
  runAction,
}: {
  rows: EnabledOverviewState['withdrawals'];
  pendingAction: string | null;
  withdrawalReasons: Record<string, string>;
  payoutIds: Record<string, string>;
  setWithdrawalReasons: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setPayoutIds: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  runAction: (actionKey: string, action: () => Promise<void>, success: string) => Promise<void>;
}): JSX.Element {
  return (
    <QueueSection title="提现复核" empty="暂无提现申请">
      <DataTable
        headers={['用户', '金额', '状态', '风险分', '银行指纹', '审核截止', '操作']}
        empty={rows.length === 0}
        colSpan={7}
      >
        {rows.map((row) => {
          const reason = withdrawalReasons[row.withdrawalExternalId] ?? '';
          const payoutId = payoutIds[row.withdrawalExternalId] ?? '';
          return (
            <tr key={row.withdrawalExternalId} className="border-b border-[#EFEFEF] last:border-b-0 hover:bg-[#EFEFEF]/35">
              <UserCell userExternalId={row.userExternalId} email={row.email} displayName={row.displayName} />
              <td className="px-3 py-3 tabular-nums">{formatPartnerCreditCents(row.amountCreditCents)}</td>
              <td className="px-3 py-3"><StatusBadge kind="withdrawal" status={row.status} /></td>
              <td className="px-3 py-3 tabular-nums text-muted-foreground">{row.riskScore}</td>
              <td className="px-3 py-3 text-muted-foreground">{truncate(row.bankAccountFingerprint, 24) || '—'}</td>
              <td className="px-3 py-3 text-muted-foreground">{formatDateTime(row.reviewDueAt as string | Date | null)}</td>
              <td className="px-5 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  {(row.status === 'requested' || row.status === 'reviewing') && (
                    <ActionButton
                      icon={CheckCircle2}
                      label="通过"
                      compact
                      pending={pendingAction === `withdraw-approve:${row.withdrawalExternalId}`}
                      onClick={() =>
                        void runAction(
                          `withdraw-approve:${row.withdrawalExternalId}`,
                          async () => {
                            await trpc.admin.partner.approveWithdrawal.mutate({
                              withdrawalExternalId: row.withdrawalExternalId,
                              note: '后台复核通过',
                            });
                          },
                          '提现已通过',
                        )
                      }
                    />
                  )}
                  <input
                    value={reason}
                    onChange={(e) =>
                      setWithdrawalReasons((current) => ({
                        ...current,
                        [row.withdrawalExternalId]: e.target.value,
                      }))
                    }
                    placeholder="拒绝原因"
                    className="h-8 w-36 rounded-[8px] border border-[#DCDDDD] px-2 text-[12px] outline-none focus:border-[#EA1F59] focus:ring-2 focus:ring-[#EA1F59]/15"
                  />
                  <ActionButton
                    icon={XCircle}
                    label="拒绝"
                    compact
                    tone="danger"
                    pending={pendingAction === `withdraw-reject:${row.withdrawalExternalId}`}
                    onClick={() =>
                      void runAction(
                        `withdraw-reject:${row.withdrawalExternalId}`,
                        async () => {
                          await trpc.admin.partner.rejectWithdrawal.mutate({
                            withdrawalExternalId: row.withdrawalExternalId,
                            reason: reason.trim() || '后台复核拒绝',
                          });
                        },
                        '提现已拒绝',
                      )
                    }
                  />
                  {row.status === 'approved' && (
                    <>
                      <input
                        value={payoutId}
                        onChange={(e) =>
                          setPayoutIds((current) => ({
                            ...current,
                            [row.withdrawalExternalId]: e.target.value,
                          }))
                        }
                        placeholder="出款流水"
                        className="h-8 w-36 rounded-[8px] border border-[#DCDDDD] px-2 text-[12px] outline-none focus:border-[#EA1F59] focus:ring-2 focus:ring-[#EA1F59]/15"
                      />
                      <ActionButton
                        icon={Banknote}
                        label="出款"
                        compact
                        pending={pendingAction === `withdraw-paid:${row.withdrawalExternalId}`}
                        onClick={() =>
                          void runAction(
                            `withdraw-paid:${row.withdrawalExternalId}`,
                            async () => {
                              await trpc.admin.partner.markWithdrawalPaid.mutate({
                                withdrawalExternalId: row.withdrawalExternalId,
                                providerPayoutId: payoutId.trim() || `manual:${row.withdrawalExternalId}`,
                              });
                            },
                            '提现已出款',
                          )
                        }
                      />
                    </>
                  )}
                </div>
              </td>
            </tr>
          );
        })}
      </DataTable>
    </QueueSection>
  );
}

function WithdrawalHistory({ rows }: { rows: EnabledOverviewState['withdrawalHistory'] }): JSX.Element {
  return (
    <QueueSection title="提现历史" empty="暂无提现历史">
      <DataTable
        headers={['用户', '金额', '状态', '银行指纹', '处理信息', '更新时间']}
        empty={rows.length === 0}
        colSpan={6}
      >
        {rows.map((row) => {
          const detail =
            row.status === 'paid'
              ? [row.providerPayoutId, row.paidAt ? `出款 ${formatDateTime(row.paidAt)}` : ''].filter(Boolean).join(' / ')
              : row.status === 'returned'
                ? ['资金退回', formatDateTime(row.updatedAt as string | Date | null)]
                    .filter(Boolean)
                    .join(' / ')
                : [row.rejectionReason, row.rejectedAt ? `拒绝 ${formatDateTime(row.rejectedAt)}` : '']
                  .filter(Boolean)
                  .join(' / ');
          return (
            <tr key={row.withdrawalExternalId} className="border-b border-[#EFEFEF] last:border-b-0 hover:bg-[#EFEFEF]/35">
              <UserCell userExternalId={row.userExternalId} email={row.email} displayName={row.displayName} />
              <td className="px-3 py-3 tabular-nums">{formatPartnerCreditCents(row.amountCreditCents)}</td>
              <td className="px-3 py-3"><StatusBadge kind="withdrawal" status={row.status} /></td>
              <td className="px-3 py-3 text-muted-foreground">{truncate(row.bankAccountFingerprint, 24) || '—'}</td>
              <td className="px-3 py-3 text-muted-foreground">{truncate(detail, 42) || '—'}</td>
              <td className="px-3 py-3 text-muted-foreground">{formatDateTime(row.updatedAt as string | Date | null)}</td>
            </tr>
          );
        })}
      </DataTable>
    </QueueSection>
  );
}

function RiskLotQueue({
  rows,
  pendingAction,
  riskLotNotes,
  riskLotResolutionKinds,
  riskLotResolutionRefs,
  setRiskLotNotes,
  setRiskLotResolutionKinds,
  setRiskLotResolutionRefs,
  runAction,
}: {
  rows: EnabledOverviewState['riskLots'];
  pendingAction: string | null;
  riskLotNotes: Record<string, string>;
  riskLotResolutionKinds: Record<string, PartnerRiskLotCloseResolutionKind>;
  riskLotResolutionRefs: Record<string, string>;
  setRiskLotNotes: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setRiskLotResolutionKinds: React.Dispatch<React.SetStateAction<Record<string, PartnerRiskLotCloseResolutionKind>>>;
  setRiskLotResolutionRefs: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  runAction: (actionKey: string, action: () => Promise<void>, success: string) => Promise<void>;
}): JSX.Element {
  return (
    <QueueSection title="风险批次" empty="暂无风险批次">
      <DataTable
        headers={['用户', '批次', '本金', 'API Units', '批次状态', '风险状态', '风险信息', '更新时间', '操作']}
        empty={rows.length === 0}
        colSpan={9}
      >
        {rows.map((row) => {
          const action = partnerRiskLotQueueAction(row);
          const actionKey = `risk-${action.action}:${row.lotExternalId}`;
          const closeActionKey = `risk-close:${row.lotExternalId}`;
          const pending = pendingAction === actionKey;
          const closePending = pendingAction === closeActionKey;
          const operatorNote = riskLotNotes[row.lotExternalId] ?? '';
          const resolutionKind = riskLotResolutionKinds[row.lotExternalId] ?? 'manual';
          const resolutionRef = riskLotResolutionRefs[row.lotExternalId] ?? '';
          const riskDetail = [
            row.riskFreezeReason,
            row.riskFrozenByUserId > 0 ? `冻结人 #${row.riskFrozenByUserId}` : '',
            row.riskFrozenAt ? `冻结 ${formatDateTime(row.riskFrozenAt)}` : '',
            row.riskResumeNote,
            row.riskResumedByUserId > 0 ? `恢复人 #${row.riskResumedByUserId}` : '',
            row.riskResumedAt ? `恢复 ${formatDateTime(row.riskResumedAt)}` : '',
            row.riskCloseReason,
            row.riskCloseResolutionKind
              ? `处理 ${partnerRiskCloseResolutionKindLabel(row.riskCloseResolutionKind)}`
              : '',
            row.riskCloseResolutionRef ? `凭证 ${truncate(row.riskCloseResolutionRef, 24)}` : '',
            row.riskClosedByUserId > 0 ? `关闭人 #${row.riskClosedByUserId}` : '',
            row.riskClosedAt ? `关闭 ${formatDateTime(row.riskClosedAt)}` : '',
          ]
            .filter(Boolean)
            .join(' / ');
          return (
            <tr key={row.lotExternalId} className="border-b border-[#EFEFEF] last:border-b-0 hover:bg-[#EFEFEF]/35">
              <UserCell userExternalId={row.userExternalId} email={row.email} displayName={row.displayName} />
              <td className="px-3 py-3 text-muted-foreground">{truncate(row.lotExternalId, 18)}</td>
              <td className="px-3 py-3 tabular-nums">{formatPartnerCreditCents(row.principalCreditCents)}</td>
              <td className="px-3 py-3 tabular-nums text-muted-foreground">{formatInteger(row.apiUnits)}</td>
              <td className="px-3 py-3 text-muted-foreground">{row.status === 'frozen' ? '已冻结' : row.status || '—'}</td>
              <td className="px-3 py-3"><StatusBadge kind="risk" status={row.riskStatus} /></td>
              <td className="px-3 py-3 text-muted-foreground">{truncate(riskDetail, 52) || '—'}</td>
              <td className="px-3 py-3 text-muted-foreground">{formatDateTime(row.updatedAt as string | Date | null)}</td>
              <td className="px-5 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  {action.action === 'closed' ? (
                    <span className="text-[12px] text-muted-foreground">已关闭</span>
                  ) : (
                    <>
                      <input
                        value={operatorNote}
                        onChange={(event) =>
                          setRiskLotNotes((current) => ({
                            ...current,
                            [row.lotExternalId]: event.target.value,
                          }))
                        }
                        placeholder="风险备注"
                        className="h-8 w-40 rounded-[8px] border border-[#DCDDDD] px-2 text-[12px] outline-none focus:border-[#EA1F59] focus:ring-2 focus:ring-[#EA1F59]/15"
                      />
                      <ActionButton
                        icon={action.action === 'freeze' ? ShieldCheck : RefreshCw}
                        label={pending ? action.pendingLabel : action.label}
                        compact
                        tone={action.action === 'freeze' ? 'danger' : 'primary'}
                        pending={pending}
                        onClick={() =>
                          void runAction(
                            actionKey,
                            async () => {
                              if (action.action === 'freeze') {
                                await trpc.admin.partner.freezeRiskLot.mutate({
                                  lotExternalId: row.lotExternalId,
                                  ...partnerRiskLotActionPayload('freeze', operatorNote),
                                });
                                return;
                              }
                              await trpc.admin.partner.resumeRiskLot.mutate({
                                lotExternalId: row.lotExternalId,
                                ...partnerRiskLotActionPayload('resume', operatorNote),
                              });
                            },
                            action.action === 'freeze' ? '批次已冻结' : '批次已恢复',
                          )
                        }
                      />
                    </>
                  )}
                  {action.canClose && (
                    <>
                      <select
                        value={resolutionKind}
                        onChange={(event) =>
                          setRiskLotResolutionKinds((current) => ({
                            ...current,
                            [row.lotExternalId]: event.target.value as PartnerRiskLotCloseResolutionKind,
                          }))
                        }
                        aria-label="关闭处理类型"
                        className="h-8 w-24 rounded-[8px] border border-[#DCDDDD] bg-white px-2 text-[12px] outline-none focus:border-[#EA1F59] focus:ring-2 focus:ring-[#EA1F59]/15"
                      >
                        <option value="manual">人工</option>
                        <option value="refund">退款</option>
                        <option value="fraud">欺诈</option>
                      </select>
                      <input
                        value={resolutionRef}
                        onChange={(event) =>
                          setRiskLotResolutionRefs((current) => ({
                            ...current,
                            [row.lotExternalId]: event.target.value,
                          }))
                        }
                        placeholder="处理凭证"
                        className="h-8 w-32 rounded-[8px] border border-[#DCDDDD] px-2 text-[12px] outline-none focus:border-[#EA1F59] focus:ring-2 focus:ring-[#EA1F59]/15"
                      />
                      <ActionButton
                        icon={XCircle}
                        label={closePending ? '关闭中' : '关闭'}
                        compact
                        tone="danger"
                        pending={closePending}
                        onClick={() =>
                          void runAction(
                            closeActionKey,
                            async () => {
                              await trpc.admin.partner.closeRiskLot.mutate({
                                lotExternalId: row.lotExternalId,
                                ...partnerRiskLotActionPayload('close', operatorNote, {
                                  resolutionKind,
                                  resolutionRef,
                                }),
                              });
                            },
                            '批次已关闭',
                          )
                        }
                      />
                    </>
                  )}
                </div>
              </td>
            </tr>
          );
        })}
      </DataTable>
    </QueueSection>
  );
}

function RiskEventHistory({ rows }: { rows: EnabledOverviewState['riskEvents'] }): JSX.Element {
  return (
    <QueueSection title="风险事件" empty="暂无风险事件">
      <DataTable
        headers={['用户', '批次', '事件', '严重度', '状态', '处理信息', '时间']}
        empty={rows.length === 0}
        colSpan={7}
      >
        {rows.map((row) => {
          const detail = [
            row.riskReason,
            row.riskResolutionKind ? `处理 ${partnerRiskCloseResolutionKindLabel(row.riskResolutionKind)}` : '',
            row.riskResolutionRef ? `凭证 ${truncate(row.riskResolutionRef, 24)}` : '',
            row.riskNote,
            row.reviewerUserId > 0 ? `处理人 #${row.reviewerUserId}` : '',
          ]
            .filter(Boolean)
            .join(' / ');
          return (
            <tr key={row.riskEventExternalId} className="border-b border-[#EFEFEF] last:border-b-0 hover:bg-[#EFEFEF]/35">
              <UserCell userExternalId={row.userExternalId} email={row.email} displayName={row.displayName} />
              <td className="px-3 py-3 text-muted-foreground">{truncate(row.lotExternalId, 18) || '—'}</td>
              <td className="px-3 py-3 text-muted-foreground">{partnerRiskEventTypeLabel(row.eventType)}</td>
              <td className="px-3 py-3 text-muted-foreground">{partnerRiskEventSeverityLabel(row.severity)}</td>
              <td className="px-3 py-3 text-muted-foreground">{row.status || '—'}</td>
              <td className="px-3 py-3 text-muted-foreground">{truncate(detail, 56) || '—'}</td>
              <td className="px-3 py-3 text-muted-foreground">{formatDateTime(row.createdAt as string | Date | null)}</td>
            </tr>
          );
        })}
      </DataTable>
    </QueueSection>
  );
}

function MetricCard({
  label,
  value,
  tone = 'normal',
}: {
  label: string;
  value: number;
  tone?: 'normal' | 'danger';
}): JSX.Element {
  return (
    <div className="rounded-[8px] border border-[#DCDDDD] bg-white px-4 py-3">
      <div className="text-[12px] text-muted-foreground">{label}</div>
      <div className={cn('mt-2 text-2xl font-semibold tabular-nums', tone === 'danger' && 'text-[#EA1F59]')}>
        {formatInteger(value)}
      </div>
    </div>
  );
}

function QueueSection({
  title,
  empty,
  children,
}: {
  title: string;
  empty: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <section className="rounded-[8px] border border-[#DCDDDD] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
      <div className="border-b border-[#EFEFEF] px-5 py-3">
        <h2 className="text-[15px] font-semibold">{title}</h2>
      </div>
      <div className="overflow-x-auto" data-empty-label={empty}>
        {children}
      </div>
    </section>
  );
}

function DataTable({
  headers,
  empty,
  colSpan,
  children,
}: {
  headers: string[];
  empty: boolean;
  colSpan: number;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <table className="w-full min-w-[860px] text-[13px]">
      <thead>
        <tr className="border-b border-[#EFEFEF] text-left text-[11px] uppercase text-muted-foreground">
          {headers.map((header, index) => (
            <th key={`${header}-${index}`} className={cn(index === 0 ? 'px-5' : 'px-3', 'py-3 font-medium')}>
              {header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {empty ? (
          <tr>
            <td colSpan={colSpan} className="py-8 text-center text-muted-foreground">
              暂无数据
            </td>
          </tr>
        ) : (
          children
        )}
      </tbody>
    </table>
  );
}

function UserCell({
  userExternalId,
  email,
  displayName,
}: {
  userExternalId: string;
  email: string;
  displayName: string;
}): JSX.Element {
  return (
    <td className="px-5 py-3">
      <div className="min-w-0">
        <Link to={`/admin/users/${userExternalId}`} className="font-medium text-foreground hover:text-[#EA1F59]">
          {displayName !== '—' ? truncate(displayName, 18) : truncate(userExternalId, 18)}
        </Link>
        <div className="mt-0.5 text-[12px] text-muted-foreground">{truncate(email, 30)}</div>
      </div>
    </td>
  );
}

function StatusBadge({
  kind,
  status,
}: {
  kind: AdminPartnerStatusKind;
  status: string;
}): JSX.Element {
  const token = partnerReviewStatusToken(kind, status);
  return (
    <span className={cn('inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium', token.textClass, token.bgClass)}>
      {token.label}
    </span>
  );
}

function ActionButton({
  icon: Icon,
  label,
  pending,
  onClick,
  compact,
  tone = 'primary',
}: {
  icon: LucideIcon;
  label: string;
  pending?: boolean;
  onClick: () => void;
  compact?: boolean;
  tone?: 'primary' | 'danger';
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-[8px] border text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60',
        compact ? 'h-8 px-2.5' : 'h-9 px-3',
        tone === 'danger'
          ? 'border-[#EA1F59]/20 bg-white text-[#EA1F59] hover:bg-[#EA1F59]/5'
          : 'border-[#DCDDDD] bg-white text-[#595757] hover:border-[#ADADAD] hover:text-[#EA1F59]',
      )}
    >
      {pending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
      ) : (
        <Icon className="h-3.5 w-3.5" aria-hidden />
      )}
      {label}
    </button>
  );
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}
