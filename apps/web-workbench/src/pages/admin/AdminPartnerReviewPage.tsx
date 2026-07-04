import {
  Banknote,
  CheckCircle2,
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
  partnerOrderActionLabel,
  partnerReviewStatusToken,
  type AdminPartnerStatusKind,
} from './admin-partner-state';

type OverviewState = ReturnType<typeof normalizeAdminPartnerOverview>;
type EnabledOverviewState = Extract<OverviewState, { enabled: true }>;
type KycStatusInput = 'pending' | 'passed' | 'review_required' | 'rejected';

export function AdminPartnerReviewPage(): JSX.Element {
  const mountedRef = useMountedRef();
  const toast = useToast();
  const requestIdRef = React.useRef(0);
  const [data, setData] = React.useState<OverviewState | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [pendingAction, setPendingAction] = React.useState<string | null>(null);
  const [kycUserExternalId, setKycUserExternalId] = React.useState('');
  const [kycStatus, setKycStatus] = React.useState<KycStatusInput>('passed');
  const [kycProvider, setKycProvider] = React.useState('manual');
  const [kycProviderRef, setKycProviderRef] = React.useState('');
  const [kycNote, setKycNote] = React.useState('');
  const [orderReviewNotes, setOrderReviewNotes] = React.useState<Record<string, string>>({});
  const [withdrawalReasons, setWithdrawalReasons] = React.useState<Record<string, string>>({});
  const [payoutIds, setPayoutIds] = React.useState<Record<string, string>>({});
  const [queueSearch, setQueueSearch] = React.useState('');

  const refresh = React.useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const res = normalizeAdminPartnerOverview(await trpc.admin.partner.overview.query());
      if (mountedRef.current && requestIdRef.current === requestId) setData(res);
    } catch (err) {
      if (mountedRef.current && requestIdRef.current === requestId) {
        setError(pageErrorMessage(err));
      }
    } finally {
      if (mountedRef.current && requestIdRef.current === requestId) setLoading(false);
    }
  }, [mountedRef]);

  React.useEffect(() => {
    void refresh();
    return () => {
      requestIdRef.current += 1;
    };
  }, [refresh]);

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
          note: kycNote.trim() || undefined,
        });
        setKycProviderRef('');
        setKycNote('');
      },
      '实名状态已更新',
    );
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
          queueSearch={queueSearch}
          pendingAction={pendingAction}
          kycUserExternalId={kycUserExternalId}
          kycStatus={kycStatus}
          kycProvider={kycProvider}
          kycProviderRef={kycProviderRef}
          kycNote={kycNote}
          orderReviewNotes={orderReviewNotes}
          withdrawalReasons={withdrawalReasons}
          payoutIds={payoutIds}
          setKycUserExternalId={setKycUserExternalId}
          setKycStatus={setKycStatus}
          setKycProvider={setKycProvider}
          setKycProviderRef={setKycProviderRef}
          setKycNote={setKycNote}
          setOrderReviewNotes={setOrderReviewNotes}
          setWithdrawalReasons={setWithdrawalReasons}
          setPayoutIds={setPayoutIds}
          setQueueSearch={setQueueSearch}
          submitManualKyc={submitManualKyc}
          runAction={runAction}
        />
      ) : null}
    </div>
  );
}

function EnabledAdminPartnerReview({
  data,
  queueSearch,
  pendingAction,
  kycUserExternalId,
  kycStatus,
  kycProvider,
  kycProviderRef,
  kycNote,
  orderReviewNotes,
  withdrawalReasons,
  payoutIds,
  setKycUserExternalId,
  setKycStatus,
  setKycProvider,
  setKycProviderRef,
  setKycNote,
  setOrderReviewNotes,
  setWithdrawalReasons,
  setPayoutIds,
  setQueueSearch,
  submitManualKyc,
  runAction,
}: {
  data: EnabledOverviewState;
  queueSearch: string;
  pendingAction: string | null;
  kycUserExternalId: string;
  kycStatus: KycStatusInput;
  kycProvider: string;
  kycProviderRef: string;
  kycNote: string;
  orderReviewNotes: Record<string, string>;
  withdrawalReasons: Record<string, string>;
  payoutIds: Record<string, string>;
  setKycUserExternalId: (value: string) => void;
  setKycStatus: (value: KycStatusInput) => void;
  setKycProvider: (value: string) => void;
  setKycProviderRef: (value: string) => void;
  setKycNote: (value: string) => void;
  setOrderReviewNotes: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setWithdrawalReasons: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setPayoutIds: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setQueueSearch: (value: string) => void;
  submitManualKyc: () => Promise<void>;
  runAction: (actionKey: string, action: () => Promise<void>, success: string) => Promise<void>;
}): JSX.Element {
  return (
    <div className="space-y-5">
      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <MetricCard label="待实名" value={data.metrics.pendingKycCount} />
        <MetricCard label="待确认订单" value={data.metrics.pendingOrderCount} />
        <MetricCard label="需复核订单" value={data.metrics.reviewRequiredOrderCount} />
        <MetricCard label="待提现处理" value={data.metrics.pendingWithdrawalCount + data.metrics.approvedWithdrawalCount} />
        <MetricCard label="风险批次" value={data.metrics.riskLotCount} tone={data.metrics.riskLotCount > 0 ? 'danger' : 'normal'} />
      </section>

      <ManualKycPanel
        userExternalId={kycUserExternalId}
        status={kycStatus}
        provider={kycProvider}
        providerRef={kycProviderRef}
        note={kycNote}
        pending={pendingAction?.startsWith('kyc-manual') ?? false}
        setUserExternalId={setKycUserExternalId}
        setStatus={setKycStatus}
        setProvider={setKycProvider}
        setProviderRef={setKycProviderRef}
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
      <RiskLotQueue rows={data.riskLots} />
    </div>
  );
}

function ManualKycPanel({
  userExternalId,
  status,
  provider,
  providerRef,
  note,
  pending,
  setUserExternalId,
  setStatus,
  setProvider,
  setProviderRef,
  setNote,
  onSubmit,
}: {
  userExternalId: string;
  status: KycStatusInput;
  provider: string;
  providerRef: string;
  note: string;
  pending: boolean;
  setUserExternalId: (value: string) => void;
  setStatus: (value: KycStatusInput) => void;
  setProvider: (value: string) => void;
  setProviderRef: (value: string) => void;
  setNote: (value: string) => void;
  onSubmit: () => Promise<void>;
}): JSX.Element {
  return (
    <section className="rounded-[8px] border border-[#DCDDDD] bg-white p-4">
      <div className="mb-3 flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-[#EA1F59]" aria-hidden />
        <h2 className="text-[15px] font-semibold">实名状态</h2>
      </div>
      <div className="grid gap-3 md:grid-cols-[1.2fr_0.8fr_0.9fr_1fr_1.2fr_auto]">
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
        headers={['用户', '状态', '国家', 'provider', '认证流水', '更新时间', '操作']}
        empty={rows.length === 0}
        colSpan={7}
      >
        {rows.map((row) => (
          <tr key={row.kycExternalId} className="border-b border-[#EFEFEF] last:border-b-0 hover:bg-[#EFEFEF]/35">
            <UserCell userExternalId={row.userExternalId} email={row.email} displayName={row.displayName} />
            <td className="px-3 py-3"><StatusBadge kind="kyc" status={row.status} /></td>
            <td className="px-3 py-3 text-muted-foreground">{row.country}</td>
            <td className="px-3 py-3 text-muted-foreground">{truncate(row.provider, 24)}</td>
            <td className="px-3 py-3 text-muted-foreground">{truncate(row.providerRef, 28) || '—'}</td>
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
                        await trpc.admin.partner.setKycStatus.mutate({
                          userExternalId: row.userExternalId,
                          status: 'passed',
                          provider: 'manual',
                          note: '后台审核通过',
                        });
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
                        await trpc.admin.partner.setKycStatus.mutate({
                          userExternalId: row.userExternalId,
                          status: 'rejected',
                          provider: 'manual',
                          note: '后台审核拒绝',
                        });
                      },
                      '实名已拒绝',
                    )
                  }
                />
              </div>
            </td>
          </tr>
        ))}
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

function RiskLotQueue({ rows }: { rows: EnabledOverviewState['riskLots'] }): JSX.Element {
  return (
    <QueueSection title="风险批次" empty="暂无风险批次">
      <DataTable
        headers={['用户', '批次', '本金', 'API Units', '风险状态', '更新时间']}
        empty={rows.length === 0}
        colSpan={6}
      >
        {rows.map((row) => (
          <tr key={row.lotExternalId} className="border-b border-[#EFEFEF] last:border-b-0 hover:bg-[#EFEFEF]/35">
            <UserCell userExternalId={row.userExternalId} email={row.email} displayName={row.displayName} />
            <td className="px-3 py-3 text-muted-foreground">{truncate(row.lotExternalId, 18)}</td>
            <td className="px-3 py-3 tabular-nums">{formatPartnerCreditCents(row.principalCreditCents)}</td>
            <td className="px-3 py-3 tabular-nums text-muted-foreground">{formatInteger(row.apiUnits)}</td>
            <td className="px-3 py-3"><StatusBadge kind="risk" status={row.riskStatus} /></td>
            <td className="px-3 py-3 text-muted-foreground">{formatDateTime(row.updatedAt as string | Date | null)}</td>
          </tr>
        ))}
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
