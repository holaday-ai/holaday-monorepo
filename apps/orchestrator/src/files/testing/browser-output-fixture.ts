import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SQL } from 'drizzle-orm';
import { MySqlDialect } from 'drizzle-orm/mysql-core';
import { pino } from 'pino';
import type { DB } from '../../db/client.js';
import { taskFiles } from '../../db/schema/task-files.js';
import { tasks } from '../../db/schema/tasks.js';
import { users } from '../../db/schema/users.js';
import { FileService } from '../file-service.js';
import { LocalStorageProvider } from '../storage-provider.js';
const logger = pino({ level: 'silent' });
export async function browserOutputFixture() {
  const root = await mkdtemp(join(tmpdir(), 'ba-browser-files-'));
  const records: Array<Record<string, unknown>> = [];
  const taskRecords: Array<Record<string, unknown>> = [
    { id: 9, externalId: 'tsk_alice', userId: 7, status: 'executing', origin: 'user' },
    { id: 10, externalId: 'tsk_bob', userId: 8, status: 'executing', origin: 'user' },
  ];
  const faults = {
    insert: 'none' as 'none' | 'before' | 'after' | 'unknown',
    read: false,
    reorder: false,
    ownerStatus: 'active',
  };
  const dialect = new MySqlDialect();
  function matches(row: Record<string, unknown>, query: SQL) {
    const compiled = dialect.sqlToQuery(query);
    const columns = [...compiled.sql.matchAll(/`\w+`\.`(\w+)`\s*=\s*\?/g)];
    if (columns.length !== compiled.params.length) throw new Error('Unsupported fixture predicate');
    return columns.every((match, i) => {
      const name = match[1]!.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
      return row[name] === compiled.params[i];
    });
  }
  const db = {
    insert: (table: unknown) => ({
      values: async (data: Record<string, unknown>) => {
        if (table !== taskFiles) throw new Error('Unexpected insert table');
        if (faults.insert === 'before')
          throw Object.assign(new Error('synthetic DB insert rejected'), {
            code: 'ER_NO_REFERENCED_ROW_2',
          });
        if (faults.insert === 'unknown') throw new Error('synthetic write outcome unknown');
        if (faults.reorder && data.browserSource) {
          data = {
            ...data,
            browserSource: Object.fromEntries(
              Object.entries(data.browserSource).sort(([a], [b]) => a.localeCompare(b)),
            ),
          };
        }
        records.push({ id: records.length + 1, status: 'active', createdAt: new Date(), ...data });
      },
    }),
    select: () => ({
      from: (table: unknown) => ({
        where: (query: SQL) => ({
          limit: (count: number) => {
            const result = Promise.resolve().then(() => {
              if (table === taskFiles && faults.read)
                throw new Error('synthetic DB read unavailable');
              const rows =
                table === taskFiles
                  ? records
                  : table === users
                    ? [
                        {
                          id: 7,
                          externalId: 'usr_alice',
                          status: faults.ownerStatus,
                          modelDataRegion: 'intl',
                        },
                        { id: 8, externalId: 'usr_bob', status: 'active', modelDataRegion: 'intl' },
                      ]
                    : table === tasks
                      ? taskRecords
                      : (() => {
                          throw new Error('Unexpected select table');
                        })();
              return rows.filter((row) => matches(row, query)).slice(0, count);
            });
            return Object.assign(result, {
              for: (mode: string) => {
                if (mode !== 'update') throw new Error('Unexpected fixture lock');
                return result;
              },
            });
          },
          orderBy: () => ({
            limit: async (count: number) => {
              if (table !== taskFiles) throw new Error('Unexpected ordered fixture query');
              return [...records]
                .filter((row) => matches(row, query))
                .sort((a, b) => Number(b.id) - Number(a.id))
                .slice(0, count);
            },
          }),
        }),
      }),
    }),
    transaction: async (change: (tx: DB) => Promise<unknown>) => {
      const result = await change(db);
      if (faults.insert === 'after') throw new Error('synthetic transaction receipt lost');
      return result;
    },
  } as unknown as DB;
  const storage = new LocalStorageProvider(root, logger);
  return {
    service: new FileService(db, logger, storage),
    db,
    records,
    taskRecords,
    faults,
    storage,
    root,
  };
}
