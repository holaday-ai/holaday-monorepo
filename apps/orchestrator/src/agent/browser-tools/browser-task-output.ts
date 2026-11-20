import { z } from 'zod';
import { detectRequestedFileFormat } from '../../files/writers.js';
import type { NeutralToolDefinition } from '../../llm/messages-adapter.js';
import type { RunSupercarOptions } from '../supercar/agent-loop.js';
import type { BrowserDownloadReceipt } from './playwright-unified-executor.js';
export const createFileSchema = z
  .object({
    filename: z
      .string()
      .trim()
      .min(1)
      .max(255)
      .regex(/^[^/\\\r\n]+$/),
    format: z.string().trim().min(1),
    content: z
      .string()
      .min(1)
      .max(200_000)
      .refine((content) => content.trim().length > 0),
  })
  .strict();
export const fileReceiptSchema = z.object({
  fileId: z.string().min(1),
  filename: z.string().min(1),
  size: z.number().int().positive(),
  downloadUrl: z.string().min(1),
});
export type CreatedFile = z.infer<typeof fileReceiptSchema> & { format: string };
type FileRequirement = { format: string; filename?: string; count?: number };

function requestedCount(value: string): number {
  if (/^[0-9]+$/.test(value)) return Number(value);
  const words: Record<string, number> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  };
  if (value.includes('十')) {
    const [tens, units] = value.split('十');
    return (tens ? (words[tens] ?? 0) : 1) * 10 + (units ? (words[units] ?? 0) : 0);
  }
  return words[value.toLowerCase()] ?? 0;
}

export function taskFileRequirements(intent: string): FileRequirement[] {
  // Only explicit delivery requests, not merely a mention of an input PDF/CSV.
  const request = intent
    // A material the human provided is an input, not an imperative to provide
    // that same filename again. Keep a later explicit generation request.
    .replace(/(?:我|用户)(?:已|已经)?提供(?:给你)?的?|提供的/g, '')
    .replace(/(?:不要|无需|不必|不)(?:生成|创建|导出|制作|交付|保存)[^，。；\n]*/g, '')
    .replace(/(?:do not|don't|without)\s+(?:create|generate|export|save)[^,.;\n]*/gi, '');
  const delivery =
    /生成|创建|导出|制作|交付|给我|提供|输出|整理[成为]|保存为|转换成|转成|可下载|\b(?:create|generate|export|deliver|provide|save|convert|downloadable)\b/i.exec(
      request,
    );
  if (!delivery) return [];
  let outputRequest = request.slice(delivery.index + delivery[0].length);
  // In an explicit conversion, the input format is not another requested output.
  if (/^convert$/i.test(delivery[0]))
    outputRequest = outputRequest.replace(/^[\s\S]*?\b(?:to|into)\b/i, '');
  outputRequest = outputRequest
    .replace(/https?:\/\/\S+/gi, '')
    // Source filenames after a delivery verb are not requested outputs. Remove
    // only the qualified filename, not the rest of a clause with more outputs.
    .replace(
      /(?:参考|依据|根据|读取|输入(?:文件)?|\b(?:using|from|based on|refer to)\b)\s*["'“]?[^\s"'”），,;；:：]+?\.[a-z0-9]+\b(?!\.)/gi,
      '',
    )
    .replace(/(?:文件名|命名为|名为|filename)\s*[:：=]?\s*/gi, ' ');
  const formats = new Set(
    (outputRequest.match(/[a-z]+|电子表格|幻灯片|演示文稿|演示文件|纯文本文件|文本文件/gi) ?? [])
      .map((token) => detectRequestedFileFormat(token))
      .filter((format): format is NonNullable<typeof format> => format !== null),
  );
  // Explicit unavailable formats must not silently pass as a different file.
  const unsupported =
    outputRequest.match(/\b(?:zip|rar|7z|rtf|xls|ods|odt|html|xml|tar|gz)\b/gi) ?? [];
  const counts = new Map<string, number>();
  for (const match of outputRequest.matchAll(
    /([1-9][0-9]{0,2}|one|two|three|four|five|six|seven|eight|nine|ten|[一二两三四五六七八九十]+)\s*(?:个|份|张|本)?\s*(csvs?|xlsx|pdfs?|docx|pptx|json|txt|md|文件|附件|files?|attachments?)(?=\b|[\u3400-\u9fff]|$)/gi,
  )) {
    const token = match[2]!;
    const format = /^(?:文件|附件|files?|attachments?)$/i.test(token)
      ? '*'
      : (detectRequestedFileFormat(token) ?? detectRequestedFileFormat(token.replace(/s$/i, '')));
    if (!format) continue;
    counts.set(format, Math.max(counts.get(format) ?? 1, requestedCount(match[1]!)));
    if (format !== '*') formats.add(format);
  }
  const requirements: FileRequirement[] = [
    ...formats,
    ...unsupported.map((format) => format.toLowerCase()),
    ...[...counts.keys()].filter((format) => format === '*'),
  ].map((format) => ({ format, ...(counts.has(format) ? { count: counts.get(format)! } : {}) }));
  const names = outputRequest.matchAll(
    /(?:^|[\s"'“（(、，,])([^\s"'”）)、，,;；:：/\\]+\.(csv|txt|md|json|xlsx|pdf|docx|pptx|zip|rar|7z|rtf|xls|ods|odt|html|xml|tar|gz))\b/gi,
  );
  for (const match of names) {
    if (match[1] && match[2])
      requirements.push({ filename: match[1], format: match[2].toLowerCase() });
  }
  return requirements.length > 0
    ? requirements
    : /文件|附件|\b(?:file|attachment)\b/i.test(outputRequest)
      ? [{ format: '*' }]
      : [];
}

/** Both runners enforce the same receipt provenance and distinct output counts. */
export function taskOutputGap(
  intent: string,
  receipts: Iterable<CreatedFile>,
  generated: ReadonlySet<string>,
): string | null {
  const files = [...new Map([...receipts].map((file) => [file.fileId, file])).values()];
  const matches = (required: FileRequirement, generatedOnly = false) =>
    files.filter(
      (file) =>
        (!generatedOnly || generated.has(file.fileId)) &&
        (required.format === '*' || file.format === required.format) &&
        (!required.filename || file.filename === required.filename),
    ).length >= (required.count ?? 1);
  const missing = taskFileRequirements(intent).filter((required) => !matches(required));
  const generationRequest = intent
    .replace(/(?:不要|无需|不必|不)(?:生成|创建|导出|制作|交付|保存)[^，。；\n]*/g, '')
    .replace(/(?:do not|don't|without)\s+(?:create|generate|export|save)[^,.;\n]*/gi, '');
  const generation = /生成|创建|制作|保存为|转换成|转成|\b(?:create|generate|convert)\b/i.exec(
    generationRequest,
  );
  if (generation) {
    let scope = generationRequest.slice(generation.index);
    const sourceRequest = generationRequest
      .slice(0, generation.index)
      .replace(/(?:不要|无需|不必|不)(?:下载|导出)[^，。；\n]*/g, '')
      .replace(/(?:do not|don't|without)\s+(?:download|export)[^,.;\n]*/gi, '');
    if (/下载|导出|\b(?:download|export)\b/i.test(sourceRequest)) {
      // A final combined handoff describes originals plus new files. It must
      // not turn "generate analysis.csv, give me both files" into two new files.
      const handoff =
        /[，,；;\n]\s*(?:(?:并|再|最后|然后)\s*)?(?:(?:把|将)\s*(?:这|上述|以上)?(?:[一二两三四五六七八九十\d]+|全部|所有)(?:个|份)?\s*(?:[a-z]+\s*)?(?:文件|附件)(?:一起|都)?(?:交给|交付|提供给|给|发给)|(?:and\s+)?(?:give|send|deliver|provide)\s+(?:me\s+)?(?:both|all|these|the|two|three|four|\d+)\s+(?:[a-z]+\s+)?(?:files?|attachments?))/i.exec(
          scope,
        );
      if (handoff) scope = scope.slice(0, handoff.index);
    }
    const generatedRequirements = taskFileRequirements(scope);
    if (
      !generatedRequirements.length &&
      taskFileRequirements(generationRequest.slice(generation.index)).length
    )
      generatedRequirements.push({ format: '*' });
    missing.push(...generatedRequirements.filter((required) => !matches(required, true)));
  }
  return missing.length
    ? `缺少实际保存的输出文件回执：${[...new Set(missing.map((item) => item.filename ?? `${item.count ?? 1} × ${item.format}`))].join('、')}。请用可用 create_file 生成；不能完成则如实报告失败，不能用文本或链接冒充文件。`
    : null;
}

export type TaskOutputResult =
  | { ok: true; file: CreatedFile }
  | { ok: false; error: string; fatal?: true };

/** One task owns these host receipts. Model file IDs and URLs never enter here. */
export class BrowserTaskOutputs {
  private readonly files = new Map<string, CreatedFile>();
  private readonly generated = new Set<string>();
  private readonly writes = new Map<string, Promise<TaskOutputResult>>();
  private uncertain = false;
  constructor(
    private readonly options: {
      formats?: readonly string[];
      store?: RunSupercarOptions['onCreateFile'];
      signal?: AbortSignal;
      canPublish?: () => boolean;
      current(): Promise<boolean>;
    },
  ) {}
  get tools(): NeutralToolDefinition[] {
    if (!this.options.store || !this.options.formats?.length) return [];
    return [
      {
        name: 'create_file',
        description:
          'Create and save a downloadable task output using the allowed renderer formats. Only a successful host file receipt proves delivery; output attachments are added automatically. No paths, URLs, file IDs or uploaded bytes in input. Do not repeat an uncertain write.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            filename: { type: 'string', minLength: 1, maxLength: 255 },
            format: { type: 'string', enum: [...this.options.formats] },
            content: { type: 'string', minLength: 1, maxLength: 200000 },
          },
          required: ['filename', 'format', 'content'],
        },
      },
    ];
  }
  admitDownload(receipt: BrowserDownloadReceipt): void {
    this.files.set(receipt.fileId, {
      fileId: receipt.fileId,
      filename: receipt.filename,
      size: receipt.sizeBytes,
      downloadUrl: receipt.downloadUrl,
      format: receipt.filename.split('.').at(-1)?.toLowerCase() ?? '*',
    });
  }
  async create(input: unknown): Promise<TaskOutputResult> {
    if (this.uncertain) return { ok: false, error: 'file_save_unconfirmed', fatal: true };
    const parsed = createFileSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: 'invalid_file_input' };
    if (
      !this.options.store ||
      !this.options.formats?.includes(parsed.data.format) ||
      !parsed.data.filename.toLowerCase().endsWith(`.${parsed.data.format.toLowerCase()}`)
    )
      return { ok: false, error: 'file_format_unavailable' };
    if (!(await this.options.current())) return { ok: false, error: 'task_stopped', fatal: true };
    const key = JSON.stringify(parsed.data);
    const existing = this.writes.get(key);
    if (existing) return existing;
    const writing = (async (): Promise<TaskOutputResult> => {
      let abort: (() => void) | undefined;
      try {
        const operation = this.options.store!({
          ...parsed.data,
          canPublish: () => !this.options.signal?.aborted && this.options.canPublish?.() !== false,
        });
        const signal = this.options.signal;
        const result = await (signal
          ? Promise.race([
              operation,
              new Promise<never>((_, reject) => {
                abort = () => reject(new Error('task_stopped'));
                signal.addEventListener('abort', abort, { once: true });
                if (signal.aborted) abort();
              }),
            ])
          : operation);
        const receipt = fileReceiptSchema.safeParse(result);
        if (
          !receipt.success ||
          receipt.data.filename !== parsed.data.filename ||
          receipt.data.downloadUrl !== `/api/files/${receipt.data.fileId}/download` ||
          !(await this.options.current())
        )
          throw new Error();
        const file = { ...receipt.data, format: parsed.data.format };
        this.files.set(file.fileId, file);
        this.generated.add(file.fileId);
        return { ok: true, file };
      } catch {
        this.uncertain = true;
        return { ok: false, error: 'file_save_unconfirmed', fatal: true };
      } finally {
        if (abort) this.options.signal?.removeEventListener('abort', abort);
      }
    })();
    this.writes.set(key, writing);
    return writing;
  }
  gap(intent: string): string | null {
    if (this.uncertain) return '文件保存结果未知；已停止，不会重复写入。';
    return taskOutputGap(intent, this.files.values(), this.generated);
  }

  attach(summary: string): string {
    const clean = summary
      .replace(
        /^[ \t]*(?:`{3,}|~{3,})[ \t]*holaday-file[^\n]*\r?\n[\s\S]*?(?:^[ \t]*(?:`{3,}|~{3,})[ \t]*$|$(?![\s\S]))/gim,
        '',
      )
      .trim();
    return [
      clean,
      ...[...this.files.values()].map(
        ({ format: _format, ...file }) => `\`\`\`holaday-file\n${JSON.stringify(file)}\n\`\`\``,
      ),
    ]
      .filter(Boolean)
      .join('\n\n');
  }
}
