/**
 * Phase 5c — storage-provider tests.
 *
 * LocalStorageProvider is exercised against a real `os.tmpdir()`
 * sandbox so the put/get/delete round-trip + the layout invariant
 * (root/user/kind/file/filename) are verified end-to-end without
 * pulling in the real FILES_ROOT.
 *
 * R2StorageProvider is exercised with a stubbed S3Client (DI) so
 * we don't need network or real R2 creds.
 *
 * createStorageProvider() validates the env-flag flow: default
 * local, explicit r2 with creds, r2 with missing creds throws.
 */

import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LocalStorageProvider,
  R2StorageProvider,
  createStorageProvider,
} from './storage-provider.js';

// Pino has a no-op-friendly stub but it's quicker to just make our own.
const fakeLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn(),
  level: 'silent',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

describe('LocalStorageProvider', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'holaday-storage-test-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('put / get round-trip preserves bytes', async () => {
    const provider = new LocalStorageProvider(root, fakeLogger);
    const buf = Buffer.from('hello world', 'utf-8');
    const { storagePath } = await provider.put({
      userExternalId: 'usr_test',
      kind: 'output',
      fileExternalId: 'file_abc',
      filename: 'greeting.txt',
      buffer: buf,
      mimetype: 'text/plain',
    });
    // Layout: <root>/<user>/<kind>/<file>/<filename>
    expect(storagePath).toBe(path.join(root, 'usr_test', 'output', 'file_abc', 'greeting.txt'));
    const got = await provider.get(storagePath);
    expect(got?.toString('utf-8')).toBe('hello world');
  });

  it('putFile copies a local artifact without requiring a Buffer', async () => {
    const provider = new LocalStorageProvider(root, fakeLogger);
    const sourcePath = path.join(root, 'source.mp4');
    await writeFile(sourcePath, Buffer.from('streamed-video'));
    const { storagePath } = await provider.putFile({
      userExternalId: 'usr_test',
      kind: 'output',
      fileExternalId: 'file_video',
      filename: 'video.mp4',
      sourcePath,
      sizeBytes: 14,
      mimetype: 'video/mp4',
    });
    expect(storagePath).toBe(
      provider.pathFor({
        userExternalId: 'usr_test',
        kind: 'output',
        fileExternalId: 'file_video',
        filename: 'video.mp4',
      }),
    );
    expect((await readFile(storagePath)).toString()).toBe('streamed-video');
  });

  it('delete removes the file, second delete is idempotent (no throw)', async () => {
    const provider = new LocalStorageProvider(root, fakeLogger);
    const { storagePath } = await provider.put({
      userExternalId: 'usr_test',
      kind: 'input',
      fileExternalId: 'file_x',
      filename: 'data.csv',
      buffer: Buffer.from('a,b\n1,2'),
      mimetype: 'text/csv',
    });
    await provider.delete(storagePath);
    expect(await provider.get(storagePath)).toBeNull();
    // Second delete should NOT throw — operator can call cleanup
    // twice without juggling state.
    await expect(provider.delete(storagePath)).resolves.toBeUndefined();
  });

  it('getSignedUrl returns null for local (no native signing)', async () => {
    const provider = new LocalStorageProvider(root, fakeLogger);
    expect(await provider.getSignedUrl('/nonexistent/path')).toBeNull();
  });

  it('get returns null when path does not exist (404-friendly)', async () => {
    const provider = new LocalStorageProvider(root, fakeLogger);
    expect(await provider.get(path.join(root, 'nonexistent.txt'))).toBeNull();
  });

  it('scopes by user externalId — two users with same fileId stay separate', async () => {
    const provider = new LocalStorageProvider(root, fakeLogger);
    const userA = await provider.put({
      userExternalId: 'usr_a',
      kind: 'output',
      fileExternalId: 'file_z',
      filename: 'note.txt',
      buffer: Buffer.from('alice'),
      mimetype: 'text/plain',
    });
    const userB = await provider.put({
      userExternalId: 'usr_b',
      kind: 'output',
      fileExternalId: 'file_z',
      filename: 'note.txt',
      buffer: Buffer.from('bob'),
      mimetype: 'text/plain',
    });
    expect(userA.storagePath).not.toBe(userB.storagePath);
    expect((await provider.get(userA.storagePath))?.toString()).toBe('alice');
    expect((await provider.get(userB.storagePath))?.toString()).toBe('bob');
    // And the on-disk tree has the two scopes side-by-side.
    const top = await readdir(root);
    expect(top.sort()).toEqual(['usr_a', 'usr_b']);
  });
});

describe('R2StorageProvider — stubbed S3Client', () => {
  /**
   * Stub the S3Client.send so we capture what command + Bucket /
   * Key were issued. Lets us verify the R2 key shape matches the
   * local layout (so a migration script writing R2 keys can rewrite
   * row.storage_path with no other changes).
   */
  function makeFakeClient() {
    const sent: Array<{ commandName: string; input: Record<string, unknown> }> = [];
    const client = {
      send: vi.fn(
        async (cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
          sent.push({ commandName: cmd.constructor.name, input: cmd.input });
          if (cmd.constructor.name === 'GetObjectCommand') {
            // Return a fake readable stream with the bytes for the round
            // trip; consumer awaits `for await (chunk of body)`.
            async function* body(): AsyncGenerator<Buffer> {
              yield Buffer.from('stub-bytes');
            }
            return { Body: body() };
          }
          return {};
        },
      ),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    return { client, sent };
  }

  it('put issues PutObjectCommand with Bucket + Key derived from layout', async () => {
    const { client, sent } = makeFakeClient();
    const provider = new R2StorageProvider(
      {
        endpoint: 'https://r2.example',
        accessKeyId: 'x',
        secretAccessKey: 'y',
        bucket: 'holaday-files',
      },
      fakeLogger,
      { client },
    );
    const { storagePath } = await provider.put({
      userExternalId: 'usr_q',
      kind: 'input',
      fileExternalId: 'file_q',
      filename: 'q.png',
      buffer: Buffer.from('img'),
      mimetype: 'image/png',
    });
    expect(storagePath).toBe('usr_q/input/file_q/q.png');
    expect(sent).toHaveLength(1);
    expect(sent[0]?.commandName).toBe('PutObjectCommand');
    expect(sent[0]?.input).toMatchObject({
      Bucket: 'holaday-files',
      Key: 'usr_q/input/file_q/q.png',
      ContentType: 'image/png',
    });
  });

  it('putFile streams a local artifact into PutObjectCommand', async () => {
    const { client, sent } = makeFakeClient();
    const provider = new R2StorageProvider(
      {
        endpoint: 'https://r2.example',
        accessKeyId: 'x',
        secretAccessKey: 'y',
        bucket: 'holaday-files',
      },
      fakeLogger,
      { client },
    );
    const sourcePath = path.join(tmpdir(), `holaday-r2-put-${Date.now()}.mp4`);
    await writeFile(sourcePath, Buffer.from('streamed-video'));
    try {
      const { storagePath } = await provider.putFile({
        userExternalId: 'usr_q',
        kind: 'output',
        fileExternalId: 'file_video',
        filename: 'video.mp4',
        sourcePath,
        sizeBytes: 14,
        mimetype: 'video/mp4',
      });
      expect(storagePath).toBe('usr_q/output/file_video/video.mp4');
      expect(sent[0]?.input).toMatchObject({
        Bucket: 'holaday-files',
        Key: 'usr_q/output/file_video/video.mp4',
        ContentLength: 14,
        ContentType: 'video/mp4',
      });
      expect(sent[0]?.input.Body).toBeDefined();
    } finally {
      await rm(sourcePath, { force: true });
    }
  });

  it('get reads back bytes from the stubbed stream', async () => {
    const { client } = makeFakeClient();
    const provider = new R2StorageProvider(
      {
        endpoint: 'https://r2.example',
        accessKeyId: 'x',
        secretAccessKey: 'y',
        bucket: 'b',
      },
      fakeLogger,
      { client },
    );
    const buf = await provider.get('any/key');
    expect(buf?.toString('utf-8')).toBe('stub-bytes');
  });

  it('get returns null on NoSuchKey (S3 404)', async () => {
    const client = {
      send: vi.fn(async () => {
        const err = new Error('not found') as Error & { name: string };
        err.name = 'NoSuchKey';
        throw err;
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const provider = new R2StorageProvider(
      {
        endpoint: 'https://r2.example',
        accessKeyId: 'x',
        secretAccessKey: 'y',
        bucket: 'b',
      },
      fakeLogger,
      { client },
    );
    expect(await provider.get('missing/key')).toBeNull();
  });

  it('delete surfaces provider failures so durable cleanup rows can be retried', async () => {
    const client = {
      send: vi.fn(async () => {
        throw new Error('R2 unavailable');
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const provider = new R2StorageProvider(
      {
        endpoint: 'https://r2.example',
        accessKeyId: 'x',
        secretAccessKey: 'y',
        bucket: 'b',
      },
      fakeLogger,
      { client },
    );

    await expect(provider.delete('usr/output/file/video.mp4')).rejects.toThrow('R2 unavailable');
  });
});

describe('createStorageProvider — env-driven factory', () => {
  // Snapshot + restore env to avoid leaking state between tests.
  const originalEnv = { ...process.env };
  beforeEach(() => {
    process.env = { ...originalEnv };
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('default (no STORAGE_PROVIDER set) returns LocalStorageProvider', () => {
    Reflect.deleteProperty(process.env, 'STORAGE_PROVIDER');
    const p = createStorageProvider({ logger: fakeLogger, localRoot: '/tmp/test' });
    expect(p).toBeInstanceOf(LocalStorageProvider);
  });

  it('STORAGE_PROVIDER=local returns LocalStorageProvider', () => {
    process.env.STORAGE_PROVIDER = 'local';
    const p = createStorageProvider({ logger: fakeLogger, localRoot: '/tmp/test' });
    expect(p).toBeInstanceOf(LocalStorageProvider);
  });

  it('STORAGE_PROVIDER=r2 with full creds returns R2StorageProvider', () => {
    process.env.STORAGE_PROVIDER = 'r2';
    process.env.R2_ENDPOINT = 'https://r2.example';
    process.env.R2_ACCESS_KEY_ID = 'k';
    process.env.R2_SECRET_ACCESS_KEY = 's';
    process.env.R2_BUCKET = 'b';
    const p = createStorageProvider({ logger: fakeLogger });
    expect(p).toBeInstanceOf(R2StorageProvider);
  });

  it('STORAGE_PROVIDER=r2 with missing creds throws (LOUD fail)', () => {
    process.env.STORAGE_PROVIDER = 'r2';
    Reflect.deleteProperty(process.env, 'R2_ENDPOINT');
    Reflect.deleteProperty(process.env, 'R2_ACCESS_KEY_ID');
    Reflect.deleteProperty(process.env, 'R2_SECRET_ACCESS_KEY');
    Reflect.deleteProperty(process.env, 'R2_BUCKET');
    expect(() => createStorageProvider({ logger: fakeLogger })).toThrow(
      /STORAGE_PROVIDER=r2 requires/,
    );
  });

  it('unknown STORAGE_PROVIDER value falls back to local + warns', () => {
    process.env.STORAGE_PROVIDER = 'gcs';
    const p = createStorageProvider({ logger: fakeLogger, localRoot: '/tmp/x' });
    expect(p).toBeInstanceOf(LocalStorageProvider);
    expect(fakeLogger.warn).toHaveBeenCalled();
  });
});
