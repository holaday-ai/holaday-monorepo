import type { EvalExpectations } from './eval-suite.js';

const EVIDENCE_SOURCE_TYPES = new Set([
  'user_input',
  'file_parse',
  'browser_state',
  'tool_result',
  'inference',
]);

export interface EvalAcceptanceSnapshot {
  evidenceEntryCount: number;
  evidenceSourceTypeCounts: Record<string, number>;
  outputFileCount: number;
  outputMimeTypeCounts: Record<string, number>;
  actionCaptureTypeCounts: Record<string, number>;
}

function parseJsonObject(value: unknown): Record<string, unknown> | null {
  if (value == null) return null;
  if (typeof value === 'object') return value as Record<string, unknown>;
  if (typeof value !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function increment(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

export function buildEvalAcceptanceSnapshot(input: {
  evidenceJson: unknown;
  outputFileMimeTypes: string[];
  actionCaptureTypes: string[];
}): EvalAcceptanceSnapshot {
  const evidenceSourceTypeCounts: Record<string, number> = {};
  const evidence = parseJsonObject(input.evidenceJson);
  const rawEntries = Array.isArray(evidence?.entries) ? evidence.entries : [];
  let evidenceEntryCount = 0;
  for (const rawEntry of rawEntries) {
    if (!rawEntry || typeof rawEntry !== 'object') continue;
    const sourceType = (rawEntry as Record<string, unknown>).sourceType;
    if (typeof sourceType !== 'string' || !EVIDENCE_SOURCE_TYPES.has(sourceType)) continue;
    evidenceEntryCount += 1;
    increment(evidenceSourceTypeCounts, sourceType);
  }

  const outputMimeTypeCounts: Record<string, number> = {};
  for (const mimetype of input.outputFileMimeTypes) {
    if (mimetype.length > 0) increment(outputMimeTypeCounts, mimetype);
  }

  const actionCaptureTypeCounts: Record<string, number> = {};
  for (const actionType of input.actionCaptureTypes) {
    if (actionType.length > 0) increment(actionCaptureTypeCounts, actionType);
  }

  return {
    evidenceEntryCount,
    evidenceSourceTypeCounts,
    outputFileCount: input.outputFileMimeTypes.length,
    outputMimeTypeCounts,
    actionCaptureTypeCounts,
  };
}

export function requiresEvalAcceptanceSnapshot(expectations: EvalExpectations): boolean {
  return (
    expectations.minEvidenceEntries !== undefined ||
    (expectations.requiredEvidenceSourceTypes?.length ?? 0) > 0 ||
    expectations.minOutputFiles !== undefined ||
    (expectations.requiredOutputMimeTypes?.length ?? 0) > 0 ||
    (expectations.requiredActionCaptureTypes?.length ?? 0) > 0
  );
}

export function satisfiesEvalAcceptanceSnapshot(
  snapshot: EvalAcceptanceSnapshot,
  expectations: EvalExpectations,
): boolean {
  if (
    expectations.minEvidenceEntries !== undefined &&
    snapshot.evidenceEntryCount < expectations.minEvidenceEntries
  ) {
    return false;
  }
  if (
    !(expectations.requiredEvidenceSourceTypes ?? []).every(
      (sourceType) => (snapshot.evidenceSourceTypeCounts[sourceType] ?? 0) > 0,
    )
  ) {
    return false;
  }
  if (
    expectations.minOutputFiles !== undefined &&
    snapshot.outputFileCount < expectations.minOutputFiles
  ) {
    return false;
  }
  if (
    !(expectations.requiredOutputMimeTypes ?? []).every(
      (mimetype) => (snapshot.outputMimeTypeCounts[mimetype] ?? 0) > 0,
    )
  ) {
    return false;
  }
  return (expectations.requiredActionCaptureTypes ?? []).every(
    (actionType) => (snapshot.actionCaptureTypeCounts[actionType] ?? 0) > 0,
  );
}
