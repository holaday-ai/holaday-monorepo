/**
 * Phase 1 (video) — tests for the presigned-PUT upload primitives:
 *   - classifyUpload / uploadByteLimit (pure: document vs media lane + caps)
 *   - StorageProvider.getSignedPutUrl + StorageProvider.stat
 *
 * R2 getSignedPutUrl is exercised against a REAL S3Client (dummy creds,
 * fake endpoint) — the presigner signs locally with no network, so we can
 * assert the URL shape offline. R2 stat uses a stubbed client (DI).
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MEDIA_UPLOAD_BYTE_LIMIT,
  UPLOAD_BYTE_LIMIT,
  classifyUpload,
  uploadByteLimit,
} from './file-service.js';
import { LocalStorageProvider, R2StorageProvider } from './storage-provider.js';

const fakeLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn(),
  level: 'silent',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

describe('classifyUpload', () => {
  it('classifies video by mime → media', () => {
    expect(classifyUpload('clip.mp4', 'video/mp4')).toBe('media');
    expect(classifyUpload('a.mov', 'video/quicktime')).toBe('media');
  });
  it('classifies audio by mime → media', () => {
    expect(classifyUpload('voice.wav', 'audio/wav')).toBe('media');
    expect(classifyUpload('voice.m4a', 'audio/mp4')).toBe('media');
  });
  it('falls back to extension when mime is octet-stream', () => {
    expect(classifyUpload('clip.mp4', 'application/octet-stream')).toBe('media');
    expect(classifyUpload('voice.m4a', 'application/octet-stream')).toBe('media');
    expect(classifyUpload('doc.pdf', 'application/octet-stream')).toBe('document');
  });
  it('classifies documents → document', () => {
    expect(classifyUpload('report.pdf', 'application/pdf')).toBe('document');
    expect(classifyUpload('data.xlsx', 'application/vnd.ms-excel')).toBe('document');
  });
  it('returns null for unsupported types', () => {
    expect(classifyUpload('a.exe', 'application/x-msdownload')).toBeNull();
    expect(classifyUpload('noext', 'application/x-weird')).toBeNull();
  });
});

describe('uploadByteLimit', () => {
  it('media gets the 200MB cap on paid plans, 0 on free', () => {
    expect(uploadByteLimit('media', 'pro')).toBe(200 * 1024 * 1024);
    expect(uploadByteLimit('media', 'basic')).toBe(200 * 1024 * 1024);
    expect(uploadByteLimit('media', 'free')).toBe(0);
    expect(MEDIA_UPLOAD_BYTE_LIMIT.pro).toBe(200 * 1024 * 1024);
  });
  it('document keeps the existing small caps', () => {
    expect(uploadByteLimit('document', 'pro')).toBe(UPLOAD_BYTE_LIMIT.pro);
    expect(uploadByteLimit('document', 'basic')).toBe(5 * 1024 * 1024);
    expect(uploadByteLimit('document', 'free')).toBe(0);
  });
});

describe('R2StorageProvider.getSignedPutUrl (real presigner, no network)', () => {
  it('returns a signed PUT url + the deterministic storage key', async () => {
    const provider = new R2StorageProvider(
      {
        endpoint: 'https://r2.example',
        accessKeyId: 'x',
        secretAccessKey: 'y',
        bucket: 'holaday-files',
      },
      fakeLogger,
    );
    const signed = await provider.getSignedPutUrl({
      userExternalId: 'usr_x',
      kind: 'input',
      fileExternalId: 'file_y',
      filename: 'clip.mp4',
      contentType: 'video/mp4',
    });
    expect(signed).not.toBeNull();
    expect(signed?.storagePath).toBe('usr_x/input/file_y/clip.mp4');
    expect(signed?.url).toContain('usr_x/input/file_y/clip.mp4');
    expect(signed?.url).toContain('X-Amz-Signature');
  });
});

describe('R2StorageProvider.stat (stubbed S3Client)', () => {
  it('returns size + content-type from a HEAD', async () => {
    const client = {
      send: vi.fn(async (cmd: { constructor: { name: string } }) => {
        if (cmd.constructor.name === 'HeadObjectCommand') {
          return { ContentLength: 12345, ContentType: 'video/mp4' };
        }
        return {};
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const provider = new R2StorageProvider(
      { endpoint: 'https://r2.example', accessKeyId: 'x', secretAccessKey: 'y', bucket: 'b' },
      fakeLogger,
      { client },
    );
    expect(await provider.stat('k')).toEqual({ sizeBytes: 12345, contentType: 'video/mp4' });
  });

  it('returns null when the object is missing (NotFound)', async () => {
    const client = {
      send: vi.fn(async () => {
        const err = new Error('nf') as Error & { name: string };
        err.name = 'NotFound';
        throw err;
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const provider = new R2StorageProvider(
      { endpoint: 'https://r2.example', accessKeyId: 'x', secretAccessKey: 'y', bucket: 'b' },
      fakeLogger,
      { client },
    );
    expect(await provider.stat('missing')).toBeNull();
  });
});

describe('LocalStorageProvider.getSignedPutUrl / stat', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'holaday-presigned-test-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('getSignedPutUrl is null (local cannot presign → caller falls back to multipart)', async () => {
    const provider = new LocalStorageProvider(root, fakeLogger);
    const signed = await provider.getSignedPutUrl({
      userExternalId: 'u',
      kind: 'input',
      fileExternalId: 'f',
      filename: 'a.mp4',
      contentType: 'video/mp4',
    });
    expect(signed).toBeNull();
  });

  it('stat returns real byte size for an existing object, null for a missing one', async () => {
    const provider = new LocalStorageProvider(root, fakeLogger);
    const buf = Buffer.from('hello world video bytes');
    const { storagePath } = await provider.put({
      userExternalId: 'u',
      kind: 'input',
      fileExternalId: 'f',
      filename: 'a.mp4',
      buffer: buf,
      mimetype: 'video/mp4',
    });
    const meta = await provider.stat(storagePath);
    expect(meta?.sizeBytes).toBe(buf.length);
    expect(await provider.stat(path.join(root, 'does-not-exist'))).toBeNull();
  });
});
