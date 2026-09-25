import { evaluateMaintenanceCutover } from './browser-maintenance-policy.mjs';

function validProcess(value) {
  return (
    value &&
    Number.isSafeInteger(value.pid) &&
    value.pid > 1 &&
    typeof value.start === 'string' &&
    /^[0-9]+$/.test(value.start) &&
    value.uid === 998 &&
    typeof value.cwd === 'string' &&
    value.cwd.startsWith('/opt/holaday-releases/') &&
    value.cwd.endsWith('/apps/orchestrator') &&
    ['main', 'worker'].includes(value.command) &&
    value.autorestart === false
  );
}
function sameProcess(a, b) {
  return (
    validProcess(a) &&
    validProcess(b) &&
    ['pid', 'start', 'uid', 'cwd', 'command'].every((key) => a[key] === b[key])
  );
}
/** No force-stop, cancellation, PM2 restart/delete, or clearing of evidence.
 * The system adapter must pin /proc start identity and manager configuration. */
export async function retireMaintenanceRuntime({
  identity,
  receipt,
  main,
  worker,
  deadlineMs,
  effects,
}) {
  const candidateMatches =
    typeof identity?.candidate === 'string' &&
    /^[a-f0-9]{40}$/.test(identity.candidate) &&
    /^[a-f0-9]{32}$/.test(identity.bootId ?? '') &&
    receipt?.identity?.candidate === identity.candidate &&
    receipt?.identity?.bootId === identity.bootId;
  if (
    !evaluateMaintenanceCutover({ ...receipt, candidateMatches, workerStopped: true }).allowed ||
    !validProcess(main) ||
    main.command !== 'main' ||
    main.cwd !== `/opt/holaday-releases/${identity?.candidate}/apps/orchestrator` ||
    (worker &&
      (!validProcess(worker) ||
        worker.command !== 'worker' ||
        worker.pid === main.pid ||
        worker.cwd !== main.cwd)) ||
    !Number.isSafeInteger(deadlineMs) ||
    deadlineMs < 1 ||
    deadlineMs > 660000
  )
    throw new Error('MAINTENANCE_STOP_INPUT');
  const deadline = effects.now() + deadlineMs;
  async function current(original) {
    const process = await effects.readProcess(original.pid);
    if (process !== null && !sameProcess(process, original))
      throw new Error('MAINTENANCE_PROCESS_IDENTITY');
    return process;
  }
  async function wait(original, code) {
    while (await current(original)) {
      if (effects.now() >= deadline) throw new Error(code);
      await effects.sleep(100);
    }
  }
  // The marker stops future worker pages; only physical exit settles this proof.
  if (worker) await wait(worker, 'MAINTENANCE_WORKER_BUSY');
  if (!(await effects.managerStopped('worker', worker)))
    throw new Error('MAINTENANCE_STOP_UNPROVEN');
  if (await current(main)) {
    if (effects.now() >= deadline) throw new Error('MAINTENANCE_PROCESS_BUSY');
    await effects.signal(main.pid, 'SIGTERM', main);
  }
  await wait(main, 'MAINTENANCE_PROCESS_BUSY');
  if (!(await effects.managerStopped('main', main)) || !(await effects.portsFree()))
    throw new Error('MAINTENANCE_STOP_UNPROVEN');
}
