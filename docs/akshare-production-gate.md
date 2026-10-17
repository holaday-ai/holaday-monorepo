# AkShare production gate

The stock HTTP process was left stopped by the explicitly authorized October 5 emergency `pm2 stop all`. Starting only the backend later did not restore this separate process. This change adds a read-only dependency check; it does not start, restart, or reconfigure any process.

`deploy-orchestrator.sh` streams the reviewed gate over SSH before the release probe, so an older serving release does not omit the entry check. The maintenance host also checks during preflight and each readiness check before opening traffic. The root PM2 manager must already exist; exactly one `akshare-mcp-http` must be online with a valid PID. Loopback `http://127.0.0.1:8848/health` must return HTTP 200, `status=ok`, and `adapter_ready=true`. A second PM2 read must have the same PID and restart count. Each read has a finite timeout. Failures return stable categories without PM2 environment values or raw provider errors.

The application capability self-check adds `infra.akshare` with the same loopback health semantics. It does not query the root PM2 manager from the application UID. Its result is liveness, not proof of fresh quotes, trading-calendar coverage, successful seven-dimensional reports, or safe investment conclusions. Those remain separate acceptance checks.

An outage fails the deployment gate before releasing the serving runtime, or keeps the candidate closed if discovered during readiness. The operator must inspect the original process configuration and obtain scoped operational authorization before restoring it. No automatic `pm2 stop all`, restart, environment update, or generic rollback is introduced. Frontend-only deployment remains frontend-only.

Run `node --test --test-concurrency=1 scripts/akshare-production-gate.test.mjs scripts/browser-maintenance-host.test.mjs scripts/deploy-browser-maintenance.test.mjs` and the orchestrator self-check unit tests. The gate tests are also included in `pnpm test:ops`. This patch has not been deployed.
