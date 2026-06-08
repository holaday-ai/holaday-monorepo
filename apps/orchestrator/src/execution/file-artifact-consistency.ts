/**
 * File-artifact consistency.
 *
 * When the agent generates a downloadable file it should emit a
 * ```holaday-file fenced JSON block in its final answer; the SPA parses
 * that fence into a FileDownloadCard. QA found ~1/3 of "generate a
 * downloadable file" tasks where the answer prose CLAIMS a file
 * ("文件已生成，点击下载：x.md" / "PDF 已生成：x.pdf") but no fence and no
 * artifact exist — so the user is told to click a download that isn't
 * there.
 *
 * This module is the pure core shared by two orchestrator-side guards:
 *   1. result finalisation folds *un-fenced* created output files into
 *      metadata.attachments so the card still renders (fencedFileIds).
 *   2. the answer verifier flags "claims a file but no artifact" as
 *      fixable → partial_success (evaluateFileArtifact).
 *
 * No SPA changes — the SPA already renders both fences and
 * metadata.attachments correctly.
 */

/**
 * Extract the `fileId`s from every well-formed ```holaday-file fenced
 * JSON block in the answer. A corrupted / unparseable fence is NOT
 * counted (its file isn't actually surfaced to the user), so callers
 * treat it as un-fenced and recover it via metadata.attachments.
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
 * file. Deliberately conservative: keyed on explicit generation /
 * download phrasing so a source link that merely ends in `.pdf`, or a
 * sentence that mentions a filename in passing, does NOT trip it.
 */
const FILE_CLAIM_RE =
  /文件已生成|已生成(?:好|了)?(?:一个|这个)?(?:可下载)?文件|点击下载|可下载的?\s*(?:Markdown|markdown|PDF|pdf|文档|表格|文件|CSV|csv)|PDF\s*已生成|下载链接\s*[:：]|供你下载|文件供下载|为你生成(?:了|好)?(?:一个|这个)?文件|生成(?:了|好)(?:一个|这个)?(?:可下载)?(?:的)?(?:Markdown|PDF|文档|表格|文件)/;

export function answerClaimsDownloadableFile(
  answerText: string | null | undefined,
): boolean {
  if (!answerText) return false;
  return FILE_CLAIM_RE.test(answerText);
}

export interface FileArtifactInputs {
  readonly answerText: string | null | undefined;
  /**
   * Number of output files actually created during this task
   * (task_files, kind='output', not expired). When unknown, pass 0 —
   * the check then relies on fence presence alone.
   */
  readonly outputFileCount: number;
}

export interface FileArtifactVerdict {
  readonly claimsFile: boolean;
  readonly fencedCount: number;
  /** A real artifact backs the answer: a fence or a created output file. */
  readonly hasArtifact: boolean;
  /** Answer offers a download but nothing real backs it. */
  readonly inconsistent: boolean;
}

/**
 * Decide whether the answer makes a download claim with no backing
 * artifact. `inconsistent === true` is the case to flag as fixable.
 */
export function evaluateFileArtifact({
  answerText,
  outputFileCount,
}: FileArtifactInputs): FileArtifactVerdict {
  const fencedCount = fencedFileIds(answerText).size;
  const claimsFile = answerClaimsDownloadableFile(answerText);
  const hasArtifact = fencedCount > 0 || outputFileCount > 0;
  return {
    claimsFile,
    fencedCount,
    hasArtifact,
    inconsistent: claimsFile && !hasArtifact,
  };
}
