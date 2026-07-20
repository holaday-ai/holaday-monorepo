# Phase 28 — Geo redirect for holaday.ai (mainland China → Aliyun mirror)

The premise: visitors from mainland China see HOLA DAY without a VPN
by being silently redirected from `holaday.ai` to the Aliyun-hosted
mirror at `hd-app.orangebench.tech`. Other regions hit `holaday.ai`
as usual.

This directory holds the Cloudflare Worker that implements the
redirect, plus the wrangler config and the BOSS-owned setup steps
(things that can't be done from the script).

## Architecture

```
Visitor (anywhere)
       │  GET https://holaday.ai/...
       ▼
Cloudflare edge ── runs worker.js ──┐
                                    │
   country=CN  ──→  302 → https://hd-app.orangebench.tech/...
   country=*   ──→  fetch(request) → Vultr origin (current behaviour)
```

`hd-app.orangebench.tech` is the Aliyun edge (`ops/aliyun-edge/`) —
NOT behind this Worker. There's no redirect loop because the Worker
only runs on the `holaday.ai` zone, and the China mirror serves
content directly from Aliyun → Vultr without ever calling holaday.ai.

## Discovery — current state of holaday.ai (verified 2026-05-18)

- DNS at GoDaddy: `ns23.domaincontrol.com / ns24.domaincontrol.com`.
- A record → Vultr `207.148.70.106` directly.
- Response headers show plain `nginx` — no Cloudflare in front today.

**Implication**: the Worker can't run until holaday.ai's nameservers
are switched to Cloudflare. Steps below.

## Alternative path — nginx + GeoIP2 on Vultr

The Vultr nginx already has `--add-dynamic-module=http-geoip2`
compiled in. If migrating DNS to Cloudflare is undesirable, the
geo redirect can run on Vultr instead:

1. Install the MaxMind GeoLite2-Country database (`/etc/nginx/geoip2/GeoLite2-Country.mmdb`).
2. In `nginx.conf` `http {}` block: `geoip2 /etc/nginx/geoip2/GeoLite2-Country.mmdb { auto_reload 60m; $geoip2_country_iso_code default=XX country iso_code; }`.
3. In the `server { listen 443; server_name holaday.ai; }` block, prepend `if ($geoip2_country_iso_code = "CN") { return 302 https://hd-app.orangebench.tech$request_uri; }`.

Trade-offs vs Cloudflare Workers:

|                          | Cloudflare Worker      | nginx + GeoIP2          |
|--------------------------|------------------------|-------------------------|
| Where the redirect runs  | CF edge, near visitor  | Vultr Singapore (origin)|
| Geo lookup source        | CF-IPCountry (built-in)| MaxMind GeoLite2 (DB)   |
| Latency to redirect      | ~10ms (no origin hit)  | ~SG round-trip          |
| Setup                    | NS change to CF        | DB download + cron      |
| Cost                     | Free (under 100k/day)  | Free (DB is free tier)  |
| Visible to CF analytics  | Yes                    | No                      |
| China-friendly           | Yes (CF reachable from CN for HTTPS) | Yes (already serving CN VPN traffic) |

The Cloudflare path is what the spec asked for and is the closer fit
to "edge redirect"; nginx is the fallback if BOSS doesn't want to
touch DNS.

## One-time setup BOSS owns (Cloudflare path)

These can't be automated — they require Cloudflare-account- and
GoDaddy-account-level access.

1. **Get / pick a Cloudflare account.** Free tier is fine. If you
   already have an account that owns other domains, use that.

2. **Add the `holaday.ai` zone in Cloudflare.**
   - Dashboard → "Add a site" → enter `holaday.ai` → pick Free plan.
   - Cloudflare will scan existing DNS records (A, MX, etc.) and
     import them. Verify the `holaday.ai` and `www.holaday.ai` A
     records point at `207.148.70.106`. Add anything CF missed
     (Aliyun's `hd-app.orangebench.tech` is on a DIFFERENT zone —
     not this one — so it's fine if not listed).
   - Cloudflare gives you two nameserver hostnames like
     `arya.ns.cloudflare.com / connor.ns.cloudflare.com`.

3. **Change nameservers at GoDaddy.**
   - GoDaddy → My Products → holaday.ai → DNS → Nameservers → "I'll
     use my own nameservers".
   - Paste the two CF nameservers from step 2.
   - Save. Propagation takes anywhere from 5 minutes to 48 hours.
     Verify with `dig +short NS holaday.ai` — should return
     `*.ns.cloudflare.com`.

4. **Make sure CF proxying is ON.**
   - In CF Dashboard → DNS, the orange cloud icon next to
     `holaday.ai` and `www.holaday.ai` A records should be ENABLED
     (proxied). Without it the Worker doesn't run.

5. **Provide a CF API token (optional, for automated deploy).**
   - CF Dashboard → My Profile → API Tokens → "Create Token" → use
     the "Edit Cloudflare Workers" template.
   - Account = your account; Zone = `holaday.ai` (or "all zones"
     if you don't want to update later).
   - Copy the token. Provide via secure channel.

   *Or*: skip the token and deploy manually via the CF dashboard
   (step 7 alternative below).

## Deploying the Worker

### With wrangler (preferred — automated)

```bash
cd ops/cloudflare-geo-redirect
npx wrangler login            # one-time, opens browser
npx wrangler deploy           # reads wrangler.toml + worker.js
```

`wrangler deploy` reads `wrangler.toml`, uploads `worker.js`,
binds the two routes (`holaday.ai/*` and `www.holaday.ai/*`).

### Without wrangler (CF dashboard)

1. Workers & Pages → Create application → Create Worker.
2. Name: `holaday-geo-redirect`.
3. Paste the contents of `worker.js` into the editor.
4. Save & Deploy.
5. Workers & Pages → your Worker → Triggers → Add custom domain or
   Add route → paste `holaday.ai/*` and `www.holaday.ai/*` (one
   per route entry).

## Testing

The Worker's geo logic depends on `request.cf.country`, which CF
populates from the visitor's IP. Local curl can't fake that
directly, but CF Preview supports overrides:

```bash
# From the Worker editor: "Preview" tab → "HTTP" → set the
# `cf.country` field to "CN" → hit Send. Expect 302 with
# Location: https://hd-app.orangebench.tech/.

# From a real client in China:
curl -i https://holaday.ai/
# Expected: HTTP/2 302 / location: https://hd-app.orangebench.tech/
```

The `X-Geo-Redirect` response header surfaces the country code that
triggered the redirect — useful for debugging from a browser's
DevTools Network tab.

## Pass-through paths (NOT redirected for CN visitors)

The Worker's `PASS_THROUGH_PREFIXES` list keeps these on origin:

- `/api/*` — orchestrator HTTP (tRPC, REST, webhooks)
- `/trpc/*` — alias for tRPC
- `/ws`, `/screencast-ws`, `/vnc-ws` — WebSockets
- `/static/`, `/assets/` — bundled SPA assets (the SPA's script src
  must resolve deterministically)
- `/_workers` — reserved for future inner Worker calls
- `/healthz`, `/robots.txt`, `/sitemap.xml`, `/favicon.ico` —
  monitor / crawler surfaces

If you add new API or static paths, add them to that array.

## Loop prevention

`hd-app.orangebench.tech` is on a different zone (`orangebench.tech`,
not `holaday.ai`). The Worker only binds to `holaday.ai/*` and
`www.holaday.ai/*`, so the redirect target is never re-evaluated by
this Worker. No loop possible.
