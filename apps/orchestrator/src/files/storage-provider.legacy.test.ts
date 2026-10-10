import { promises as fs } from 'node:fs';
import type { S3Client } from '@aws-sdk/client-s3';
import type { Logger } from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalStorageProvider, R2StorageProvider } from './storage-provider.js';
const logger = { warn: vi.fn() } as unknown as Logger;
const config = { endpoint: 'https://example.invalid', accessKeyId: 'test', secretAccessKey: 'test', bucket: 'test' };
afterEach(() => vi.restoreAllMocks());
describe('legacy storage handles', () => {
 it('propagates R2 HEAD permission failures instead of marking content missing', async () => {
  const client = { send: async () => { throw Object.assign(new Error('denied'), { name: 'AccessDenied' }); } } as unknown as S3Client;
  await expect(new R2StorageProvider(config, logger, { client }).stat('usr_test/input/file_old/example.png')).rejects.toMatchObject({ name: 'AccessDenied' });
 });
 it('passes cancellation to the R2 HEAD request', async () => {
  const client = { send: (_command: unknown, options: { abortSignal: AbortSignal }) => new Promise((_resolve, reject) => { options.abortSignal.addEventListener('abort', () => reject(options.abortSignal.reason), { once: true }); }) } as unknown as S3Client;
  await expect(new R2StorageProvider(config, logger, { client }).stat('usr_test/input/file_old/example.png', { signal: AbortSignal.timeout(5) })).rejects.toThrow();
 });
 it('reads a migrated R2 object for an old local absolute handle without rewriting the record', async () => {
  const client = { send: async (command: { input: { Key: string } }) => {
   if (command.input.Key !== 'usr_test/input/file_old/example.png') throw Object.assign(new Error('missing'), { name: 'NoSuchKey' });
   return { Body: (async function* () { yield Buffer.from('original bytes'); })() };
  } } as unknown as S3Client;
  const provider = new R2StorageProvider(config, logger, { client });
  await expect(provider.get('/tmp/holaday-files/usr_test/input/file_old/example.png', { ownerExternalId: 'usr_test' })).resolves.toEqual(Buffer.from('original bytes'));
 });
 it.each(['../escape', '/etc/passwd', '/tmp/holaday-files/../../etc/passwd', '/tmp/holaday-files/usr_test/input/file_old/../secret'])('refuses invalid legacy handle %s', async handle => {
  const provider = new R2StorageProvider(config, logger, { client: { send: async () => ({ Body: (async function* () { yield Buffer.from('should not be returned'); })() }) } as unknown as S3Client });
  await expect(provider.get(handle)).rejects.toThrow(/storage.*path/i);
 });
 it('keeps local permission failures distinct from missing content', async () => {
  vi.spyOn(fs, 'readFile').mockRejectedValue(Object.assign(new Error('denied'), { code: 'EACCES' }));
  const provider = new LocalStorageProvider('/tmp/test-only', logger);
  await expect(provider.get('/tmp/test-only/missing')).rejects.toMatchObject({ code: 'EACCES' });
 });
});

describe('legacy R2 keys are bound to the file owner', () => {
 const foreignPath = '/tmp/holaday-files/usr_bob/input/file_old/example.png';
 function storage() {
  const client = { send: async () => ({ ContentLength: 14, Body: (async function* () { yield Buffer.from('foreign bytes'); })() }) } as unknown as S3Client;
  return new R2StorageProvider(config, logger, { client });
 }
 it.each(['usr_alice', 'usr_bo', '', undefined])('refuses foreign or missing owner %s before returning bytes', async ownerExternalId => {
  await expect(storage().get(foreignPath, { ownerExternalId })).rejects.toThrow(/owner/i);
 });
 it('refuses HEAD of an object from another owner', async () => {
  await expect(storage().stat(foreignPath, { ownerExternalId: 'usr_alice' })).rejects.toThrow(/owner/i);
 });
 it('does not issue a signed URL for a foreign legacy key', async () => {
  await expect(new R2StorageProvider(config, logger).getSignedUrl(foreignPath, { ownerExternalId: 'usr_alice' })).resolves.toBeNull();
 });
 it('reads metadata when the full user segment matches the actual owner', async () => {
  await expect(storage().stat(foreignPath, { ownerExternalId: 'usr_bob' })).resolves.toEqual({ sizeBytes: 14 });
 });
});
