import { describe, expect, it } from 'vitest';
import {
  VerificationContextError,
  assessVerificationMaterials,
  createTaskVerificationContext,
  verificationImages,
  withoutImageData,
} from './task-verification-context.js';
import { VERIFICATION_INPUT_LIMITS } from './verification-input-budget.js';

const base = {
  schemaVersion: 1,
  executionId: 'synthetic',
  executionRevision: 1,
  initialRequest: '图里写了什么？',
  userTurns: [],
  phase: 'direct',
  workflow: null,
  referencePlan: null,
} as const;
const image = (data = 'iVBORw0KGgo=') => ({
  kind: 'image' as const,
  key: 'file-block-0',
  source: 'file' as const,
  mediaType: 'image/png' as const,
  data,
});

describe('image verification materials', () => {
  it('admits images as complete materials under their own budget', () => {
    const context = createTaskVerificationContext({ ...base, materials: [image()] });
    expect(assessVerificationMaterials(context)).toEqual({ complete: true, codes: [] });
    expect(verificationImages(context)).toEqual([{ mediaType: 'image/png', data: 'iVBORw0KGgo=' }]);
    expect(JSON.stringify(withoutImageData(context))).not.toContain('iVBORw0KGgo=');
  });

  it('rejects images beyond the image budget or count', () => {
    const tooMany = Array.from({ length: VERIFICATION_INPUT_LIMITS.imageCount + 1 }, (_, i) => ({
      ...image(),
      key: `file-block-${i}`,
    }));
    expect(() => createTaskVerificationContext({ ...base, materials: tooMany })).toThrow(
      VerificationContextError,
    );
    const huge = 'A'.repeat(VERIFICATION_INPUT_LIMITS.imageBytes + 4);
    expect(() => createTaskVerificationContext({ ...base, materials: [image(huge)] })).toThrow(
      VerificationContextError,
    );
  });

  it('rejects malformed image payloads', () => {
    expect(() =>
      createTaskVerificationContext({ ...base, materials: [image('not base64!')] }),
    ).toThrow(VerificationContextError);
  });
});
