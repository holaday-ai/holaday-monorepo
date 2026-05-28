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

import { AlertCircle, CheckCircle2, ExternalLink, Loader2, X } from 'lucide-react';
import * as React from 'react';
import * as QRCode from 'qrcode';
import {
  cnPaymentProviderLabel,
  cnPaymentProviderMark,
  compactOutTradeNo,
  formatCnyFromCents,
} from '@/lib/cn-payment-copy';
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
  const [payUrl, setPayUrl] = React.useState<string | null>(null);
  const [amountCents, setAmountCents] = React.useState<number | null>(null);
  const [description, setDescription] = React.useState<string | null>(null);
  const [errorText, setErrorText] = React.useState<string | null>(null);
  const [popupBlocked, setPopupBlocked] = React.useState(false);

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
          setPayUrl(res.payUrl);
          const popup = window.open(res.payUrl, '_blank', 'noopener,noreferrer');
          setPopupBlocked(popup === null);
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

  const providerName = cnPaymentProviderLabel(provider);
  const providerMark = cnPaymentProviderMark(provider);
  const formattedAmount = formatCnyFromCents(amountCents);
  const compactOrderNo = compactOutTradeNo(outTradeNo);
  const showOrderMeta = formattedAmount !== null || compactOrderNo !== null;
  const reopenAlipay = React.useCallback(() => {
    if (!payUrl) return;
    const popup = window.open(payUrl, '_blank', 'noopener,noreferrer');
    setPopupBlocked(popup === null);
  }, [payUrl]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative w-full max-w-md overflow-hidden rounded-[8px] border border-[#DCDDDD] bg-white text-[#1f1f1f] shadow-[0_18px_50px_rgba(15,23,42,0.16)]">
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭"
          title="关闭"
          className="absolute right-3 top-3 inline-flex h-7 w-7 items-center justify-center rounded-md text-[#595757] transition-colors hover:bg-[#EFEFEF]/70 hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="border-b border-[#EFEFEF] px-5 py-4">
          <div className="flex items-start gap-3 pr-8">
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] border border-[#EA1F59]/20 bg-[#EA1F59]/10 text-sm font-semibold text-[#EA1F59]">
              {providerMark}
            </div>
            <div className="min-w-0">
              <div className="text-[11px] font-medium text-[#595757]">
                安全支付
              </div>
              <h3 className="mt-0.5 text-base font-semibold">{providerName}</h3>
              {description && (
                <p className="mt-0.5 text-xs leading-5 text-[#595757]">{description}</p>
              )}
              {formattedAmount && (
                <div className="mt-2 text-2xl font-semibold tracking-tight">
                  {formattedAmount}
                </div>
              )}
            </div>
          </div>
          {showOrderMeta && (
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
              {compactOrderNo && (
                <div className="rounded-[8px] border border-[#EFEFEF] bg-[#FAFAFA] px-3 py-2">
                  <div className="text-[#ADADAD]">订单号</div>
                  <div className="mt-0.5 font-medium text-[#595757]">{compactOrderNo}</div>
                </div>
              )}
              {formattedAmount && (
                <div className="rounded-[8px] border border-[#EFEFEF] bg-[#FAFAFA] px-3 py-2">
                  <div className="text-[#ADADAD]">金额</div>
                  <div className="mt-0.5 font-medium text-[#595757]">{formattedAmount}</div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="space-y-3 px-5 py-5">
          {phase === 'creating' && (
            <div className="flex items-center gap-2 rounded-[8px] border border-[#DCDDDD] bg-white px-3 py-3 text-sm text-[#595757] shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
              <Loader2 className="h-4 w-4 animate-spin text-[#EA1F59]" />
              正在创建订单…
            </div>
          )}

          {phase === 'awaiting' && provider === 'wechat' && qrDataUrl && (
            <div className="flex flex-col items-center gap-3">
              <div className="rounded-[8px] border border-[#DCDDDD] bg-white p-2 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
                <img
                  src={qrDataUrl}
                  alt="微信支付二维码"
                  width={240}
                  height={240}
                  className="rounded-md"
                />
              </div>
              <div className="flex w-full items-center justify-center gap-2 rounded-[8px] border border-[#DCDDDD] border-l-[#42C0EF] bg-white px-3 py-2 text-center text-xs text-[#595757] [border-left-width:3px]">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-[#42C0EF]" />
                用微信扫码支付，完成后此页会自动更新
              </div>
            </div>
          )}

          {phase === 'awaiting' && provider === 'alipay' && (
            <div className="flex flex-col items-center gap-3 rounded-[8px] border border-[#DCDDDD] bg-white px-4 py-6 text-center text-sm shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
              <Loader2 className="h-5 w-5 animate-spin text-[#EA1F59]" />
              <div className="font-medium">等待支付宝付款确认</div>
              <div className="text-xs text-[#595757]">
                已尝试在新窗口打开支付宝，付款完成后此页会自动更新。
              </div>
              {payUrl && (
                <button
                  type="button"
                  onClick={reopenAlipay}
                  className="inline-flex items-center gap-1.5 rounded-[8px] border border-[#DCDDDD] bg-white px-3 py-1.5 text-sm font-medium text-[#EA1F59] transition-colors hover:border-[#EA1F59]/30 hover:bg-[#EA1F59]/10"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  重新打开支付宝
                </button>
              )}
              {popupBlocked && (
                <div className="rounded-[8px] border border-[#EA1F59]/20 bg-[#EA1F59]/[0.06] px-3 py-2 text-xs text-[#EA1F59]">
                  浏览器可能拦截了付款窗口，请点击上方按钮手动打开。
                </div>
              )}
            </div>
          )}

          {phase === 'confirmed' && (
            <div className="flex items-start gap-2 rounded-[8px] border border-[#DCDDDD] border-l-[#42C0EF] bg-white px-3 py-3 text-sm text-foreground shadow-[0_1px_2px_rgba(15,23,42,0.03)] [border-left-width:3px]">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#42C0EF]" />
              <span>支付确认成功，正在刷新套餐…</span>
            </div>
          )}

          {phase === 'failed' && errorText && (
            <div className="flex items-start gap-2 rounded-[8px] border border-[#DCDDDD] border-l-[#EA1F59] bg-white px-3 py-3 text-sm text-foreground shadow-[0_1px_2px_rgba(15,23,42,0.03)] [border-left-width:3px]">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#EA1F59]" />
              <span>{errorText}</span>
            </div>
          )}

          {phase === 'awaiting' && (
            <div className="rounded-[8px] border border-[#EFEFEF] bg-[#FAFAFA] px-3 py-2 text-[11px] leading-5 text-[#595757]">
              请在官方支付页面完成付款。此窗口只用于展示订单状态，不会要求输入银行卡或账号密码。
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
