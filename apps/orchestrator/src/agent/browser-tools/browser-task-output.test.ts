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
    '导出 report.csv，再生成 analysis.csv，核对新CSV结构后把两份文件交给我',
    '导出 report.csv，再生成 analysis.csv，核对后再把两份文件交给我',
  ])(
    'keeps validation before a combined handoff outside the new-file count: %s',
    async (intent) => {
      const outputs = new BrowserTaskOutputs({
        current: async () => true,
        formats: ['csv'],
        store: async () => receipt,
      });
      outputs.admitDownload({
        fileId: 'original',
        filename: 'report.csv',
        sizeBytes: 10,
        sha256: 'a'.repeat(64),
        downloadUrl: '/api/files/original/download',
      });
      await outputs.create(input);
      expect(outputs.gap(intent)).toBeNull();
    },
  );

  it('keeps the named original in a final combined handoff out of generated requirements', async () => {
    const outputs = new BrowserTaskOutputs({
      current: async () => true,
      formats: ['csv'],
      store: async ({ filename }) => ({ ...receipt, filename }),
    });
    outputs.admitDownload({
      fileId: 'original',
      filename: 'package.json',
      sizeBytes: 4409,
      sha256: 'b'.repeat(64),
      downloadUrl: '/api/files/original/download',
    });
    await outputs.create({ ...input, filename: 'package-summary.csv' });
    expect(
      outputs.gap(
        '下载原件package.json，用read_task_file完整读取。生成package-summary.csv，列section,count；对新CSV核对结构。最后交付原package.json和新package-summary.csv两份下载链接；不另生成JSON。',
      ),
    ).toBeNull();
  });

  it('still requires two new files when the request has no original-export handoff', async () => {
    const outputs = new BrowserTaskOutputs({
      current: async () => true,
      formats: ['csv'],
      store: async () => receipt,
    });
    outputs.admitDownload({
      fileId: 'unrequested-original',
      filename: 'report.csv',
      sizeBytes: 10,
      sha256: 'c'.repeat(64),
      downloadUrl: '/api/files/unrequested-original/download',
    });
    await outputs.create(input);
    expect(outputs.gap('生成两份CSV，核对结构后把两份文件交给我')).toBeTruthy();
  });
  it('keeps an explicitly named filename containing a classifier literal', () => {
    expect(taskFileRequirements('生成文件，文件名为“一份summary.csv”')).toContainEqual({
      filename: '一份summary.csv',
      format: 'csv',
    });
  });
  it('still requires a new JSON when generation explicitly requests JSON and CSV', async () => {
    let next = 0;
    const outputs = new BrowserTaskOutputs({
      current: async () => true,
      formats: ['csv', 'json'],
      store: async ({ filename }) => {
        const fileId = `generated_${++next}`;
        return { ...receipt, fileId, filename, downloadUrl: `/api/files/${fileId}/download` };
      },
    });
    outputs.admitDownload({
      fileId: 'original-json',
      filename: 'measurements.json',
      sizeBytes: 20,
      sha256: 'a'.repeat(64),
      downloadUrl: '/api/files/original-json/download',
    });
    const intent =
      '下载 measurements.json，生成 summary.csv 和 new.json；交付原始JSON和两份新文件。';
    await outputs.create({ ...input, filename: 'summary.csv' });
    expect(outputs.gap(intent)).toBeTruthy();
    await outputs.create({ filename: 'new.json', format: 'json', content: '{}' });
    expect(outputs.gap(intent)).toBeNull();
  });
  it('delivers an original JSON plus a generated CSV without generating a forbidden extra JSON', async () => {
    const outputs = new BrowserTaskOutputs({
      current: async () => true,
      formats: ['csv'],
      store: async ({ filename }) => ({ ...receipt, filename }),
    });
    outputs.admitDownload({
      fileId: 'original-json',
      filename: 'measurements.json',
      sizeBytes: 7560,
      sha256: 'a'.repeat(64),
      downloadUrl: '/api/files/original-json/download',
    });
    const intent =
      '只读下载原始JSON，完整读取。生成一份summary.csv，列为measurement,phase,files,total,passed,failed,pending；保留各批次原始失败数。交付原始JSON和新CSV共两份；不评论、不改仓库、不另生成JSON。';
    expect(outputs.gap(intent)).toBeTruthy();
    await outputs.create({ ...input, filename: 'summary.csv' });
    expect(outputs.gap(intent)).toBeNull();
  });
  it.each(['不另生成JSON', '不要额外生成PDF', '无需再生成XLSX'])(
    'keeps a negated extra output outside the delivery contract: %s',
    async (negative) => {
      const intent = `生成 analysis.csv；${negative}。`;
      expect(taskFileRequirements(intent).every((item) => item.format === 'csv')).toBe(true);
      const outputs = new BrowserTaskOutputs({
        current: async () => true,
        formats: ['csv'],
        store: async () => receipt,
      });
      await outputs.create(input);
      expect(outputs.gap(intent)).toBeNull();
    },
  );
  it.each([
    '从此网站导出 report.csv 原始文件，读取并完整统计金额总和和数据行数，再生成 analysis.csv，把两份文件交给我',
    'Download report.csv, generate analysis.csv, and give me 2 files',
    '下载原报表，再生成分析文件，把这两份文件交给我',
  ])('counts combined delivery separately from newly generated outputs: %s', async (intent) => {
    const outputs = new BrowserTaskOutputs({
      current: async () => true,
      formats: ['csv'],
      store: async () => receipt,
    });
    outputs.admitDownload({
      fileId: 'original',
      filename: 'report.csv',
      sizeBytes: 20,
      sha256: 'a'.repeat(64),
      downloadUrl: '/api/files/original/download',
    });
    expect(outputs.gap(intent)).toBeTruthy();
    await outputs.create(input);
    expect(outputs.gap(intent)).toBeNull();
  });
  it('still requires two generated CSVs when the final three files include an original', async () => {
    let next = 0;
    const outputs = new BrowserTaskOutputs({
      current: async () => true,
      formats: ['csv'],
      store: async ({ filename }) => {
        const fileId = `new_${++next}`;
        return { ...receipt, fileId, filename, downloadUrl: `/api/files/${fileId}/download` };
      },
    });
    outputs.admitDownload({
      fileId: 'original',
      filename: 'report.csv',
      sizeBytes: 20,
      sha256: 'a'.repeat(64),
      downloadUrl: '/api/files/original/download',
    });
    const intent = '导出 report.csv，再生成两个 CSV 文件，把三份文件交给我';
    await outputs.create(input);
    expect(outputs.gap(intent)).toBeTruthy();
    await outputs.create({ ...input, filename: 'monthly.csv' });
    expect(outputs.gap(intent)).toBeNull();
  });
  it('requires a new receipt even when combined delivery already has two originals', async () => {
    const outputs = new BrowserTaskOutputs({
      current: async () => true,
      formats: ['csv'],
      store: async () => receipt,
    });
    for (const fileId of ['original-a', 'original-b'])
      outputs.admitDownload({
        fileId,
        filename: `${fileId}.csv`,
        sizeBytes: 20,
        sha256: 'a'.repeat(64),
        downloadUrl: `/api/files/${fileId}/download`,
      });
    const intent = '下载原表，再生成分析，把两份文件交给我';
    expect(outputs.gap(intent)).toBeTruthy();
    await outputs.create(input);
    expect(outputs.gap(intent)).toBeNull();
  });
  it.each([
    '不要下载 report.csv，生成 analysis.csv，把两份文件交给我',
    'Do not download report.csv, create analysis.csv, and give me 2 files',
  ])('does not interpret a negated source operation as mixed delivery: %s', async (intent) => {
    let next = 0;
    const outputs = new BrowserTaskOutputs({
      current: async () => true,
      formats: ['csv'],
      store: async ({ filename }) => {
        const fileId = `new_${++next}`;
        return { ...receipt, fileId, filename, downloadUrl: `/api/files/${fileId}/download` };
      },
    });
    outputs.admitDownload({
      fileId: 'original',
      filename: 'report.csv',
      sizeBytes: 20,
      sha256: 'a'.repeat(64),
      downloadUrl: '/api/files/original/download',
    });
    await outputs.create(input);
    expect(outputs.gap(intent)).toBeTruthy();
    await outputs.create({ ...input, filename: 'monthly.csv' });
    expect(outputs.gap(intent)).toBeNull();
  });
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
