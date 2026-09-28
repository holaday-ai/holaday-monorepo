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
      (window?.schemaVersion !== undefined && ![1, 2].includes(window.schemaVersion)) ||
      (window?.schemaVersion === 2 &&
        ['readLegacyDisposition', 'acceptLegacyInterruption'].some(
          (key) => typeof adapter?.[key] !== 'function',
        )) ||
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
    await mark('orders_fenced');
    await adapter.fenceOrders();
    checkDeadline();
    const disposition =
      typeof effects.readLegacyDisposition === 'function'
        ? await effects.readLegacyDisposition()
        : { mode: 'drained' };
    checkDeadline();
    const interrupted = disposition?.mode === 'controlled-interruption';
    if (interrupted && window?.schemaVersion !== 2) throw new Error('CUTOVER_WORK_UNPROVEN');
    if (window?.schemaVersion === 2 && !interrupted) throw new Error('CUTOVER_WORK_UNPROVEN');
    if (
      !disposition ||
      (interrupted
        ? Object.keys(disposition).length !== 2 ||
          !/^[a-f0-9]{64}$/.test(disposition.riskDigest ?? '') ||
          typeof effects.acceptLegacyInterruption !== 'function'
        : disposition.mode !== 'drained' || Object.keys(disposition).length !== 1)
    )
      throw new Error('CUTOVER_WORK_UNPROVEN');
    if (interrupted) {
      await mark('legacy_interruption_accepted');
      checkDeadline();
      await effects.acceptLegacyInterruption();
    } else {
      await mark('legacy_settled');
      await adapter.settleLegacy();
    }
    for (const [next, action] of [
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
