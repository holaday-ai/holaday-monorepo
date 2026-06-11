/**
 * Template-fill consistency (Phase 1 #1, §6) — the answer-verifier's
 * 7th deterministic check.
 *
 * The template-fill runner grades its own outcome directly (it owns the
 * validator's `missing` set + the byte-sniffed format), so THIS is a
 * backstop "兜底防 runner 漏": a text-derivable invariant the generic
 * verifier can re-check without the runner's internals.
 *
 * What it catches that `file-artifact-consistency` misses: the runner's
 * success skeleton ("…并保留了模板原有格式。…下载链接见下方") uses phrasing
 * that the file-artifact FILE_CLAIM_RE does NOT recognise (no "文件已生成"
 * / "下载链接：" colon form), so a "filled the template" claim with no
 * real output file would slip past file-artifact. This check keys on the
 * template skeleton specifically and flags claim-without-artifact.
 *
 * Scope note: §6.2 (missing-fields listed ⇒ partial_success) and §6.3
 * (output format family == template format family) are enforced
 * deterministically in the runner (template-fill-runner.ts), which has
 * the structured data to do so precisely; they are not re-derivable from
 * answer text alone and are intentionally not duplicated here.
 */

import {
  fencedFileIds,
  isDocumentOutput,
  type OutputFileDescriptor,
} from './file-artifact-consistency.js';

// The runner's success skeleton always states it preserved the
// template's original formatting (the "已填充并交付文件" branch). The
// basic-plan PREVIEW ("…字段填充预览…升级到 Pro") deliberately does NOT
// use this phrase, so a no-file preview is never flagged.
const TEMPLATE_FILL_CLAIM_RE =
  /保留了模板(?:原有)?格式|已(?:根据|按)[^。\n]{0,40}填充(?:了)?[^。\n]{0,6}模板/;

export function answerClaimsTemplateFill(
  answerText: string | null | undefined,
): boolean {
  if (!answerText) return false;
  return TEMPLATE_FILL_CLAIM_RE.test(answerText);
}

export interface TemplateFillInputs {
  readonly answerText: string | null | undefined;
  /** Output files created during this task (task_files, kind='output'). */
  readonly outputFiles: ReadonlyArray<OutputFileDescriptor>;
}

export interface TemplateFillVerdict {
  readonly claimsFill: boolean;
  /** A real filled document (fence or document output) backs the claim. */
  readonly hasArtifact: boolean;
  /** Answer claims a filled template but nothing real backs it. */
  readonly inconsistent: boolean;
}

export function evaluateTemplateFill({
  answerText,
  outputFiles,
}: TemplateFillInputs): TemplateFillVerdict {
  const claimsFill = answerClaimsTemplateFill(answerText);
  if (!claimsFill) {
    return { claimsFill: false, hasArtifact: false, inconsistent: false };
  }
  const hasFence = fencedFileIds(answerText).size > 0;
  const hasDocument = outputFiles.some(isDocumentOutput);
  const hasArtifact = hasFence || hasDocument;
  return { claimsFill, hasArtifact, inconsistent: !hasArtifact };
}
