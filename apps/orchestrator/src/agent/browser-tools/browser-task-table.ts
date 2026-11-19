import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { setImmediate as yieldTurn } from 'node:timers/promises';
import type ExcelTypes from 'exceljs';
import { z } from 'zod';
import type { NeutralToolDefinition } from '../../llm/messages-adapter.js';
import type { BrowserTaskFiles } from './browser-task-files.js';
import {
  type TableDecimal,
  decimalAdd,
  decimalAverage,
  decimalCompare,
  decimalText,
  tableDecimal,
} from './table-decimal.js';

export const TASK_TABLE_LIMITS = Object.freeze({
  bytes: 8 * 1024 * 1024,
  rows: 100_000,
  columns: 128,
  cells: 1_000_000,
  groups: 2000,
  responseBytes: 32_000,
  queries: 16,
});
const columnId = z.string().regex(/^[A-Z]{1,2}$/);
const metricSchema = z
  .object({
    op: z.enum(['count_rows', 'count_nonempty', 'count_distinct', 'sum', 'avg', 'min', 'max']),
    column: columnId.optional(),
  })
  .strict()
  .refine((metric) =>
    metric.op === 'count_rows' ? metric.column === undefined : metric.column !== undefined,
  );
const filterSchema = z
  .object({
    column: columnId,
    op: z.enum(['eq', 'ne', 'contains', 'gt', 'gte', 'lt', 'lte', 'empty', 'nonempty']),
    value: z.string().max(256).optional(),
  })
  .strict()
  .refine((filter) =>
    ['empty', 'nonempty'].includes(filter.op)
      ? filter.value === undefined
      : filter.value !== undefined,
  );
const base = z.object({
  fileId: z.string().regex(/^[A-Za-z0-9_-]{1,160}$/),
  delimiter: z.enum([',', '\t', ';']).optional(),
  headerRow: z.number().int().min(1).max(100).optional(),
});
export const taskTableRequestSchema = z.discriminatedUnion('mode', [
  base.extend({ mode: z.literal('describe') }).strict(),
  base
    .extend({
      mode: z.literal('aggregate'),
      filters: z.array(filterSchema).max(8).optional(),
      groupBy: z.array(columnId).max(2).optional(),
      metrics: z.array(metricSchema).min(1).max(8),
      offset: z.number().int().min(0).max(TASK_TABLE_LIMITS.groups).optional(),
      limit: z.number().int().min(1).max(50).optional(),
      supersedesAnalysisId: z
        .string()
        .regex(/^tbl_[a-f0-9]{32}$/)
        .optional(),
    })
    .strict(),
]);
export type TaskTableRequest = z.infer<typeof taskTableRequestSchema>;
type Query = Extract<TaskTableRequest, { mode: 'aggregate' }>;
type Metric = Query['metrics'][number];
export interface TaskTableFact {
  id: string;
  fileId: string;
  name: string;
  value: string;
  complete: boolean;
  analysisId?: string;
}
interface MetricResult extends Omit<TaskTableFact, 'value'> {
  value: string | null;
  metricId: string;
  op: Metric['op'];
  column?: string;
  label?: string;
  /** Present only for operations that actually parse numeric cells. */
  numericCount?: number;
  missingCount: number;
  invalidCount: number;
  invalidExamples: string[];
  exact: boolean;
  fractionDigits?: number;
}
interface Scope {
  scannedRows: number;
  matchedRows: number;
  blankRows: number;
  headerRow: number;
  delimiter: string;
  filters: NonNullable<Query['filters']>;
  groupBy: string[];
}
interface BaseResult {
  fileId: string;
  filename: string;
  sha256: string;
  source: ReturnType<BrowserTaskFiles['source']>;
  websiteExportScope: 'not_verified' | 'not_applicable';
  columns: Array<{ id: string; label: string }>;
  scope: Scope;
}
export interface TableDescription extends BaseResult {
  mode: 'describe';
  sample: Array<{ row: number; values: string[]; truncated: boolean }>;
}
export interface TableAggregate extends BaseResult {
  mode: 'aggregate';
  analysisId: string;
  /** Present only after a complete same-scope correction explicitly replaces an old query. */
  supersededAnalysisId?: string;
  overall: MetricResult[];
  groups: Array<{ keys: string[]; rowCount: number; metrics: MetricResult[] }>;
  page: {
    start: number;
    end: number;
    total: number;
    nextOffset: number | null;
    ranges: Array<[number, number]>;
  };
  complete: boolean;
}
export type TaskTableResult = TableDescription | TableAggregate;

export const ANALYZE_TASK_TABLE_TOOL: NeutralToolDefinition = {
  name: 'analyze_task_table',
  description:
    '按本任务提供、下载或已生成的CSV/TSV文件统计；生成文件可读/统计，不增加上传授权。先 describe 读取列位置ID和样本，再 aggregate。数值仅支持明确的十进制（可带科学计数法）；不猜货币/百分号/千分位，不把空白或错误当0。原文件完整扫描，返回行数、筛选、质量与分组分页；只能报告回执中的统计，finish fields 绑定 fileId/tableFactId。纠正不需要的统计指标时，可用 supersedesAnalysisId 指向旧 analysisId；仅同文件/版本/表头/分隔符/筛选/分组且新结果全部完整时替换，旧查询的 fields 随即失效。当前不支持Excel二进制工作簿，请先导出CSV。',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['fileId', 'mode'],
    properties: {
      fileId: { type: 'string' },
      mode: { type: 'string', enum: ['describe', 'aggregate'] },
      delimiter: { type: 'string', enum: [',', '\t', ';'] },
      headerRow: { type: 'integer', minimum: 1, maximum: 100 },
      filters: {
        type: 'array',
        maxItems: 8,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['column', 'op'],
          properties: {
            column: {
              type: 'string',
              description: 'describe 返回的列位置ID，如 A/B，不是可能重复的表头文字。',
            },
            op: {
              type: 'string',
              enum: ['eq', 'ne', 'contains', 'gt', 'gte', 'lt', 'lte', 'empty', 'nonempty'],
            },
            value: { type: 'string', maxLength: 256 },
          },
        },
      },
      groupBy: { type: 'array', maxItems: 2, items: { type: 'string' } },
      metrics: {
        type: 'array',
        minItems: 1,
        maxItems: 8,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['op'],
          properties: {
            op: {
              type: 'string',
              enum: ['count_rows', 'count_nonempty', 'count_distinct', 'sum', 'avg', 'min', 'max'],
            },
            column: { type: 'string' },
          },
        },
      },
      offset: { type: 'integer', minimum: 0 },
      limit: { type: 'integer', minimum: 1, maximum: 50 },
      supersedesAnalysisId: {
        type: 'string',
        pattern: '^tbl_[a-f0-9]{32}$',
        description:
          '明确替换同一范围的旧统计查询；新查询完整后才生效，不能使用旧查询的事实标识交付。',
      },
    },
  },
};

const digest = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
function columnName(index: number): string {
  let result = '';
  for (let n = index + 1; n; n = Math.floor((n - 1) / 26))
    result = String.fromCharCode(65 + ((n - 1) % 26)) + result;
  return result;
}
/** Validate structure/limits before the library allocates cells. The library decodes values. */
async function csvShape(text: string, delimiter: string, signal?: AbortSignal) {
  let state: 'start' | 'plain' | 'quoted' | 'closed' = 'start';
  let rows = 0;
  let columns = 1;
  let width = 1;
  let pending = false;
  const finish = () => {
    rows++;
    width = Math.max(width, columns);
    if (
      rows > TASK_TABLE_LIMITS.rows + 100 ||
      width > TASK_TABLE_LIMITS.columns ||
      rows * width > TASK_TABLE_LIMITS.cells
    )
      throw new Error('CSV超过当前行列/单元格统计上限，未截断分析。');
    columns = 1;
    state = 'start';
    pending = false;
  };
  for (let i = 0; i < text.length; i++) {
    if (i % 65536 === 0) {
      if (signal?.aborted) throw new Error('统计已取消。');
      await yieldTurn();
    }
    const c = text[i]!;
    if (state === 'quoted') {
      if (c === '"') {
        if (text[i + 1] === '"') i++;
        else state = 'closed';
      }
      pending = true;
      continue;
    }
    if (c === delimiter) {
      columns++;
      pending = true;
      state = 'start';
      if (columns > TASK_TABLE_LIMITS.columns) throw new Error('CSV列数超过统计上限。');
      continue;
    }
    if (c === '\r' || c === '\n') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      finish();
      continue;
    }
    if (state === 'closed' || (c === '"' && state !== 'start'))
      throw new Error('CSV引号结构无效，未分析残缺记录。');
    state = c === '"' ? 'quoted' : 'plain';
    pending = true;
  }
  if (state === 'quoted') throw new Error('CSV包含未闭合引号，未分析残缺记录。');
  if (pending) finish();
  if (!rows) throw new Error('CSV没有可读取的记录。');
  return { rows, columns: width };
}
interface MetricState {
  rows: number;
  nonempty: number;
  missing: number;
  invalid: number;
  examples: string[];
  distinct: Set<string>;
  sum: TableDecimal;
  min: TableDecimal | null;
  max: TableDecimal | null;
}
const metricState = (): MetricState => ({
  rows: 0,
  nonempty: 0,
  missing: 0,
  invalid: 0,
  examples: [],
  distinct: new Set(),
  sum: { coefficient: 0n, scale: 0 },
  min: null,
  max: null,
});
function feed(state: MetricState, metric: Metric, value: string) {
  state.rows++;
  if (metric.op === 'count_rows') return;
  if (!value.trim()) {
    state.missing++;
    return;
  }
  state.nonempty++;
  if (metric.op === 'count_distinct') {
    state.distinct.add(value);
    return;
  }
  if (metric.op === 'count_nonempty') return;
  const number = tableDecimal(value);
  if (!number) {
    state.invalid++;
    if (state.examples.length < 3) state.examples.push(value.slice(0, 80));
    return;
  }
  state.sum = decimalAdd(state.sum, number);
  if (!state.min || decimalCompare(number, state.min) < 0) state.min = number;
  if (!state.max || decimalCompare(number, state.max) > 0) state.max = number;
}
function matches(value: string, filter: NonNullable<Query['filters']>[number]): boolean {
  switch (filter.op) {
    case 'empty':
      return !value.trim();
    case 'nonempty':
      return Boolean(value.trim());
    case 'eq':
      return value === filter.value;
    case 'ne':
      return value !== filter.value;
    case 'contains':
      return value.includes(filter.value!);
    default: {
      const a = tableDecimal(value);
      const b = tableDecimal(filter.value!);
      if (!a || !b)
        throw new Error('数值筛选遇到空白或非数值；请明确排除这些记录后再统计，不会静默丢弃。');
      const n = decimalCompare(a, b);
      return filter.op === 'gt'
        ? n > 0
        : filter.op === 'gte'
          ? n >= 0
          : filter.op === 'lt'
            ? n < 0
            : n <= 0;
    }
  }
}
interface AnalysisState {
  fileId: string;
  query: Query;
  result: TableAggregate;
  ranges: Array<[number, number]>;
  quality: boolean;
  supersededBy?: string;
}
/** Pure table calculations over the existing admitted material scope. No code execution or new grants. */
export class BrowserTaskTable {
  private readonly analyses = new Map<string, AnalysisState>();
  private readonly failed = new Set<string>();
  constructor(private readonly files: BrowserTaskFiles) {}
  async run(value: TaskTableRequest, signal?: AbortSignal): Promise<TaskTableResult> {
    const request = taskTableRequestSchema.parse(value);
    try {
      if (signal?.aborted) throw new Error('统计已取消。');
      const [file] = await this.files.resolveReadable(this.files.taskId, [request.fileId]);
      if (!file || !/\.(csv|tsv)$/i.test(file.name))
        throw new Error('当前统计工具只接收CSV/TSV文件；请将工作簿导出为CSV后提供。');
      if (file.buffer.length > TASK_TABLE_LIMITS.bytes)
        throw new Error('CSV超过当前8MB统计预算，未截断分析。');
      let text: string;
      try {
        text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
          .decode(file.buffer)
          .replace(/^\uFEFF/, '');
      } catch {
        throw new Error('CSV不是有效UTF-8文本，请明确转换编码后重新提供。');
      }
      if (text.includes('\u0000')) throw new Error('CSV含二进制空字节，未分析。');
      const delimiter = request.delimiter ?? (/\.tsv$/i.test(file.name) ? '\t' : ',');
      const shape = await csvShape(text, delimiter, signal);
      const headerRow = request.headerRow ?? 1;
      if (headerRow > shape.rows) throw new Error('指定表头行不存在。');
      const sourceStream = Readable.from([Buffer.from(text)]);
      const ExcelJS = (await import('exceljs')).default;
      const workbook = new ExcelJS.Workbook();
      let sheet: ExcelTypes.Worksheet;
      try {
        sheet = await workbook.csv.read(sourceStream, {
          map: (cell: string) => cell,
          parserOptions: { delimiter, headers: false, ignoreEmpty: false, trim: false },
        });
      } finally {
        sourceStream.destroy();
      }
      if (sheet.rowCount > shape.rows || sheet.columnCount > shape.columns)
        throw new Error('CSV解析结构与完整记录不符，未统计。');
      const columns = Array.from({ length: shape.columns }, (_, i) => ({
        id: columnName(i),
        label: sheet.getRow(headerRow).getCell(i + 1).text,
      }));
      if (columns.some((column) => column.label.length > 128))
        throw new Error('表头超过128字符，请选择正确的表头行或更短的列名；未截断表头后猜列。');
      const columnIndex = (id: string) => {
        const index = columns.findIndex((column) => column.id === id);
        if (index < 0) throw new Error('统计列不存在；请先describe并使用真实列位置ID。');
        return index;
      };
      const rows: Array<{ row: number; values: string[] }> = [];
      let blankRows = 0;
      for (let r = headerRow + 1; r <= shape.rows; r++) {
        if (r % 512 === 0) {
          if (signal?.aborted) throw new Error('统计已取消。');
          await yieldTurn();
        }
        const values = columns.map((_, c) => sheet.getRow(r).getCell(c + 1).text);
        if (!values.some((cell) => cell.trim())) blankRows++;
        else rows.push({ row: r, values });
      }
      if (rows.length > TASK_TABLE_LIMITS.rows)
        throw new Error('CSV数据记录超过当前统计上限，未截断分析。');
      const source = this.files.source(file.fileId);
      const baseResult = {
        fileId: file.fileId,
        filename: file.name,
        sha256: digest(file.buffer),
        source,
        websiteExportScope:
          source.kind === 'browser_download'
            ? ('not_verified' as const)
            : ('not_applicable' as const),
        columns,
      };
      const scope: Scope = {
        scannedRows: rows.length,
        matchedRows: rows.length,
        blankRows,
        headerRow,
        delimiter,
        filters: [],
        groupBy: [],
      };
      if (request.mode === 'describe') {
        if (signal?.aborted || !(await this.files.isActive()))
          throw new Error('任务或账号已不可用。');
        this.failed.delete(file.fileId);
        const result: TableDescription = {
          ...baseResult,
          mode: 'describe',
          scope,
          sample: rows.slice(0, 5).map(({ row, values }) => ({
            row,
            values: values.map((cell) => cell.slice(0, 32)),
            truncated: values.some((cell) => cell.length > 32),
          })),
        };
        while (
          Buffer.byteLength(JSON.stringify(result)) > TASK_TABLE_LIMITS.responseBytes &&
          result.sample.length > 0
        )
          result.sample.pop();
        if (Buffer.byteLength(JSON.stringify(result)) > TASK_TABLE_LIMITS.responseBytes)
          throw new Error('表头/样本超过响应预算，未返回截断的完整结构。');
        return result;
      }
      const filters = request.filters ?? [];
      const groupBy = request.groupBy ?? [];
      if (new Set(groupBy).size !== groupBy.length) throw new Error('分组列不能重复。');
      const metricColumns = request.metrics.map((metric) =>
        metric.column ? columnIndex(metric.column) : -1,
      );
      const filterColumns = filters.map((filter) => columnIndex(filter.column));
      const numericFilters = new Set(['gt', 'gte', 'lt', 'lte']);
      for (const filter of filters)
        if (numericFilters.has(filter.op) && !tableDecimal(filter.value!))
          throw new Error('数值筛选条件不是有效十进制。');
      const filterOrder = filters
        .map((filter, index) => ({ filter, index }))
        .sort(
          (a, b) =>
            Number(numericFilters.has(a.filter.op)) - Number(numericFilters.has(b.filter.op)),
        );
      const groupColumns = groupBy.map(columnIndex);
      const overall = request.metrics.map(metricState);
      const groups = new Map<string, { keys: string[]; rows: number; states: MetricState[] }>();
      let matchedRows = 0;
      for (let i = 0; i < rows.length; i++) {
        if (i % 512 === 0) {
          if (signal?.aborted) throw new Error('统计已取消。');
          await yieldTurn();
        }
        const row = rows[i]!.values;
        if (!filterOrder.every(({ filter, index }) => matches(row[filterColumns[index]!]!, filter)))
          continue;
        matchedRows++;
        const keys = groupColumns.map((column) => row[column]!);
        if (keys.some((key) => key.length > 256))
          throw new Error('分组值超过256字符，请选择更短的分组列。');
        const key = JSON.stringify(keys);
        let group = groups.get(key);
        if (!group) {
          if (groups.size >= TASK_TABLE_LIMITS.groups)
            throw new Error('分组数超过2000，未返回截断的全量统计；请缩小范围。');
          group = { keys, rows: 0, states: request.metrics.map(metricState) };
          groups.set(key, group);
        }
        group.rows++;
        request.metrics.forEach((metric, j) => {
          const value = metricColumns[j]! < 0 ? '' : row[metricColumns[j]!]!;
          feed(overall[j]!, metric, value);
          feed(group!.states[j]!, metric, value);
        });
      }
      if (signal?.aborted || !(await this.files.isActive()))
        throw new Error('任务或账号已不可用。');
      const query = {
        fileId: request.fileId,
        mode: 'aggregate',
        headerRow,
        delimiter,
        filters: [...filters].sort((a, b) =>
          JSON.stringify(a) < JSON.stringify(b)
            ? -1
            : JSON.stringify(a) > JSON.stringify(b)
              ? 1
              : 0,
        ),
        groupBy,
        metrics: request.metrics,
      };
      const analysisId = `tbl_${digest(JSON.stringify({ sha256: baseResult.sha256, query })).slice(0, 32)}`;
      if (this.analyses.get(analysisId)?.supersededBy)
        throw new Error('此查询已被完整重核替换，请使用替换后的analysisId和统计回执。');
      const replaced = request.supersedesAnalysisId
        ? this.analyses.get(request.supersedesAnalysisId)
        : undefined;
      if (request.supersedesAnalysisId) {
        const filterKey = (items: Scope['filters']) =>
          JSON.stringify(items.map((item) => JSON.stringify(item)).sort());
        if (
          !replaced ||
          replaced.supersededBy ||
          request.supersedesAnalysisId === analysisId ||
          replaced.fileId !== file.fileId ||
          replaced.result.sha256 !== baseResult.sha256 ||
          replaced.result.scope.headerRow !== headerRow ||
          replaced.result.scope.delimiter !== delimiter ||
          filterKey(replaced.result.scope.filters) !== filterKey(filters) ||
          JSON.stringify(replaced.result.scope.groupBy) !== JSON.stringify(groupBy)
        )
          throw new Error(
            '替换目标必须是本任务同一文件版本、表头、分隔符、筛选和分组下尚未替换的另一统计查询。',
          );
      }
      const metricResults = (states: MetricState[], key: string): MetricResult[] =>
        request.metrics.map((metric, i) => {
          const state = states[i]!;
          const numericCount = state.nonempty - state.invalid;
          const average =
            metric.op === 'avg' && numericCount ? decimalAverage(state.sum, numericCount) : null;
          const value =
            metric.op === 'count_rows'
              ? String(state.rows)
              : metric.op === 'count_nonempty'
                ? String(state.nonempty)
                : metric.op === 'count_distinct'
                  ? String(state.distinct.size)
                  : !numericCount
                    ? null
                    : metric.op === 'avg'
                      ? average!.value
                      : metric.op === 'min'
                        ? decimalText(state.min!)
                        : metric.op === 'max'
                          ? decimalText(state.max!)
                          : decimalText(state.sum);
          const complete = metric.op.startsWith('count_') || (!state.missing && !state.invalid);
          const operationNames = {
            count_rows: '记录数',
            count_nonempty: '非空数量',
            count_distinct: '不同值数量',
            sum: '合计',
            avg: '平均值',
            min: '最小值',
            max: '最大值',
          };
          const label = metric.column ? columns[metricColumns[i]!]!.label : '';
          const name = metric.column
            ? `${label.slice(0, 40)} [${metric.column}] ${operationNames[metric.op]}`
            : operationNames[metric.op];
          return {
            id: `tbf_${digest(`${analysisId}:${key}:${i}`).slice(0, 32)}`,
            fileId: file.fileId,
            name,
            value,
            metricId: `m${i + 1}`,
            ...metric,
            ...(metric.column ? { label } : {}),
            ...(metric.op.startsWith('count_') ? {} : { numericCount }),
            missingCount: state.missing,
            invalidCount: state.invalid,
            invalidExamples: state.examples,
            exact: average?.exact ?? true,
            ...(average && !average.exact ? { fractionDigits: average.fractionDigits } : {}),
            complete,
          };
        });
      const allGroups = [...groups.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, group]) => ({
          keys: group.keys,
          rowCount: group.rows,
          metrics: metricResults(group.states, key),
        }));
      const total = groupBy.length ? allGroups.length : 0;
      const start = request.offset ?? 0;
      let end = Math.min(total, start + (request.limit ?? 25));
      if (start > total) throw new Error('分组分页位置无效。');
      const prior = this.analyses.get(analysisId);
      if (!prior && this.analyses.size >= TASK_TABLE_LIMITS.queries)
        throw new Error('本任务统计查询已到预算上限，请整理当前结果后继续。');
      const overallResults = metricResults(overall, 'overall');
      const quality = overallResults.every((metric) => metric.complete);
      const usedColumns = new Set([...metricColumns, ...filterColumns, ...groupColumns]);
      const makeResult = (end: number): TableAggregate => {
        const ranges = [...(prior?.ranges ?? []), [start, end] as [number, number]].sort(
          (a, b) => a[0] - b[0],
        );
        const merged: Array<[number, number]> = [];
        for (const [from, to] of ranges) {
          const last = merged.at(-1);
          if (last && from <= last[1]) last[1] = Math.max(last[1], to);
          else merged.push([from, to]);
        }
        const complete =
          quality &&
          (!total || (merged.length === 1 && merged[0]![0] === 0 && merged[0]![1] === total));
        let nextGap = 0;
        for (const [from, to] of merged) {
          if (from > nextGap) break;
          nextGap = Math.max(nextGap, to);
        }
        return {
          ...baseResult,
          columns: columns.filter((_, index) => usedColumns.has(index)),
          mode: 'aggregate',
          analysisId,
          ...(replaced && complete ? { supersededAnalysisId: request.supersedesAnalysisId } : {}),
          scope: { ...scope, matchedRows, filters, groupBy },
          overall: overallResults,
          groups: groupBy.length ? allGroups.slice(start, end) : [],
          page: {
            start,
            end,
            total,
            nextOffset: nextGap >= total ? null : nextGap,
            ranges: merged,
          },
          complete,
        };
      };
      let result = makeResult(end);
      while (
        Buffer.byteLength(JSON.stringify(result)) > TASK_TABLE_LIMITS.responseBytes &&
        end > start
      )
        result = makeResult(--end);
      if (
        Buffer.byteLength(JSON.stringify(result)) > TASK_TABLE_LIMITS.responseBytes ||
        (start < total && end === start)
      )
        throw new Error('统计响应超过预算，请减少统计字段或分组列；未截断数字交付。');
      this.analyses.set(analysisId, {
        fileId: file.fileId,
        query: request,
        result,
        ranges: result.page.ranges,
        quality,
      });
      if (replaced && result.complete) replaced.supersededBy = analysisId;
      this.failed.delete(file.fileId);
      return structuredClone(result);
    } catch (error) {
      this.failed.add(request.fileId);
      throw error;
    }
  }
  incomplete(): boolean {
    return (
      this.failed.size > 0 ||
      [...this.analyses.values()].some((state) => !state.supersededBy && !state.result.complete)
    );
  }
  completeFiles(): ReadonlySet<string> {
    const ids = new Set(
      [...this.analyses.values()]
        .filter((state) => !state.supersededBy && state.result.complete)
        .map((state) => state.fileId),
    );
    for (const state of this.analyses.values())
      if (!state.supersededBy && !state.result.complete) ids.delete(state.fileId);
    for (const id of this.failed) ids.delete(id);
    return ids;
  }
  coverageNote(english = false): string {
    return [...this.analyses.values()]
      .filter((state) => !state.supersededBy)
      .map(({ result }) => {
        // Grouped batches may overlap. Automatic result notes describe their
        // coverage; an overall total belongs only to an explicit ungrouped query.
        const metrics = (result.scope.groupBy.length ? [] : result.overall)
          .map(
            (metric) =>
              `${metric.name}=${metric.value ?? (english ? 'no numeric value' : '无数值')}${metric.exact ? '' : ` (${english ? 'rounded decimal places' : '舍入至小数位数'} ${metric.fractionDigits})`}`,
          )
          .join('; ');
        const filterOps = {
          eq: '=',
          ne: '≠',
          contains: english ? 'contains' : '包含',
          gt: '>',
          gte: '≥',
          lt: '<',
          lte: '≤',
          empty: english ? 'empty' : '为空',
          nonempty: english ? 'nonempty' : '非空',
        };
        const column = (id: string) =>
          `${result.columns.find((column) => column.id === id)?.label || id} [${id}]`;
        const filters =
          result.scope.filters
            .map(
              (filter) => `${column(filter.column)} ${filterOps[filter.op]} ${filter.value ?? ''}`,
            )
            .join(english ? ' AND ' : ' 且 ') || (english ? 'none' : '无');
        const groups = result.scope.groupBy.map(column).join(',') || (english ? 'none' : '无');
        const source =
          result.source.kind === 'browser_download'
            ? result.source.origin
            : english
              ? 'user attachment'
              : '用户附件';
        return english
          ? `${result.filename}: source ${source}; scanned ${result.scope.scannedRows} data rows, matched ${result.scope.matchedRows}, blank rows excluded ${result.scope.blankRows}; filters ${filters}; group columns ${groups}, groups shown ${result.page.ranges.reduce((n, [a, b]) => n + b - a, 0)}/${result.page.total}. ${metrics ? `${metrics}. ` : ''}${result.complete ? '' : 'Partial statistics: missing/invalid values or unseen result groups.'} File scope does not verify complete website exports.`
          : `${result.filename}：来源 ${source}；统计扫描 ${result.scope.scannedRows} 条数据，筛选后 ${result.scope.matchedRows} 条，排除空记录 ${result.scope.blankRows} 条；筛选 ${filters}；分组列 ${groups}，已返回分组 ${result.page.ranges.reduce((n, [a, b]) => n + b - a, 0)}/${result.page.total}。${metrics ? `核对值：${metrics}。` : ''}${result.complete ? '' : '统计尚有缺失/无效值或未返回的分组，属于部分结果。'}网站导出范围尚未核实。`;
      })
      .concat(
        this.failed.size
          ? [english ? 'Some table requests did not succeed.' : '仍有表格统计请求未成功。']
          : [],
      )
      .join('\n');
  }
}
export function taskTableFacts(result: TaskTableResult): TaskTableFact[] {
  return result.mode !== 'aggregate'
    ? []
    : [...result.overall, ...result.groups.flatMap((group) => group.metrics)].flatMap((metric) =>
        metric.value === null
          ? []
          : [
              {
                id: metric.id,
                analysisId: result.analysisId,
                fileId: result.fileId,
                name: metric.name,
                value: metric.value,
                complete: metric.complete,
              },
            ],
      );
}
