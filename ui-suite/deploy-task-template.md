# SPA deployment task — required local UI acceptance

Before the candidate SPA is published:

1. Freeze the candidate commit and record `git rev-parse HEAD`. Use an isolated candidate checkout with Node 22, workspace dependencies and Playwright Chromium.
2. Run the repository's required unit/type/build checks serially.
3. Run `NODE_OPTIONS='--max-old-space-size=1536 --v8-pool-size=1' UV_THREADPOOL_SIZE=1 GOMAXPROCS=1 pnpm ui:audit` against the candidate's local build and seed backend.
4. Archive `ui-suite/report.{md,json}` and `ui-suite/artifacts/` with the deployment evidence. Check candidate SHA, source/build hash, expected/completed page count and final completion timestamp.
5. **Do not publish on exit 1, any P1, missing baseline, coverage gap or incomplete run.** Review P2 screenshot/text differences explicitly; baseline replacement requires review, not automatic acceptance.
6. After a separately authorized deployment, rerun this same candidate locally and attach the evidence to the deploy report. Record the deployed SPA digest independently; this local suite does not prove production traffic, authentication or deployed correctness.

Never point this harness at production, reuse real credentials, turn on payment/identity integrations, or perform a deployment as part of the audit itself. A future production smoke test needs its own authorization and evidence.
