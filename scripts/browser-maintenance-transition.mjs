import { evaluateMaintenanceCutover, recoveryAction } from './browser-maintenance-policy.mjs';
import { finishStoppedRelease } from './browser-maintenance-release-tail.mjs';
const validIdentity = (i) =>
  typeof i?.candidate === 'string' &&
  typeof i?.bootId === 'string' &&
  /^[a-f0-9]{40}$/.test(i.candidate) &&
  /^[a-f0-9]{32}$/.test(i.bootId);
const same = (a, b) =>
  validIdentity(a) && validIdentity(b) && a.candidate === b.candidate && a.bootId === b.bootId;

/** One locked release attempt. The adapter supplies real effects, never retries
 * the attempt, and persists each phase durably before its irreversible action. */
export async function performMaintenanceRelease({ candidate, adapter }) {
  let phase = 'preflight';
  let identity;
  const mark = async (next) => {
    phase = next; // A failed durable write is uncertain, never a preflight abort.
    await adapter.persist(phase, { candidate, identity });
  };
  try {
    if (typeof candidate !== 'string' || !/^[a-f0-9]{40}$/.test(candidate))
      throw new Error('MAINTENANCE_TARGET_REQUIRED');
    const capability = await adapter.capability();
    if (capability?.protocol !== 1 || !validIdentity(capability.identity))
      throw new Error('LEGACY_DRAIN_UNSUPPORTED');
    identity = capability.identity;
    if (!['serving', 'closed'].includes(capability.mode)) throw new Error('MAINTENANCE_UNPROVEN');
    await adapter.preflight(identity, candidate);
    await adapter.stage(identity, candidate);
    await mark('closed');
    await adapter.close(identity);
    const workerStopped = await adapter.stopWorker(identity);
    const receipt = await adapter.wait(identity);
    const decision = evaluateMaintenanceCutover({
      ...receipt,
      candidateMatches: same(receipt?.identity, identity),
      workerStopped,
    });
    if (!decision.allowed) throw new Error(decision.code);
    await mark('stopped');
    await adapter.stop(identity);
    return finishStoppedRelease({
      candidate,
      previousBootId: identity.bootId,
      adapter: {
        ...adapter,
        // Normal journals still require the real old identity until start returns
        // the new one. First bootstrap uses its separate journal discriminator.
        persist: (next, detail) =>
          adapter.persist(next, { ...detail, identity: detail.identity ?? identity }),
      },
    });
  } catch (error) {
    const action = recoveryAction(phase);
    let closeAcknowledged = false;
    if (action === 'hold_maintenance' && identity) {
      try {
        await adapter.close(identity);
        closeAcknowledged = true;
      } catch {
        /* report uncertainty, never rollback */
      }
    }
    const code = /^(MAINTENANCE_[A-Z_]+|LEGACY_DRAIN_UNSUPPORTED)$/.test(error?.message)
      ? error.message
      : 'MAINTENANCE_RELEASE_FAILED';
    return { ok: false, phase, identity, action, code, closeAcknowledged };
  }
}
