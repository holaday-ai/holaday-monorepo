import { getTableName } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
const storage = vi.hoisted(() => ({ stat: vi.fn(async (key: string) => { if (key === 'missing') return null; if (key === 'denied') throw new Error('AccessDenied'); return { sizeBytes: 1 }; }) }));
vi.mock('../../files/storage-provider.js', async original => ({ ...await original<object>(), getSharedStorageProvider: () => storage }));
import { filesRouter } from './files.js';
const files = ['present', 'missing', 'denied'].map((storagePath, index) => ({ id: 10-index, externalId: 'file_'+storagePath, userId: 7, kind: 'input', status: 'active', expiresAt: null, storagePath, filename: storagePath+'.png', mimetype: 'image/png', sizeBytes: 1, createdAt: new Date() }));
function caller() {
 const db = { select: () => ({ from: (table: Parameters<typeof getTableName>[0]) => ({ where: () => ({ limit: async () => [{ id: 7 }], orderBy: () => ({ limit: async () => getTableName(table) === 'task_files' ? files : [] }) }) }) }) };
 return filesRouter.createCaller({ userId: 'usr_file_contract', req: {}, db, logger: { warn: vi.fn() } } as never);
}
describe('file list and byte availability contract', () => {
 it('preserves owned metadata while distinguishing missing bytes from a storage failure', async () => {
  const result = await caller().list({ limit: 3 });
  expect(result.items.map(item => (item as unknown as { availability: string }).availability)).toEqual(['available','unavailable','unknown']);
  expect(result.items.map(item => item.fileId)).toEqual(['file_present','file_missing','file_denied']);
  expect(JSON.stringify(result)).not.toContain('storagePath');
 });
 it('keeps pagination based on metadata rows when a file has no bytes', async () => {
  const result = await caller().list({ limit: 2 });
  expect(result.items.map(item => item.fileId)).toEqual(['file_present','file_missing']);
  expect(result.nextCursor).toBe(9);
 });
});
