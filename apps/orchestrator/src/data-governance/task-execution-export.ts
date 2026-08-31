export interface TaskExecutionExportRecord {
  externalId: string;
  status: string;
  summaryMetadata: Partial<{
    sourceKind: string;
    evidenceType: string;
    humanConfirmationStatus: string;
    resultVersion: string;
  }>;
}

const SUMMARY_KEYS = [
  'sourceKind',
  'evidenceType',
  'humanConfirmationStatus',
  'resultVersion',
] as const;
const SOURCE_KINDS = new Set(['taskFile', 'evidenceArtifact', 'controlledExternalRef']);
const EVIDENCE_TYPES = new Set([
  'source_document',
  'report',
  'screenshot',
  'structured_output',
  'execution_log',
]);
const CONFIRMATION_STATUSES = new Set(['pending', 'confirmed', 'modified', 'rejected']);
const RESULT_VERSION = /^rv_[0-9a-f]{32}$/;

function boundedString(value: unknown, maxLength: number): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maxLength &&
    !Array.from(value).some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    })
  );
}

/**
 * Executable serializer for the audited task/team-work export allowlist.
 * Unknown/private fields are intentionally never copied, even when nested
 * beside allowlisted summary metadata.
 */
export function serializeTaskExecutionExportRecord(input: unknown): TaskExecutionExportRecord {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('INVALID_TASK_EXPORT_RECORD');
  }
  const record = input as Record<string, unknown>;
  if (!boundedString(record.externalId, 32) || !boundedString(record.status, 32)) {
    throw new Error('INVALID_TASK_EXPORT_RECORD');
  }
  const summaryInput = record.summaryMetadata;
  if (
    summaryInput !== undefined &&
    (!summaryInput || typeof summaryInput !== 'object' || Array.isArray(summaryInput))
  ) {
    throw new Error('INVALID_TASK_EXPORT_RECORD');
  }
  const summaryRecord = (summaryInput ?? {}) as Record<string, unknown>;
  const summaryMetadata: TaskExecutionExportRecord['summaryMetadata'] = {};
  for (const key of SUMMARY_KEYS) {
    const value = summaryRecord[key];
    if (value === undefined) continue;
    if (!boundedString(value, 128)) throw new Error('INVALID_TASK_EXPORT_RECORD');
    if (key === 'sourceKind' && !SOURCE_KINDS.has(value)) {
      throw new Error('INVALID_TASK_EXPORT_RECORD');
    }
    if (key === 'evidenceType' && !EVIDENCE_TYPES.has(value)) {
      throw new Error('INVALID_TASK_EXPORT_RECORD');
    }
    if (key === 'humanConfirmationStatus' && !CONFIRMATION_STATUSES.has(value)) {
      throw new Error('INVALID_TASK_EXPORT_RECORD');
    }
    if (key === 'resultVersion' && !RESULT_VERSION.test(value)) {
      throw new Error('INVALID_TASK_EXPORT_RECORD');
    }
    summaryMetadata[key] = value;
  }
  return { externalId: record.externalId, status: record.status, summaryMetadata };
}
