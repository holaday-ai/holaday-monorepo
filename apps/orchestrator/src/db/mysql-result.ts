/**
 * Small helpers for reading mysql2/drizzle result envelopes.
 *
 * mysql2 returns inserts as `[{insertId, affectedRows, ...}, fields]`;
 * drizzle surfaces `[{insertId}]`. These helpers read the parts we need
 * without leaking the driver shape into call sites. Mirrors the private
 * helpers in `src/agent/task-repository.ts` (kept separate so the new
 * Pack A repositories don't import from the agent layer).
 */

/** Read the AUTO_INCREMENT id from an insert result. Throws if absent. */
export function readInsertId(result: unknown): number {
  if (Array.isArray(result) && result.length > 0) {
    const head = result[0] as { insertId?: number | bigint };
    if (head && typeof head.insertId === 'number') return head.insertId;
    if (head && typeof head.insertId === 'bigint') return Number(head.insertId);
  }
  throw new Error('insert did not return insertId');
}

/** Read `affectedRows` from an update/delete result. Returns 0 when absent. */
export function readAffectedRows(result: unknown): number {
  if (Array.isArray(result)) {
    const head = result[0] as { affectedRows?: number } | undefined;
    if (typeof head?.affectedRows === 'number') return head.affectedRows;
  }
  const direct = (result as { affectedRows?: number } | null)?.affectedRows;
  return typeof direct === 'number' ? direct : 0;
}
