/**
 * Phase 1 指令 #3 — R2 key convention for Evidence Ledger artifacts
 * (Playbook + Evidence Ledger design §8 Pack A).
 *
 * Every `evidence_artifacts` row stores `r2_bucket` + `r2_key`; the bytes
 * (screenshot / a11y_tree / html_snapshot / text_excerpt / diff_bundle)
 * live in R2. This module is the SINGLE source of truth for how those
 * keys are shaped, so writers and the Pack B retention reaper agree:
 *
 *   - Playbook exploration / canary artifacts:
 *       playbook/{siteExternalId}/{runExternalId}/{artifactExternalId}/{filename}
 *   - Task evidence artifacts (user task / browser final screenshot / excerpts):
 *       tasks/{taskExternalId}/evidence/{artifactExternalId}/{filename}
 *
 * Shape rationale: the leading prefix (`playbook` vs `tasks`) lets a
 * lifecycle sweep scope by owner class; the {artifactExternalId} dir
 * guarantees collision-free per-artifact storage even when two artifacts
 * share a filename; the trailing filename keeps Content-Disposition
 * downloads human-readable.
 *
 * Keys are R2 object keys, NOT filesystem paths — slashes are plain key
 * characters. We still reject traversal-ish segments so a caller can't
 * smuggle `..` / control chars into a key.
 */

export const PLAYBOOK_R2_PREFIX = 'playbook';
export const TASK_EVIDENCE_R2_PREFIX = 'tasks';

/** True when `s` contains any C0 control char or DEL (rejected in key segments). */
function hasControlChar(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return true;
  }
  return false;
}

/** Drop C0 control chars + DEL from `s`. */
function stripControlChars(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0x20 && c !== 0x7f) out += s[i];
  }
  return out;
}

/** Thrown when a key segment is empty or contains illegal characters. */
export class InvalidR2KeySegmentError extends Error {
  constructor(segment: string, reason: string) {
    super(`invalid R2 key segment ${JSON.stringify(segment)}: ${reason}`);
    this.name = 'InvalidR2KeySegmentError';
  }
}

/**
 * Validate one path segment — external_ids and sanitized filenames only.
 * Rejects empty, slashes, backslashes, `.`/`..`, and control characters
 * so a caller can never escape the intended prefix.
 */
function assertSegment(segment: string): string {
  if (typeof segment !== 'string' || segment.length === 0) {
    throw new InvalidR2KeySegmentError(String(segment), 'empty');
  }
  if (segment === '.' || segment === '..') {
    throw new InvalidR2KeySegmentError(segment, 'dot segment');
  }
  if (/[/\\]/.test(segment)) {
    throw new InvalidR2KeySegmentError(segment, 'contains slash');
  }
  if (hasControlChar(segment)) {
    throw new InvalidR2KeySegmentError(segment, 'control character');
  }
  return segment;
}

/**
 * Sanitize a user-supplied filename into a single safe key segment:
 * strip any directory parts, drop control chars, and collapse anything
 * outside `[A-Za-z0-9._-]` or CJK to `_`. Falls back to `artifact.bin`
 * when nothing usable remains.
 */
export function sanitizeArtifactFilename(filename: string): string {
  const base = stripControlChars((filename ?? '').split(/[/\\]/).pop() ?? '');
  const cleaned = base
    .replace(/\s+/g, '_')
    .replace(/[^A-Za-z0-9._\u4e00-\u9fff-]/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 200);
  return cleaned.length > 0 ? cleaned : 'artifact.bin';
}

export interface PlaybookArtifactKeyInput {
  siteExternalId: string;
  runExternalId: string;
  artifactExternalId: string;
  filename: string;
}

/**
 * Build the R2 key for a Playbook exploration / canary artifact:
 *   playbook/{siteExternalId}/{runExternalId}/{artifactExternalId}/{filename}
 */
export function playbookArtifactKey(input: PlaybookArtifactKeyInput): string {
  return [
    PLAYBOOK_R2_PREFIX,
    assertSegment(input.siteExternalId),
    assertSegment(input.runExternalId),
    assertSegment(input.artifactExternalId),
    assertSegment(sanitizeArtifactFilename(input.filename)),
  ].join('/');
}

export interface TaskEvidenceKeyInput {
  taskExternalId: string;
  artifactExternalId: string;
  filename: string;
}

/**
 * Build the R2 key for a task-evidence artifact:
 *   tasks/{taskExternalId}/evidence/{artifactExternalId}/{filename}
 */
export function taskEvidenceKey(input: TaskEvidenceKeyInput): string {
  return [
    TASK_EVIDENCE_R2_PREFIX,
    assertSegment(input.taskExternalId),
    'evidence',
    assertSegment(input.artifactExternalId),
    assertSegment(sanitizeArtifactFilename(input.filename)),
  ].join('/');
}

/** Whether a key belongs to the Playbook prefix (used by lifecycle sweeps). */
export function isPlaybookKey(key: string): boolean {
  return key.startsWith(`${PLAYBOOK_R2_PREFIX}/`);
}

/** Whether a key belongs to the task-evidence prefix. */
export function isTaskEvidenceKey(key: string): boolean {
  return key.startsWith(`${TASK_EVIDENCE_R2_PREFIX}/`);
}
