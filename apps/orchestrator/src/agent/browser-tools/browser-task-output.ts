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
type FileRequirement = { format: string; filename?: string };

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
  const requirements: FileRequirement[] = [
    ...formats,
    ...unsupported.map((format) => format.toLowerCase()),
  ].map((format) => ({ format }));
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
        const operation = this.options.store!(parsed.data);
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
    const matches = (required: FileRequirement, generatedOnly = false) =>
      [...this.files.values()].some(
        (file) =>
          (!generatedOnly || this.generated.has(file.fileId)) &&
          (required.format === '*' || file.format === required.format) &&
          (!required.filename || file.filename === required.filename),
      );
    const missing = taskFileRequirements(intent).filter((required) => !matches(required));
    const generation = /生成|创建|制作|保存为|转换成|转成|\b(?:create|generate|convert)\b/i.exec(
      intent,
    );
    if (generation)
      missing.push(
        ...taskFileRequirements(intent.slice(generation.index)).filter(
          (required) => !matches(required, true),
        ),
      );
    return missing.length
      ? `缺少实际保存的输出文件回执：${missing.map((item) => item.filename ?? item.format).join('、')}。请用可用 create_file 生成；不能完成则如实报告失败，不能用文本或链接冒充文件。`
      : null;
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
