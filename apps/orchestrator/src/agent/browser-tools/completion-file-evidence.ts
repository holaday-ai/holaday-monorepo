import { createHash } from 'node:crypto';
import { assessCompletionFacts, normalizeFact } from './completion-fields.js';

type FileReceipt = { fileId: string; filename: string };
type TableFact = { id: string; fileId: string; name: string; value: string; complete: boolean };
type Field = {
  name: string;
  value: string;
  fileId: string;
  tableFactId?: string;
  fileProperty?: 'filename';
};
export type FileBindingDiagnostic = {
  index: number;
  code: string;
  nameSHA256: string;
  valueSHA256: string;
  fileIdSHA256?: string;
  tableFactIdSHA256?: string;
};

/** Canonical tuples stay in the model context. Persist only mismatch codes and fingerprints. */
export function completionFileEvidence(input: {
  fields?: unknown;
  fileReceipts: readonly FileReceipt[];
  materials: readonly { fileId: string; text: string }[];
  tableFacts: readonly TableFact[];
}) {
  const fields: Field[] = [
    ...input.fileReceipts.map((file) => ({
      fileProperty: 'filename' as const,
      name: 'filename',
      value: file.filename,
      fileId: file.fileId,
    })),
    ...input.tableFacts.map((fact) => ({
      name: fact.name,
      value: fact.value,
      fileId: fact.fileId,
      tableFactId: fact.id,
    })),
  ];
  const unique = [...new Map(fields.map((field) => [JSON.stringify(field), field])).values()];
  const fingerprint = (value: string) => createHash('sha256').update(value).digest('hex');
  const diagnostics: FileBindingDiagnostic[] = [];
  for (const [index, value] of (Array.isArray(input.fields)
    ? input.fields.slice(0, 60)
    : []
  ).entries()) {
    if (!value || typeof value !== 'object') continue;
    const field = value as Record<string, unknown>;
    if (
      typeof field.name !== 'string' ||
      typeof field.value !== 'string' ||
      typeof field.fileId !== 'string'
    )
      continue;
    if (
      !assessCompletionFacts({
        summary: '',
        fields: [field],
        pages: [],
        fileReceipts: input.fileReceipts,
        materials: input.materials,
        tableFacts: input.tableFacts,
      }).contradictions.length
    )
      continue;
    const fact = input.tableFacts.find((fact) => fact.id === field.tableFactId);
    let code: string | undefined;
    if (field.tabId || field.sourceURL || (field.fileProperty !== undefined && field.tableFactId))
      code = 'mixed_source';
    else if (field.tableFactId) {
      if (!fact) code = 'table_fact_missing';
      else if (fact.fileId !== field.fileId) code = 'table_file_mismatch';
      else if (normalizeFact(fact.name) !== normalizeFact(field.name)) code = 'table_name_mismatch';
      else if (normalizeFact(fact.value) !== normalizeFact(field.value))
        code = 'table_value_mismatch';
      else if (!fact.complete) code = 'table_incomplete';
    } else
      code = field.fileProperty !== undefined ? 'file_metadata_mismatch' : 'file_content_unmatched';
    if (code)
      diagnostics.push({
        index,
        code,
        nameSHA256: fingerprint(field.name),
        valueSHA256: fingerprint(field.value),
        fileIdSHA256: fingerprint(field.fileId),
        ...(typeof field.tableFactId === 'string'
          ? { tableFactIdSHA256: fingerprint(field.tableFactId) }
          : {}),
      });
  }
  return { fields: unique.slice(0, 60), fieldsTruncated: unique.length > 60, diagnostics };
}
