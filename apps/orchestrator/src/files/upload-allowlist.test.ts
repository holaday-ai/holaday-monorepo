import { describe, it, expect, vi } from 'vitest';
import {
  isAcceptedUpload,
  isMacroOfficeUpload,
  decodeUploadFilename,
  contentDispositionAttachment,
  looksLikeMojibake,
  ACCEPTED_MIMES,
  ACCEPTED_EXTENSIONS,
  FileService,
} from './file-service.js';

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const DOCM_MIME = 'application/vnd.ms-word.document.macroEnabled.12';

describe('upload allowlist — docx must be uploadable (Phase 1 #1 P0)', () => {
  it('allowlist includes the docx mime + extension', () => {
    expect(ACCEPTED_MIMES.has(DOCX_MIME)).toBe(true);
    expect(ACCEPTED_EXTENSIONS.has('.docx')).toBe(true);
  });

  it('accepts a docx by mimetype', () => {
    expect(isAcceptedUpload('发票模板.docx', DOCX_MIME)).toBe(true);
  });

  it('accepts a docx by extension even when the browser sends octet-stream', () => {
    expect(isAcceptedUpload('模板.docx', 'application/octet-stream')).toBe(true);
  });

  it('still accepts xlsx / csv / pdf / images', () => {
    expect(isAcceptedUpload('data.xlsx', XLSX_MIME)).toBe(true);
    expect(isAcceptedUpload('rows.csv', 'text/csv')).toBe(true);
    expect(isAcceptedUpload('doc.pdf', 'application/pdf')).toBe(true);
    expect(isAcceptedUpload('pic.png', 'image/png')).toBe(true);
  });

  it('rejects an unrelated binary', () => {
    expect(isAcceptedUpload('tool.exe', 'application/octet-stream')).toBe(false);
  });
});

describe('macro-Office rejection (docm still refused, coordinates with template-safety)', () => {
  it('flags macro extensions', () => {
    for (const f of ['x.docm', 'x.xlsm', 'x.pptm', 'x.dotm', 'x.xltm']) {
      expect(isMacroOfficeUpload(f, 'application/octet-stream'), f).toBe(true);
    }
  });

  it('flags a macroEnabled mimetype regardless of extension', () => {
    expect(isMacroOfficeUpload('renamed.bin', DOCM_MIME)).toBe(true);
  });

  it('does NOT flag plain docx / xlsx', () => {
    expect(isMacroOfficeUpload('报表.docx', DOCX_MIME)).toBe(false);
    expect(isMacroOfficeUpload('数据.xlsx', XLSX_MIME)).toBe(false);
  });

  it('a .docm is refused by the gate (macro check runs before the allowlist)', () => {
    // The upload route checks isMacroOfficeUpload first → friendly 415.
    // Even if it didn't, .docm is not in the allowlist.
    expect(isMacroOfficeUpload('m.docm', DOCM_MIME)).toBe(true);
    expect(isAcceptedUpload('m.docm', 'application/octet-stream')).toBe(false);
  });
});

describe('decodeUploadFilename (P2 — multipart latin1→utf8)', () => {
  it('recovers a Chinese name that multer decoded as latin1 (the mojibake root cause)', () => {
    const mojibake = Buffer.from('发票模板.docx', 'utf8').toString('latin1');
    expect(mojibake).not.toBe('发票模板.docx'); // sanity: it IS garbled
    expect(decodeUploadFilename(mojibake)).toBe('发票模板.docx');
  });
  it('leaves an already-correct Unicode name untouched (filename* / RFC 5987)', () => {
    expect(decodeUploadFilename('报价单.xlsx')).toBe('报价单.xlsx');
  });
  it('leaves a plain ASCII name untouched', () => {
    expect(decodeUploadFilename('invoice-2026.docx')).toBe('invoice-2026.docx');
  });
  it('does NOT corrupt a genuine latin1 name (no valid-UTF-8 recovery)', () => {
    expect(decodeUploadFilename('café.docx')).toBe('café.docx');
  });
  it('handles empty input', () => {
    expect(decodeUploadFilename('')).toBe('');
  });
});

describe('contentDispositionAttachment (P0 / E10 — download filename encoding)', () => {
  // The full chain that mojibake'd in E10: a Chinese template name flows into
  // the filled output name "周报模板-已填充.xlsx" and must survive download.
  it('keeps a CJK output name intact via RFC 5987 filename*', () => {
    const name = '周报模板-已填充.xlsx';
    const header = contentDispositionAttachment(name);
    const m = header.match(/filename\*=UTF-8''([^;]+)$/);
    expect(m, header).toBeTruthy();
    // the star param round-trips back to the exact UTF-8 name (no mojibake)
    expect(decodeURIComponent(m![1]!)).toBe(name);
  });

  it('the ASCII fallback filename= is pure ASCII (never latin1 mojibake)', () => {
    const header = contentDispositionAttachment('周报模板-已填充.xlsx');
    const ascii = header.match(/filename="([^"]*)"/)?.[1] ?? '';
    expect(ascii).toMatch(/^[\x20-\x7e]*$/); // ASCII-only
    expect(ascii).toContain('.xlsx'); // extension preserved
    expect(ascii).not.toMatch(/å|æ|¥/); // not the mojibake bytes
  });

  it('leaves an ASCII name as-is in both params', () => {
    const header = contentDispositionAttachment('report-2026.xlsx');
    expect(header).toContain('filename="report-2026.xlsx"');
    expect(header).toContain("filename*=UTF-8''report-2026.xlsx");
  });

  it('quotes/backslashes in the name cannot break out of filename=', () => {
    const header = contentDispositionAttachment('a"b\\c.xlsx');
    const ascii = header.match(/filename="([^"]*)"/)?.[1] ?? '';
    expect(ascii).not.toContain('"');
    expect(ascii).not.toContain('\\');
  });

  it('falls back to "download" for an empty name', () => {
    expect(contentDispositionAttachment('')).toContain('filename="download"');
  });
});

describe('looksLikeMojibake (P0 / E10 — output-name defense)', () => {
  it('flags UTF-8-as-latin1 mojibake (C1 control bytes)', () => {
    // 周报模板 stored as latin1 → the classic å¨æ¥… garble (has C1 controls)
    const garble = Buffer.from('周报模板', 'utf8').toString('latin1');
    expect(looksLikeMojibake(garble)).toBe(true);
  });
  it('flags a replacement char', () => {
    expect(looksLikeMojibake('bad�name')).toBe(true);
  });
  it('does NOT flag clean CJK', () => {
    expect(looksLikeMojibake('周报模板')).toBe(false);
  });
  it('does NOT flag a genuine accented latin name (café)', () => {
    expect(looksLikeMojibake('café')).toBe(false);
  });
  it('does NOT flag plain ASCII or empty', () => {
    expect(looksLikeMojibake('report-2026')).toBe(false);
    expect(looksLikeMojibake('')).toBe(false);
  });
  it('a recoverable mojibake name, once repaired, is no longer flagged', () => {
    const garble = Buffer.from('周报模板', 'utf8').toString('latin1');
    expect(looksLikeMojibake(decodeUploadFilename(garble))).toBe(false); // → 周报模板
  });
});

function collectColumnNames(node: unknown, out = new Set<string>()): Set<string> {
  if (!node || typeof node !== 'object') return out;
  const record = node as Record<string, unknown>;
  if (typeof record.name === 'string' && typeof record.columnType === 'string') {
    out.add(record.name);
  }
  const chunks = record.queryChunks;
  if (Array.isArray(chunks)) {
    for (const chunk of chunks) collectColumnNames(chunk, out);
  }
  return out;
}

describe('FileService.linkToTask ownership guard', () => {
  it('creates presigned pending uploads with a finite expiry for cleanup', async () => {
    let inserted: Record<string, unknown> | undefined;
    const db = {
      insert: () => ({
        values: (row: Record<string, unknown>) => {
          inserted = row;
          return Promise.resolve();
        },
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const logger = {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
      debug: () => undefined,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const storage = {
      getSignedPutUrl: () =>
        Promise.resolve({ url: 'https://r2.example/upload', storagePath: 'usr/input/file/clip.mp4' }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const service = new FileService(db, logger, storage);
    const out = await service.createPendingUpload({
      userIdInternal: 7,
      userExternalId: 'usr_owner',
      filename: 'clip.mp4',
      mimetype: 'video/mp4',
      declaredSize: 123,
    });

    expect(out?.uploadUrl).toContain('r2.example');
    expect(inserted?.status).toBe('pending');
    expect(inserted?.expiresAt).toBeInstanceOf(Date);
    expect((inserted?.expiresAt as Date).getTime()).toBeGreaterThan(Date.now());
    // Regression guard: presigned-pending uploads (kind='input') keep their own
    // 24h TTL. The OUTPUT_FILE_TTL_DAYS (30d) change to storeOutput must NOT
    // leak here — pin this path to ~24h so a future refactor can't conflate them.
    const pendingTtlMs = (inserted?.expiresAt as Date).getTime() - Date.now();
    expect(pendingTtlMs).toBeGreaterThan(23 * 60 * 60 * 1000);
    expect(pendingTtlMs).toBeLessThanOrEqual(24 * 60 * 60 * 1000 + 5_000);
  });

  it('clears the upload expiry only when an input is retained as a durable asset', async () => {
    let row: Record<string, unknown> = {
      externalId: 'file_base',
      userId: 7,
      kind: 'input',
      filename: 'base.mp4',
      mimetype: 'video/mp4',
      sizeBytes: 456,
      storagePath: 'usr/input/file_base/base.mp4',
      status: 'active',
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    };
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve([row]),
          }),
        }),
      }),
      update: () => ({
        set: (values: Record<string, unknown>) => ({
          where: () => {
            row = { ...row, ...values };
            return Promise.resolve();
          },
        }),
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const storage = {
      stat: vi.fn(async () => ({ sizeBytes: 456, contentType: 'video/mp4' })),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const service = new FileService(db, logger, storage);
    const retained = await service.retainInputForUser('file_base', 7);

    expect(retained).toBe(true);
    expect(row).toMatchObject({ status: 'active', expiresAt: null });
  });

  it('does not mint a provider URL for an inactive or missing storage object', async () => {
    const row = {
      externalId: 'file_stale',
      userId: 7,
      status: 'expired',
      expiresAt: null,
      storagePath: 'usr/input/file_stale/base.mp4',
    };
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve([row]),
          }),
        }),
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const storage = {
      stat: vi.fn(async () => null),
      getSignedUrl: vi.fn(async () => 'https://r2.example/stale'),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const service = new FileService(db, logger, storage);

    await expect(service.isReadableForUser('file_stale', 7)).resolves.toBe(false);
    await expect(service.signedReadUrl('file_stale', 7)).resolves.toBeNull();
    expect(storage.getSignedUrl).not.toHaveBeenCalled();
  });

  it('updates attachment task_id only when external_id, owner user_id, and active status match', async () => {
    let whereClause: unknown;
    const db = {
      update: () => ({
        set: () => ({
          where: (condition: unknown) => {
            whereClause = condition;
            return Promise.resolve();
          },
        }),
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const logger = {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
      debug: () => undefined,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const service = new FileService(db, logger);
    await service.linkToTask(['file_foreign'], 42, 7);

    expect(collectColumnNames(whereClause)).toEqual(
      new Set(['external_id', 'user_id', 'status']),
    );
  });

  it('does not load pending presigned uploads before upload-confirm activates them', async () => {
    const row = {
      externalId: 'file_pending',
      userId: 7,
      status: 'pending',
      expiresAt: null,
      storagePath: 'usr/input/file_pending/video.mp4',
    };
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve([row]),
          }),
        }),
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const logger = {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
      debug: () => undefined,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const storage = {
      get: () => {
        throw new Error('pending upload should not be read');
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const service = new FileService(db, logger, storage);
    await expect(service.loadMany(['file_pending'], 7)).resolves.toEqual([]);
  });

  it('does not download pending presigned uploads before upload-confirm activates them', async () => {
    const row = {
      externalId: 'file_pending',
      userId: 7,
      status: 'pending',
      expiresAt: null,
      storagePath: 'usr/input/file_pending/video.mp4',
    };
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve([row]),
          }),
        }),
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const logger = {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
      debug: () => undefined,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const storage = {
      get: () => {
        throw new Error('pending upload should not be downloaded');
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const service = new FileService(db, logger, storage);
    await expect(service.loadForUser('file_pending', 7)).resolves.toBeNull();
  });

  it('does not load another user’s file even when its external id is known', async () => {
    const row = {
      externalId: 'file_foreign',
      userId: 99,
      status: 'active',
      expiresAt: null,
      storagePath: 'usr_other/input/file_foreign/video.mp4',
    };
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve([row]),
          }),
        }),
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const storage = {
      get: vi.fn(async () => Buffer.from('private')),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const service = new FileService(db, {} as any, storage);

    await expect(service.loadForUser('file_foreign', 7)).resolves.toBeNull();
    expect(storage.get).not.toHaveBeenCalled();
  });
});
