/**
 * File-artifact consistency.
 *
 * When the agent generates a downloadable file it should emit a
 * ```holaday-file fenced JSON block in its final answer; the SPA parses
 * that fence into a FileDownloadCard. QA found "generate a downloadable
 * file" tasks where the answer prose CLAIMS a file ("文件已生成，点击下载：
 * x.md" / "PDF 已生成：x.pdf") but no fence and no matching document
 * artifact exist — so the user is told to click a download that isn't
 * there.
 *
 * Crucial subtlety: the auto-captured final screenshot is ALSO stored
 * as a kind='output' task_files row, so a raw output-file count would
 * be satisfied by the screenshot even when the claimed PDF/Markdown was
 * never produced. The artifact signal therefore counts DOCUMENT outputs
 * only (image/* and screenshot-* excluded) and matches the claimed file
 * family when the answer names one.
 *
 * Two orchestrator-side guards share this pure core (no SPA change):
 *   1. result finalisation folds un-fenced DOCUMENT output files into
 *      metadata.attachments so the card still renders.
 *   2. the answer verifier flags "claims a file but no matching
 *      artifact" as fixable → partial_success.
 */

export interface OutputFileDescriptor {
  readonly filename: string;
  readonly mimetype: string;
}

/**
 * Extract the `fileId`s from every well-formed ```holaday-file fenced
 * JSON block. A corrupted / unparseable fence is NOT counted (its file
 * isn't actually surfaced), so callers recover it via attachments.
 */
export function fencedFileIds(answerText: string | null | undefined): Set<string> {
  const ids = new Set<string>();
  if (!answerText) return ids;
  const fenceRe = /```holaday-file[ \t]*\r?\n([\s\S]*?)```/gi;
  for (const match of answerText.matchAll(fenceRe)) {
    const body = match[1];
    if (!body) continue;
    try {
      const obj = JSON.parse(body) as { fileId?: unknown };
      if (typeof obj.fileId === 'string' && obj.fileId.trim().length > 0) {
        ids.add(obj.fileId.trim());
      }
    } catch {
      // Corrupted fence — not counted as surfaced.
    }
  }
  return ids;
}

/**
 * Whether the answer prose OFFERS the user a generated downloadable
 * file. Conservative: keyed on explicit generation / download phrasing
 * so a source link ending in `.pdf` or a passing filename mention does
 * not trip it.
 */
const FILE_CLAIM_RE =
  /文件已生成|已生成(?:好|了)?(?:一个|这个)?(?:可下载)?文件|点击下载|从上方卡片下载|可从.{0,6}卡片下载|可下载文件卡片|可下载的?\s*(?:Markdown|markdown|PDF|pdf|文档|表格|文件|CSV|csv)|PDF\s*已(?:生成|创建)|下载链接\s*[:：]|供你下载|文件供下载|为你生成(?:了|好)?(?:一个|这个)?文件|生成(?:了|好)(?:一个|这个)?(?:可下载)?(?:的)?(?:Markdown|PDF|文档|表格|文件)/;

/**
 * A document FILENAME immediately followed by a generation / download
 * phrase — "qa-summary.pdf 已生成", "`report.md` 已创建", "x.csv 可下载".
 * Only whitespace and closing quote/backtick/bracket chars may sit
 * between the filename and the phrase, so a bare source link
 * ("来源：https://example.com/spec.pdf（仅供参考）") does NOT match — its
 * `.pdf` is not adjacent to any generation / download wording.
 */
const FILE_CLAIM_FILENAME_RE =
  /[\w\-]+\.(?:pdf|md|markdown|csv|json|xlsx|docx|txt|pptx)\s*[`'"」』）)\]]*\s*(?:已(?:生成|创建|完成|备好)|生成(?:完毕|好了|完成)?|可(?:下载|供下载|从[^。\n]{0,8}下载)|下载卡片)/i;

export function answerClaimsDownloadableFile(
  answerText: string | null | undefined,
): boolean {
  if (!answerText) return false;
  return FILE_CLAIM_RE.test(answerText) || FILE_CLAIM_FILENAME_RE.test(answerText);
}

/**
 * Whether an output file is a user-facing DOCUMENT download, not an
 * auto-captured screenshot / image. The auto-final-screenshot is a
 * kind='output' row too, so the artifact signal must exclude it.
 */
export function isDocumentOutput(file: OutputFileDescriptor): boolean {
  if (/^image\//i.test(file.mimetype)) return false;
  const name = file.filename.toLowerCase();
  if (/^screenshot[-_]/.test(name)) return false;
  if (/\.(?:png|jpe?g|webp|gif|bmp|svg)$/.test(name)) return false;
  return true;
}

/** Coarse download family for a file (extension first, then mimetype). */
export function fileFamily(file: OutputFileDescriptor): string {
  const ext = (file.filename.match(/\.([a-z0-9]+)$/i)?.[1] ?? '').toLowerCase();
  if (ext) return ext === 'markdown' ? 'md' : ext;
  const m = file.mimetype.toLowerCase();
  if (m.includes('pdf')) return 'pdf';
  if (m.includes('markdown')) return 'md';
  if (m.includes('csv')) return 'csv';
  if (m.includes('json')) return 'json';
  if (m.includes('spreadsheet') || m.includes('excel')) return 'xlsx';
  if (m.includes('word') || m.includes('document')) return 'docx';
  if (m.includes('presentation')) return 'pptx';
  return 'file';
}

/**
 * Families the answer explicitly claims (from a "PDF"/"Markdown" word or
 * a `name.ext` filename in the prose). Empty when only a generic
 * "可下载文件" is claimed — any document then satisfies it.
 */
export function claimedDownloadFamilies(
  answerText: string | null | undefined,
): Set<string> {
  const fams = new Set<string>();
  if (!answerText) return fams;
  for (const match of answerText.matchAll(
    /[\w\-]+\.(pdf|md|markdown|csv|json|xlsx|docx|txt|pptx)\b/gi,
  )) {
    const ext = (match[1] ?? '').toLowerCase();
    if (ext) fams.add(ext === 'markdown' ? 'md' : ext);
  }
  if (/\bPDF\b/i.test(answerText)) fams.add('pdf');
  if (/Markdown|markdown/.test(answerText)) fams.add('md');
  if (/\bCSV\b/i.test(answerText)) fams.add('csv');
  if (/\bxlsx\b|Excel|表格文件/i.test(answerText)) fams.add('xlsx');
  if (/\bdocx\b|Word\s*文档/i.test(answerText)) fams.add('docx');
  return fams;
}

export interface FileArtifactInputs {
  readonly answerText: string | null | undefined;
  /** Output files created during this task (task_files, kind='output'). */
  readonly outputFiles: ReadonlyArray<OutputFileDescriptor>;
}

export interface FileArtifactVerdict {
  readonly claimsFile: boolean;
  readonly fencedCount: number;
  /** A real document artifact backs the claim (fence or matching file). */
  readonly hasArtifact: boolean;
  /** Answer offers a download but nothing real backs it. */
  readonly inconsistent: boolean;
}

/**
 * Decide whether the answer makes a download claim with no backing
 * document artifact. `inconsistent === true` is the case to flag fixable.
 */
export function evaluateFileArtifact({
  answerText,
  outputFiles,
}: FileArtifactInputs): FileArtifactVerdict {
  const fencedCount = fencedFileIds(answerText).size;
  const claimsFile = answerClaimsDownloadableFile(answerText);
  const documents = outputFiles.filter(isDocumentOutput);
  const claimedFamilies = claimedDownloadFamilies(answerText);

  let hasArtifact = fencedCount > 0;
  if (!hasArtifact && documents.length > 0) {
    hasArtifact =
      claimedFamilies.size === 0
        ? true // generic "可下载文件" + any document
        : documents.some((d) => claimedFamilies.has(fileFamily(d)));
  }

  return {
    claimsFile,
    fencedCount,
    hasArtifact,
    inconsistent: claimsFile && !hasArtifact,
  };
}
