import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { TaskFileTransfer } from './task-file-transfer.js';

const file = (text: string, fileId = 'file_731') => ({
  fileId,
  name: `${fileId}.csv`,
  mimeType: 'text/csv',
  sizeBytes: Buffer.byteLength(text),
  sha256: createHash('sha256').update(text).digest('hex'),
});
const chunk = (transferId: string, text: string, offset = 0, fileIndex = 0) => ({
  transferId,
  fileIndex,
  offset,
  data: Buffer.from(text).toString('base64'),
});

describe('task file transfer before the bound native file delivery', () => {
  it('transfers the full 50MiB budget in bounded chunks with the final byte intact', async () => {
    const size = 50 * 1024 * 1024;
    const block = Buffer.alloc(256 * 1024);
    const last = Buffer.from(block);
    last[last.length - 1] = 90;
    const digest = createHash('sha256');
    for (let i = 0; i < 199; i++) digest.update(block);
    digest.update(last);
    let received: number[] | undefined;
    const transfer = new TaskFileTransfer({
      active: () => true,
      deliver: async (files) => {
        const bytes = files[0]!.bytes;
        received = [bytes.length, bytes[0]!, bytes[bytes.length - 1]!];
        return { status: 'handed_to_page' };
      },
    });
    const { transferId } = transfer.begin([
      { ...file(''), sizeBytes: size, sha256: digest.digest('hex') },
    ]);
    for (let i = 0; i < 200; i++) {
      const receipt = transfer.append({
        transferId,
        fileIndex: 0,
        offset: i * block.length,
        data: (i === 199 ? last : block).toString('base64'),
      });
      expect(receipt.nextOffset).toBe((i + 1) * block.length);
    }
    expect((await transfer.commit(transferId)).status).toBe('handed_to_page');
    expect(received).toEqual([52_428_800, 0, 90]);
  }, 20_000);

  it('does not extend the ten-minute lifetime by replaying identical chunks', async () => {
    let now = 0;
    const transfer = new TaskFileTransfer({
      active: () => true,
      now: () => now,
      deliver: async () => ({ status: 'handed_to_page' }),
    });
    const { transferId } = transfer.begin([file('alpha\n')]);
    for (let i = 0; i < 6; i++) {
      now = i * 100_000;
      transfer.append(chunk(transferId, 'alpha\n'));
    }
    now = 600_001;
    await expect(transfer.commit(transferId)).rejects.toThrow('transfer_unavailable');
    transfer.dispose();
  });

  it('reports uncertainty when the scope closes after native delivery begins', async () => {
    let started!: () => void;
    let finish!: () => void;
    const issued = new Promise<void>((resolve) => {
      started = resolve;
    });
    const done = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const transfer = new TaskFileTransfer({
      active: () => true,
      deliver: async () => {
        started();
        await done;
        return { status: 'handed_to_page' };
      },
    });
    const { transferId } = transfer.begin([file('alpha\n')]);
    transfer.append(chunk(transferId, 'alpha\n'));
    const result = transfer.commit(transferId);
    await issued;
    transfer.dispose();
    finish();
    expect((await result).status).toBe('unknown');
    await expect(transfer.commit(transferId)).rejects.toThrow('scope_unavailable');
  });

  it('delivers complete verified files in manifest order exactly once, including repeated commit', async () => {
    let calls = 0;
    const received: string[][] = [];
    const transfer = new TaskFileTransfer({
      active: () => true,
      deliver: async (files) => {
        calls++;
        received.push(files.map((value) => `${value.name}:${Buffer.from(value.bytes).toString()}`));
        return { status: 'handed_to_page' };
      },
    });
    const { transferId } = transfer.begin([file('alpha\n'), file('βeta\n', 'file_732')]);
    transfer.append(chunk(transferId, 'alpha\n'));
    transfer.append(chunk(transferId, 'βeta\n', 0, 1));
    const results = await Promise.all([transfer.commit(transferId), transfer.commit(transferId)]);
    expect(results[0]).toMatchObject({
      transferId,
      status: 'handed_to_page',
      files: [
        { fileId: 'file_731', sizeBytes: 6 },
        { fileId: 'file_732', sizeBytes: 6 },
      ],
    });
    expect(results[1]).toEqual(results[0]);
    expect(await transfer.commit(transferId)).toEqual(results[0]);
    expect(calls).toBe(1);
    expect(received).toEqual([['file_731.csv:alpha\n', 'file_732.csv:βeta\n']]);
  });

  it('accepts an identical earlier chunk but rejects holes, altered repeats and overlaps', async () => {
    let calls = 0;
    const transfer = new TaskFileTransfer({
      active: () => true,
      deliver: async () => {
        calls++;
        return { status: 'handed_to_page' };
      },
    });
    const { transferId } = transfer.begin([file('abcdef')]);
    expect(() => transfer.append(chunk(transferId, 'ef', 4))).toThrow('offset_mismatch');
    expect(transfer.append(chunk(transferId, 'abc'))).toMatchObject({ nextOffset: 3 });
    expect(transfer.append(chunk(transferId, 'abc'))).toMatchObject({ nextOffset: 3 });
    expect(() => transfer.append(chunk(transferId, 'abX'))).toThrow('chunk_mismatch');
    expect(() => transfer.append(chunk(transferId, 'cde', 2))).toThrow('offset_mismatch');
    await expect(transfer.commit(transferId)).rejects.toThrow('file_incomplete');
    expect(calls).toBe(0);
    transfer.append(chunk(transferId, 'def', 3));
    expect((await transfer.commit(transferId)).status).toBe('handed_to_page');
  });

  it('rejects a complete file with the wrong digest before native delivery', async () => {
    let calls = 0;
    const transfer = new TaskFileTransfer({
      active: () => true,
      deliver: async () => {
        calls++;
        return { status: 'handed_to_page' };
      },
    });
    const { transferId } = transfer.begin([file('alpha\n')]);
    transfer.append(chunk(transferId, 'wrong\n'));
    await expect(transfer.commit(transferId)).rejects.toThrow('file_hash_mismatch');
    expect(calls).toBe(0);
  });

  it('does not rerun an uncertain native delivery after a lost receipt', async () => {
    let calls = 0;
    const transfer = new TaskFileTransfer({
      active: () => true,
      deliver: async () => {
        calls++;
        throw new Error('response lost after page got bytes');
      },
    });
    const { transferId } = transfer.begin([file('alpha\n')]);
    transfer.append(chunk(transferId, 'alpha\n'));
    expect((await transfer.commit(transferId)).status).toBe('unknown');
    expect((await transfer.commit(transferId)).status).toBe('unknown');
    expect(() => transfer.begin([file('alpha\n')])).toThrow('upload_outcome_unknown');
    expect(calls).toBe(1);
  });

  it('preserves a known not-applied target rejection without retrying delivery', async () => {
    let calls = 0;
    const transfer = new TaskFileTransfer({
      active: () => true,
      deliver: async () => {
        calls++;
        return { status: 'not_applied', reason: 'target_changed' };
      },
    });
    const { transferId } = transfer.begin([file('alpha\n')]);
    transfer.append(chunk(transferId, 'alpha\n'));
    expect(await transfer.commit(transferId)).toMatchObject({
      status: 'not_applied',
      reason: 'target_changed',
    });
    expect((await transfer.commit(transferId)).status).toBe('not_applied');
    expect(calls).toBe(1);
  });

  it('checks the live scope again after hashing and before handing bytes to the page', async () => {
    let active = true;
    let calls = 0;
    const transfer = new TaskFileTransfer({
      active: () => active,
      deliver: async () => {
        calls++;
        return { status: 'handed_to_page' };
      },
    });
    const { transferId } = transfer.begin([file('alpha\n')]);
    transfer.append(chunk(transferId, 'alpha\n'));
    const result = transfer.commit(transferId);
    active = false;
    await expect(result).rejects.toThrow('scope_unavailable');
    expect(calls).toBe(0);
  });

  it('bounds aggregate bytes, file count and metadata before accepting a transfer', () => {
    const transfer = new TaskFileTransfer({
      active: () => true,
      deliver: async () => ({ status: 'handed_to_page' }),
    });
    expect(() => transfer.begin([{ ...file(''), sizeBytes: 51 * 1024 * 1024 }])).toThrow(
      'invalid_manifest',
    );
    expect(() => transfer.begin([file(''), file('')])).toThrow('invalid_manifest');
    expect(() =>
      transfer.begin(Array.from({ length: 6 }, (_, i) => file('', `file_${i}`))),
    ).toThrow('invalid_manifest');
    expect(() => transfer.begin([{ ...file(''), name: '../secret.csv' }])).toThrow(
      'invalid_manifest',
    );
    expect(() => transfer.begin([{ ...file(''), path: '/Users/secret' }])).toThrow(
      'invalid_manifest',
    );
    expect(() =>
      transfer.begin([
        { ...file(''), sizeBytes: 30 * 1024 * 1024 },
        { ...file('', 'file_732'), sizeBytes: 30 * 1024 * 1024 },
      ]),
    ).toThrow('invalid_manifest');
  });

  it('rejects oversized, noncanonical or invalid chunks without exposing partial data', () => {
    const transfer = new TaskFileTransfer({
      active: () => true,
      deliver: async () => ({ status: 'handed_to_page' }),
    });
    const { transferId } = transfer.begin([{ ...file(''), sizeBytes: 262145 }]);
    expect(() =>
      transfer.append({
        transferId,
        fileIndex: 0,
        offset: 0,
        data: Buffer.alloc(262145).toString('base64'),
      }),
    ).toThrow('invalid_chunk');
    expect(() => transfer.append({ transferId, fileIndex: 0, offset: 0, data: 'AB==' })).toThrow(
      'invalid_chunk',
    );
    expect(() =>
      transfer.append({ transferId, fileIndex: 0, offset: 0, data: 'data:text/plain,abc' }),
    ).toThrow('invalid_chunk');
  });

  it('expires incomplete data, admits only one transfer and supports zero-byte files', async () => {
    let now = 0;
    let calls = 0;
    const transfer = new TaskFileTransfer({
      active: () => true,
      now: () => now,
      deliver: async () => {
        calls++;
        return { status: 'handed_to_page' };
      },
    });
    const first = transfer.begin([file('alpha\n')]);
    expect(() => transfer.begin([file('other')])).toThrow('transfer_busy');
    transfer.append(chunk(first.transferId, 'alpha\n'));
    now = 120001;
    await expect(transfer.commit(first.transferId)).rejects.toThrow('transfer_unavailable');
    const empty = transfer.begin([file('')]);
    expect((await transfer.commit(empty.transferId)).status).toBe('handed_to_page');
    expect(calls).toBe(1);
  });

  it('clears uncommitted bytes on abort or disposal without calling the native page', async () => {
    let calls = 0;
    const transfer = new TaskFileTransfer({
      active: () => true,
      deliver: async () => {
        calls++;
        return { status: 'handed_to_page' };
      },
    });
    const first = transfer.begin([file('alpha\n')]);
    transfer.append(chunk(first.transferId, 'alpha\n'));
    expect(transfer.abort(first.transferId)).toBe(true);
    await expect(transfer.commit(first.transferId)).rejects.toThrow('transfer_unavailable');
    const second = transfer.begin([file('alpha\n')]);
    transfer.append(chunk(second.transferId, 'alpha\n'));
    transfer.dispose();
    await expect(transfer.commit(second.transferId)).rejects.toThrow('scope_unavailable');
    expect(calls).toBe(0);
  });
});
