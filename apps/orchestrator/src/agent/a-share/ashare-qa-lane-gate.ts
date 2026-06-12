import type { ExecutionMode } from '../intent-classifier.js';

/**
 * Cross-session guard — added by the #1 (template-fill) session on
 * 2026-06-13; see docs/daily/SESSION_STATUS.md. #2 to confirm next active.
 *
 * The a-share QA lane must only handle GENERIC info intents (generate /
 * scrape). When the classifier already chose a DEDICATED lane —
 * template_fill (the user uploaded a template + said 填充模板), image, or
 * browser — that strong signal must win; the a-share matcher must not
 * second-guess it.
 *
 * Regression it fixes: an a-share-skill-enabled account uploaded a docx
 * template and said "按这个周报模板填充…"; the a-share QA fork (which ran
 * BEFORE the template_fill fork and didn't check executionMode) matched the
 * GMV/环比 prose to stock 600415 and answered with a briefing — the template
 * was never filled.
 */
export function ashareQaHandlesMode(executionMode: ExecutionMode): boolean {
  return executionMode === 'generate' || executionMode === 'scrape';
}
