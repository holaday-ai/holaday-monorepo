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
                                  ├─ /                 → local landing / SPA
                                  ├─ /api/*            → Vultr TLS origin directly
                                  └─ all WebSockets    → Vultr TLS origin directly
```

The API and WebSocket channels bypass Cloudflare so redirects cannot
interrupt upgrades or rewrite the browser-facing OAuth host. Aliyun
connects to the Vultr IP over TLS, verifies the `holaday.ai`
certificate through SNI, and preserves `Host: hd-app.orangebench.tech`
for API/OAuth requests. The SPA's clients remain origin-relative, so
there is no CORS or runtime environment switch.

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

- TLS cert: provision once with certbot; later deploys validate and
  reload nginx automatically
- nginx: same instance that already serves `hd-pay.orangebench.tech`
- Vultr orchestrator: no change. Aliyun reaches its nginx TLS origin
  on port 443; internal Orchestrator ports remain private.

## Deploy

From the monorepo root:

```bash
# 1. First deployment only: provision the certificate before installing
#    the TLS vhost. The port-80 ACME webroot may be served by the existing
#    default vhost while DNS points at this host.
ssh root@47.99.169.186
mkdir -p /var/www/certbot
certbot certonly --webroot -w /var/www/certbot \
  -d hd-app.orangebench.tech \
  --non-interactive --agree-tos -m ops@orangebench.tech
exit

# 2. Build the SPA
pnpm --filter @holaday/web-workbench build

# 3. Push to Aliyun (uploads SPA, landing site, and nginx vhost)
export SSHPASS='<aliyun root password — see boss notes>'
./ops/aliyun-edge/deploy.sh
```

Every release is extracted under `/opt/holaday-edge/releases/`. The
installer validates the certificate before active changes, takes an
exclusive deployment lock, switches the `current` symlink atomically,
and restores the previous web/config links if `nginx -t` or reload fails.
Recovery backups are retained under `/opt/holaday-edge/backups/`.

## Verify

From a China network without VPN:

1. `curl -I https://hd-app.orangebench.tech/` → 200
2. `curl https://hd-app.orangebench.tech/api/healthz` → orchestrator health JSON
3. WebSocket probe for `/screencast-ws/*` → Orchestrator auth response, never 302
4. Browser → `https://hd-app.orangebench.tech/` → SPA loads
5. Sign in (email/code or Google) → submit "打开 Google" task → completes

If step 1 fails: DNS not propagated yet, or Aliyun ECS security group
blocks 443. If step 2 fails: nginx vhost mis-installed, or
Aliyun→Vultr egress is throttled (rare). If step 3 fails: SPA build
not extracted to `/opt/holaday-edge/current/apps/web-workbench/dist`.

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
ls -1 /opt/holaday-edge/backups
FAILED_RELEASE='<release-id-to-undo>'
bash "/opt/holaday-edge/releases/$FAILED_RELEASE/ops/aliyun-edge/rollback-remote.sh" \
  hd-app.orangebench.tech "$FAILED_RELEASE"
```

This restores the previous static-release target and the exact prior
`sites-available` / `sites-enabled` state. It also handles the first
versioned deployment, where there was no prior `current` symlink. The
command refuses to roll back a release that is no longer active and
restores the failed release if the old Nginx configuration cannot be
validated or reloaded.

## Open questions / follow-ups

1. **Aliyun→Vultr latency**: extra hop adds ~50ms RTT vs direct.
   Acceptable for tasks (10-second granularity); painful for WS
   heartbeats only at the edge case.
2. **CDN for static SPA**: if even Aliyun ECS becomes a hotspot,
   move the dist/ to Aliyun OSS + CDN. Out of scope for v1.
3. **SPA rebuild + redeploy on every backend change**: only when the
   SPA itself changes (UI, types). Backend-only changes don't need
   the SPA touched.
