import { isEnglishRequestText } from '@holaday/shared-types';
import { renderFile } from '../../files/writers.js';
import { BrowserTaskFileReader } from './browser-task-file-reader.js';
import type { BrowserTaskFiles } from './browser-task-files.js';
import type { BrowserTaskOutputs } from './browser-task-output.js';
import { BrowserTaskTable, type TableAggregate, csvShape } from './browser-task-table.js';

const contracts = new WeakSet<object>();
const fileTools = Object.freeze(['read_task_file', 'analyze_task_table', 'create_file', 'finish']);
const positiveRequest = (intent: string) =>
  intent
    .replace(/但是?|不过|然而|而是|却|\b(?:but|however|instead)\b/gi, ', $&')
    .replace(/(?:不要|别|无需|不用|不必|禁止|请勿)[^，。；,;！？!?\n]*/g, ' ')
    .replace(/\b(?:do not|don't|never|without)\b[^，。；,.;！？!?\n]*/gi, ' ');

/** Routing uses only the original request; supplied document text never enters here. */
export function isExplicitFileOnlyRequest(intent: string): boolean {
  if (
    /不是不要|并非不|不(?:是|能|应)只|\bnot\s+only\b|(?:在|从|到|去)(?:GitHub|Google|Sheets|百度|淘宝|网站)/i.test(
      intent,
    )
  )
    return false;
  if (/(?:不要|别|并非|不是)[^，。；;\n]*(?:只|仅)(?:处理|分析|读取)/.test(intent)) return false;
  const positive = positiveRequest(intent);
  if (
    !/(?:只|仅)(?:需|用|要)?(?:基于|针对|处理|分析|读取|使用)[^。；;\n]{0,60}(?:附件|文件|CSV|TSV|JSON)|\bonly\s+(?:analy[sz]e|process|read|use)\b[^.\n]{0,70}\b(?:attached|provided)\b/i.test(
      positive,
    )
  )
    return false;
  return !/https?:|www\.|\b[a-z0-9-]+\.(?:com|org|net|io|cn|ai|dev|gov|edu)\b|访问|打开|点击|导航|搜索|联网|上传|发送|邮件|登录|账号|页面|网页|网站|支付|付款|转账|预订|订票|下单|购买|发布|分享|注册|提交|模板|填入|填充|图片|视频|音频|\b(?:visit|navigate|browse|search|upload|send|email|login|account|website|webpage|book|pay|purchase|submit|publish|share|register|transfer|template|fill|image|video|audio)\b/i.test(
    positive,
  );
}

export function taskFileInputSupported(file: { name: string; mimeType: string }): boolean {
  return (
    /\.(?:csv|tsv|json|txt|md|pdf|docx)$/i.test(file.name) &&
    !/^(?:image|audio|video)\//i.test(file.mimeType)
  );
}

export type TaskFileContract = Readonly<{
  taskId: string;
  completionIntent: string;
  inputFiles: ReadonlyArray<Readonly<ReturnType<BrowserTaskFiles['references']>[number]>>;
  toolNames: readonly string[];
  assertCurrent(): Promise<void>;
  read: BrowserTaskFileReader['read'];
  analyze: BrowserTaskTable['run'];
  create: BrowserTaskOutputs['create'];
  outputTools: BrowserTaskOutputs['tools'];
  outputGap(): string | null;
  completionGap(): Promise<string | null>;
  attach(summary: string): string;
}>;

export function isTaskFileContract(value: unknown): value is TaskFileContract {
  return Boolean(value && typeof value === 'object' && contracts.has(value));
}

export async function createTaskFileContract(options: {
  intent: string;
  files: BrowserTaskFiles;
  outputs: BrowserTaskOutputs;
  signal?: AbortSignal;
}): Promise<TaskFileContract | null> {
  const { intent, files, outputs, signal } = options;
  const inputs = Object.freeze(files.references().map((file) => Object.freeze({ ...file })));
  if (
    !isExplicitFileOnlyRequest(intent) ||
    !inputs.length ||
    !inputs.every(taskFileInputSupported) ||
    inputs.some((file) => files.source(file.fileId).kind !== 'user_attachment')
  )
    return null;
  const current = async () => !signal?.aborted && (await files.isActive());
  if (!(await current())) throw new Error('材料所属任务或账号已不可用。');
  for (const file of await files.resolveReadable(
    files.taskId,
    inputs.map((x) => x.fileId),
  )) {
    outputs.admitProvided({
      fileId: file.fileId,
      filename: file.name,
      size: file.buffer.length,
      downloadUrl: `/api/files/${file.fileId}/download`,
      format: file.name.split('.').at(-1)?.toLowerCase() ?? '*',
    });
  }
  const reader = new BrowserTaskFileReader(files);
  const tables = new BrowserTaskTable(files);
  const sourceAnalyses = new Map<string, TableAggregate>();
  const requiredOps = new Set<string>();
  if (/行数|记录数|data_rows|count_rows|row\s*count/i.test(intent)) requiredOps.add('count_rows');
  if (/合计|总和|总计|总额|amount_sum|\bsum\b/i.test(intent)) requiredOps.add('sum');
  if (/平均|\b(?:average|avg)\b/i.test(intent)) requiredOps.add('avg');
  if (/最大|\bmax(?:imum)?\b/i.test(intent)) requiredOps.add('max');
  if (/最小|\bmin(?:imum)?\b/i.test(intent)) requiredOps.add('min');
  const allowsFilters = /筛选|过滤|\b(?:filter|where)\b/i.test(positiveRequest(intent));
  const csvColumnNames =
    /(?:列为|columns?\s*(?:are|:|=))\s*([A-Za-z_][A-Za-z0-9_-]*(?:[ \t]*[,，][ \t]*[A-Za-z_][A-Za-z0-9_-]*)+)/i.exec(
      positiveRequest(intent),
    )?.[1];
  const requestedCsvWidth = csvColumnNames?.split(/[,，]/).length;
  let unresolvedOutput = false;
  const statsRequested =
    requiredOps.size > 0 ||
    /统计|计算|合计|汇总|总和|平均|\b(?:sum|count|aggregate|calculate|statistics)\b/i.test(intent);
  const ensureCurrent = async () => {
    if (!(await current())) throw new Error('文件处理已停止或归属失效。');
  };
  const contract: TaskFileContract = Object.freeze({
    taskId: files.taskId,
    completionIntent: positiveRequest(intent),
    inputFiles: inputs,
    toolNames: fileTools,
    assertCurrent: ensureCurrent,
    read: async (request) => {
      await ensureCurrent();
      const result = await reader.read(request);
      await ensureCurrent();
      return result;
    },
    analyze: async (request, abort) => {
      await ensureCurrent();
      const result = await tables.run(request, abort ?? signal);
      await ensureCurrent();
      if (result.mode === 'aggregate') {
        if (result.supersededAnalysisId) sourceAnalyses.delete(result.supersededAnalysisId);
        sourceAnalyses.set(result.analysisId, structuredClone(result));
      }
      return result;
    },
    create: async (input) => {
      if (unresolvedOutput) return { ok: false, error: 'file_save_unconfirmed', fatal: true };
      await ensureCurrent();
      if (requestedCsvWidth && input && typeof input === 'object') {
        const args = input as Record<string, unknown>;
        if (args.format === 'csv' && typeof args.content === 'string') {
          const rendered = await renderFile('csv', args.content);
          await csvShape(rendered.buffer.toString('utf8'), ',', signal, requestedCsvWidth);
          await ensureCurrent();
        }
      }
      const result = await outputs.create(input);
      if (result.ok) {
        try {
          await files.admitGenerated(result.file);
          await ensureCurrent();
        } catch (error) {
          unresolvedOutput = true;
          throw error;
        }
      } else if (result.fatal) unresolvedOutput = true;
      return result;
    },
    outputTools: outputs.tools,
    outputGap: () => outputs.gap(intent),
    completionGap: async () => {
      try {
        await ensureCurrent();
        if (unresolvedOutput) return '文件保存或归属结果未知，不能完成或重复写入。';
        const generated = files.generatedReferences();
        const all = [...inputs, ...generated];
        for (const file of all) await files.resolveReadable(files.taskId, [file.fileId]);
        const read = reader.completeFiles();
        if (all.some((file) => !read.has(file.fileId)) || reader.incomplete())
          return '本任务输入或生成文件尚未完整读取。';
        const analyzed = tables.completeFiles();
        if (
          tables.incomplete() ||
          [...(statsRequested ? inputs : []), ...generated].some(
            (file) => /\.(?:csv|tsv)$/i.test(file.name) && !analyzed.has(file.fileId),
          )
        )
          return '请求的文件统计或生成表格核对尚未完整。';
        for (const file of inputs.filter(
          (file) => statsRequested && /\.(?:csv|tsv)$/i.test(file.name),
        )) {
          const proof = [...sourceAnalyses.values()].filter(
            (result) =>
              result.fileId === file.fileId &&
              result.complete &&
              (allowsFilters || result.scope.filters.length === 0),
          );
          if (
            [...requiredOps].some(
              (op) => !proof.some((result) => result.overall.some((metric) => metric.op === op)),
            )
          )
            return '原输入缺少请求的实际统计指标或完整范围证明，生成文件不能替代。';
          if (
            /\bamount(?:_sum)?\b/i.test(intent) &&
            requiredOps.has('sum') &&
            !proof.some((result) =>
              result.overall.some(
                (metric) => metric.op === 'sum' && metric.label?.toLowerCase() === 'amount',
              ),
            )
          )
            return 'amount 合计尚未绑定原输入 amount 列的实际统计。';
        }
        await ensureCurrent();
        return outputs.gap(intent);
      } catch {
        return '任务、账号或文件字节已变化，文件处理结果未确认。';
      }
    },
    attach: (summary) =>
      outputs.attach(
        [
          summary,
          reader.coverageNote(isEnglishRequestText(intent)),
          tables.coverageNote(isEnglishRequestText(intent)),
        ]
          .filter(Boolean)
          .join('\n\n'),
      ),
  });
  contracts.add(contract);
  return contract;
}
