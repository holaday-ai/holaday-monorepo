/**
 * AddonPackButton — same shape as PayPalButton but routes the
 * createOrder leg to `payment.createAddonOrder`. The capture leg
 * is shared with subscription orders (server discriminates on
 * `payments.kind`), so this component reuses captureOrder verbatim.
 *
 * Kept separate from PayPalButton because:
 *   - The createOrder input shape differs (`packId` vs `plan + cycle`).
 *   - Add-on flows can charge users who already have a paid plan,
 *     while PayPalButton is anchored to "upgrade from free → paid".
 *   - Letting them diverge means each block can evolve copy / styling
 *     without polluting the other.
 */

import * as React from 'react';
import type { AddonPackId } from '@holaday/shared-types';
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
  packId: AddonPackId;
  clientId: string;
  env: 'sandbox' | 'live';
  onSuccess: () => void;
  onError?: (message: string) => void;
}

export function AddonPackButton({
  packId,
  clientId,
  env,
  onSuccess,
  onError,
}: Props): JSX.Element {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = React.useState<'loading' | 'ready' | 'error'>('loading');

  React.useEffect(() => {
    let cancelled = false;
    loadPayPalSdk(clientId, env)
      .then(async () => {
        if (cancelled || !containerRef.current || !window.paypal) return;
        setStatus('ready');
        containerRef.current.replaceChildren();
        let pendingPaymentId: string | null = null;
        try {
          await window.paypal
            .Buttons({
              style: { layout: 'vertical', shape: 'rect', height: 36 },
              createOrder: async () => {
                const r = await trpc.payment.createAddonOrder.mutate({ packId });
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
                  onError?.(pageErrorMessage(err, '支付确认失败'));
                }
              },
              onError: (err) => {
                onError?.(pageErrorMessage(err, 'PayPal 支付组件出错，请稍后重试。'));
              },
              onCancel: () => {
                /* user closed popup */
              },
            })
            .render(containerRef.current);
        } catch (err) {
          if (!cancelled) {
            setStatus('error');
            onError?.(pageErrorMessage(err, '加载 PayPal 按钮失败'));
          }
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setStatus('error');
          onError?.(pageErrorMessage(err, 'PayPal 支付组件加载失败，请刷新后重试。'));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [packId, clientId, env, onSuccess, onError]);

  return (
    <div className="w-full">
      <div ref={containerRef} className="min-h-[36px]" />
      {status === 'loading' && (
        <div className="text-center text-[10px] text-muted-foreground">正在加载 PayPal...</div>
      )}
      {status === 'error' && (
        <div className="text-center text-[10px] text-destructive">PayPal 暂时无法加载</div>
      )}
    </div>
  );
}
