export function evaluateMaintenanceCutover(input) {
  if (input?.protocol !== 1) return { allowed: false, code: 'LEGACY_DRAIN_UNSUPPORTED' };
  const allowed =
    input.mode === 'closed' &&
    input.idle === true &&
    input.needsReconciliation === false &&
    input.candidateMatches === true &&
    input.workerStopped === true;
  return { allowed, code: allowed ? 'READY_TO_STOP' : 'MAINTENANCE_UNPROVEN' };
}
export function recoveryAction(phase) {
  return phase === 'preflight' ? 'abort_without_mutation' : 'hold_maintenance';
}
