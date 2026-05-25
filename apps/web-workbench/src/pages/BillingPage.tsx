import { AlertCircle, CreditCard, Mail } from 'lucide-react';
import * as React from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import {
  billingLoadErrorMessage,
  billingPageSummary,
  billingPlanLabel,
  cancellationMailBody,
  type BillingSnapshot,
  isPaidBillingPlan,
  nextBillingAmountText,
  nextBillingDateText,
  normalizeBillingSnapshot,
} from '@/lib/billing-page-state';
import { SUPPORT_EMAIL, supportMailtoHref } from '@/lib/support-links';
import { trpc } from '@/lib/trpc';
import { PageContainer, PageHeader, Row, Section } from '@/pages/PageShell';

export function BillingPage(): JSX.Element {
  const mountedRef = React.useRef(false);
  const [snapshot, setSnapshot] = React.useState<BillingSnapshot | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const next = normalizeBillingSnapshot(await trpc.auth.me.query());
      if (!mountedRef.current) return;
      setSnapshot(next);
    } catch (err) {
      if (!mountedRef.current) return;
      setLoadError(billingLoadErrorMessage(err));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    mountedRef.current = true;
    void refresh();
    return () => {
      mountedRef.current = false;
    };
  }, [refresh]);

  const plan = snapshot?.plan ?? null;
  const planLabel = billingPlanLabel(plan);
  const isPaid = isPaidBillingPlan(plan);
  const nextAmountText = nextBillingAmountText(plan);
  const nextBillingDate = nextBillingDateText(plan, snapshot?.planExpiresAt ?? null);
  const summary = billingPageSummary({ loading, error: loadError, plan });

  return (
    <PageContainer width="list">
      <PageHeader
        title="账单与订阅"
        description="订阅状态、支付支持和发票记录"
        action={
          <div className="inline-flex items-center rounded-full border border-border bg-card px-3 py-1 text-[12px] font-medium text-foreground">
            {summary}
          </div>
        }
      />
      <div className="space-y-6">
        {loading ? (
          <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
            订阅加载中…
          </div>
        ) : loadError ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card/40 px-6 py-12 text-center">
            <AlertCircle className="h-8 w-8 text-primary" aria-hidden />
            <div className="text-sm font-medium text-foreground/80">订阅加载失败</div>
            <div className="max-w-md text-xs leading-5 text-muted-foreground">
              {loadError}
            </div>
            <div className="mt-1 flex flex-wrap justify-center gap-2">
              <Button type="button" size="sm" onClick={() => void refresh()}>
                重试
              </Button>
              <Button asChild variant="outline" size="sm">
                <a
                  href={supportMailtoHref({
                    subject: '账单订阅信息加载失败',
                    body: '账单订阅信息加载失败，请协助排查。\n\n注册邮箱：\n出现时间：',
                  })}
                >
                  联系支持
                </a>
              </Button>
            </div>
          </div>
        ) : (
          <>
            <Section title="当前订阅">
              <Row label="套餐" description="查看完整对比">
                <div className="flex items-center gap-3">
                  <span className="rounded-md bg-muted px-2 py-1 text-xs font-medium">
                    {planLabel}
                  </span>
                  <Link
                    to="/plan"
                    className="text-xs text-primary underline-offset-2 hover:underline"
                  >
                    升级
                  </Link>
                </div>
              </Row>
              <Row label="下次扣款日期">
                <span className="text-sm text-muted-foreground">{nextBillingDate}</span>
              </Row>
              <Row label="下次扣款金额">
                <span className="text-sm text-muted-foreground">{nextAmountText}</span>
              </Row>
              {isPaid && (
                <div className="mt-4 flex flex-col items-end gap-1.5">
                  {/*
                    P2.5 — disabled, no toast theatre. Cancellation goes
                    through support so refunds + plan-end logic land in
                    one place. The tooltip surfaces the email so the user
                    doesn't have to hunt.
                  */}
                  <Button asChild variant="outline" size="sm" className="text-red-600">
                    <a
                      href={supportMailtoHref({
                        subject: '取消 HOLA DAY 订阅',
                        body: cancellationMailBody(planLabel),
                      })}
                    >
                      联系客服取消
                    </a>
                  </Button>
                  <p className="text-[11px] text-muted-foreground">
                    取消订阅请联系客服：
                    <a
                      href={`mailto:${SUPPORT_EMAIL}`}
                      className="text-primary underline-offset-2 hover:underline"
                    >
                      {SUPPORT_EMAIL}
                    </a>
                  </p>
                </div>
              )}
            </Section>

            <Section title="支付方式">
              <div className="space-y-3">
                <div className="flex items-center justify-between rounded-lg border border-border bg-background p-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-md bg-muted">
                      <CreditCard className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div>
                      <div className="text-sm font-medium">当前未保存支付方式</div>
                      <div className="text-[11px] text-muted-foreground">
                        在线订阅通过结账页完成；企业付款、发票和本地支付可联系支持处理
                      </div>
                    </div>
                  </div>
                  <Button asChild variant="outline" size="sm">
                    <a href={supportMailtoHref({ subject: 'HOLA DAY 支付支持' })}>
                      <Mail className="h-3.5 w-3.5" />
                      联系支持
                    </a>
                  </Button>
                </div>
              </div>
            </Section>

            <Section title="账单记录" description="付款和发票历史">
              <div className="rounded-lg border border-border bg-background px-6 py-10 text-center">
                <p className="text-sm text-muted-foreground">暂无账单记录</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  已付款用户如需发票或付款凭证，可联系 {SUPPORT_EMAIL}。
                </p>
              </div>
            </Section>
          </>
        )}
      </div>
    </PageContainer>
  );
}
