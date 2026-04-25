import { Check } from 'lucide-react';
import * as React from 'react';
import { PLAN_CATALOGUE, formatUsd, type PlanId } from '@holaday/shared-types';
import { PayPalButton } from '@/components/PayPalButton';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import { PageShell } from '@/pages/PageShell';

interface PlanCard {
  id: PlanId;
  tagline: string;
  features: string[];
  featured?: boolean;
}

const PLAN_CARDS: PlanCard[] = [
  {
    id: 'free',
    tagline: 'Try the AI browser at no cost',
    features: [
      '20 tasks per month',
      '10-minute task time limit',
      'Search engines only',
      '7-day task history',
    ],
  },
  {
    id: 'basic',
    tagline: 'Best for everyday light usage',
    features: [
      '200 tasks per month',
      '30-minute task time limit',
      'Global search + e-commerce',
      '30-day task history',
      'Email support',
    ],
    featured: true,
  },
  {
    id: 'pro',
    tagline: 'Heavy usage and team workflows',
    features: [
      '1,000 tasks per month',
      '2-hour task time limit',
      'All sites + Zapier / Apify',
      'Permanent task history',
      '24/7 priority support',
      'Custom prompt library',
    ],
  },
];

interface PaymentOptions {
  paypal: boolean;
  paypalClientId: string | null;
  paypalEnv: 'sandbox' | 'live' | null;
}

export function PlanPage(): JSX.Element {
  const toast = useToast();
  const [currentPlan, setCurrentPlan] = React.useState<string>('free');
  const [paymentOpts, setPaymentOpts] = React.useState<PaymentOptions | null>(null);
  const [openPayFor, setOpenPayFor] = React.useState<PlanId | null>(null);

  const refreshUser = React.useCallback(() => {
    trpc.auth.me.query().then(
      (res) => setCurrentPlan(res.plan),
      () => {
        /* not logged in — keep showing free as current */
      },
    );
  }, []);

  React.useEffect(() => {
    refreshUser();
    trpc.payment.options.query().then(
      (res) => setPaymentOpts(res),
      () => setPaymentOpts({ paypal: false, paypalClientId: null, paypalEnv: null }),
    );
  }, [refreshUser]);

  const handlePaymentSuccess = React.useCallback(
    (planId: PlanId) => {
      toast.show(`升级到 ${PLAN_CATALOGUE[planId].name} 成功`);
      setOpenPayFor(null);
      refreshUser();
    },
    [refreshUser, toast],
  );

  return (
    <PageShell title="Plans & Pricing" subtitle="Pick the version that fits you" width="6xl">
      <div className="mx-auto mb-10 max-w-2xl text-center">
        <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">
          Let AI handle everything in your browser
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          All plans include premium models, real-time VNC observation, and instant takeover. Pay
          monthly, cancel any time.
        </p>
      </div>

      <div className="grid gap-5 md:grid-cols-3">
        {PLAN_CARDS.map((card) => {
          const def = PLAN_CATALOGUE[card.id];
          const isCurrent = card.id === currentPlan;
          const isPaid = card.id !== 'free';
          const isOpen = openPayFor === card.id;
          return (
            <div
              key={card.id}
              className={cn(
                'relative flex flex-col rounded-2xl border bg-card p-6 shadow-sm transition-shadow',
                card.featured
                  ? 'border-primary/60 shadow-md ring-1 ring-primary/20'
                  : 'border-border',
              )}
            >
              {card.featured && !isCurrent && (
                <div className="absolute -top-2.5 left-6 rounded-full bg-primary px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary-foreground">
                  Recommended
                </div>
              )}
              {isCurrent && (
                <div className="absolute -top-2.5 left-6 rounded-full bg-foreground px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-background">
                  Current Plan
                </div>
              )}
              <div className="mb-5">
                <h3 className="text-lg font-semibold">{def.name}</h3>
                <p className="mt-1 text-xs text-muted-foreground">{card.tagline}</p>
              </div>
              <div className="mb-6 flex items-baseline gap-1">
                <span className="text-3xl font-semibold tracking-tight">
                  {formatUsd(def.usdAmountCents)}
                </span>
                <span className="text-xs text-muted-foreground">
                  {def.usdAmountCents === 0 ? 'free forever' : '/ month'}
                </span>
              </div>
              <ul className="mb-6 flex-1 space-y-2">
                {card.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <span className="text-muted-foreground">{f}</span>
                  </li>
                ))}
              </ul>
              {isCurrent ? (
                <Button variant="outline" disabled className="w-full">
                  Current
                </Button>
              ) : !isPaid ? (
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => toast.show('降级到 Free 请发邮件给 sales@holaday.ai')}
                >
                  Downgrade
                </Button>
              ) : isOpen && paymentOpts?.paypal && paymentOpts.paypalClientId ? (
                <PayPalButton
                  plan={card.id as Exclude<PlanId, 'free'>}
                  clientId={paymentOpts.paypalClientId}
                  env={paymentOpts.paypalEnv ?? 'sandbox'}
                  onSuccess={() => handlePaymentSuccess(card.id)}
                  onError={(msg) => toast.show(msg)}
                />
              ) : (
                <Button
                  variant={card.featured ? 'default' : 'outline'}
                  className="w-full"
                  onClick={() => {
                    if (!paymentOpts) return;
                    if (!paymentOpts.paypal) {
                      toast.show('支付暂未开放，请联系客服 sales@holaday.ai');
                      return;
                    }
                    setOpenPayFor(card.id);
                  }}
                >
                  Upgrade
                </Button>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-10 rounded-xl border border-border bg-card p-6 text-center">
        <h3 className="text-sm font-semibold">Need an enterprise or team plan?</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Multi-seat, dedicated deploy, SLA — get in touch for a custom quote
        </p>
        <Button
          variant="outline"
          size="sm"
          className="mt-3"
          onClick={() => toast.show('请发送邮件到 sales@holaday.ai')}
        >
          Contact sales
        </Button>
      </div>

      {paymentOpts?.paypalEnv === 'sandbox' && (
        <div className="mx-auto mt-6 max-w-xl rounded-md border border-amber-300/50 bg-amber-50/50 p-3 text-center text-xs text-amber-900 dark:border-amber-700/50 dark:bg-amber-950/30 dark:text-amber-200">
          ⚠ PayPal 处于 sandbox 模式 — 任何支付都不会实际扣款
        </div>
      )}
    </PageShell>
  );
}
