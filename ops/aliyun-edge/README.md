# Aliyun edge — China-accessible entry for HOLA DAY

The premise of HOLA DAY is "user in China hits OUR domain (no VPN
needed); our Singapore Brave does the dirty work of reaching Google /
YouTube / Twitter for them." That premise breaks if `holaday.ai`
itself is unreachable from China. The Aliyun edge fixes that.

## Architecture

```
[user in China, no VPN]
        │  HTTPS / WSS
        ▼
hd-app.orangebench.tech  ──→  Aliyun (47.99.169.186, China-accessible)
                                  │
                                  ├─ /        →  /opt/holaday-spa/dist (SPA static)
                                  ├─ /api/*   →  http://207.148.70.106:4001  (Vultr orchestrator HTTP)
                                  └─ /ws      →  ws://207.148.70.106:4002    (Vultr orchestrator WS)
```

Aliyun → Vultr egress is open from China (outbound TCP to Singapore
isn't blocked even when inbound holaday.ai is). The SPA's tRPC + WS
clients are origin-relative, so the same hostname serves all three
slots — no CORS, no env switching at runtime.

## One-time setup BOSS owns

These can't be automated from the script — they're account- /
DNS- / Google-Console-level changes.

### 1. DNS

Point `hd-app.orangebench.tech` at Aliyun:

```
A   hd-app   47.99.169.186   TTL 600
```

Wait for propagation (`dig hd-app.orangebench.tech`).

### 2. Google OAuth allowed redirect URI

Google Cloud Console → APIs & Services → Credentials → the OAuth 2.0
Client ID HOLA DAY uses (per `apps/orchestrator/.env`'s
`GOOGLE_CLIENT_ID`).

Under **Authorized redirect URIs**, add:

```
https://hd-app.orangebench.tech/api/auth/google/callback
```

(Don't remove the existing `holaday.ai` entry — both should work.)

### 3. nothing else

- TLS cert: certbot (script will run it once cert files don't exist)
- nginx: same instance that already serves `hd-pay.orangebench.tech`
- Vultr orchestrator: NO change. Its HTTP port 4001 + WS port 4002
  are already exposed; Aliyun reaches them by IP.

## Deploy

From the monorepo root:

```bash
# 1. Build the SPA
pnpm --filter @holaday/web-workbench build

# 2. Push to Aliyun (uploads SPA + nginx vhost, doesn't reload yet)
export SSHPASS='<aliyun root password — see boss notes>'
./ops/aliyun-edge/deploy.sh

# 3. SSH into Aliyun and finish certificate + reload
ssh root@47.99.169.186
certbot --nginx -d hd-app.orangebench.tech \
  --redirect --non-interactive --agree-tos -m ops@orangebench.tech
nginx -t && nginx -s reload
```

## Verify

From a China network without VPN:

1. `curl -I https://hd-app.orangebench.tech/` → 200
2. `curl https://hd-app.orangebench.tech/api/healthz` → orchestrator health JSON
3. Browser → `https://hd-app.orangebench.tech/` → SPA loads
4. Sign in (email/code or Google) → submit "打开 Google" task → completes

If step 1 fails: DNS not propagated yet, or Aliyun ECS security group
blocks 443. If step 2 fails: nginx vhost mis-installed, or
Aliyun→Vultr egress is throttled (rare). If step 3 fails: SPA build
not extracted to /opt/holaday-spa/dist.

## Coexistence

The Aliyun box already runs `hd-pay.orangebench.tech` (Phase 11
cn-payment). The new vhost has a distinct `server_name`, so nginx
serves both side-by-side. No port collisions: cn-payment is bound
to 4010 internally; nginx fans out by hostname.

`holaday.ai` (Vultr) keeps working unchanged. Outside-China users
can use either entry. We don't take down the original.

## Rollback

```bash
ssh root@47.99.169.186
rm /etc/nginx/sites-enabled/hd-app.orangebench.tech
nginx -t && nginx -s reload
```

DNS record stays (just stops resolving to a serving vhost — 502 from
nginx default). To fully remove, drop the A record at the registrar.

## Open questions / follow-ups

1. **Aliyun→Vultr latency**: extra hop adds ~50ms RTT vs direct.
   Acceptable for tasks (10-second granularity); painful for WS
   heartbeats only at the edge case.
2. **CDN for static SPA**: if even Aliyun ECS becomes a hotspot,
   move the dist/ to Aliyun OSS + CDN. Out of scope for v1.
3. **SPA rebuild + redeploy on every backend change**: only when the
   SPA itself changes (UI, types). Backend-only changes don't need
   the SPA touched.
