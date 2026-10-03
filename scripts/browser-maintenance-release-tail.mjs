const valid = (identity) =>
  /^[a-f0-9]{40}$/.test(identity?.candidate ?? '') && /^[a-f0-9]{32}$/.test(identity?.bootId ?? '');
const same = (a, b) => valid(a) && valid(b) && a.candidate === b.candidate && a.bootId === b.bootId;
const errorCode = (error) =>
  /^(MAINTENANCE_[A-Z_]+|CUTOVER_[A-Z_]+)$/.test(error?.message)
    ? error.message
    : 'MAINTENANCE_RELEASE_FAILED';

/** Starts only after physical retirement. Both callers supply explicit gates.
 * No retries of migration, start or open, and never an old-version rollback. */
export async function finishStoppedRelease({ candidate, previousBootId, adapter }) {
  let phase = 'stopped';
  let identity;
  const mark = async (next) => {
    phase = next;
    await adapter.persist(next, { candidate, identity });
  };
  try {
    if (
      !/^[a-f0-9]{40}$/.test(candidate ?? '') ||
      (previousBootId !== undefined && !/^[a-f0-9]{32}$/.test(previousBootId)) ||
      [
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
      ].some((name) => typeof adapter?.[name] !== 'function')
    )
      throw new Error('MAINTENANCE_TARGET_REQUIRED');
    await mark('migration_started');
    await adapter.migrate(candidate);
    await mark('candidate_started');
    const started = await adapter.start(candidate);
    if (!valid(started) || started.candidate !== candidate || started.bootId === previousBootId)
      throw new Error('MAINTENANCE_IDENTITY_MISMATCH');
    identity = { ...started };
    await adapter.verify(identity);
    await mark('verified');
    await adapter.beforeOpen(identity);
    let opened;
    try {
      opened = await adapter.open(identity);
    } catch {
      opened = await adapter.status(identity);
    }
    if (
      opened?.protocol !== 1 ||
      !same(opened.identity, identity) ||
      opened.mode !== 'serving' ||
      opened.needsReconciliation !== true ||
      opened.idle !== false
    )
      throw new Error('MAINTENANCE_OPEN_UNPROVEN');
    await adapter.afterOpen(identity);
    await adapter.resumeWorker(identity);
    await mark('opened');
    return { ok: true, phase, identity };
  } catch (error) {
    let closeAcknowledged = false;
    if (identity) {
      try {
        const closed = await adapter.close(identity);
        closeAcknowledged =
          closed?.protocol === 1 && same(closed.identity, identity) && closed.mode === 'closed';
      } catch {
        /* Keep uncertainty; never reset dirty state or retry a side effect. */
      }
    }
    return {
      ok: false,
      phase,
      identity,
      action: 'hold_maintenance',
      code: errorCode(error),
      closeAcknowledged,
    };
  }
}
