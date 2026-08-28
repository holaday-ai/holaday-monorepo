import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HEALTH_ENDPOINTS = [
  'https://holaday.ai/api/healthz',
  'https://hd-app.orangebench.tech/api/healthz',
];

function blocked(message) {
  throw new Error(`production enablement blocked: ${message}`);
}

function csv(value) {
  return new Set(
    String(value ?? '')
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
  );
}

async function defaultSchemaVerification() {
  const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const result = spawnSync('pnpm', ['--filter', '@holaday/orchestrator', 'db:verify'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  return result.status === 0;
}

export async function verifyVideoEditingProduction(
  env = process.env,
  { fetchImpl = globalThis.fetch, verifySchema = defaultSchemaVerification } = {},
) {
  if (env.VIDEO_EDITING_ENABLED !== 'true') {
    return { status: 'production_disabled_pending_commercial_license' };
  }

  if (env.VIDEO_EDITING_PROVIDER !== 'cesdk') blocked('provider contract is invalid');
  const license = String(env.CESDK_LICENSE ?? '').trim();
  if (!license) blocked('commercial license is missing');
  if (!String(env.VIDEO_EDITING_ALLOWLIST ?? '').trim()) blocked('canary allowlist is empty');

  const stagingHostname = String(env.VIDEO_EDITING_STAGING_HOSTNAME ?? '')
    .trim()
    .toLowerCase();
  if (!stagingHostname) blocked('staging hostname is missing');
  const licensedHostnames = csv(env.CESDK_LICENSED_HOSTNAMES);
  const requiredHostnames = ['holaday.ai', 'hd-app.orangebench.tech', stagingHostname];
  if (requiredHostnames.some((hostname) => !licensedHostnames.has(hostname))) {
    blocked('licensed hostname scope is incomplete');
  }

  if (!(await verifySchema())) blocked('schema 0051/0052 is not verified');
  for (const endpoint of HEALTH_ENDPOINTS) {
    let response;
    try {
      response = await fetchImpl(endpoint, { headers: { Accept: 'application/json' } });
    } catch {
      blocked('health check failed');
    }
    if (!response?.ok) blocked('health check failed');
    let payload;
    try {
      payload = await response.json();
    } catch {
      blocked('health check failed');
    }
    if (payload?.status !== 'ok') blocked('health check failed');
  }

  return {
    status: 'ready_for_allowlisted_canary',
    provider: 'cesdk',
    licenseConfigured: true,
    licenseLength: license.length,
    schema: '0051+0052',
    health: 'ok',
  };
}

const isDirectRun = process.argv[1]
  ? import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
  : false;

if (isDirectRun) {
  try {
    const result = await verifyVideoEditingProduction();
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'production enablement blocked';
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
