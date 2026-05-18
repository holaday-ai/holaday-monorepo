# Vultr nginx — holaday.ai snapshot

`holaday.conf` is the live nginx config from
`/etc/nginx/sites-available/holaday` on Vultr (207.148.70.106).
Kept in source so a server rebuild (re-provision, migration to a
new box, disaster recovery) can recover it without reverse-
engineering from prod.

## What it serves

```
holaday.ai / www.holaday.ai
  /                       → /opt/holaday-landing (marketing landing)
  /terms /privacy /robots.txt /sitemap.xml /og-image.png /favicon.svg
  /landing-assets/*       → /opt/holaday-landing/landing-assets
  /assets/*               → SPA hashed bundles (cached 1y immutable)
  /api/*  /trpc/*         → 127.0.0.1:4001 (orchestrator HTTP)
  /ws  /screencast-ws/*   → 127.0.0.1:4002 (orchestrator WebSocket)
  /vnc-ws/*  /vnc/*       → 127.0.0.1:6080 (noVNC proxy)
  /healthz                → 127.0.0.1:4001/healthz
  /index.html             → no-cache, no-store, must-revalidate
  /everything else        → SPA fallback (no-cache index.html)
```

## Re-deploying

`scripts/deploy-spa.sh` writes the SPA bundle into
`/opt/holaday-monorepo/apps/web-workbench/dist/` directly; nginx
doesn't need to know — `root` already points there. So routine SPA
deploys never touch this file.

For nginx config changes:

```bash
SSHPASS='...' sshpass -e scp -o StrictHostKeyChecking=no \
  ops/vultr-nginx/holaday.conf \
  root@207.148.70.106:/etc/nginx/sites-available/holaday

SSHPASS='...' sshpass -e ssh -o StrictHostKeyChecking=no root@207.148.70.106 \
  'nginx -t && nginx -s reload'
```

Always `nginx -t` before reload; the validate-then-reload pattern is
what keeps the site up when a comma's in the wrong place.

## History

- 2026-05-18 — initial snapshot. Includes the no-cache headers on
  `index.html` + SPA fallback (added in the same session), plus the
  immutable `/assets/` rule.
