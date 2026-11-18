import { describe, expect, it, vi } from 'vitest';
import { BrowserTaskOutputs, taskFileRequirements } from './browser-task-output.js';

const input = { filename: 'analysis.csv', format: 'csv', content: 'metric,value\nsum,1099.9\n' };
const receipt = {
  fileId: 'file_real',
  filename: 'analysis.csv',
  size: 25,
  downloadUrl: '/api/files/file_real/download',
};
describe('task-owned generated outputs', () => {
  it.each([
    '分析我提供的 report.csv，给出数量合计',
    '分析提供的 report.csv 并统计数量',
    'Read the provided report.csv and report the total',
  ])('does not treat an input reference as output delivery: %s', (intent) => {
    expect(taskFileRequirements(intent)).toEqual([]);
  });
  it.each([
    '生成两个 CSV 文件，一个按地区，一个按月份',
    'Create 2 CSV files',
    'Generate two CSV files',
  ])('requires two distinct generated receipts: %s', async (intent) => {
    let next = 0;
    const outputs = new BrowserTaskOutputs({
      formats: ['csv'],
      current: async () => true,
      store: async ({ filename }) => {
        const fileId = `file_${++next}`;
        return { ...receipt, filename, fileId, downloadUrl: `/api/files/${fileId}/download` };
      },
    });
    await outputs.create(input);
    expect(outputs.gap(intent)).toBeTruthy();
    await outputs.create({ ...input, filename: 'monthly.csv' });
    expect(outputs.gap(intent)).toBeNull();
  });
  it('requires both an allowed format and a host store before advertising generation', () => {
    expect(new BrowserTaskOutputs({ formats: ['csv'], current: async () => true }).tools).toEqual(
      [],
    );
    expect(
      new BrowserTaskOutputs({ store: async () => receipt, current: async () => true }).tools,
    ).toEqual([]);
  });
  it('does not use a downloaded CSV as proof that a new analysis CSV was generated', () => {
    const outputs = new BrowserTaskOutputs({ current: async () => true });
    outputs.admitDownload({
      fileId: 'original',
      filename: 'source.csv',
      sizeBytes: 20,
      sha256: 'a'.repeat(64),
      downloadUrl: '/api/files/original/download',
    });
    expect(outputs.gap('下载原报表后，生成一份CSV分析文件')).toBeTruthy();
  });
  it('deduplicates the same saved content and fulfills named output only with an actual receipt', async () => {
    const store = vi.fn(async () => receipt);
    const outputs = new BrowserTaskOutputs({ store, formats: ['csv'], current: async () => true });
    expect(outputs.gap('生成 analysis.csv')).toBeTruthy();
    expect(await outputs.create(input)).toMatchObject({ ok: true, file: receipt });
    expect(await outputs.create(input)).toMatchObject({ ok: true, file: receipt });
    expect(store).toHaveBeenCalledOnce();
    expect(outputs.gap('生成 analysis.csv')).toBeNull();
    expect(outputs.attach('```holaday-file\n{"fileId":"fake"}\n```')).not.toContain('fake');
    expect(outputs.attach('完成')).toContain('file_real');
  });
  it.each(['throw', 'wrong-url', 'returned-error'] as const)(
    'stops on %s and never retries an uncertain write',
    async (fault) => {
      const store = vi.fn(async () => {
        if (fault === 'throw') throw new Error('lost receipt');
        return fault === 'returned-error'
          ? { error: 'write unavailable' }
          : { ...receipt, downloadUrl: '/forged' };
      });
      const outputs = new BrowserTaskOutputs({
        store,
        formats: ['csv'],
        current: async () => true,
      });
      expect(await outputs.create(input)).toMatchObject({ ok: false, fatal: true });
      expect(await outputs.create(input)).toMatchObject({ ok: false, fatal: true });
      expect(store).toHaveBeenCalledOnce();
      expect(outputs.gap('生成 analysis.csv')).toBeTruthy();
    },
  );
  it('discards a late saved receipt after task authority changes', async () => {
    let current = true;
    const outputs = new BrowserTaskOutputs({
      formats: ['csv'],
      current: async () => current,
      store: async () => {
        current = false;
        return receipt;
      },
    });
    expect(await outputs.create(input)).toMatchObject({ ok: false, fatal: true });
    expect(outputs.attach('')).not.toContain('file_real');
  });
  it('stops awaiting a hung write on cancellation without publishing or retrying', async () => {
    const controller = new AbortController();
    let resolve!: (value: typeof receipt) => void;
    const store = vi.fn(
      () =>
        new Promise<typeof receipt>((done) => {
          resolve = done;
        }),
    );
    const outputs = new BrowserTaskOutputs({
      store,
      signal: controller.signal,
      formats: ['csv'],
      current: async () => !controller.signal.aborted,
    });
    const pending = outputs.create(input);
    await vi.waitFor(() => expect(store).toHaveBeenCalledOnce());
    controller.abort();
    expect(await pending).toMatchObject({ ok: false, fatal: true });
    resolve(receipt);
    await Promise.resolve();
    expect(outputs.attach('')).not.toContain('file_real');
    expect(await outputs.create(input)).toMatchObject({ ok: false, fatal: true });
    expect(store).toHaveBeenCalledOnce();
  });
  it('rejects a path or unallowed format before writing', async () => {
    const store = vi.fn(async () => receipt);
    const outputs = new BrowserTaskOutputs({ store, formats: ['csv'], current: async () => true });
    expect(await outputs.create({ ...input, filename: '/tmp/analysis.csv' })).toMatchObject({
      ok: false,
    });
    expect(await outputs.create({ ...input, format: 'pdf' })).toMatchObject({ ok: false });
    expect(store).not.toHaveBeenCalled();
  });
});
