import { describe, expect, it } from 'vitest';
import { utils, write } from 'xlsx';
import { parseFileForPrompt } from './parsers.js';

describe('complete core text parsing', () => {
  it.each([
    [
      'synthetic.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      Buffer.from('PK synthetic zipped document'),
    ],
    ['synthetic.txt', 'text/plain', Buffer.from([0x61, 0xff, 0x62])],
    ['synthetic.txt', 'text/plain', Buffer.from([0x61, 0x00, 0x62])],
    ['synthetic.docx', 'application/json', Buffer.from('PK synthetic zipped document')],
  ] as const)(
    'rejects unsupported binary or invalid UTF-8 input: %s',
    async (filename, mimetype, body) => {
      const error = await parseFileForPrompt(body, filename, mimetype, { completeText: true }).then(
        () => null,
        (reason: unknown) => reason,
      );
      expect(error).toMatchObject({ message: 'CORE_FILE_UNREADABLE' });
    },
  );

  it('does not count names of empty worksheets as readable material', async () => {
    const workbook = utils.book_new();
    utils.book_append_sheet(workbook, utils.aoa_to_sheet([]), 'SyntheticA');
    utils.book_append_sheet(workbook, utils.aoa_to_sheet([]), 'SyntheticB');
    const error = await parseFileForPrompt(
      write(workbook, { type: 'buffer', bookType: 'xlsx' }),
      'synthetic.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      { completeText: true },
    ).then(
      () => null,
      (reason: unknown) => reason,
    );
    expect(error).toMatchObject({ message: 'CORE_FILE_UNREADABLE' });
  });

  it('retains zero and false cell values as nonempty spreadsheet content', async () => {
    const workbook = utils.book_new();
    utils.book_append_sheet(workbook, utils.aoa_to_sheet([[0, false]]), 'SyntheticValues');
    const parsed = await parseFileForPrompt(
      write(workbook, { type: 'buffer', bookType: 'xlsx' }),
      'synthetic.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      { completeText: true },
    );
    const block = parsed.blocks[0];
    expect(block?.type === 'text' && block.text.includes('0,FALSE')).toBe(true);
  });

  it('preserves the tail of an in-budget file beyond the legacy character ceiling', async () => {
    const body = `${'a'.repeat(55_000)}CORE_TAIL`;
    const parsed = await parseFileForPrompt(Buffer.from(body), 'synthetic.txt', 'text/plain', {
      completeText: true,
    });
    expect(parsed.truncated).toBe(false);
    expect(parsed.blocks).toEqual([{ type: 'text', text: `[附件: synthetic.txt]\n${body}` }]);
  });

  it.each(['a'.repeat(65_537), '字'.repeat(22_000)])(
    'rejects oversized complete input before producing a misleading partial block',
    async (body) => {
      await expect(
        parseFileForPrompt(Buffer.from(body), 'synthetic.txt', 'text/plain', {
          completeText: true,
        }),
      ).rejects.toThrow('CORE_FILE_INPUT_LIMIT');
    },
  );

  it('rejects empty content instead of treating a filename heading as evidence', async () => {
    await expect(
      parseFileForPrompt(Buffer.from(' \n\t'), 'synthetic.txt', 'text/plain', {
        completeText: true,
      }),
    ).rejects.toThrow('CORE_FILE_UNREADABLE');
  });

  it('does not replace a failed PDF parse with an error string in the evidence channel', async () => {
    await expect(
      parseFileForPrompt(Buffer.from('synthetic invalid pdf'), 'synthetic.pdf', 'application/pdf', {
        completeText: true,
      }),
    ).rejects.toThrow('CORE_FILE_UNREADABLE');
  });

  it('retains the legacy truncation behavior when complete mode is not requested', async () => {
    const parsed = await parseFileForPrompt(
      Buffer.from(`${'a'.repeat(55_000)}LEGACY_TAIL`),
      'synthetic.txt',
      'text/plain',
    );
    expect(parsed.truncated).toBe(true);
    expect(JSON.stringify(parsed.blocks)).not.toContain('LEGACY_TAIL');
  });
});
