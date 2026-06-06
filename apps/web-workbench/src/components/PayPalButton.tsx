/**
 * PayPalButton — loads the PayPal JS SDK on demand and renders a Smart
 * Button that drives our two-step server flow:
 *
 *   1. createOrder()  → POST /trpc/payment.createOrder  → server returns a
 *                       PayPal order id we hand to the SDK.
 *   2. onApprove()    → POST /trpc/payment.captureOrder → server captures
 *                       and flips the user's plan; we tell parent via
 *                       `onSuccess` so the page can refetch `auth.me`.
 *
 * The SDK script tag is appended to <head> exactly once per
 * (clientId, currency, env) tuple. Multiple instances of this
 * component reuse the same `paypal` global.
 */

import * as React from 'react';
import type { BillingCycle, PlanId } from '@holaday/shared-types';
import { pageErrorMessage } from '@/lib/page-error-copy';
import { trpc } from '@/lib/trpc';

declare global {
  interface Window {
    paypal?: {
      Buttons: (config: PayPalButtonsConfig) => { render: (selector: HTMLElement) => Promise<void> };
    };
  }
}

interface PayPalButtonsConfig {
  style?: { layout?: 'vertical' | 'horizontal'; shape?: 'rect' | 'pill'; color?: string; height?: number };
  createOrder: () => Promise<string>;
  onApprove: (data: { orderID: string }) => Promise<void>;
  onError?: (err: unknown) => void;
  onCancel?: () => void;
}

const SDK_LOADERS = new Map<string, Promise<void>>();

function loadPayPalSdk(clientId: string, env: 'sandbox' | 'live'): Promise<void> {
  // Sandbox vs live both use the same SDK URL — `client-id` selects the
  // PayPal account; `&debug=true` is for sandbox debugging only when
  // the tab dev tools are open. Currency is fixed USD this stage.
  const cacheKey = `${env}:${clientId}`;
  const existing = SDK_LOADERS.get(cacheKey);
  if (existing) return existing;
  const promise = new Promise<void>((resolve, reject) => {
    if (window.paypal) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    const params = new URLSearchParams({
      'client-id': clientId,
      currency: 'USD',
      intent: 'capture',
    });
    script.src = `https://www.paypal.com/sdk/js?${params.toString()}`;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('PayPal SDK failed to load'));
    document.head.appendChild(script);
  });
  SDK_LOADERS.set(cacheKey, promise);
  return promise;
}

interface Props {
  plan: Exclude<PlanId, 'free'>;
  /** Billing cycle to charge. Yearly skips the first-month promo. */
  cycle: BillingCycle;
  clientId: string;
  env: 'sandbox' | 'live';
  onSuccess: () => void;
  onError?: (message: string) => void;
}

export function PayPalButton({ plan, cycle, clientId, env, onSuccess, onError }: Props): JSX.Element {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = React.useState<'loading' | 'ready' | 'error'>('loading');

  React.useEffect(() => {
    let cancelled = false;
    loadPayPalSdk(clientId, env)
      .then(async () => {
        if (cancelled || !containerRef.current || !window.paypal) return;
        setStatus('ready');
        // Clear any prior render before re-rendering — React may have
        // dropped + remounted us if `plan` changed.
        containerRef.current.replaceChildren();
        let pendingPaymentId: string | null = null;
        try {
          await window.paypal
            .Buttons({
              style: { layout: 'vertical', shape: 'rect', height: 40 },
              createOrder: async () => {
                const r = await trpc.payment.createOrder.mutate({ plan, cycle });
                pendingPaymentId = r.paymentId;
                return r.orderId;
              },
              onApprove: async (data) => {
                if (!pendingPaymentId) {
                  onError?.('支付状态缺失，请重新发起支付。');
                  return;
                }
                try {
                  await trpc.payment.captureOrder.mutate({
                    paymentId: pendingPaymentId,
                    orderId: data.orderID,
                  });
                  onSuccess();
                } catch (err) {
                  onError?.(pageErrorMessage(err, '支付确认失败，请联系客服'));
                }
              },
              onError: (err) => {
                onError?.(pageErrorMessage(err, 'PayPal 支付组件出错，请稍后重试。'));
              },
              onCancel: () => {
                // No-op — user closed the popup. The pending payments
                // row stays in 'pending' until the next attempt.
              },
            })
            .render(containerRef.current);
        } catch (err) {
          if (!cancelled) {
            setStatus('error');
            onError?.(pageErrorMessage(err, 'PayPal 暂时无法加载，请刷新后重试。'));
          }
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setStatus('error');
          onError?.(pageErrorMessage(err, 'PayPal 暂时无法加载，请刷新后重试。'));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [plan, cycle, clientId, env, onSuccess, onError]);

  return (
    <div className="w-full">
      <div ref={containerRef} className="min-h-[40px]" />
      {status === 'loading' && (
        <div className="text-center text-xs text-muted-foreground">正在加载 PayPal...</div>
      )}
      {status === 'error' && (
        <div className="text-center text-xs text-destructive">PayPal 暂时无法加载，请刷新重试</div>
      )}
    </div>
  );
}
