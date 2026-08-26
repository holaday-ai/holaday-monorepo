import { AddonPackButton } from '@/components/AddonPackButton';
import { CnPaymentDialog, type CnProvider, type CnPurchase } from '@/components/CnPaymentDialog';
import { PayPalButton } from '@/components/PayPalButton';
import { TrustNavigation } from '@/components/TrustNavigation';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { normalizeAuthMeProfile } from '@/lib/auth-me-state';
import {
  MANUAL_RENEWAL_DISCLOSURE_EN,
  MANUAL_RENEWAL_DISCLOSURE_ZH,
} from '@/lib/billing-page-state';
import { shouldScrollPlanAddons } from '@/lib/plan-page-hash';
import {
  type CnPaymentOptions,
  type PaymentOptions,
  normalizeCnPaymentOptions,
  normalizePaymentOptions,
  planAddonPaymentAvailable,
  planFirstMonthOfferCopy,
  planPaymentCtaState,
  planPaymentErrorMessage,
  planPaymentOptionsLoading,
  planSettlementNotice,
} from '@/lib/plan-payment-state';
import { supportMailtoHref } from '@/lib/support-links';
import { trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import { PageContainer, PageHeader } from '@/pages/PageShell';
import {
  ADDON_PACK_CATALOGUE,
  ADDON_PACK_IDS,
  type AddonPackId,
  type BillingCycle,
  type Currency,
  PLAN_CATALOGUE,
  type PlanId,
  formatPrice,
  getAddonPackPriceCents,
  getPlanPriceCents,
} from '@holaday/shared-types';
import { Check, Plus } from 'lucide-react';
import * as React from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Pick currency by browser locale. zh-* (mainland + HK + TW) gets ¥;
 * everywhere else gets $. The settlement notice below the cards
 * distinguishes CNY local-payment checkout from USD PayPal checkout.
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
  const location = useLocation();
  const [currentPlan, setCurrentPlan] = React.useState<PlanId | null>(null);
  const [accountStatus, setAccountStatus] = React.useState<'loading' | 'ready' | 'error'>(
    'loading',
  );
  const [paymentOpts, setPaymentOpts] = React.useState<PaymentOptions | null>(null);
  const [cnOpts, setCnOpts] = React.useState<CnPaymentOptions | null>(null);
  const [openPayFor, setOpenPayFor] = React.useState<PlanId | null>(null);
  const [openAddonFor, setOpenAddonFor] = React.useState<AddonPackId | null>(null);
  const [cycle, setCycle] = React.useState<BillingCycle>('monthly');
  const [currency] = React.useState<Currency>(() => detectCurrency());
  const zh = isZhLocale();
  // Phase 11 — CN-payment dialog state. provider + purchase together
  // describe what the dialog should kick off; null = dialog closed.
  const [cnDialog, setCnDialog] = React.useState<{
    provider: CnProvider;
    purchase: CnPurchase;
  } | null>(null);

  const refreshUser = React.useCallback(() => {
    setAccountStatus('loading');
    trpc.auth.me.query().then(
      (res) => {
        const plan = normalizeAuthMeProfile(res).plan;
        setCurrentPlan(plan === 'basic' || plan === 'pro' ? plan : 'free');
        setAccountStatus('ready');
      },
      () => {
        setCurrentPlan(null);
        setAccountStatus('error');
      },
    );
  }, []);

  React.useEffect(() => {
    refreshUser();
    trpc.payment.options.query().then(
      (res) => setPaymentOpts(normalizePaymentOptions(res)),
      () => setPaymentOpts({ paypal: false, paypalClientId: null, paypalEnv: null }),
    );
    trpc.payment.cnOptions.query().then(
      (res) => setCnOpts(normalizeCnPaymentOptions(res)),
      () => setCnOpts({ enabled: false, wechat: false, alipay: false }),
    );
  }, [refreshUser]);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!shouldScrollPlanAddons(location.hash)) return;
    const id = requestAnimationFrame(() => {
      document.getElementById('addons')?.scrollIntoView({ block: 'start' });
    });
    return () => cancelAnimationFrame(id);
  }, [location.hash]);

  const accountReady = accountStatus === 'ready' && currentPlan !== null;
  const mayQualifyForFirstMonthOffer = accountReady && currentPlan === 'free';
  const isPaidPlan = currentPlan === 'basic' || currentPlan === 'pro';
  const canBuyAddons = Boolean(
    isPaidPlan &&
      planAddonPaymentAvailable({
        zh,
        cnEnabled: cnOpts?.enabled ?? false,
        paypalEnabled: Boolean(paymentOpts?.paypal && paymentOpts.paypalClientId),
      }),
  );

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
      toast.show(planPaymentErrorMessage(rawMsg, zh));
    },
    [toast, zh],
  );

  return (
    <PageContainer width="wide">
      <PageHeader
        title={zh ? '套餐与定价' : 'Plans & Pricing'}
        description={zh ? '选择适合你的版本' : 'Pick the version that fits you'}
      />
      <div className="mx-auto mb-7 max-w-2xl text-center">
        <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">
          {zh ? '让 AI 替你搞定浏览器里的一切' : 'Let AI handle everything in your browser'}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {zh
            ? '所有套餐都包含高质量模型、浏览器画面同步、随时接管。'
            : 'All plans include premium models, browser view sync, and instant takeover.'}
        </p>
      </div>

      {/* Cycle toggle */}
      <div className="mx-auto mb-7 flex flex-col items-center gap-2">
        <div className="inline-flex rounded-[8px] border border-[#DCDDDD] bg-[#EFEFEF]/55 p-0.5 text-sm shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
          <button
            type="button"
            onClick={() => setCycle('monthly')}
            className={cn(
              'rounded-md px-4 py-1.5 transition-colors',
              cycle === 'monthly'
                ? 'bg-white text-[#EA1F59] shadow-[0_1px_2px_rgba(15,23,42,0.06)]'
                : 'text-[#595757] hover:text-foreground',
            )}
          >
            {zh ? '按月' : 'Monthly'}
          </button>
          <button
            type="button"
            onClick={() => setCycle('yearly')}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-4 py-1.5 transition-colors',
              cycle === 'yearly'
                ? 'bg-white text-[#EA1F59] shadow-[0_1px_2px_rgba(15,23,42,0.06)]'
                : 'text-[#595757] hover:text-foreground',
            )}
          >
            <span>{zh ? '按年' : 'Yearly'}</span>
            <span
              className={cn(
                'rounded-full border px-2 py-1 text-[11px] font-medium leading-none',
                cycle === 'yearly'
                  ? 'border-[#EA1F59]/30 bg-white text-[#EA1F59]'
                  : 'border-[#DCDDDD] bg-white text-[#595757]',
              )}
            >
              {zh ? '省 17%' : '-17%'}
            </span>
          </button>
        </div>
        <p className="text-center text-[12px] leading-5 text-muted-foreground">
          {zh ? MANUAL_RENEWAL_DISCLOSURE_ZH : MANUAL_RENEWAL_DISCLOSURE_EN}
        </p>
      </div>

      <div className="grid gap-5 md:grid-cols-3">
        {CARDS_ORDER.map((planId) => {
          const def = PLAN_CATALOGUE[planId];
          const name = zh ? def.nameZh : def.nameEn;
          const tagline = zh ? CARD_TAGLINE_ZH[planId] : CARD_TAGLINE_EN[planId];
          const features = zh ? def.featuresZh : def.featuresEn;
          const isCurrent = accountReady && planId === currentPlan;
          const featured = planId === 'basic';
          const isPaid = planId !== 'free';
          const isOpen = openPayFor === planId;
          const paymentCta = planPaymentCtaState({
            loading: planPaymentOptionsLoading({
              zh,
              paymentOptionsLoaded: paymentOpts !== null,
              cnPaymentOptionsLoaded: cnOpts !== null,
            }),
            zh,
            cnEnabled: cnOpts?.enabled ?? false,
            paypalEnabled: paymentOpts?.paypal ?? false,
          });

          // Pricing: free shows $0; paid shows the cycle's price, with
          // the first-month promo highlighted if eligible (monthly only;
          // yearly skips the promo since the discount is already in
          // the yearly rate).
          let priceMain = '';
          let priceUnit = '';
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
            if (mayQualifyForFirstMonthOffer && promoCents != null) {
              const offer = planFirstMonthOfferCopy({
                zh,
                regularPrice: formatPrice(regular, currency),
                promoPrice: formatPrice(promoCents, currency),
              });
              priceMain = offer.priceMain;
              priceUnit = offer.priceUnit;
              firstMonthHint = offer.hint;
            } else {
              priceMain = formatPrice(regular, currency);
              priceUnit = zh ? '/ 月' : '/ month';
            }
          }

          return (
            <div
              key={planId}
              className={cn(
                'group relative flex flex-col overflow-hidden rounded-[8px] border bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] transition-[transform,border-color,box-shadow]',
                featured
                  ? 'border-[#EA1F59]/45 hover:-translate-y-px hover:shadow-[0_8px_24px_rgba(15,23,42,0.07)]'
                  : 'border-[#DCDDDD] hover:-translate-y-px hover:border-[#ADADAD] hover:shadow-[0_5px_16px_rgba(15,23,42,0.055)]',
              )}
            >
              {featured && !isCurrent && (
                <div className="absolute inset-x-0 top-0 h-0.5 bg-[#EA1F59]" />
              )}
              {isCurrent && <div className="absolute inset-x-0 top-0 h-0.5 bg-[#57479C]" />}

              <div className="mb-5 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-lg font-semibold">{name}</h3>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">{tagline}</p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  {featured && !isCurrent && (
                    <span className="rounded-full border border-[#EA1F59]/35 bg-white px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide text-[#EA1F59]">
                      {zh ? '推荐' : 'Recommended'}
                    </span>
                  )}
                  {isCurrent && (
                    <span className="rounded-full border border-[#57479C]/30 bg-white px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide text-[#57479C]">
                      {zh ? '当前' : 'Current'}
                    </span>
                  )}
                </div>
              </div>

              <div className="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="text-3xl font-semibold tracking-tight">{priceMain}</span>
                <span className="text-xs text-muted-foreground">{priceUnit}</span>
              </div>
              {firstMonthHint ? (
                <p className="mb-4 text-xs text-muted-foreground">{firstMonthHint}</p>
              ) : (
                <div className="mb-4 h-4" />
              )}

              {/* Tasks + concurrency + roles callout */}
              <div className="mb-4 rounded-[8px] border border-[#DCDDDD] bg-white px-3 py-2 text-xs shadow-[0_1px_2px_rgba(15,23,42,0.02)]">
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
                {def.tasks.firstMonthBonus &&
                  mayQualifyForFirstMonthOffer &&
                  cycle === 'monthly' && (
                    <div className="text-muted-foreground">
                      {zh
                        ? `符合首月优惠条件时额外赠送 ${def.tasks.firstMonthBonus} 次`
                        : `Eligible first-month offers include +${def.tasks.firstMonthBonus} bonus tasks`}
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

              <ul className="mb-6 flex-1 space-y-2.5">
                {features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm">
                    <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-[#EA1F59]/35 bg-white text-[#EA1F59]">
                      <Check className="h-3 w-3" />
                    </span>
                    <span className="text-muted-foreground">{f}</span>
                  </li>
                ))}
              </ul>

              {!accountReady ? (
                <Button variant="outline" disabled className="w-full">
                  {accountStatus === 'error'
                    ? zh
                      ? '当前套餐暂不可用'
                      : 'Plan status unavailable'
                    : zh
                      ? '正在确认当前套餐…'
                      : 'Checking current plan…'}
                </Button>
              ) : isCurrent ? (
                <Button variant="outline" disabled className="w-full">
                  {zh ? '当前使用中' : 'Current'}
                </Button>
              ) : !isPaid ? (
                <Button
                  asChild
                  variant="outline"
                  className="w-full border-[#DCDDDD] bg-white text-[#595757] hover:border-[#ADADAD] hover:bg-white hover:text-[#EA1F59]"
                >
                  <a
                    href={supportMailtoHref({
                      subject: zh ? '降级到 HOLA DAY 体验版' : 'Downgrade HOLA DAY plan',
                      body: zh
                        ? '请协助将我的 HOLA DAY 套餐降级到体验版。\n\n注册邮箱：'
                        : 'Please help downgrade my HOLA DAY plan to Free.\n\nAccount email:',
                    })}
                  >
                    {zh ? '降级到体验版' : 'Downgrade'}
                  </a>
                </Button>
              ) : isOpen && zh && cnOpts?.enabled ? (
                // zh locale + CN gateway live → show 微信/支付宝/PayPal trio
                <div className="flex flex-col gap-2">
                  {cnOpts.wechat && (
                    <Button
                      variant="default"
                      className="w-full"
                      onClick={() =>
                        setCnDialog({
                          provider: 'wechat',
                          purchase: {
                            kind: 'subscription',
                            planId: planId as Exclude<PlanId, 'free'>,
                            cycle,
                          },
                        })
                      }
                    >
                      微信支付
                    </Button>
                  )}
                  {cnOpts.alipay && (
                    <Button
                      variant="outline"
                      className="w-full border-[#DCDDDD] bg-white text-[#595757] hover:border-[#ADADAD] hover:bg-white hover:text-[#EA1F59]"
                      onClick={() =>
                        setCnDialog({
                          provider: 'alipay',
                          purchase: {
                            kind: 'subscription',
                            planId: planId as Exclude<PlanId, 'free'>,
                            cycle,
                          },
                        })
                      }
                    >
                      支付宝
                    </Button>
                  )}
                  {paymentOpts?.paypal && paymentOpts.paypalClientId && (
                    <PayPalButton
                      plan={planId as Exclude<PlanId, 'free'>}
                      cycle={cycle}
                      clientId={paymentOpts.paypalClientId}
                      env={paymentOpts.paypalEnv ?? 'sandbox'}
                      onSuccess={() => handlePaymentSuccess(planId)}
                      onError={handlePaymentError}
                    />
                  )}
                </div>
              ) : isOpen && paymentOpts?.paypal && paymentOpts.paypalClientId ? (
                // Non-zh or CN gateway not configured → PayPal-only (legacy path)
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
                  className={cn(
                    'w-full',
                    !featured &&
                      'border-[#DCDDDD] bg-white text-[#595757] hover:border-[#ADADAD] hover:bg-white hover:text-[#EA1F59]',
                  )}
                  disabled={paymentCta.disabled}
                  onClick={() => {
                    if (paymentCta.unavailableMessage) {
                      window.location.href = supportMailtoHref({
                        subject: zh ? '开通 HOLA DAY 付费套餐' : 'Enable HOLA DAY billing',
                        body: zh
                          ? `我想开通 HOLA DAY ${name} 套餐。\n\n注册邮箱：`
                          : `I would like to enable the HOLA DAY ${name} plan.\n\nAccount email:`,
                      });
                      return;
                    }
                    setOpenPayFor(planId);
                  }}
                >
                  {paymentCta.label}
                </Button>
              )}
            </div>
          );
        })}
      </div>

      {/* Add-on packs — paid plans only. If the payment channel is not */}
      {/* wired, keep the #addons deep link meaningful with a contact panel. */}
      {isPaidPlan &&
        paymentOpts &&
        (canBuyAddons ? (
          <div id="addons" className="mt-12 scroll-mt-6">
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
                      'flex flex-col rounded-[8px] border bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] transition-[transform,border-color,box-shadow]',
                      allowed
                        ? 'border-[#DCDDDD] hover:-translate-y-px hover:border-[#ADADAD] hover:shadow-[0_5px_16px_rgba(15,23,42,0.055)]'
                        : 'border-[#DCDDDD] opacity-60',
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
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[#DCDDDD] bg-white text-[#595757]">
                        <Plus className="h-3.5 w-3.5" />
                      </span>
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
                    ) : isOpen ? (
                      <div className="mt-4 flex flex-col gap-2">
                        {zh && cnOpts?.wechat && (
                          <Button
                            size="sm"
                            className="w-full"
                            onClick={() =>
                              setCnDialog({
                                provider: 'wechat',
                                purchase: { kind: 'addon', packId },
                              })
                            }
                          >
                            微信支付
                          </Button>
                        )}
                        {zh && cnOpts?.alipay && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="w-full border-[#DCDDDD] bg-white text-[#595757] hover:border-[#ADADAD] hover:bg-white hover:text-[#EA1F59]"
                            onClick={() =>
                              setCnDialog({
                                provider: 'alipay',
                                purchase: { kind: 'addon', packId },
                              })
                            }
                          >
                            支付宝
                          </Button>
                        )}
                        {paymentOpts.paypal && paymentOpts.paypalClientId && (
                          <AddonPackButton
                            packId={packId}
                            clientId={paymentOpts.paypalClientId}
                            env={paymentOpts.paypalEnv ?? 'sandbox'}
                            onSuccess={() => {
                              setOpenAddonFor(null);
                              toast.show(zh ? '加量包已生效，立即可用' : 'Top-up applied');
                            }}
                            onError={handlePaymentError}
                          />
                        )}
                      </div>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-4 w-full border-[#DCDDDD] bg-white text-[#595757] hover:border-[#ADADAD] hover:bg-white hover:text-[#EA1F59]"
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
        ) : (
          <div
            id="addons"
            className="mx-auto mt-12 max-w-xl scroll-mt-6 rounded-[8px] border border-[#DCDDDD] border-l-[#42C0EF] bg-white p-4 text-center shadow-[0_1px_2px_rgba(15,23,42,0.03)] [border-left-width:3px]"
          >
            <h3 className="text-sm font-semibold text-foreground">
              {zh ? '加量包暂未开通在线支付' : 'Add-ons are not available online yet'}
            </h3>
            <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-muted-foreground">
              {zh
                ? '你的套餐支持加量包。当前支付通道暂不可用，可以联系支持协助开通或手动加量。'
                : 'Your plan supports top-ups. Online payment is unavailable right now; support can help enable or apply a pack manually.'}
            </p>
            <Button
              asChild
              size="sm"
              variant="outline"
              className="mt-3 border-[#DCDDDD] bg-white text-[#595757] hover:border-[#42C0EF]/45 hover:bg-[#42C0EF]/10 hover:text-[#1688AA]"
            >
              <a
                href={supportMailtoHref({
                  subject: zh ? '开通 HOLA DAY 加量包' : 'Enable HOLA DAY add-ons',
                  body: zh
                    ? '我想开通或购买 HOLA DAY 加量包。\n\n注册邮箱：'
                    : 'I would like to enable or purchase HOLA DAY add-ons.\n\nAccount email:',
                })}
              >
                {zh ? '联系支持' : 'Contact support'}
              </a>
            </Button>
          </div>
        ))}

      {/* CN-locale settlement note reflects the providers available now. */}
      {currency === 'cny' && (
        <div className="mx-auto mt-6 max-w-xl rounded-[8px] border border-[#DCDDDD] border-l-[#42C0EF] bg-white p-3 text-center text-xs text-muted-foreground shadow-[0_1px_2px_rgba(15,23,42,0.03)] [border-left-width:3px]">
          {planSettlementNotice({
            zh,
            wechat: cnOpts?.wechat ?? false,
            alipay: cnOpts?.alipay ?? false,
            paypalEnabled: paymentOpts?.paypal ?? false,
          })}
        </div>
      )}

      {/* Sandbox-mode warning */}
      {paymentOpts?.paypalEnv === 'sandbox' && (
        <div className="mx-auto mt-3 max-w-xl rounded-[8px] border border-[#DCDDDD] border-l-[#FFC910] bg-white p-3 text-center text-xs text-[#595757] shadow-[0_1px_2px_rgba(15,23,42,0.03)] [border-left-width:3px]">
          {zh
            ? '提示：PayPal 处于 sandbox 模式，任何支付都不会实际扣款'
            : 'Notice: PayPal is in sandbox mode, no real charges'}
        </div>
      )}

      <div className="mt-6">
        <TrustNavigation destinations={['billing', 'profile', 'terms', 'privacy']} />
      </div>

      {/* Phase 11 — CN payment dialog. Mounted page-level so the QR /
          Alipay-redirect view sits above whatever card the user
          clicked from. */}
      {cnDialog && (
        <CnPaymentDialog
          provider={cnDialog.provider}
          purchase={cnDialog.purchase}
          onClose={() => setCnDialog(null)}
          onSuccess={() => {
            const planLabel =
              cnDialog.purchase.kind === 'subscription'
                ? PLAN_CATALOGUE[cnDialog.purchase.planId][zh ? 'nameZh' : 'nameEn']
                : '加量包';
            toast.show(`${planLabel} 支付成功`);
            setCnDialog(null);
            setOpenPayFor(null);
            setOpenAddonFor(null);
            refreshUser();
          }}
          onError={(msg) => handlePaymentError(msg)}
        />
      )}
    </PageContainer>
  );
}
