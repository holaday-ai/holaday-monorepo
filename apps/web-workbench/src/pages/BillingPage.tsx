import { CreditCard, Plus } from 'lucide-react';
import * as React from 'react';
import { Link } from 'react-router-dom';
import { formatCny, getPlanPriceCents, type PaidPlanId } from '@holaday/shared-types';
import { Button } from '@/components/ui/button';
import { trpc } from '@/lib/trpc';
import { PageContainer, PageHeader, Row, Section } from '@/pages/PageShell';

const SUPPORT_EMAIL = 'support@holaday.ai';

export function BillingPage(): JSX.Element {
  const [plan, setPlan] = React.useState<string>('free');
  const [planExpiresAt, setPlanExpiresAt] = React.useState<string | null>(null);

  React.useEffect(() => {
    trpc.auth.me.query().then(
      (res) => {
        setPlan(res.plan);
        setPlanExpiresAt(res.planExpiresAt ?? null);
      },
      () => {
        /* ignore */
      },
    );
  }, []);

  const planLabel = plan === 'pro' ? 'Pro' : plan === 'basic' ? 'Basic' : 'Free · 试用';
  const isPaid = plan === 'pro' || plan === 'basic';
  // Price comes from PLAN_CATALOGUE so it can't drift from the
  // checkout sheet — hardcoding here previously had Basic at ¥39
  // while the catalogue priced it at ¥29.
  const nextAmountText = isPaid
    ? formatCny(getPlanPriceCents(plan as PaidPlanId, 'monthly', 'cny', false))
    : '—';
  const nextBillingDate = isPaid && planExpiresAt
    ? new Date(planExpiresAt).toISOString().slice(0, 10)
    : '—';

  return (
    <PageContainer width="list">
      <PageHeader title="账单与订阅" description="支付方式和历史发票" />
      <div className="space-y-6">
        <Section title="当前订阅">
          <Row label="套餐" description="查看完整对比">
            <div className="flex items-center gap-3">
              <span className="rounded-md bg-muted px-2 py-1 text-xs font-medium">
                {planLabel}
              </span>
              <Link to="/plan" className="text-xs text-primary underline-offset-2 hover:underline">
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
          {plan !== 'free' && (
            <div className="mt-4 flex flex-col items-end gap-1.5">
              {/*
                P2.5 — disabled, no toast theatre. Cancellation goes
                through support so refunds + plan-end logic land in
                one place. The tooltip surfaces the email so the user
                doesn't have to hunt.
              */}
              <Button
                variant="outline"
                size="sm"
                disabled
                title={`取消订阅请联系客服：${SUPPORT_EMAIL}`}
                className="cursor-not-allowed text-red-600 opacity-50"
              >
                取消订阅
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
                  <div className="text-sm font-medium">暂未绑定支付方式</div>
                  <div className="text-[11px] text-muted-foreground">支持信用卡、支付宝、微信支付</div>
                </div>
              </div>
              {/*
                P2.5 — disabled until the saved-card flow lands. The
                old toast-only path implied the action did something.
              */}
              <Button
                variant="outline"
                size="sm"
                disabled
                title="即将支持"
                className="cursor-not-allowed opacity-50"
              >
                <Plus className="h-3.5 w-3.5" />
                添加
              </Button>
            </div>
          </div>
        </Section>

        <Section title="账单记录" description="付款和发票历史">
          <div className="rounded-lg border border-border bg-background px-6 py-10 text-center">
            <p className="text-sm text-muted-foreground">账单记录即将开放</p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              我们正在打磨账单导出与发票下载，敬请期待。
            </p>
          </div>
        </Section>
      </div>
    </PageContainer>
  );
}
