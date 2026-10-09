import type { AkshareClient } from '../agent/a-share/akshare-client.js';
import { SnapshotAkshareClient } from './snapshot-akshare-client.js';
import type { ValidatedStockTaskContext } from './stock-task-context.js';

/** Current context is an admitted research boundary, not a complete company dataset.
 * Historic/delayed contexts stay snapshot-only: never silently import present-day facts.
 */
export function selectStockAnalysisInput(
  context: ValidatedStockTaskContext | null,
  live: AkshareClient,
  submittedAt: Date,
) {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(submittedAt);
  const current = !context || (context.trustMode === 'current' && context.dataAsOf === today);
  return {
    client: current ? live : new SnapshotAkshareClient(context.snapshotPayload),
    submittedAt,
    matchNow: current ? submittedAt : new Date(`${context.dataAsOf}T04:00:00.000Z`),
    sourceMode: current ? ('provider' as const) : ('snapshot' as const),
  };
}
