import mysql, { type Connection } from 'mysql2/promise';
import { drizzle } from 'drizzle-orm/mysql2';
import { desc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { DB } from '../db/client.js';
import { stockDashboardSnapshots } from '../db/schema/stock-dashboard-snapshots.js';
import { loadLatestStockRiskSnapshot } from './stock-risk-monitor-executor.js';

// Only a dedicated loopback QA database is permitted; never uses DATABASE_URL.
let connection: Connection;
let db: DB;
const display = {
  watchlistStocks: [{ symbol: '603528', name: 'Synthetic stock', market: 'A' }],
  trust: {
    snapshotId: 'stkshot_0123456789abcdef01234567',
    generatedAt: '2026-10-07T01:00:00Z',
    dataAsOf: '2026-10-07',
    mode: 'current',
    evidenceIds: [],
  },
};
beforeAll(async () => {
  const port = Number(process.env.HOLADAY_SNAPSHOT_TEST_PORT);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error('Set HOLADAY_SNAPSHOT_TEST_PORT to an isolated loopback MySQL QA port');
  }
  connection = await mysql.createConnection({ host: '127.0.0.1', port, user: 'root', database: 'holaday_pr243_qa', timezone: 'Z' });
  db = drizzle(connection, { mode: 'default' }) as unknown as DB;
  // A session-local table shadows any persistent table; no migration or business rows.
  await connection.query(`CREATE TEMPORARY TABLE stock_dashboard_snapshots (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, user_id BIGINT UNSIGNED NOT NULL,
    cache_key_hash VARCHAR(64) NOT NULL, snapshot_json JSON NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE KEY user_key (user_id, cache_key_hash))`);
});
afterAll(async () => { if (connection) await connection.end(); });
beforeEach(async () => { await connection.query('DELETE FROM stock_dashboard_snapshots'); });
async function insert(userId: number, key: string, snapshot: unknown, updatedAt: string) {
  await connection.execute('INSERT INTO stock_dashboard_snapshots (user_id, cache_key_hash, snapshot_json, updated_at) VALUES (?, ?, ?, ?)', [userId, key, JSON.stringify(snapshot), updatedAt]);
}
describe('risk-monitor latest display snapshot, real MySQL query', () => {
  it('finds the older display snapshot when the latest 20 owned rows are short-lived contexts', async () => {
    await insert(7, 'display', display, '2026-10-07 01:00:00');
    for (let i = 0; i < 20; i++) {
      await insert(7, 'served-' + i, { kind: 'served-stock-context-v1', expiresAt: '2026-10-07T02:10:00Z', snapshot: display }, '2026-10-07 02:00:00');
    }
    // Independently prove the database fixture really fills the unfiltered LIMIT.
    const recent = await db.select({ snapshotJson: stockDashboardSnapshots.snapshotJson }).from(stockDashboardSnapshots).where(eq(stockDashboardSnapshots.userId, 7)).orderBy(desc(stockDashboardSnapshots.updatedAt)).limit(20);
    expect(recent).toHaveLength(20);
    expect(recent.every(row => (row.snapshotJson as { kind: string }).kind === 'served-stock-context-v1')).toBe(true);
    expect(await loadLatestStockRiskSnapshot(db, 7)).toEqual({ snapshotId: 'stkshot_0123456789abcdef01234567', dataAsOf: '2026-10-07', stocks: [{ symbol: '603528', name: 'Synthetic stock', market: 'A' }] });
  });
  it('never substitutes another user display snapshot when the owner has only served contexts', async () => {
    await insert(8, 'other-user-display', display, '2026-10-07 03:00:00');
    await insert(7, 'served-only', { kind: 'served-stock-context-v1', snapshot: display }, '2026-10-07 02:00:00');
    expect(await loadLatestStockRiskSnapshot(db, 7)).toBeNull();
    expect(await loadLatestStockRiskSnapshot(db, 8)).toMatchObject({ snapshotId: 'stkshot_0123456789abcdef01234567' });
  });
});
