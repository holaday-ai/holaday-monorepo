# Production-read interaction audit

Implementation status: read-only audit harness with serial route traversal and focused form, breadcrumb, back-state and confirmation checks. Findings and unresolved coverage remain separate from release acceptance.

Run from `apps/web-workbench`. This is a staged audit, not a deployment command.
The audit never logs credentials, request headers/bodies, console text, OAuth URLs,
or storageState. Keep exported auth and screenshots outside Git in a private directory.

## Authentication handoff

Use a BOSS-exported Playwright storageState file from an already authorized Holaday
test-account sign-in. The account must have the permissions needed for admin routes.
Do not put a password/token into source, CLI arguments, the report, or chat.
If an export is not available, the user can run the following local login capture,
sign in through the normal UI, then close the recorder:

```sh
mkdir -p e2e/.auth
chmod 700 e2e/.auth
umask 077
pnpm exec playwright codegen --save-storage=e2e/.auth/storage-state.json https://holaday.ai/login
chmod 600 e2e/.auth/storage-state.json
```

Google can reject the automation capture browser. Do not weaken browser security or
retry that blocked OAuth flow. Use the site's supported password/email-code login,
or have the user export only the Holaday access-token entry from their already
signed-in normal Chrome session. Both production origins are supported. Never
print that entry or collect Google cookies. Move the downloaded export into
`e2e/.auth/storage-state.json`, chmod 600, and confirm Git ignores it.

Set `HOLADAY_AUDIT_RESUME=1` to continue only the routes recorded as completed in
that viewport's private JSON receipt. Do not reuse a receipt after changing the
build, account, or viewport. Preserve incomplete calibration receipts separately.

Set `HOLADAY_AUDIT_FOCUSED_RETRY=1` to rerun only focused rules not already
recorded as completed in `<viewport>-rules.json`. Main-route and focused-rule
receipts are separate; a completed traversal can still contain findings or gaps.

Read readiness uses a bounded API wait, then DOM stability, rather than global
`networkidle` or waiting for unrelated images. In observation mode, an API batch
that exceeds this wait becomes an explicit `not-verified` receipt and observation
continues on rendered UI. This is never a successful data/API acceptance check.
Dynamic-ID payloads are read after `requestfinished`, never in an early response
callback. Verification mode rejects unresolved data/readiness and coverage gaps.

The audit imports only the Holaday access-token localStorage entry into the loopback
preview context. It does not import unrelated cookies, Google credentials, or other
origins. Expired/missing login state fails before authenticated route acceptance.

## Serial execution

```sh
umask 022
export NODE_OPTIONS='--max-old-space-size=1536 --v8-pool-size=1'
export UV_THREADPOOL_SIZE=1 GOMAXPROCS=1 RAYON_NUM_THREADS=1
pnpm build > /private/tmp/holaday-ui-build.log 2>&1
HOLADAY_AUDIT_API_ORIGIN=https://holaday.ai pnpm preview:interaction-audit
```

In another terminal, with absolute paths to the private export/output:

```sh
HOLADAY_AUDIT_STORAGE_STATE=/absolute/private/storage-state.json \
HOLADAY_AUDIT_OUTPUT=/private/tmp/holaday-tasks/ui-audit \
HOLADAY_AUDIT_MODE=observe pnpm test:interaction-audit --project=desktop
# Then run iphone-14. Never run both in parallel.
```

`observe` captures all findings without asserting P0/P1 are zero. `verify` fails
on P0/P1, unresolved coverage gaps, or safety-intercepted requests. No auth export
means a blocked report and failed run, not a skipped/green audit.

Routes are derived from `src/App.tsx`, including aliases. Dynamic route objects
are discovered from allowed production read responses. If a real object is not
available, supply a JSON map via `HOLADAY_AUDIT_ROUTE_MAP` mapping route patterns
to real, existing relative routes. Never invent IDs or create production records.

## Safety and coverage

Only source-discovered tRPC `.query()` procedures and known file/health reads are
allowed. Production mutations, unknown API reads, external documents/scripts, and
WebSocket traffic fail closed. External images/fonts/styles may load over HTTPS
without Authorization. Final confirmation/immediate-save/paid buttons are excluded
before click; unknown controls need source review before entering the safe list.

Readiness waits for bounded tRPC reads and DOM stability, rather than unrelated
image/font requests. Already explained disabled controls are checked directly from
the rendered inventory without repeated page reloads.

Each page inventories all controls. Stable shared-sidebar controls are behavior-tested
once per viewport and checked for rendering on later pages; receipts name the original
route instead of claiming a repeat behavioral test. Page-specific controls are
independently replayed from their page; newly revealed menu/popup
controls are inventoried to a maximum depth of three. Deeper flows, forms requiring
unsafe final submission, dynamic records without read access, breadcrumb semantic
checks, and live stream occlusion are reported as gaps. **These are not accepted
as passing coverage.** Extend route-specific assertions after reviewing each flow.
The generic audit is deliberately insufficient to claim full release acceptance.

Run the safety/inventory tests independently of any login:

```sh
pnpm exec playwright test --config e2e/playwright.config.ts --project=desktop audit-safety.spec.ts
pnpm typecheck:interaction-audit
```

Reports and per-finding screenshots are private (600, directories 700). Screen
captures can contain account content; do not attach them to a public PR. Include
only a sanitized problem list and counts in the PR. Never merge or deploy from
this workflow.
