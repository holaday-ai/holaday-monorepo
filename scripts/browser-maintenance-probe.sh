#!/bin/bash
# Read-only capability discovery: no upload, provisioning, restart or migration.
set -euo pipefail
exec runuser -u holaday -- /opt/node22/bin/node --input-type=module -e '
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
try {
  const state = JSON.parse(readFileSync("/var/lib/holaday/ordinary-maintenance/state.json", "utf8"));
  const sha = state.candidate;
  if (!/^[a-f0-9]{40}$/.test(sha ?? "")) process.exit(1);
  const root = "/opt/holaday-releases/" + sha;
  const result = spawnSync("/opt/node22/bin/node", ["--import", "tsx", root + "/scripts/browser-maintenance-control.mjs", "status"],
    { cwd: root + "/apps/orchestrator", encoding: "utf8", timeout: 10000, maxBuffer: 16384 });
  if (result.status !== 0) process.exit(1);
  process.stdout.write(result.stdout);
} catch { process.exit(1); }
'
