import { getTableName } from 'drizzle-orm';
import type { S3Client } from '@aws-sdk/client-s3';
import type { Logger } from 'pino';
import { describe, expect, it } from 'vitest';
import { FileService } from './file-service.js';
import { R2StorageProvider } from './storage-provider.js';
const logger = { warn() {}, info() {} } as unknown as Logger;
function service(pathOwner: string, owner: string | null = 'usr_alice') {
 const row = { externalId: 'file_old', userId: 7, status: 'active', expiresAt: null, storagePath: '/tmp/holaday-files/' + pathOwner + '/input/file_old/example.png' };
 const db = { select: () => ({ from: (table: Parameters<typeof getTableName>[0]) => ({ where: () => ({ limit: async () => getTableName(table) === 'users' ? (owner ? [{ externalId: owner }] : []) : [row] }) }) }) };
 const client = { send: async () => ({ ContentLength: 14, Body: (async function* () { yield Buffer.from('stored bytes'); })() }) } as unknown as S3Client;
 return new FileService(db as never, logger, new R2StorageProvider({ endpoint: 'https://example.invalid', accessKeyId: 'test', secretAccessKey: 'test', bucket: 'test' }, logger, { client }));
}
describe('FileService passes database owner for legacy R2 reads', () => {
 it('rejects a row owned by Alice whose storage path points at Bob', async () => {
  await expect(service('usr_bob').loadForUser('file_old', 7)).rejects.toThrow(/owner/i);
 });
 it.each(['loadMany', 'signedReadUrl', 'getScopedPreviewForUser'] as const)('rejects a foreign owner path in %s', async method => {
  const files = service('usr_bob');
  const result = method === 'loadMany' ? files.loadMany(['file_old'], 7) : files[method]('file_old', 7);
  await expect(result).rejects.toThrow(/owner/i);
 });
 it('reads a migrated object owned by the caller', async () => {
  const result = await service('usr_alice').loadForUser('file_old', 7);
  expect(result?.buffer).toEqual(Buffer.from('stored bytes'));
 });
 it('refuses compatibility reads when the database owner identity is missing', async () => {
  await expect(service('usr_alice', null).loadForUser('file_old', 7)).rejects.toThrow(/owner/i);
 });
});
