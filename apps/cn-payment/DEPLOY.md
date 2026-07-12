# cn-payment deploy notes

The China-side payment gateway (`hd-pay.orangebench.tech`) lives on
the Aliyun box at `47.99.169.186`. It sits in front of WeChat Pay v3
+ Alipay's OpenAPI; Vultr's orchestrator proxies user clicks here,
the gateway returns a QR / redirect URL, the wallet calls back to
this host, and we bridge the verified result over the internal
shared-secret channel back to Vultr.

The same `/payment/create` endpoint also serves the partner ledger
online-payment path. For partner purchases, Vultr passes the existing
`partner_recharge_orders.external_id` as `partnerOrderExternalId`; the
gateway uses that value as `out_trade_no`, and verified callbacks are
bridged to `/api/internal/partner-payment/confirm` instead of the
legacy `/api/internal/payment/confirm`.

## Prerequisites

Before deploy can finish, BOSS needs to have:

1. **DNS record** — `hd-pay.orangebench.tech A 47.99.169.186`. Set in
   Aliyun's DNS console under the orangebench.tech zone; TTL 600s.
2. **WeChat Pay v3 credentials** (from https://pay.weixin.qq.com →
   "商户后台" → "API 安全"):
   - `WX_APPID` (公众号 / 小程序 / App AppID — whatever the merchant
     account is bound to)
   - `WX_MCHID` (商户号, 10-digit)
   - `WX_API_V3_KEY` (32-char v3 key set via "API 密钥设置")
   - `apiclient_cert.pem` + `apiclient_key.pem` (download from
     "API 证书" — the merchant cert pair)
3. **Alipay credentials** (from https://open.alipay.com → "我的应用"):
   - `ALIPAY_APPID`
   - `ALIPAY_PRIVATE_KEY` (the application's RSA-2048 private key —
     generated locally, public counterpart pasted into Alipay's
     "应用公钥" UI)
   - `ALIPAY_PUBLIC_KEY` (Alipay's public key, copy-pasted from the
     same console after Alipay approves the app)
4. **Internal shared secret** — generate once with
   `openssl rand -hex 32`; same value goes in BOTH `.env` files
   (Aliyun + Vultr).

## One-time host setup

Tested on Aliyun's stock Ubuntu 22.04 image. PM2 + Nginx + Node 22
already installed for this host (the box predates this service).

```bash
# 1. Create install dir + clone
mkdir -p /opt/holaday-cn-payment
cd /opt/holaday-cn-payment
git clone https://github.com/holaday-ai/holaday-monorepo.git src
ln -sfn src/apps/cn-payment app

# 2. Install monorepo deps (pnpm 10 already on the box)
cd src
pnpm install --filter @holaday/cn-payment...

# 3. Drop in cert files (BOSS uploads via scp)
mkdir -p /opt/holaday-cn-payment/certs
chmod 700 /opt/holaday-cn-payment/certs
# scp apiclient_cert.pem apiclient_key.pem to the certs/ dir
chmod 400 /opt/holaday-cn-payment/certs/*

# 4. .env
cd /opt/holaday-cn-payment/src/apps/cn-payment
cp .env.example .env
# Edit with the credentials above; INTERNAL_SHARED_SECRET MUST match
# the value in /opt/holaday-monorepo/apps/orchestrator/.env on Vultr.

# 5. Boot under PM2
pm2 start /opt/holaday-cn-payment/start.sh \
  --name holaday-cn-payment \
  --update-env
pm2 save
```

`start.sh` (write to `/opt/holaday-cn-payment/start.sh`):

```bash
#!/bin/bash
export PATH=/opt/node22/bin:$PATH
cd /opt/holaday-cn-payment/src/apps/cn-payment
exec /opt/node22/bin/npx tsx src/index.ts
```

## Nginx

Append to `/etc/nginx/sites-available/orangebench`:

```nginx
server {
    listen 443 ssl http2;
    server_name hd-pay.orangebench.tech;

    ssl_certificate     /etc/letsencrypt/live/orangebench.tech/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/orangebench.tech/privkey.pem;

    # WeChat / Alipay POST async notifications here. Don't strip the
    # request body or rewrite headers — WX signs over the literal
    # bytes; any rewrite breaks signature verification.
    location / {
        proxy_pass http://127.0.0.1:4010;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_http_version 1.1;
        proxy_request_buffering off;
        client_max_body_size 1m;
    }
}
```

Then:
```bash
nginx -t && systemctl reload nginx
# Issue a wildcard cert for hd-pay.orangebench.tech if it's not
# already in the bundle:
certbot certonly -d hd-pay.orangebench.tech --webroot -w /var/www/letsencrypt
```

## Vultr-side env

Add to `/opt/holaday-monorepo/apps/orchestrator/.env` and pm2-restart
the orchestrator:

```bash
# Phase 11 — CN payment gateway bridge
CN_PAYMENT_URL=https://hd-pay.orangebench.tech
INTERNAL_SHARED_SECRET=<same 64-char hex as Aliyun>

# Partner ledger must also be explicitly enabled before partner
# membership / recharge payment callbacks are accepted.
PARTNER_LEDGER_ENABLED=true
```

## Smoke after deploy

1. `curl https://hd-pay.orangebench.tech/healthz` → providers should
   show `wechat: ready` and `alipay: ready`.
2. From the Vultr workbench (`/plan`), with a zh-locale browser:
   - Click 微信支付 on the Basic card → QR popup appears with the
     correct ¥ amount + description.
   - Scan with WeChat → wallet shows the order → confirm.
   - SPA polls `payment.cnStatus` every 3s; within ~5s of the
     wallet round-trip, status flips to 'completed'.
   - Toast shows "基础版 支付成功", `users.plan` flips on Vultr.
3. Repeat for 支付宝 — different end-of-flow (new tab opens to Alipay
   gateway) but same internal-confirm bridge.
4. From `/partner`, create a partner membership order with 微信支付:
   - The create response should contain a real wallet QR `codeUrl`,
     not a `partner-payment://` local placeholder.
   - Gateway logs should show `purchase.kind=partner_membership`
     with `outTradeNo` equal to the partner order external id.
   - After payment, Vultr should receive
     `/api/internal/partner-payment/confirm`, and
     `partner_recharge_orders.status` should move to `completed`.
5. Repeat a partner recharge order after KYC passes; the callback
   should create the partner lot and leave the original `payments`
   table untouched.

## Troubleshooting

- **`/healthz` shows `wechat: missing one or more credentials/cert paths`**
  — env vars or cert files not readable. Check paths + perms (cert
  files must be readable by the user pm2 runs as).
- **WX notify returns 401 verification failed** — almost always a
  middleware ordering issue stripping the raw body. The express.text
  middleware on `/payment/wechat/notify` is mandatory; do not move
  the json parser above it.
- **Alipay notify returns 'fail' loop** — verify `ALIPAY_PUBLIC_KEY`
  is the **Alipay** public key (downloaded from their console), NOT
  the application's public key.
- **Vultr internal-confirm returns 401** — `INTERNAL_SHARED_SECRET`
  values diverge. Compare both `.env` files exactly; trailing
  whitespace counts.
- **payments table doesn't get a row even after the gateway logs
  "verified"** — sync POST to Vultr is failing. Check Aliyun's pm2
  logs for `sync: Vultr rejected confirm` lines; the body field has
  the upstream error.
- **partner order still shows a `partner-payment://` URL** —
  Vultr is missing `CN_PAYMENT_URL` or `INTERNAL_SHARED_SECRET`, so
  the orchestrator is using the local development fallback instead of
  calling the gateway.
- **partner callback returns `partner_ledger_disabled`** —
  `PARTNER_LEDGER_ENABLED=true` is missing on Vultr. The cn-payment
  process will retry provider notifications while Vultr returns 5xx.
