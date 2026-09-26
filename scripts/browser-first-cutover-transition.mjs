import { finishStoppedRelease } from './browser-maintenance-release-tail.mjs';

/** Explicit first bootstrap only. It does not infer a legacy protocol identity. */
export async function performFirstCutover({ candidate, adapter, window, clock = Date.now }) {
  let phase = 'preflight';
  let identity;
  const { maintenanceEndsAtMs, reconcileByMs, operatorRef } = window ?? {};
  let lastTime;
  const checkDeadline = (reconciling = false) => {
    const now = clock();
    if (
      !Number.isSafeInteger(now) ||
      now < 0 ||
      (lastTime !== undefined && now < lastTime) ||
      now >= (reconciling ? reconcileByMs : maintenanceEndsAtMs)
    )
      throw new Error('CUTOVER_DEADLINE_UNPROVEN');
    lastTime = now;
  };
  const mark = async (next) => {
    phase = next;
    await adapter.persist(next, { candidate, identity });
  };
  async function hold(result) {
    let closeAcknowledged = result.closeAcknowledged === true;
    try {
      const held = await adapter.holdMaintenance({
        phase: result.phase,
        identity: result.identity,
        errorCode: result.code,
        closeAcknowledged,
      });
      closeAcknowledged = held?.closeAcknowledged === true;
    } catch {
      closeAcknowledged = false;
    }
    return { ...result, closeAcknowledged };
  }
  try {
    if (
      !Number.isSafeInteger(maintenanceEndsAtMs) ||
      maintenanceEndsAtMs <= 0 ||
      !Number.isSafeInteger(reconcileByMs) ||
      reconcileByMs < maintenanceEndsAtMs ||
      !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(operatorRef ?? '') ||
      typeof clock !== 'function'
    )
      throw new Error('CUTOVER_WINDOW_UNPROVEN');
    if (
      !/^[a-f0-9]{40}$/.test(candidate ?? '') ||
      [
        'preflight',
        'stage',
        'fenceOrders',
        'settleLegacy',
        'stopProducers',
        'fenceAll',
        'stopLegacy',
        'backupAndRestoreCheck',
        'initializeState',
        'persist',
        'migrate',
        'start',
        'verify',
        'beforeOpen',
        'open',
        'status',
        'afterOpen',
        'resumeWorker',
        'close',
        'holdMaintenance',
        'reconcile',
      ].some((name) => typeof adapter?.[name] !== 'function')
    )
      throw new Error('CUTOVER_ADAPTER_REQUIRED');
    checkDeadline();
    const effects = adapter;
    adapter = { ...effects };
    // Check at the effect boundary, including after a slow journal write.
    // Never cancel an uncertain operation or deadline-gate protective closing.
    for (const name of [
      'preflight',
      'stage',
      'fenceOrders',
      'settleLegacy',
      'stopProducers',
      'fenceAll',
      'stopLegacy',
      'backupAndRestoreCheck',
      'migrate',
      'initializeState',
      'start',
      'verify',
      'beforeOpen',
      'open',
      'status',
      'afterOpen',
      'resumeWorker',
      'reconcile',
    ]) {
      adapter[name] = async (...args) => {
        checkDeadline(name === 'reconcile');
        return effects[name](...args);
      };
    }
    await adapter.preflight(candidate);
    await adapter.stage(candidate);
    checkDeadline();
    await mark('prepared');
    for (const [next, action] of [
      ['orders_fenced', 'fenceOrders'],
      ['legacy_settled', 'settleLegacy'],
      ['producers_stopped', 'stopProducers'],
      ['all_fenced', 'fenceAll'],
      ['stopped', 'stopLegacy'],
      ['backup_verified', 'backupAndRestoreCheck'],
    ]) {
      await mark(next);
      await adapter[action]();
    }
    const result = await finishStoppedRelease({
      candidate,
      adapter: {
        ...adapter,
        migrate: async () => {
          await adapter.migrate(candidate);
          await adapter.initializeState();
        },
      },
    });
    if (!result.ok) return hold(result);
    phase = result.phase;
    identity = result.identity;
    await mark('reconciled');
    await adapter.reconcile(identity);
    checkDeadline(true);
    return { ok: true, phase, identity };
  } catch (error) {
    const code = /^(CUTOVER_[A-Z_]+|MAINTENANCE_[A-Z_]+)$/.test(error?.message)
      ? error.message
      : 'CUTOVER_FAILED';
    const result = {
      ok: false,
      phase,
      identity,
      code,
      action: phase === 'preflight' ? 'abort_without_mutation' : 'hold_maintenance',
      closeAcknowledged: false,
    };
    return phase === 'preflight' ? result : hold(result);
  }
}
