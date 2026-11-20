# PR3 implementation plan (prepared during PR2 verification; start after PR2 delivery)
Base: rebased codex/user-chrome-routing-v2; branch codex/session-vault-v1.
No production changes, credentials, SSH, deployments, real accounts, or parallel agents.

1. Contract + cryptography: strict exact-origin grants, distinct purposes, consent record, one-use import, 7-day imported-session bound; AES-256-GCM envelopes with context-bound wrap/unwrap KeyProvider. Test-only ephemeral provider, injectable cloud KMS adapter, startup fail-closed when enabled without production provider. No credentials in outputs.
2. Durable store + lifecycle: dedicated per-user DB state with locked transaction and CAS revision, ciphertext-only blobs; bounded grants/snapshots; tombstones, single writer lease, expiry, revoke, clear and account closure. Test in-memory adapter mirrors serialization; database adapter checks active user and row lock. No generic model API exposes plaintext.
3. Worker: isolated task context loaded from filtered state in memory (no storage-state file/userDataDir sharing), exact origin/network gate, read-only login validation, active context closure, post-close encrypted snapshot with CAS. Profile idle 7 days, absolute 30 days, grant-bound. Unsupported partition/IndexedDB fails closed instead of losing semantics.
4. HTTP + extension + UI: authenticated metadata APIs, explicit site/retention/disclosure consent, selected connection/tab import command, values direct HTTPS to vault, only count/status ACK over WS; permanently retire legacy auto-sync/HTTP ingress and default injection, remove plaintext fallback regardless of flags. Settings shows expiry/status/last-use and revoke/clear; explicit return-to-Chrome on risk.
5. Migration/governance: additive schema and safe migration runbook; no production migration executed. Unscoped legacy rows are purged at explicit new consent rather than silently turned into site grants; existing encryption helper verifies no plaintext dual-write. Register ownership/closure/retention metadata.
6. Synthetic acceptance + review: grant/import/seal/read-only login/revoke+expiry/next task denial, cross-user, tamper/context mismatch, one-use, concurrent CAS/logout wins, off/startup guards; extension and settings integration tests; typechecks/builds and relevant regression serial with file logs. Report and draft PR only.

## Execution ledger

- Base confirmed: 8efe0f8f23a3273ccc1390a86256ec4981b98789; isolated worktree, one agent.
- Core RED: vault module missing, recorded vault-red.log. GREEN: 9 lifecycle/crypto/config cases.
- Worker RED: missing module; initial fixture used a login URL and unissued verification state, corrected to account-check and actual one-use import. GREEN: 2 Chromium synthetic workflows; lifecycle + worker 11 passed.
- Runtime RED/GREEN: three tests for off/default, missing provider, test-only injection.
- HTTP + extension + settings: wrote failing contracts before implementation; metadata-only responses and selected-origin refusal are explicit gates.
- Ruling: initial candidate supports one active site per cloud task; multiple connected grants fail closed pending explicit task-site selection. No arbitrary guess between accounts/sites.
- Ruling: partition metadata is preserved and validated at import; the cloud worker rejects partitioned state rather than silently changing its semantics. IndexedDB is rejected/not collected. These capabilities need a dedicated follow-up adapter.
- Ruling: profile state travels in memory into isolated incognito contexts; no plaintext storageState file or shared active userDataDir. Existing browser pool owns physical resource cleanup.
- Ruling: no production provider or site verifier is wired in this PR. Flags remain off; enabling without a provider rejects startup. Only trusted explicit probe adapters can declare a site connected; a 200 response is insufficient.
- Ruling: legacy unscoped queues cannot be assigned a site grant retroactively. Explicit new consent/revoke/clear purges that owner's old queue. No production migration or deletion is executed by this task.
- Final verification is recorded in /private/tmp/holaday-tasks/browser-pr3/report.md with exact frozen source hashes and per-command logs.

- Review correction: old automatic cookie synchronization, legacy HTTP ingress, default pool injection, plaintext dual-write and plaintext read fallback are retired even with both new flags off. Rollback cannot restore them.
- Key rotation: authenticated DEK rewrapping helper changes wrapping provider/version without returning plaintext or rewriting ciphertext; production rotation job remains operator-managed and is not run here.

- Final privacy review adds Cookie-store binding to the selected tab, rejects credential redirects, and suppresses payload-bearing parser errors. A packaged-extension synthetic E2E exercises the actual import command, HTTP vault, isolated cloud browser, reuse, revoke and expiry.
- PR target follows the original batch plan: claude/capability-recovery. PR3 includes the unmerged #250 dependency and documents it explicitly; implementation commits start at rebased #250 head 8efe0f8f.

- Synthetic extension harness: QA deliberately strips cookies permission. The test restores only that existing production permission in its disposable loopback-only manifest; production and ordinary QA manifests are unchanged. No real browser profile is used.
