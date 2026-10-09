import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
/** Read-only stock-service gate. Never starts PM2 or returns environment fields. */
function processIdentity(text) {
  let rows;
  try { rows = JSON.parse(text); } catch { throw new Error('AKSHARE_PROCESS_UNAVAILABLE'); }
  if (!Array.isArray(rows)) throw new Error('AKSHARE_PROCESS_UNAVAILABLE');
  const matches = rows.filter((p) => p?.name === 'akshare-mcp-http');
  const p = matches[0];
  if (matches.length !== 1 || p?.pm2_env?.status !== 'online' ||
      !Number.isSafeInteger(p.pid) || p.pid <= 0 ||
      !Number.isSafeInteger(p.pm2_env.restart_time) || p.pm2_env.restart_time < 0)
    throw new Error('AKSHARE_PROCESS_UNAVAILABLE');
  return { pid: p.pid, restarts: p.pm2_env.restart_time };
}
export async function verifyAkshareProduction({ readProcessList, readHealth }) {
  let before, after;
  try { before = processIdentity(await readProcessList()); }
  catch { throw new Error('AKSHARE_PROCESS_UNAVAILABLE'); }
  try {
    const body = JSON.parse(await readHealth());
    if (body?.status !== 'ok' || body?.adapter_ready !== true) throw new Error();
  } catch { throw new Error('AKSHARE_HEALTH_UNAVAILABLE'); }
  try { after = processIdentity(await readProcessList()); }
  catch { throw new Error('AKSHARE_PROCESS_CHANGED'); }
  if (before.pid !== after.pid || before.restarts !== after.restarts)
    throw new Error('AKSHARE_PROCESS_CHANGED');
  return { ok: true, ...after };
}
/** Runs against the root PM2 manager; fixed loopback URL, finite reads, no redirects. */
export async function checkHostAkshare(exec) {
  const options = { timeout: 6000, maxBuffer: 4 * 1024 * 1024,
    env: { PATH: '/opt/node22/bin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
      HOME: '/root', PM2_HOME: '/root/.pm2' } };
  try {
    await exec('bash', ['-c', 'read -r p < /root/.pm2/pm2.pid && [[ "$p" =~ ^[1-9][0-9]*$ ]] && kill -0 "$p"'], options);
  } catch { throw new Error('AKSHARE_PROCESS_UNAVAILABLE'); }
  return verifyAkshareProduction({
    readProcessList: () => exec('pm2', ['jlist'], options),
    readHealth: async () => {
      const raw = await exec('curl', ['--fail', '--silent', '--max-time', '5',
        '--noproxy', '*', '--write-out', '\n%{http_code}', 'http://127.0.0.1:8848/health'], options);
      const boundary = raw.lastIndexOf('\n');
      if (raw.slice(boundary + 1) !== '200') throw new Error('AKSHARE_HEALTH_UNAVAILABLE');
      return raw.slice(0, boundary);
    },
  });
}

// May be streamed over SSH before any deployed copy of this module exists.
if (process.argv[2] === '--verify-akshare') {
  try {
    if (process.getuid?.() !== 0) throw new Error('AKSHARE_PROCESS_UNAVAILABLE');
    const run = promisify(execFile);
    await checkHostAkshare(async (command, args, options) => (await run(command, args,
      {...options, encoding:'utf8'})).stdout);
    console.log('AKSHARE_GATE_PASSED');
  } catch (error) {
    console.error(/^AKSHARE_[A-Z_]+$/.test(error?.message) ? error.message : 'AKSHARE_GATE_FAILED');
    process.exitCode = 1;
  }
}
