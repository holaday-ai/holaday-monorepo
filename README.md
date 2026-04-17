# holaday-monorepo

HOLA DAY — Browser Agent monorepo (Phase 0).

Layout follows `docs/HOLADAY_ORCHESTRATOR_DESIGN.md`:

```
apps/
  orchestrator/   # Express 5 + tRPC + ws + Drizzle
  extension/      # Chrome MV3 + Playwright-CRX (W2+)
  web/            # Next.js management console  (W5)
packages/
  shared-types/   # WS protocol, ResilientSelector, canonical occupations
  browser-driver/ # HolaDayBrowserDriver + Playwright-CRX adapter (later)
  skill-sdk/      # Skill SDK (later)
skills/           # Phase 0 built-in skills
docs/             # design + daily reports
scripts/
```

## Quick start

```bash
pnpm install
docker compose up -d          # MySQL 8.4 / Redis 7.4 / MinIO
pnpm --filter @holaday/orchestrator dev
```

See `docs/` for design notes and daily reports.
