import { Check, Plus } from 'lucide-react';
import * as React from 'react';
import {
  ADDON_PACK_CATALOGUE,
  ADDON_PACK_IDS,
  PLAN_CATALOGUE,
  formatPrice,
  getAddonPackPriceCents,
  getPlanPriceCents,
  type AddonPackId,
  type BillingCycle,
  type Currency,
  type PlanId,
} from '@holaday/shared-types';
import { AddonPackButton } from '@/components/AddonPackButton';
import { PayPalButton } from '@/components/PayPalButton';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import { PageShell } from '@/pages/PageShell';

interface PaymentOptions {
  paypal: boolean;
  paypalClientId: string | null;
  paypalEnv: 'sandbox' | 'live' | null;
}

/**
 * Pick currency by browser locale. zh-* (mainland + HK + TW) gets ¥;
 * everywhere else gets $. PayPal still charges USD until WeChat Pay /
 * Alipay land in Phase 2 — for CN users we render ¥ as primary and
 * surface a small "(charged in USD via PayPal)" note below the cards.
 */
function detectCurrency(): Currency {
  if (typeof navigator === 'undefined') return 'usd';
  return navigator.language.toLowerCase().startsWith('zh') ? 'cny' : 'usd';
}

function isZhLocale(): boolean {
  if (typeof navigator === 'undefined') return false;
  return navigator.language.toLowerCase().startsWith('zh');
}

const CARDS_ORDER: PlanId[] = ['free', 'basic', 'pro'];

const CARD_TAGLINE_ZH: Record<PlanId, string> = {
  free: '体验 AI 浏览器的基础能力',
  basic: '日常轻度使用的最佳选择',
  pro: '重度使用与团队协作',
};
const CARD_TAGLINE_EN: Record<PlanId, string> = {
  free: 'Try the AI browser at no cost',
  basic: 'Best for everyday light usage',
  pro: 'Heavy usage and team workflows',
};

export function PlanPage(): JSX.Element {
  const toast = useToast();
  const [currentPlan, setCurrentPlan] = React.useState<string>('free');
  const [paymentOpts, setPaymentOpts] = React.useState<PaymentOptions | null>(null);
  const [openPayFor, setOpenPayFor] = React.useState<PlanId | null>(null);
  const [openAddonFor, setOpenAddonFor] = React.useState<AddonPackId | null>(null);
  const [cycle, setCycle] = React.useState<BillingCycle>('monthly');
  const [currency] = React.useState<Currency>(() => detectCurrency());
  const zh = isZhLocale();

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

  const isFirstMonthEligible = currentPlan === 'free';

  const handlePaymentSuccess = React.useCallback(
    (planId: PlanId) => {
      const def = PLAN_CATALOGUE[planId];
      const name = zh ? def.nameZh : def.nameEn;
      const msg = zh ? `升级到 ${name} 成功，已是 ${name} 会员` : `Upgraded to ${name}`;
      toast.show(msg);
      setOpenPayFor(null);
      refreshUser();
    },
    [refreshUser, toast, zh],
  );

  const handlePaymentError = React.useCallback(
    (rawMsg: string) => {
      const msg = (() => {
        if (!rawMsg) return zh ? '支付失败，请重试' : 'Payment failed';
        if (/timeout|timed out/i.test(rawMsg)) {
          return zh
            ? '支付确认超时，刷新页面查看状态'
            : 'Payment confirmation timed out, refresh to check status';
        }
        if (/PRECONDITION/i.test(rawMsg) || /not configured/i.test(rawMsg)) {
          return zh ? '支付未开启，联系 sales@holaday.ai' : 'Payment not enabled, contact sales@holaday.ai';
        }
        return zh ? `支付未完成：${rawMsg}` : `Payment incomplete: ${rawMsg}`;
      })();
      toast.show(msg);
    },
    [toast, zh],
  );

  return (
    <PageShell
      title={zh ? '套餐与定价' : 'Plans & Pricing'}
      subtitle={zh ? '选择适合你的版本' : 'Pick the version that fits you'}
      width="6xl"
    >
      <div className="mx-auto mb-8 max-w-2xl text-center">
        <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">
          {zh ? '让 AI 替你搞定浏览器里的一切' : 'Let AI handle everything in your browser'}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {zh
            ? '所有套餐都包含高质量模型、实时 VNC 观察、随时接管。'
            : 'All plans include premium models, real-time VNC observation, and instant takeover.'}
        </p>
      </div>

      {/* Cycle toggle */}
      <div className="mx-auto mb-8 flex items-center justify-center">
        <div className="inline-flex rounded-full border border-border bg-card p-1 text-sm">
          <button
            onClick={() => setCycle('monthly')}
            className={cn(
              'rounded-full px-4 py-1.5 transition-colors',
              cycle === 'monthly' ? 'bg-foreground text-background' : 'text-muted-foreground',
            )}
          >
            {zh ? '按月' : 'Monthly'}
          </button>
          <button
            onClick={() => setCycle('yearly')}
            className={cn(
              'flex items-center gap-1.5 rounded-full px-4 py-1.5 transition-colors',
              cycle === 'yearly' ? 'bg-foreground text-background' : 'text-muted-foreground',
            )}
          >
            <span>{zh ? '按年' : 'Yearly'}</span>
            <span
              className={cn(
                'rounded-full px-1.5 py-0.5 text-[10px] font-medium',
                cycle === 'yearly' ? 'bg-background/20 text-background' : 'bg-foreground/10 text-foreground',
              )}
            >
              {zh ? '省 17%' : '-17%'}
            </span>
          </button>
        </div>
      </div>

      <div className="grid gap-5 md:grid-cols-3">
        {CARDS_ORDER.map((planId) => {
          const def = PLAN_CATALOGUE[planId];
          const name = zh ? def.nameZh : def.nameEn;
          const tagline = zh ? CARD_TAGLINE_ZH[planId] : CARD_TAGLINE_EN[planId];
          const features = zh ? def.featuresZh : def.featuresEn;
          const isCurrent = planId === currentPlan;
          const featured = planId === 'basic';
          const isPaid = planId !== 'free';
          const isOpen = openPayFor === planId;

          // Pricing: free shows $0; paid shows the cycle's price, with
          // the first-month promo highlighted if eligible (monthly only;
          // yearly skips the promo since the discount is already in
          // the yearly rate).
          let priceMain = '';
          let priceUnit = '';
          let priceStrike = '';
          let firstMonthHint = '';
          if (planId === 'free') {
            priceMain = formatPrice(0, currency);
            priceUnit = zh ? '永久免费' : 'free forever';
          } else if (cycle === 'yearly') {
            const cents = getPlanPriceCents(planId, 'yearly', currency, false);
            priceMain = formatPrice(cents, currency);
            priceUnit = zh ? '/ 年' : '/ year';
          } else {
            const regular = getPlanPriceCents(planId, 'monthly', currency, false);
            const promoCents = def[currency].firstMonthCents;
            if (isFirstMonthEligible && promoCents != null) {
              priceMain = formatPrice(promoCents, currency);
              priceUnit = zh ? '/ 首月' : '/ first month';
              priceStrike = formatPrice(regular, currency);
              firstMonthHint = zh
                ? `之后每月 ${formatPrice(regular, currency)}`
                : `then ${formatPrice(regular, currency)}/mo`;
            } else {
              priceMain = formatPrice(regular, currency);
              priceUnit = zh ? '/ 月' : '/ month';
            }
          }

          return (
            <div
              key={planId}
              className={cn(
                'relative flex flex-col rounded-2xl border bg-card p-6 shadow-sm transition-shadow',
                featured ? 'border-primary/60 shadow-md ring-1 ring-primary/20' : 'border-border',
              )}
            >
              {featured && !isCurrent && (
                <div className="absolute -top-2.5 left-6 rounded-full bg-primary px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary-foreground">
                  {zh ? '推荐' : 'Recommended'}
                </div>
              )}
              {isCurrent && (
                <div className="absolute -top-2.5 left-6 rounded-full bg-foreground px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-background">
                  {zh ? '当前套餐' : 'Current Plan'}
                </div>
              )}

              <div className="mb-5">
                <h3 className="text-lg font-semibold">{name}</h3>
                <p className="mt-1 text-xs text-muted-foreground">{tagline}</p>
              </div>

              <div className="mb-2 flex items-baseline gap-2">
                <span className="text-3xl font-semibold tracking-tight">{priceMain}</span>
                <span className="text-xs text-muted-foreground">{priceUnit}</span>
                {priceStrike && (
                  <span className="text-xs text-muted-foreground line-through">{priceStrike}</span>
                )}
              </div>
              {firstMonthHint ? (
                <p className="mb-4 text-xs text-muted-foreground">{firstMonthHint}</p>
              ) : (
                <div className="mb-4" />
              )}

              {/* Tasks + concurrency + roles callout */}
              <div className="mb-4 rounded-md border border-border/50 bg-background/40 px-3 py-2 text-xs">
                <div className="font-medium text-foreground">
                  {planId === 'free'
                    ? zh
                      ? `每天 ${def.tasks.count} 个任务`
                      : `${def.tasks.count} tasks/day`
                    : def.tasks.opus
                      ? zh
                        ? `每月 ${def.tasks.count} 普通 + ${def.tasks.opus} Opus`
                        : `${def.tasks.count} standard + ${def.tasks.opus} Opus / mo`
                      : zh
                        ? `每月 ${def.tasks.count} 个任务`
                        : `${def.tasks.count} tasks/month`}
                </div>
                {def.tasks.firstMonthBonus && isFirstMonthEligible && cycle === 'monthly' && (
                  <div className="text-muted-foreground">
                    {zh
                      ? `首月额外赠送 ${def.tasks.firstMonthBonus} 次`
                      : `+${def.tasks.firstMonthBonus} bonus first month`}
                  </div>
                )}
                <div className="text-muted-foreground">
                  {zh
                    ? `${def.concurrency} 并发 · ${
                        def.rolesAllowed === 0
                          ? '无角色'
                          : def.rolesAllowed === 33
                            ? '全部 33 个角色'
                            : `自选 ${def.rolesAllowed} 个角色`
                      }`
                    : `${def.concurrency} concurrent · ${
                        def.rolesAllowed === 0
                          ? 'no roles'
                          : def.rolesAllowed === 33
                            ? 'all 33 roles'
                            : `${def.rolesAllowed} roles (your pick)`
                      }`}
                </div>
              </div>

              <ul className="mb-6 flex-1 space-y-2">
                {features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <span className="text-muted-foreground">{f}</span>
                  </li>
                ))}
              </ul>

              {isCurrent ? (
                <Button variant="outline" disabled className="w-full">
                  {zh ? '当前使用中' : 'Current'}
                </Button>
              ) : !isPaid ? (
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() =>
                    toast.show(
                      zh ? '降级到 Free 请发邮件给 sales@holaday.ai' : 'Email sales@holaday.ai to downgrade',
                    )
                  }
                >
                  {zh ? '降级到 Free' : 'Downgrade'}
                </Button>
              ) : isOpen && paymentOpts?.paypal && paymentOpts.paypalClientId ? (
                <PayPalButton
                  plan={planId as Exclude<PlanId, 'free'>}
                  cycle={cycle}
                  clientId={paymentOpts.paypalClientId}
                  env={paymentOpts.paypalEnv ?? 'sandbox'}
                  onSuccess={() => handlePaymentSuccess(planId)}
                  onError={handlePaymentError}
                />
              ) : (
                <Button
                  variant={featured ? 'default' : 'outline'}
                  className="w-full"
                  onClick={() => {
                    if (!paymentOpts) return;
                    if (!paymentOpts.paypal) {
                      toast.show(
                        zh
                          ? '支付暂未开放，联系 sales@holaday.ai'
                          : 'Payment not yet enabled, contact sales@holaday.ai',
                      );
                      return;
                    }
                    setOpenPayFor(planId);
                  }}
                >
                  {zh ? '升级' : 'Upgrade'}
                </Button>
              )}
            </div>
          );
        })}
      </div>

      {/* Add-on packs — only when the user is on a paid plan and PayPal */}
      {/* is wired. Free users see the plan-tier upgrade UI above; the    */}
      {/* add-on flow assumes they already pay and just need a top-up.    */}
      {(currentPlan === 'basic' || currentPlan === 'pro') &&
        paymentOpts?.paypal &&
        paymentOpts.paypalClientId && (
          <div className="mt-12">
            <div className="mb-4 text-center">
              <h3 className="text-lg font-semibold tracking-tight">
                {zh ? '加量包' : 'Add-on packs'}
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                {zh
                  ? '本月额度不够用？一次性购买，加量本周期立即生效'
                  : 'Need more this period? One-time top-ups, applied instantly'}
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {ADDON_PACK_IDS.map((packId) => {
                const pack = ADDON_PACK_CATALOGUE[packId];
                const allowed = pack.availableTo.includes(currentPlan as 'basic' | 'pro');
                const priceCents = getAddonPackPriceCents(packId, currency);
                const isOpen = openAddonFor === packId;
                return (
                  <div
                    key={packId}
                    className={cn(
                      'flex flex-col rounded-2xl border bg-card p-5 shadow-sm',
                      allowed ? 'border-border' : 'border-border/40 opacity-60',
                    )}
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <h4 className="text-base font-semibold">
                          {zh ? pack.nameZh : pack.nameEn}
                        </h4>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {zh
                            ? `本周期内 +${pack.tasks} 次任务${
                                pack.opus > 0 ? ` · +${pack.opus} 次 Opus` : ''
                              }`
                            : `+${pack.tasks} tasks${
                                pack.opus > 0 ? ` · +${pack.opus} Opus` : ''
                              } this period`}
                        </p>
                      </div>
                      <Plus className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="mt-4 flex items-baseline gap-2">
                      <span className="text-2xl font-semibold tracking-tight">
                        {formatPrice(priceCents, currency)}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {zh ? '一次性' : 'one-time'}
                      </span>
                    </div>
                    {!allowed ? (
                      <div className="mt-4 text-xs text-muted-foreground">
                        {zh ? '专业版可购买' : 'Pro plan only'}
                      </div>
                    ) : isOpen && paymentOpts.paypalClientId ? (
                      <div className="mt-4">
                        <AddonPackButton
                          packId={packId}
                          clientId={paymentOpts.paypalClientId}
                          env={paymentOpts.paypalEnv ?? 'sandbox'}
                          onSuccess={() => {
                            setOpenAddonFor(null);
                            toast.show(
                              zh ? '加量包已生效，立即可用' : 'Top-up applied',
                            );
                          }}
                          onError={handlePaymentError}
                        />
                      </div>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-4 w-full"
                        onClick={() => setOpenAddonFor(packId)}
                      >
                        {zh ? '购买' : 'Buy'}
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

      {/* CN-locale note: PayPal still settles in USD */}
      {currency === 'cny' && (
        <div className="mx-auto mt-6 max-w-xl rounded-md border border-border bg-card/60 p-3 text-center text-xs text-muted-foreground">
          {zh
            ? '当前通过 PayPal 以美元结算（按当日汇率折算 ≈ ¥）。微信支付与支付宝即将上线。'
            : "Charged via PayPal in USD (¥ shown at today's rate). WeChat Pay + Alipay coming soon."}
        </div>
      )}

      {/* Sandbox-mode warning */}
      {paymentOpts?.paypalEnv === 'sandbox' && (
        <div className="mx-auto mt-3 max-w-xl rounded-md border border-amber-300/50 bg-amber-50/50 p-3 text-center text-xs text-amber-900 dark:border-amber-700/50 dark:bg-amber-950/30 dark:text-amber-200">
          {zh ? '⚠ PayPal 处于 sandbox 模式 — 任何支付都不会实际扣款' : '⚠ PayPal in sandbox mode — no real charges'}
        </div>
      )}
    </PageShell>
  );
}
