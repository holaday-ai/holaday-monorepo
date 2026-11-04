# OrangeBench MCP local client plan

User approved 2026-11-03: isolated HOLA DAY local worktree only, MCP loader + five-tool whitelist + trusted confirmation handoff with fixtures. No deploy, existing service start/restart, real provider/model/email/payment call, real credentials or HOLA database. Source checkout remains untouched except Git worktree metadata. Base is inspected local client940f4b998a0e; remote default is an older independent snapshot and is not a release target.

Spec: OrangeBench docs/agents/task4-holaday-acceptance.md and docs/api/v1.md at execution candidate486505b. Existing OrangeBench PR7 remains draft; production has PR6 only. The repository-wide OrangeBench prohibition on HOLA files has a user-approved exception for this isolated client.

Architecture: explicit optional per-task OrangeBench client in the existing supercar loop. No service/env auto-wiring, public ports or generic arbitrary MCP connections. Official TypeScript SDK1.32.2 pinned, stdio only, paired with the existing Python SDK2 server by actual protocol tests. Five names are permitted only for hybrid tasks with an enabled ready connection. Default registry behaviour and banned tools remain unchanged.

The host owns approval: quote returns free preview; execute must match a locally captured quote and a trusted callback response bound to task/account/key/project/capability/quote/amount/expiry. Model fields cannot supply an approval receipt. Persist only quote/approval/intent/task metadata to an explicitly configured private task journal (no API secret, script or provider details), atomic writes and process ownership/locking. A stable derived idempotency key survives response loss and restart; never retry automatically. Revocation fails closed. No sampling, roots, elicitation or arbitrary resource/URL access is exposed.

Files:
- src/agent/orangebench/contracts.ts: exact names, safe public types, validation/error contract.
- src/agent/orangebench/stdio.ts: explicit pinned local process, minimal environment, bounded/redacted diagnostics, lifecycle/timeout.
- src/agent/orangebench/journal.ts: private immutable intent metadata and atomic persistence.
- src/agent/orangebench/client.ts: typed tools/resources, quote/host-confirm/execute/cancel boundary and stable replay.
- src/agent/tool-registry.ts: opt-in five-name capability; no default expansion.
- src/agent/supercar/agent-loop.ts: optional tools and guarded dispatch with cancellation + trusted host approval callback.
- matching tests: failing registry, confirmation/no-call, durable replay, unknown/revoke, and real SDK→Python stdio→actual fixture API/DB. Run real HOLA loop with model/browser substitutes; no runtime service.

Execution (single lane; at most2threads; logs in OrangeBench ignored logs):
1. Install isolated existing dependencies with scripts disabled; baseline registry/loop tests.
2. Add failing scoped whitelist/client confirmation tests, observe RED, implement minimum.
3. Pin SDK and update only local package/lock; add strict loader/private journal tests and actual stdio integration.
4. Add optional actual-loop injection; fake model calls quote/execute and trusted host approval; ensure unavailable/cancelled/forged/expired/cross-task/revoked requests do not dispatch.
5. Serial targeted regressions, typecheck/build appropriate to touched paths; independent security review; fix Important findings and rerun meaningful checks.
6. Local commit only; no HOLA push/PR/deploy unless separately authorized. Record exact base/head/diff and fixture acceptance in OrangeBench report and update PR7 integration status truthfully. Do not call fixture acceptance real-user or paid-generation acceptance.
