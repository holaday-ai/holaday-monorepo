import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  VideoHttpError,
  downloadToBuffer,
  downloadToFile,
  fetchWithTimeout,
} from './video-http.js';

describe('fetchWithTimeout', () => {
  it('returns the response on success', async () => {
    const fetchImpl = (async () => new Response('ok', { status: 200 })) as unknown as typeof fetch;
    const res = await fetchWithTimeout(
      'https://x',
      { method: 'GET' },
      { timeoutMs: 1000, fetchImpl },
    );
    expect(res.status).toBe(200);
  });

  it('throws VideoHttpError(timeout) when the internal timer aborts', async () => {
    // A fetch that never resolves on its own — only rejects when aborted.
    const fetchImpl = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        const sig = init.signal as AbortSignal;
        const onAbort = () => {
          const e = new Error('aborted');
          e.name = 'AbortError';
          reject(e);
        };
        if (sig.aborted) onAbort();
        else sig.addEventListener('abort', onAbort);
      })) as unknown as typeof fetch;
    await expect(
      fetchWithTimeout('https://x', { method: 'GET' }, { timeoutMs: 10, fetchImpl }),
    ).rejects.toMatchObject({ kind: 'timeout' });
  });

  it('throws VideoHttpError(network) on a non-abort fetch rejection', async () => {
    const fetchImpl = (async () => {
      throw new Error('boom');
    }) as unknown as typeof fetch;
    await expect(
      fetchWithTimeout('https://x', { method: 'GET' }, { timeoutMs: 1000, fetchImpl }),
    ).rejects.toMatchObject({ kind: 'network' });
  });
});

describe('downloadToBuffer', () => {
  it('downloads bytes + content-type', async () => {
    const fetchImpl = (async () =>
      new Response(Buffer.from('hello world'), {
        status: 200,
        headers: { 'content-type': 'video/mp4' },
      })) as unknown as typeof fetch;
    const out = await downloadToBuffer('https://x/a.mp4', { fetchImpl });
    expect(out.buffer.toString('utf-8')).toBe('hello world');
    expect(out.contentType).toBe('video/mp4');
    expect(out.sizeBytes).toBe('hello world'.length);
  });

  it('throws on non-2xx', async () => {
    const fetchImpl = (async () =>
      new Response('nope', { status: 404 })) as unknown as typeof fetch;
    await expect(downloadToBuffer('https://x', { fetchImpl })).rejects.toBeInstanceOf(
      VideoHttpError,
    );
  });

  it('throws when maxBytes is exceeded', async () => {
    const fetchImpl = (async () =>
      new Response(Buffer.alloc(100), { status: 200 })) as unknown as typeof fetch;
    await expect(downloadToBuffer('https://x', { fetchImpl, maxBytes: 10 })).rejects.toBeInstanceOf(
      VideoHttpError,
    );
  });
});

describe('downloadToFile', () => {
  it('streams bytes to disk without returning the body buffer', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'video-http-'));
    const destination = path.join(dir, 'reference.mp4');
    const fetchImpl = (async () =>
      new Response(Buffer.from('streamed-video'), {
        status: 200,
        headers: { 'content-type': 'video/mp4' },
      })) as unknown as typeof fetch;
    try {
      const out = await downloadToFile('https://x/reference.mp4', destination, {
        fetchImpl,
        maxBytes: 100,
      });
      expect(out).toEqual({ contentType: 'video/mp4', sizeBytes: 14 });
      expect(await fs.readFile(destination, 'utf-8')).toBe('streamed-video');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('removes a partial file when the streamed body exceeds maxBytes', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'video-http-'));
    const destination = path.join(dir, 'reference.mp4');
    const fetchImpl = (async () =>
      new Response(Buffer.alloc(100), { status: 200 })) as unknown as typeof fetch;
    try {
      await expect(
        downloadToFile('https://x/reference.mp4', destination, {
          fetchImpl,
          maxBytes: 10,
        }),
      ).rejects.toBeInstanceOf(VideoHttpError);
      await expect(fs.stat(destination)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
