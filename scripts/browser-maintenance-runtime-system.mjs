/** Validate observed PM2 metadata and /proc identities before any mutation.
 * Read adapters must include all matching application/worker processes, not
 * only the one pid returned by PM2 (otherwise an orphan would be missed). */
export async function captureMaintenanceProcesses({ identity, root, rows, processes, listeners }) {
  const fail = () => {
    throw new Error('MAINTENANCE_RUNTIME_UNPROVEN');
  };
  if (
    !/^[a-f0-9]{40}$/.test(identity?.candidate ?? '') ||
    !/^[a-f0-9]{32}$/.test(identity?.bootId ?? '') ||
    root !== `/opt/holaday-releases/${identity.candidate}` ||
    !Array.isArray(rows) ||
    !Array.isArray(processes)
  )
    fail();
  function capture(name, command, optional = false) {
    const matches = rows.filter((row) => row?.name === name);
    const observed = processes.filter((p) => p?.command === command);
    if (optional && matches.length === 0 && observed.length === 0) return null;
    if (matches.length !== 1 || observed.length !== 1) fail();
    const row = matches[0],
      p = observed[0],
      env = row.pm2_env;
    if (
      !env ||
      env.status !== 'online' ||
      env.autorestart !== false ||
      env.watch ||
      env.max_memory_restart ||
      env.cron_restart ||
      env.pm_cwd !== `${root}/apps/orchestrator` ||
      env.HOLADAY_ORDINARY_MAINTENANCE !== '1' ||
      env.HOLADAY_ORDINARY_CANDIDATE !== identity.candidate ||
      !Number.isSafeInteger(p.pid) ||
      p.pid <= 1 ||
      row.pid !== p.pid ||
      p.uid !== 998 ||
      p.cwd !== env.pm_cwd ||
      !/^[0-9]+$/.test(p.start ?? '')
    )
      fail();
    return { ...p, autorestart: false };
  }
  const main = capture('holaday-orchestrator', 'main');
  const worker = capture('holaday-account-closure-worker', 'worker', true);
  if (
    worker?.pid === main.pid ||
    ![4001, 4002].every(
      (port) =>
        Array.isArray(listeners?.[port]) &&
        listeners[port].length === 1 &&
        listeners[port][0] === main.pid,
    )
  )
    fail();
  return { identity, root, main, worker };
}
