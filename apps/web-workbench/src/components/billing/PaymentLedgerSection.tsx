import {
  type BillingPaymentCursor,
  type BillingPaymentLedgerSection,
  type BillingPaymentRecord,
  appendBillingPaymentPage,
  billingLoadErrorMessage,
  billingPaymentAmount,
  billingPaymentDate,
  billingPaymentProduct,
  billingPaymentProvider,
  billingPaymentReceiptMailOptions,
  billingPaymentStatusCopy,
  normalizeBillingPaymentPage,
} from '@/lib/billing-page-state';
import { supportMailtoHref } from '@/lib/support-links';
import { trpc } from '@/lib/trpc';
import { Section } from '@/pages/PageShell';
import { AlertCircle, ChevronDown, Copy, FileText, Loader2 } from 'lucide-react';
import * as React from 'react';

const PAGE_SIZE = 10;

interface LedgerState {
  readonly items: BillingPaymentRecord[];
  readonly nextCursor: BillingPaymentCursor | null;
  readonly loading: boolean;
  readonly loadingMore: boolean;
  readonly error: string | null;
  readonly loaded: boolean;
}

const EMPTY_LEDGER_STATE: LedgerState = {
  items: [],
  nextCursor: null,
  loading: false,
  loadingMore: false,
  error: null,
  loaded: false,
};

export function PaymentLedgerSection({ refreshKey }: { refreshKey: number }): JSX.Element {
  const mountedRef = React.useRef(false);
  const settledRequestRef = React.useRef(0);
  const unfinishedRequestRef = React.useRef(0);
  const settledRefreshKeyRef = React.useRef<number | null>(null);
  const copyTimerRef = React.useRef<number | null>(null);
  const [settled, setSettled] = React.useState<LedgerState>({
    ...EMPTY_LEDGER_STATE,
    loading: true,
  });
  const [unfinished, setUnfinished] = React.useState<LedgerState>(EMPTY_LEDGER_STATE);
  const [unfinishedExpanded, setUnfinishedExpanded] = React.useState(false);
  const [copyFeedback, setCopyFeedback] = React.useState<{
    readonly orderId: string;
    readonly ok: boolean;
  } | null>(null);

  const loadSection = React.useCallback(
    async (
      section: BillingPaymentLedgerSection,
      cursor: BillingPaymentCursor | null,
      replace: boolean,
      requestRefreshKey?: number,
    ): Promise<void> => {
      const setState = section === 'settled' ? setSettled : setUnfinished;
      const requestRef = section === 'settled' ? settledRequestRef : unfinishedRequestRef;
      if (section === 'settled' && requestRefreshKey !== undefined) {
        settledRefreshKeyRef.current = requestRefreshKey;
      }
      const requestId = ++requestRef.current;
      setState((current) => ({
        ...current,
        loading: cursor === null,
        loadingMore: cursor !== null,
        error: null,
      }));

      try {
        const rawPage = await trpc.payment.ledger.query({
          section,
          limit: PAGE_SIZE,
          ...(cursor ? { cursor } : {}),
        });
        const page = normalizeBillingPaymentPage(rawPage, section);
        if (
          !mountedRef.current ||
          requestId !== requestRef.current ||
          (section === 'settled' &&
            requestRefreshKey !== undefined &&
            requestRefreshKey !== settledRefreshKeyRef.current)
        )
          return;
        setState((current) => ({
          items: replace ? page.items : appendBillingPaymentPage(current.items, page.items),
          nextCursor: page.nextCursor,
          loading: false,
          loadingMore: false,
          error: null,
          loaded: true,
        }));
      } catch (error) {
        if (
          !mountedRef.current ||
          requestId !== requestRef.current ||
          (section === 'settled' &&
            requestRefreshKey !== undefined &&
            requestRefreshKey !== settledRefreshKeyRef.current)
        )
          return;
        setState((current) => ({
          ...current,
          loading: false,
          loadingMore: false,
          error: billingLoadErrorMessage(error, '付款记录暂时无法加载，请稍后重试。'),
          loaded: true,
        }));
      }
    },
    [],
  );

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      settledRequestRef.current += 1;
      unfinishedRequestRef.current += 1;
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
    };
  }, []);

  React.useEffect(() => {
    void loadSection('settled', null, true, refreshKey);
  }, [loadSection, refreshKey]);

  React.useEffect(() => {
    if (unfinishedExpanded && !unfinished.loaded && !unfinished.loading) {
      void loadSection('unfinished', null, true);
    }
  }, [loadSection, unfinished.loaded, unfinished.loading, unfinishedExpanded]);

  const copyOrder = React.useCallback(async (orderId: string): Promise<void> => {
    if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(orderId);
      if (!mountedRef.current) return;
      setCopyFeedback({ orderId, ok: true });
    } catch {
      if (!mountedRef.current) return;
      setCopyFeedback({ orderId, ok: false });
    }
    copyTimerRef.current = window.setTimeout(() => {
      if (mountedRef.current) setCopyFeedback(null);
    }, 2_000);
  }, []);

  return (
    <div className="space-y-3">
      <Section
        id="billing-payment-ledger"
        title="付款记录"
        description="已确认到账或已退款的记录"
        className="p-4 sm:p-6"
      >
        <PaymentList
          section="settled"
          state={settled}
          copyFeedback={copyFeedback}
          onCopy={copyOrder}
          onLoadMore={() => void loadSection('settled', settled.nextCursor, false)}
          onRetry={() =>
            void loadSection(
              'settled',
              settled.items.length > 0 ? settled.nextCursor : null,
              settled.items.length === 0,
            )
          }
        />
      </Section>

      <section
        className="overflow-hidden rounded-[8px] border border-[#DCDDDD] bg-[#FAFAFA]/75 shadow-[0_1px_2px_rgba(15,23,42,0.02)]"
        aria-label="未完成支付"
      >
        <button
          type="button"
          aria-expanded={unfinishedExpanded}
          aria-controls="billing-unfinished-payments"
          className="flex min-h-11 w-full items-center justify-between gap-4 px-4 py-3 text-left transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#EA1F59]/25 sm:px-6"
          onClick={() => setUnfinishedExpanded((value) => !value)}
        >
          <span className="min-w-0">
            <span className="block text-sm font-medium text-[#595757]">查看未完成支付</span>
            <span className="mt-0.5 block text-[11px] leading-5 text-muted-foreground">
              包括取消、失败或仍待确认的结账记录，不代表已扣款
            </span>
          </span>
          <ChevronDown
            className={`h-4 w-4 shrink-0 text-[#777777] transition-transform motion-reduce:transition-none ${
              unfinishedExpanded ? 'rotate-180' : ''
            }`}
            aria-hidden
          />
        </button>
        {unfinishedExpanded && (
          <div
            id="billing-unfinished-payments"
            className="border-t border-[#E8E8E8] bg-white px-4 py-1 sm:px-6"
          >
            <PaymentList
              section="unfinished"
              state={unfinished}
              copyFeedback={copyFeedback}
              onCopy={copyOrder}
              onLoadMore={() => void loadSection('unfinished', unfinished.nextCursor, false)}
              onRetry={() =>
                void loadSection(
                  'unfinished',
                  unfinished.items.length > 0 ? unfinished.nextCursor : null,
                  unfinished.items.length === 0,
                )
              }
            />
          </div>
        )}
      </section>
    </div>
  );
}

function PaymentList({
  section,
  state,
  copyFeedback,
  onCopy,
  onLoadMore,
  onRetry,
}: {
  readonly section: BillingPaymentLedgerSection;
  readonly state: LedgerState;
  readonly copyFeedback: { readonly orderId: string; readonly ok: boolean } | null;
  readonly onCopy: (orderId: string) => Promise<void>;
  readonly onLoadMore: () => void;
  readonly onRetry: () => void;
}): JSX.Element {
  const listLabel = section === 'settled' ? '付款记录' : '未完成支付';
  const firstLoadErrorTitle =
    section === 'settled' ? '付款记录暂时无法加载' : '未完成支付暂时无法加载';
  const loadMoreErrorTitle =
    section === 'settled' ? '付款记录暂时无法继续加载' : '未完成支付暂时无法继续加载';

  if (state.loading && state.items.length === 0) {
    return (
      <div className="space-y-3" aria-label={`${listLabel}加载中`} aria-live="polite">
        {[0, 1, 2].map((item) => (
          <div
            key={item}
            className="hola-skel h-[92px] rounded-[6px] bg-[#EFEFEF]/80 sm:h-[76px]"
          />
        ))}
      </div>
    );
  }

  if (state.error && state.items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 px-4 py-8 text-center" aria-live="polite">
        <AlertCircle className="h-5 w-5 text-amber-600" aria-hidden />
        <p className="text-sm font-medium text-[#595757]">{firstLoadErrorTitle}</p>
        <p className="max-w-md text-xs leading-5 text-muted-foreground">{state.error}</p>
        <button
          type="button"
          className="mt-1 inline-flex min-h-11 items-center rounded-[7px] border border-[#DCDDDD] bg-white px-3 text-xs font-medium text-[#595757] hover:border-[#EA1F59]/35 hover:text-[#EA1F59] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#EA1F59]/25"
          onClick={onRetry}
        >
          重试
        </button>
      </div>
    );
  }

  if (state.loaded && state.items.length === 0) {
    return (
      <div className="px-4 py-9 text-center">
        <p className="text-sm text-muted-foreground">
          {section === 'settled' ? '暂无付款记录' : '暂无未完成支付'}
        </p>
        <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
          {section === 'settled'
            ? '购买套餐或加量包后，记录会显示在这里。'
            : '目前没有取消、失败或仍待确认的结账记录。'}
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="divide-y divide-[#EFEFEF] border-y border-[#EFEFEF]">
        {state.items.map((record) => (
          <PaymentRow
            key={record.orderId}
            record={record}
            section={section}
            copyFeedback={copyFeedback}
            onCopy={onCopy}
          />
        ))}
      </div>

      {(state.nextCursor || state.loadingMore || state.error) && (
        <div
          className="flex min-h-11 flex-col items-center justify-center gap-1 pt-3"
          aria-live="polite"
        >
          {state.error ? (
            <>
              <span className="text-[11px] text-amber-700">{loadMoreErrorTitle}</span>
              <button
                type="button"
                className="inline-flex min-h-11 items-center rounded-[7px] px-3 text-xs font-medium text-[#595757] hover:bg-[#F7F7F7] hover:text-[#EA1F59] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#EA1F59]/25"
                aria-label={`重试加载${listLabel}`}
                title={`重试加载${listLabel}`}
                onClick={onRetry}
              >
                重试
              </button>
            </>
          ) : (
            <button
              type="button"
              className="inline-flex min-h-11 items-center gap-2 rounded-[7px] px-3 text-xs font-medium text-[#595757] hover:bg-[#F7F7F7] hover:text-[#EA1F59] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#EA1F59]/25 disabled:cursor-not-allowed disabled:opacity-60"
              aria-label={`加载更多${listLabel}`}
              title={`加载更多${listLabel}`}
              disabled={state.loadingMore}
              onClick={onLoadMore}
            >
              {state.loadingMore && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
              {state.loadingMore ? '正在加载' : '加载更多'}
            </button>
          )}
        </div>
      )}
    </>
  );
}

function PaymentRow({
  record,
  section,
  copyFeedback,
  onCopy,
}: {
  readonly record: BillingPaymentRecord;
  readonly section: BillingPaymentLedgerSection;
  readonly copyFeedback: { readonly orderId: string; readonly ok: boolean } | null;
  readonly onCopy: (orderId: string) => Promise<void>;
}): JSX.Element {
  const status = billingPaymentStatusCopy(record.status, record.createdAt);
  const statusClass =
    status.tone === 'success'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
      : status.tone === 'warning'
        ? 'border-amber-200 bg-amber-50 text-amber-700'
        : 'border-[#DCDDDD] bg-[#F7F7F7] text-[#777777]';
  const receiptOptions = billingPaymentReceiptMailOptions(record);
  const feedback = copyFeedback?.orderId === record.orderId ? copyFeedback : null;

  return (
    <article className="grid min-w-0 gap-3 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-x-6">
      <div className="min-w-0">
        <div className="flex min-w-0 items-start justify-between gap-3 sm:block">
          <h3 className="min-w-0 text-sm font-medium text-[#1F1F1F]">
            {billingPaymentProduct(record.kind, record.plan)}
          </h3>
          <span
            className={`inline-flex shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium sm:hidden ${statusClass}`}
          >
            {status.label}
          </span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span>{billingPaymentProvider(record.provider)}</span>
          <span aria-hidden>·</span>
          <time dateTime={record.completedAt ?? record.createdAt}>
            {billingPaymentDate(record.completedAt ?? record.createdAt)}
          </time>
        </div>
        <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <code className="min-w-0 break-all font-mono text-[10px] leading-4 text-[#888888]">
            订单 {record.orderId}
          </code>
          <button
            type="button"
            className="inline-flex min-h-11 items-center gap-1 rounded-[7px] px-2 text-[11px] font-medium text-[#595757] hover:bg-[#F7F7F7] hover:text-[#EA1F59] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#EA1F59]/25 min-[769px]:min-h-8"
            aria-label={`复制订单 ${record.orderId}`}
            title={`复制订单 ${record.orderId}`}
            onClick={() => void onCopy(record.orderId)}
          >
            <Copy className="h-3.5 w-3.5" aria-hidden />
            {feedback?.ok ? '已复制' : feedback ? '复制失败' : '复制订单号'}
          </button>
          {section === 'settled' && (
            <a
              href={supportMailtoHref(receiptOptions)}
              className="inline-flex min-h-11 items-center gap-1 rounded-[7px] px-2 text-[11px] font-medium text-[#595757] hover:bg-[#FFF5F7] hover:text-[#EA1F59] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#EA1F59]/25 min-[769px]:min-h-8"
              aria-label={`申请订单 ${record.orderId} 的付款凭证或发票`}
            >
              <FileText className="h-3.5 w-3.5" aria-hidden />
              申请凭证/发票
            </a>
          )}
        </div>
        {feedback && !feedback.ok && (
          <p className="mt-1 text-[11px] leading-5 text-amber-700" aria-live="polite">
            复制失败，请手动选择订单号
          </p>
        )}
      </div>

      <div className="flex items-center justify-between gap-4 sm:flex-col sm:items-end sm:justify-start sm:text-right">
        <span className="text-sm font-semibold tabular-nums text-[#1F1F1F]">
          {billingPaymentAmount(record.amountCents, record.currency)}
        </span>
        <div className="hidden min-w-0 flex-col items-end gap-1 sm:flex">
          <span
            className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusClass}`}
          >
            {status.label}
          </span>
          <span className="max-w-[220px] text-[10px] leading-4 text-muted-foreground">
            {status.detail}
          </span>
        </div>
        <span className="text-right text-[10px] leading-4 text-muted-foreground sm:hidden">
          {status.detail}
        </span>
      </div>
    </article>
  );
}
