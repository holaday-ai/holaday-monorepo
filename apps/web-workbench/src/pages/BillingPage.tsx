import { PaymentLedgerSection } from '@/components/billing/PaymentLedgerSection';
import { Button } from '@/components/ui/button';
import {
  type BillingPaymentReturnStatus,
  type BillingSnapshot,
  billingLoadErrorCopy,
  billingLoadErrorMessage,
  billingPageSummary,
  billingPaymentReturnCopy,
  billingPlanSupportMailBody,
  billingPlanActionLabel,
  billingPlanLabel,
  isPaidBillingPlan,
  normalizeBillingSnapshot,
  normalizePaymentReturnOrder,
  planValidUntilText,
  renewalMethodText,
} from '@/lib/billing-page-state';
import { SUPPORT_EMAIL, supportMailtoHref } from '@/lib/support-links';
import { trpc } from '@/lib/trpc';
import { PageContainer, PageHeader, Row, Section } from '@/pages/PageShell';
import { AlertCircle, CheckCircle2, CreditCard, Loader2, Mail } from 'lucide-react';
import * as React from 'react';
import { Link, useSearchParams } from 'react-router-dom';

export function BillingPage(): JSX.Element {
  const [searchParams] = useSearchParams();
  const mountedRef = React.useRef(false);
  const requestIdRef = React.useRef(0);
  const [snapshot, setSnapshot] = React.useState<BillingSnapshot | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [paymentLedgerRefreshKey, setPaymentLedgerRefreshKey] = React.useState(0);
  const paymentReturnOrder = normalizePaymentReturnOrder(searchParams.get('payment'));
  const [paymentReturnStatus, setPaymentReturnStatus] =
    React.useState<BillingPaymentReturnStatus | null>(paymentReturnOrder ? 'checking' : null);

  const refresh = React.useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setLoadError(null);
    try {
      const next = normalizeBillingSnapshot(await trpc.auth.me.query());
      if (!mountedRef.current || requestId !== requestIdRef.current) return;
      setSnapshot(next);
    } catch (err) {
      if (!mountedRef.current || requestId !== requestIdRef.current) return;
      setLoadError(billingLoadErrorMessage(err));
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

  React.useEffect(() => {
    if (!paymentReturnOrder) {
      setPaymentReturnStatus(null);
      return;
    }
    let cancelled = false;
    let timer: number | undefined;
    const startedAt = Date.now();
    setPaymentReturnStatus('checking');

    const poll = async (): Promise<void> => {
      try {
        const result = (await trpc.payment.cnStatus.query({
          outTradeNo: paymentReturnOrder,
        })) as { status: 'pending' | 'completed' | 'failed' };
        if (cancelled) return;
        if (result.status === 'completed') {
          setPaymentReturnStatus('completed');
          await refresh();
          if (!cancelled) setPaymentLedgerRefreshKey((value) => value + 1);
          return;
        }
        if (result.status === 'failed') {
          setPaymentReturnStatus('failed');
          return;
        }
      } catch {
        // Keep the order visible while a transient network failure clears.
      }
      if (Date.now() - startedAt >= 2 * 60 * 1_000) {
        setPaymentReturnStatus('timeout');
        return;
      }
      timer = window.setTimeout(() => void poll(), 2_500);
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [paymentReturnOrder, refresh]);

  const plan = snapshot?.plan ?? null;
  const planLabel = billingPlanLabel(plan);
  const planActionLabel = billingPlanActionLabel(plan);
  const isPaid = isPaidBillingPlan(plan);
  const planValidUntil = planValidUntilText(plan, snapshot?.planExpiresAt ?? null);
  const renewalMethod = renewalMethodText(plan);
  const summary = billingPageSummary({ loading, error: loadError, plan });
  const loadErrorCopy = billingLoadErrorCopy(loadError);
  const paymentReturnCopy = paymentReturnStatus
    ? billingPaymentReturnCopy(paymentReturnStatus)
    : null;

  return (
    <PageContainer width="list">
      <PageHeader
        title="账单与套餐"
        description="套餐有效期、续费方式和付款支持"
        action={
          <div className="inline-flex items-center rounded-full border border-[#DCDDDD] bg-white px-3 py-1 text-[12px] font-medium text-[#595757] shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
            {summary}
          </div>
        }
      />
      <div className="space-y-6">
        {paymentReturnCopy && (
          <div
            className={`flex items-start gap-3 rounded-[8px] border px-4 py-3 text-sm shadow-[0_1px_2px_rgba(15,23,42,0.03)] ${
              paymentReturnCopy.tone === 'success'
                ? 'border-emerald-200 bg-emerald-50/60 text-emerald-950'
                : paymentReturnCopy.tone === 'warning'
                  ? 'border-amber-200 bg-amber-50/60 text-amber-950'
                  : 'border-[#DCDDDD] bg-white text-[#1f1f1f]'
            }`}
            aria-live="polite"
          >
            {paymentReturnStatus === 'checking' ? (
              <Loader2
                className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-[#EA1F59]"
                aria-hidden
              />
            ) : paymentReturnStatus === 'completed' ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
            ) : (
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
            )}
            <div className="min-w-0">
              <div className="font-medium">{paymentReturnCopy.title}</div>
              <div className="mt-0.5 text-xs leading-5 opacity-75">{paymentReturnCopy.body}</div>
            </div>
          </div>
        )}
        {loading ? (
          <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
            套餐加载中…
          </div>
        ) : loadError ? (
          <div className="flex flex-col items-center gap-3 rounded-[8px] border border-[#DCDDDD] bg-white px-6 py-12 text-center shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
            <AlertCircle className="h-8 w-8 text-[#EA1F59]" aria-hidden />
            <div className="text-sm font-medium text-foreground/80">{loadErrorCopy.title}</div>
            <div className="max-w-md text-xs leading-5 text-muted-foreground">
              {loadErrorCopy.body}
            </div>
            <div className="mt-1 flex flex-wrap justify-center gap-2">
              <Button type="button" size="sm" onClick={() => void refresh()}>
                重试
              </Button>
              <Button
                asChild
                variant="outline"
                size="sm"
                className="border-[#DCDDDD] bg-white text-[#595757] hover:border-[#ADADAD] hover:bg-white hover:text-[#EA1F59]"
              >
                <a
                  href={supportMailtoHref({
                    subject: '账单套餐信息加载失败',
                    body: '账单套餐信息加载失败，请协助排查。\n\n注册邮箱：\n出现时间：',
                  })}
                >
                  联系支持
                </a>
              </Button>
            </div>
          </div>
        ) : (
          <>
            <Section
              title="当前套餐"
              className="rounded-[8px] border-[#DCDDDD] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]"
            >
              <Row label="套餐" description="查看完整对比">
                <div className="flex items-center gap-3">
                  <span className="rounded-full border border-[#57479C]/30 bg-white px-2 py-1 text-xs font-medium text-[#57479C]">
                    {planLabel}
                  </span>
                  <Button
                    asChild
                    variant="outline"
                    size="sm"
                    className="h-8 border-[#DCDDDD] bg-white px-3 text-[#EA1F59] hover:border-[#EA1F59]/35 hover:bg-white hover:text-[#EA1F59]"
                  >
                    <Link to="/plan">{planActionLabel}</Link>
                  </Button>
                </div>
              </Row>
              <Row label="套餐有效期">
                <span className="text-sm text-muted-foreground">{planValidUntil}</span>
              </Row>
              <Row label="续费方式">
                <span className="text-sm text-muted-foreground">{renewalMethod}</span>
              </Row>
              {isPaid && (
                <div className="mt-4 flex flex-col items-end gap-1.5">
                  {/*
                    P2.5 — disabled, no toast theatre. Cancellation goes
                    through support so refunds + plan-end logic land in
                    one place. The tooltip surfaces the email so the user
                    doesn't have to hunt.
                  */}
                  <Button
                    asChild
                    variant="outline"
                    size="sm"
                    className="border-[#DCDDDD] bg-white text-[#EA1F59] hover:border-[#EA1F59]/35 hover:bg-white hover:text-[#EA1F59]"
                  >
                    <a
                      href={supportMailtoHref({
                        subject: 'HOLA DAY 套餐退款或提前结束',
                        body: billingPlanSupportMailBody(planLabel),
                      })}
                    >
                      退款/提前结束套餐
                    </a>
                  </Button>
                  <p className="text-[11px] text-muted-foreground">
                    套餐不会自动续费；退款或提前结束请联系：
                    <a
                      href={`mailto:${SUPPORT_EMAIL}`}
                      className="inline-flex h-8 items-center text-[#EA1F59] underline-offset-2 hover:underline"
                    >
                      {SUPPORT_EMAIL}
                    </a>
                  </p>
                </div>
              )}
            </Section>

            <Section
              title="支付方式"
              className="rounded-[8px] border-[#DCDDDD] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]"
            >
              <div className="space-y-3">
                <div className="flex flex-col gap-3 rounded-[8px] border border-[#DCDDDD] bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-md border border-[#DCDDDD] bg-white">
                      <CreditCard className="h-4 w-4 text-[#595757]" />
                    </div>
                    <div>
                      <div className="text-sm font-medium">当前未保存支付方式</div>
                      <div className="text-[11px] text-muted-foreground">
                        在线套餐通过结账页购买；企业付款、发票和本地支付可联系支持处理
                      </div>
                    </div>
                  </div>
                  <Button
                    asChild
                    variant="outline"
                    size="sm"
                    className="shrink-0 border-[#DCDDDD] bg-white text-[#595757] hover:border-[#ADADAD] hover:bg-white hover:text-[#EA1F59]"
                  >
                    <a href={supportMailtoHref({ subject: 'HOLA DAY 支付支持' })}>
                      <Mail className="h-3.5 w-3.5" />
                      联系支持
                    </a>
                  </Button>
                </div>
              </div>
            </Section>
          </>
        )}

        <PaymentLedgerSection refreshKey={paymentLedgerRefreshKey} />
      </div>
    </PageContainer>
  );
}
