/**
 * CN payment dialog — opens after the user picks 微信支付 or 支付宝.
 *
 * WeChat path:
 *   1. Call payment.createCnOrder({ provider: 'wechat', purchase })
 *   2. Render the returned `codeUrl` as a QR via the qrcode lib
 *   3. Poll payment.cnStatus({ outTradeNo }) every 3s
 *   4. status='completed' → toast success + close + refresh user
 *
 * Alipay path:
 *   1. Call payment.createCnOrder({ provider: 'alipay', purchase })
 *   2. Open `payUrl` in a new window
 *   3. Same polling loop as WeChat (status comes from the same
 *      payments table, written by the gateway → internal-confirm
 *      bridge regardless of provider)
 */

import { Loader2, X } from 'lucide-react';
import * as React from 'react';
import * as QRCode from 'qrcode';
import { trpc } from '@/lib/trpc';
import type { AddonPackId, BillingCycle, PaidPlanId } from '@holaday/shared-types';

export type CnProvider = 'wechat' | 'alipay';

export type CnPurchase =
  | { kind: 'subscription'; planId: PaidPlanId; cycle: BillingCycle }
  | { kind: 'addon'; packId: AddonPackId };

interface Props {
  provider: CnProvider;
  purchase: CnPurchase;
  onClose(): void;
  onSuccess(): void;
  onError(message: string): void;
}

const POLL_INTERVAL_MS = 3_000;
const POLL_TIMEOUT_MS = 10 * 60 * 1_000;

export function CnPaymentDialog({
  provider,
  purchase,
  onClose,
  onSuccess,
  onError,
}: Props): JSX.Element {
  const [phase, setPhase] = React.useState<'creating' | 'awaiting' | 'confirmed' | 'failed'>(
    'creating',
  );
  const [outTradeNo, setOutTradeNo] = React.useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = React.useState<string | null>(null);
  const [amountCents, setAmountCents] = React.useState<number | null>(null);
  const [description, setDescription] = React.useState<string | null>(null);
  const [errorText, setErrorText] = React.useState<string | null>(null);

  // Step 1 — kick off the order. Single shot per provider+purchase
  // tuple, fired on mount.
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = (await trpc.payment.createCnOrder.mutate({
          provider,
          purchase,
        })) as
          | {
              provider: 'wechat';
              outTradeNo: string;
              codeUrl: string;
              amountCents: number;
              description: string;
            }
          | {
              provider: 'alipay';
              outTradeNo: string;
              payUrl: string;
              amountCents: number;
              description: string;
            };
        if (cancelled) return;
        setOutTradeNo(res.outTradeNo);
        setAmountCents(res.amountCents);
        setDescription(res.description);
        if (res.provider === 'wechat') {
          // Render QR client-side from the code_url WX returns
          const dataUrl = await QRCode.toDataURL(res.codeUrl, {
            margin: 2,
            width: 240,
            color: { dark: '#000000', light: '#ffffff' },
          });
          if (cancelled) return;
          setQrDataUrl(dataUrl);
        } else {
          // Alipay — pop the gateway page in a new tab. The user's
          // session cookie isn't needed; the URL carries the full
          // signed query string.
          window.open(res.payUrl, '_blank', 'noopener,noreferrer');
        }
        setPhase('awaiting');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (cancelled) return;
        setErrorText(msg);
        setPhase('failed');
        onError(msg);
      }
    })();
    return () => {
      cancelled = true;
    };
    // intentionally only fires on mount; provider+purchase are stable
    // for this dialog instance
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Step 2 — once we have an outTradeNo, poll status until terminal
  // or the cap elapses.
  React.useEffect(() => {
    if (!outTradeNo) return;
    let cancelled = false;
    const startedAt = Date.now();
    const tick = async (): Promise<void> => {
      if (cancelled) return;
      try {
        const r = (await trpc.payment.cnStatus.query({ outTradeNo })) as {
          status: 'pending' | 'completed' | 'failed';
        };
        if (cancelled) return;
        if (r.status === 'completed') {
          setPhase('confirmed');
          onSuccess();
          return;
        }
        if (r.status === 'failed') {
          setPhase('failed');
          setErrorText('支付失败或已取消');
          onError('支付失败或已取消');
          return;
        }
      } catch {
        // Network blip — keep polling. The gateway-side 5xx case
        // also resolves via WX/Alipay's own retry to the notify
        // endpoint, so transient failures here are harmless.
      }
      if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
        setPhase('failed');
        setErrorText('等待支付超时，订单仍在处理中。请稍后刷新页面。');
        return;
      }
      window.setTimeout(tick, POLL_INTERVAL_MS);
    };
    void tick();
    return () => {
      cancelled = true;
    };
  }, [outTradeNo, onSuccess, onError]);

  const providerName = provider === 'wechat' ? '微信支付' : '支付宝';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-xl">
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭"
          className="absolute right-3 top-3 inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="mb-4">
          <h3 className="text-lg font-semibold">{providerName}</h3>
          {description && (
            <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
          )}
          {amountCents != null && (
            <div className="mt-2 text-2xl font-semibold tracking-tight">
              ¥{(amountCents / 100).toFixed(2)}
            </div>
          )}
        </div>

        {phase === 'creating' && (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            正在创建订单…
          </div>
        )}

        {phase === 'awaiting' && provider === 'wechat' && qrDataUrl && (
          <div className="flex flex-col items-center gap-3 py-2">
            <img
              src={qrDataUrl}
              alt="微信支付二维码"
              width={240}
              height={240}
              className="rounded-md border border-border"
            />
            <div className="text-xs text-muted-foreground">
              用微信扫码支付，完成后此页会自动更新
            </div>
          </div>
        )}

        {phase === 'awaiting' && provider === 'alipay' && (
          <div className="flex flex-col items-center gap-3 py-6 text-sm">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            <div>已在新窗口打开支付宝，付款完成后此页会自动更新。</div>
            <div className="text-xs text-muted-foreground">
              没看到新窗口？检查浏览器是否拦截了弹窗。
            </div>
          </div>
        )}

        {phase === 'confirmed' && (
          <div className="rounded-md border border-amber-300/40 bg-amber-50/40 px-3 py-3 text-sm dark:border-amber-700/40 dark:bg-amber-950/20">
            支付确认成功，正在刷新套餐…
          </div>
        )}

        {phase === 'failed' && errorText && (
          <div className="rounded-md border border-red-300/40 bg-red-50/40 px-3 py-3 text-sm text-red-800 dark:border-red-700/40 dark:bg-red-950/20 dark:text-red-300">
            {errorText}
          </div>
        )}
      </div>
    </div>
  );
}
