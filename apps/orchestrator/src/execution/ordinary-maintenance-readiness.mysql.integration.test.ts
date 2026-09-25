import { randomBytes } from 'node:crypto';
import mysql from 'mysql2/promise';
import { describe, expect, it } from 'vitest';
import { checkMaintenanceSchema } from './ordinary-maintenance-readiness.js';

describe.skipIf(process.env.CORE_MYSQL_INTEGRATION !== '1')(
  'maintenance actual MySQL metadata',
  () => {
    it('accepts real MySQL column metadata, then rejects an incompatible nullable-cost change', async () => {
      const url = new URL(process.env.CORE_MYSQL_TEST_ADMIN_URL ?? 'http://invalid');
      if (
        url.protocol !== 'mysql:' ||
        url.hostname !== '127.0.0.1' ||
        url.port !== '13316' ||
        url.pathname !== '/'
      )
        throw new Error('QA_LOOPBACK_13316_REQUIRED');
      const connection = await mysql.createConnection(url.toString());
      const database = 'holaday_maintenance_' + randomBytes(8).toString('hex') + '_integration';
      let created = false;
      try {
        await connection.query(`CREATE DATABASE \`${database}\``);
        created = true;
        await connection.query(`USE \`${database}\``);
        await connection.query(
          'CREATE TABLE tasks (id BIGINT PRIMARY KEY, execution_id VARCHAR(64) NULL, execution_revision BIGINT UNSIGNED NOT NULL DEFAULT 0, core_record_version BIGINT UNSIGNED NOT NULL DEFAULT 0)',
        );
        await connection.query(
          'CREATE TABLE llm_calls (id BIGINT PRIMARY KEY, prompt_tokens INT NULL, completion_tokens INT NULL, cache_read_tokens INT NULL, cache_write_tokens INT NULL, cost_usd DECIMAL(12,6) NULL, cost_status VARCHAR(32), usage_status VARCHAR(32), region VARCHAR(32), provider_request_id VARCHAR(64))',
        );
        const query = async (sql: string, values?: unknown[]) => {
          const [rows] = await connection.query(sql, values);
          return rows as unknown as Record<string, unknown>[];
        };
        await expect(checkMaintenanceSchema(query)).resolves.toBeUndefined();
        await connection.query(
          'ALTER TABLE llm_calls MODIFY cost_usd DECIMAL(12,6) NOT NULL DEFAULT 0',
        );
        await expect(checkMaintenanceSchema(query)).rejects.toThrow('MAINTENANCE_SCHEMA_UNPROVEN');
      } finally {
        if (created) await connection.query(`DROP DATABASE \`${database}\``);
        await connection.end();
      }
    });
  },
);
