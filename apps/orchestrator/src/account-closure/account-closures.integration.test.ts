import mysql, { type Pool, type ResultSetHeader, type RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

describe('account closure database invariants', () => {
  let pool: Pool;
  let sequence = 0;

  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error('DATABASE_URL is required for integration tests');
    const { applyMigrations } = await import('../test/db-helper.js');
    await applyMigrations(databaseUrl);
    pool = mysql.createPool({ uri: databaseUrl });
  });

  afterAll(async () => {
    await pool?.end();
  });

  async function createUser(status = 'active'): Promise<number> {
    sequence += 1;
    const [result] = await pool.execute<ResultSetHeader>(
      `INSERT INTO users (external_id, email, password_hash, status)
       VALUES (?, ?, ?, ?)`,
      [
        `usr_closure_${sequence}`,
        `closure-${sequence}@example.test`,
        'not-a-real-password',
        status,
      ],
    );
    return result.insertId;
  }

  async function createRequest(
    userId: number,
    activeUserId: number | null,
    status = 'pending_grace',
  ) {
    sequence += 1;
    return pool.execute(
      `INSERT INTO account_closure_requests
        (external_id, user_id, active_user_id, status, requested_at, grace_ends_at)
       VALUES (?, ?, ?, ?, UTC_TIMESTAMP(3), DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 168 HOUR))`,
      [`acl_req_${sequence}`, userId, activeUserId, status],
    );
  }

  it('rejects a live request without its own active-user guard', async () => {
    const userId = await createUser();

    await expect(createRequest(userId, null)).rejects.toMatchObject({
      code: 'ER_CHECK_CONSTRAINT_VIOLATED',
    });
  });

  it('rejects a live request guarded by another user', async () => {
    const userId = await createUser();
    const anotherUserId = await createUser();

    await expect(createRequest(userId, anotherUserId)).rejects.toMatchObject({
      code: 'ER_CHECK_CONSTRAINT_VIOLATED',
    });
  });

  it('rejects a terminal request that retains an active-user guard', async () => {
    const userId = await createUser();

    await expect(createRequest(userId, userId, 'completed')).rejects.toMatchObject({
      code: 'ER_CHECK_CONSTRAINT_VIOLATED',
    });
  });

  it.each(['active', 'system', 'suspended', 'closure_pending', 'closure_processing', 'closed'])(
    'accepts the persisted user status %s',
    async (status) => {
      await expect(createUser(status)).resolves.toEqual(expect.any(Number));
    },
  );

  it('rejects an invented user status', async () => {
    await expect(createUser('invented_status')).rejects.toMatchObject({
      code: 'ER_CHECK_CONSTRAINT_VIOLATED',
    });
  });

  it('rejects a checkpoint object with an unapproved key', async () => {
    const userId = await createUser();
    await createRequest(userId, userId);
    const [requestRows] = await pool.query<Array<RowDataPacket & { id: number }>>(
      'SELECT id FROM account_closure_requests WHERE user_id = ? ORDER BY id DESC LIMIT 1',
      [userId],
    );
    const requestId = requestRows[0]?.id;
    if (!requestId) throw new Error('expected closure request');

    await expect(
      pool.execute(
        `INSERT INTO account_closure_steps
          (request_id, category_id, handler_version, checkpoint)
         VALUES (?, 'account_security', 1, JSON_OBJECT('unapproved', 1))`,
        [requestId],
      ),
    ).rejects.toMatchObject({ code: 'ER_CHECK_CONSTRAINT_VIOLATED' });
  });

  it('rejects receipt category data that is not a JSON array', async () => {
    const userId = await createUser();
    await createRequest(userId, userId);
    const [requestRows] = await pool.query<Array<RowDataPacket & { id: number }>>(
      'SELECT id FROM account_closure_requests WHERE user_id = ? ORDER BY id DESC LIMIT 1',
      [userId],
    );
    const requestId = requestRows[0]?.id;
    if (!requestId) throw new Error('expected closure request');

    await expect(
      pool.execute(
        `INSERT INTO account_closure_receipts
          (request_id, user_id, receipt_number, kind, completed_category_ids, restricted_category_ids, issued_at)
         VALUES (?, ?, ?, 'application', JSON_OBJECT(), JSON_ARRAY(), UTC_TIMESTAMP(3))`,
        [requestId, userId, `acl_rcpt_${sequence}`],
      ),
    ).rejects.toMatchObject({ code: 'ER_CHECK_CONSTRAINT_VIOLATED' });
  });
});
