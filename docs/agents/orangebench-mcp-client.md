# OrangeBench local client acceptance

2026-11-03/04 local run. User authorization is limited to this isolated HOLA DAY client checkout. No HOLA service/deploy/config/port/database was started or changed; no HOLA remote push is authorized or performed. Base:940f4b998a0ec346f2f9b4baac7bc104f2414bd0. Source checkout and its unrelated drafts stay intact.

## Implemented client surface

The explicit `loadOrangeBenchFromEnvironment` factory returns null unless `HOLA_ORANGEBENCH_MCP_ENABLED=true` is passed by the host. No existing production service entrypoint invokes it. Host supplies a dedicated OrangeBench account Key in `ORANGEBENCH_API_KEY`, a preinstalled trusted Python interpreter in `ORANGEBENCH_MCP_PYTHON`, the OrangeBench `integrations/mcp` package root in `ORANGEBENCH_MCP_ROOT`, and a private700 journal directory. Normal API URL is HTTPS orangebench.ai/api/v1. Never put a Key into command arguments, code, model messages, browser storage or logs. No real Key is needed by the fixture tests.

The pinned official Node SDK1.32.2 runs the Python MCP module by stdio, with fixed arguments, no shell, bounded buffers/timeouts, piped/discarded bounded stderr and a minimal environment. No sampling, roots or arbitrary generic MCP connection is advertised. HTTP loopback is allowed only by an explicit NODE_ENV=test fixture option. Invalid manifest, unsafe executable/module permissions or unknown tool names fail closed. SDK dependencies were installed in this checkout with lifecycle scripts disabled.

`RunSupercarOptions.orangebench` is an explicit task-bound client. Only an enabled ready connection for that task adds the exact five tools to the hybrid registry. Browser/search profiles, default behaviour and banned tools remain unchanged. Dispatch repeats the registry gate even for model-invented calls. Default-off path starts no process and offers no OrangeBench tools.

## Confirmation and recovery

The host provides `onOrangeBenchApproval`, outside model arguments. It receives account/Key/task/project/capability, source revision, quote ID/region/expiry, exact integer credit limit, rounded-up two-decimal USD display, and quote effects including existing-content replacement. The immutable binding covers the captured quote and target. Returning the exact binding and limit is required; missing, rejected, changed, expired, cross-task, cancelled or forged approval does not execute. Model `confirm:true` or an injected approval object cannot approve a request.

Journal files contain only task/quote/approval/intent/result IDs and safe metadata; no script, prompt, provider credential or API secret. Directory700, files600, owner checks, no symlink reads, bounded strict schema, atomic replace and file+directory fsync. Heartbeat lock uses one fixed10second stale policy. Live contenders fail client_busy. Expired crashed leases can be recovered; lease compromise aborts and fails closed. Never manually delete a live lock or use different lease policies on the same journal.

The exact request intent is synced before every execution/replay. Effective idempotency is derived by the host; changing a model-invented key cannot create a new paid task. Unknown transport results preserve the approved intent, never automatically retry, and can be explicitly resumed with the same key after reconnect. Known task IDs are returned without a second execution. Every dispatch rechecks the live Key before returning cached task metadata; revocation denies reconnect/read/mutation. Closing the client, direct loop abort, deadline or durable cancellation stops a pending confirmation; a synchronous cancellation callback failure is handled without crashing the orchestrator.

## Evidence and boundaries

- Baseline registry/loop115 tests passed before implementation.
- Final touched-area suite:779 passed,1 skipped (the explicit real-protocol fixture is skipped unless launched by the independent API harness).
- Full orchestrator TypeScript noEmit and production compile passed; they start no service.
- Actual HOLA supercar loop uses a model/browser substitute, then real Node SDK → real Python stdio MCP → actual OrangeBench FastAPI + isolated PostgreSQL25434. The fixture runs free project/quote, one trusted approval, confirmed execution, changed-model-key replay, cancel and revoked-Key reconnect. Assert one workflow, zero generation child jobs, no remaining hold, no Key in model messages.
- Exact-owned child SIGKILL fixture preserves a submitted intent; only that dead child's lease is aged in the fixture to exercise recovery immediately. Live lock contention and compromise, private permissions, unknown/restart, expiry/target/max checks and pending-confirmation cancellation are covered.
- Independent read-only review findings were reproduced RED and fixed: crashed lock recovery, directory fsync, pending/durable cancellation and close, unsafe synchronous callback throw. Reviewer did not run tests; final test receipts are the implementer's gate.

This is **isolated client fixture acceptance**, not live HOLA service/UI integration, paid model acceptance or a production release. A real UI must render the trusted callback view and return an authenticated human decision; it must never manufacture approval in the model or auto-approve. Real owner Key provisioning, production configuration/host wiring, merge/deploy and user acceptance remain outside this authorization.

Official sources checked: [SDK client/stdio guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/v1.x/docs/client.md), [SDK package1.32.2](https://www.npmjs.com/package/@modelcontextprotocol/sdk/v/1.32.2), [proper-lockfile design](https://github.com/moxystudio/node-proper-lockfile#design). The actual interop fixture, rather than assumptions about SDK major versions, is the compatibility evidence.
