import type { EvalExpectations } from './eval-suite.js';

export interface EvalTaskDetail {
  taskId: string;
  intent: string;
  status: string;
  awaitingKind: string | null;
  awaitingQuestion: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  result: unknown;
  planText: string | null;
  verificationPassed: boolean | null;
  steps: Array<{ kind: string; seq: number; output: unknown }>;
}

export function readResultField<T = unknown>(result: unknown, key: string): T | null {
  if (result == null || typeof result !== 'object') return null;
  const value = (result as Record<string, unknown>)[key];
  return (value ?? null) as T | null;
}

function buildHaystack(detail: EvalTaskDetail): string {
  const summary = readResultField<string>(detail.result, 'summary');
  const reason = readResultField<string>(detail.result, 'reason');
  // Phase 3 R3 — also surface result.metadata.attachments[] (L1
  // auto-saved screenshot + L2 save_page_as_pdf outputs) so eval
  // cases can assert via mustContainAny on filename / downloadUrl
  // substrings (e.g. "screenshot-" / "page-tsk_" / ".pdf").
  const metadata = readResultField<{ attachments?: unknown }>(detail.result, 'metadata');
  const attachments = metadata?.attachments;
  const attachmentsJson =
    Array.isArray(attachments) && attachments.length > 0 ? JSON.stringify(attachments) : null;
  // For awaiting_user states the relevant text lives in
  // awaitingQuestion (the agent's clarification prompt) — result
  // is empty until the task actually terminates. Including it lets
  // mustContain / mustContainAny validate parked tasks too.
  return [
    summary,
    reason,
    detail.awaitingQuestion,
    detail.intent,
    detail.errorMessage,
    attachmentsJson,
  ]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join('\n');
}

export function validateEvalExpectations(
  detail: EvalTaskDetail | undefined,
  expectations: EvalExpectations,
  prefix: string,
  capturedExecutionMode: string | null,
): string[] {
  const failures: string[] = [];
  if (!detail) {
    failures.push(`${prefix}no detail captured`);
    return failures;
  }
  if (expectations.terminalStatus && detail.status !== expectations.terminalStatus) {
    failures.push(
      `${prefix}terminalStatus: expected ${expectations.terminalStatus}, got ${detail.status}`,
    );
  }
  if (expectations.mustComplete && !expectations.terminalStatus && detail.status !== 'completed') {
    failures.push(
      `${prefix}mustComplete: status=${detail.status}${
        detail.errorMessage ? ` (errorMessage="${detail.errorMessage}")` : ''
      }`,
    );
  }
  if (expectations.verificationMustPass && detail.verificationPassed !== true) {
    failures.push(
      `${prefix}verificationMustPass: expected true, got ${String(detail.verificationPassed)}`,
    );
  }
  if (expectations.executionMode && capturedExecutionMode !== expectations.executionMode) {
    failures.push(
      `${prefix}executionMode: expected ${expectations.executionMode}, got ${capturedExecutionMode ?? 'null'}`,
    );
  }
  if (expectations.awaitingKind && detail.awaitingKind !== expectations.awaitingKind) {
    failures.push(
      `${prefix}awaitingKind: expected ${expectations.awaitingKind}, got ${detail.awaitingKind ?? 'null'}`,
    );
  }
  const haystack = buildHaystack(detail);
  for (const needle of expectations.mustContain ?? []) {
    if (!haystack.includes(needle)) {
      failures.push(`${prefix}mustContain: missing "${needle}"`);
    }
  }
  if (expectations.mustContainAny && expectations.mustContainAny.length > 0) {
    const hit = expectations.mustContainAny.some((needle) => haystack.includes(needle));
    if (!hit) {
      failures.push(
        `${prefix}mustContainAny: none of [${expectations.mustContainAny.join(', ')}] appeared`,
      );
    }
  }
  for (const needle of expectations.mustNotContain ?? []) {
    if (haystack.includes(needle)) {
      failures.push(`${prefix}mustNotContain: contains "${needle}"`);
    }
  }
  if (expectations.urlMustMatch) {
    const finalUrl = readResultField<string>(detail.result, 'finalUrl');
    if (!finalUrl || !finalUrl.includes(expectations.urlMustMatch)) {
      failures.push(
        `${prefix}urlMustMatch: finalUrl=${finalUrl ?? 'null'} doesn't include "${expectations.urlMustMatch}"`,
      );
    }
  }
  return failures;
}
