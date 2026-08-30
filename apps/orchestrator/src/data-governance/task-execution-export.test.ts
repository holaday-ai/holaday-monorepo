import { describe, expect, it } from 'vitest';
import { serializeTaskExecutionExportRecord } from './task-execution-export.js';

describe('task execution privacy-safe export serializer', () => {
  it('emits only the executable allowlist and bounded summary metadata', () => {
    const exported = serializeTaskExecutionExportRecord({
      id: 99,
      externalId: 'twi_public_reference',
      status: 'completed',
      intent: 'private task prompt',
      rawPrompt: 'private AI prompt',
      storagePath: 'private/object/path',
      sourceUrl: 'https://private.example/token',
      summaryMetadata: {
        sourceKind: 'taskFile',
        evidenceType: 'source_document',
        humanConfirmationStatus: 'confirmed',
        resultVersion: 'rv_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        rawExcerpt: 'private excerpt',
        internalId: 123,
      },
    });

    expect(exported).toEqual({
      externalId: 'twi_public_reference',
      status: 'completed',
      summaryMetadata: {
        sourceKind: 'taskFile',
        evidenceType: 'source_document',
        humanConfirmationStatus: 'confirmed',
        resultVersion: 'rv_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      },
    });
    const serialized = JSON.stringify(exported);
    for (const privateValue of [
      'private task prompt',
      'private AI prompt',
      'private/object/path',
      'private.example',
      'private excerpt',
      '123',
    ]) {
      expect(serialized).not.toContain(privateValue);
    }
  });

  it('rejects malformed and unbounded public fields instead of leaking fallback data', () => {
    expect(() =>
      serializeTaskExecutionExportRecord({ externalId: 7, status: 'completed' }),
    ).toThrow('INVALID_TASK_EXPORT_RECORD');
    expect(() =>
      serializeTaskExecutionExportRecord({
        externalId: 'x'.repeat(33),
        status: 'completed',
      }),
    ).toThrow('INVALID_TASK_EXPORT_RECORD');
    expect(() =>
      serializeTaskExecutionExportRecord({
        externalId: 'twi_public_reference',
        status: 'x'.repeat(33),
      }),
    ).toThrow('INVALID_TASK_EXPORT_RECORD');
  });

  it.each([
    ['sourceKind', 'private prompt disguised as a source'],
    ['evidenceType', 'private_prompt_disguised_as_evidence'],
    ['humanConfirmationStatus', 'private prompt disguised as status'],
    ['resultVersion', 'private prompt disguised as version'],
  ])('rejects poisoned allowlisted %s values', (key, value) => {
    expect(() =>
      serializeTaskExecutionExportRecord({
        externalId: 'twi_public_reference',
        status: 'completed',
        summaryMetadata: { [key]: value },
      }),
    ).toThrow('INVALID_TASK_EXPORT_RECORD');
  });
});
