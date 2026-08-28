import { describe, expect, it } from 'vitest';
import { parseImageTaskMeta } from './image-task-meta';

describe('parseImageTaskMeta', () => {
  it('hydrates safe studio choices and exposes only aggregate consistency counts', () => {
    expect(
      parseImageTaskMeta({
        imageOptions: {
          model: 'nano_banana_pro',
          style: 'vibrant',
          aspectRatio: '3:4',
          imageCount: 2,
          mode: 'lock_subject',
          subjectFileId: 'file_subject',
          goal: 'commercial',
          commercialUse: 'poster',
          changeTargets: ['background', 'lighting'],
          visiblePrompt: ' 做一张夏日新品海报 ',
        },
        subjectConsistency: {
          checked: 2,
          passed: 1,
          failed: 1,
          reasons: ['internal model output must not reach the UI'],
        },
      }),
    ).toEqual({
      imageOptions: {
        model: 'nano_banana_pro',
        style: 'vibrant',
        aspectRatio: '3:4',
        imageCount: 2,
        mode: 'lock_subject',
        subjectFileId: 'file_subject',
        goal: 'commercial',
        commercialUse: 'poster',
        changeTargets: ['background', 'lighting'],
        visiblePrompt: '做一张夏日新品海报',
      },
      subjectConsistency: { checked: 2, passed: 1, failed: 1 },
    });
  });

  it('uses honest legacy defaults without guessing a missing brief', () => {
    expect(
      parseImageTaskMeta({
        imageOptions: {
          model: 'nano_banana_2',
          aspectRatio: '1:1',
          imageCount: 1,
          mode: 'lock_subject',
        },
      }),
    ).toEqual({
      imageOptions: {
        model: 'nano_banana_2',
        style: 'random',
        aspectRatio: '1:1',
        imageCount: 1,
        mode: 'lock_subject',
        goal: 'lock_subject',
        changeTargets: [],
      },
    });
  });

  it.each([
    { imageOptions: { model: 'nano_banana_2', aspectRatio: '1:1', imageCount: 1, mode: 'unsafe' } },
    { imageOptions: { model: 'nano_banana_2', aspectRatio: '1:1', imageCount: 1, changeTargets: ['background', 'style', 'lighting', 'action', 'composition', 'extra'] } },
    { imageOptions: { model: 'nano_banana_2', aspectRatio: '1:1', imageCount: 1, visiblePrompt: 'x'.repeat(4_001) } },
    { subjectConsistency: { checked: -1, passed: 0, failed: 0 } },
    { subjectConsistency: { checked: 1, passed: 2, failed: 0 } },
  ])('rejects malformed metadata without throwing: %o', (metadata) => {
    expect(parseImageTaskMeta(metadata)).toEqual({});
  });

  it('keeps a valid independent aggregate when image options are malformed', () => {
    expect(
      parseImageTaskMeta({
        imageOptions: { mode: 'unsafe' },
        subjectConsistency: { checked: 1, passed: 1, failed: 0 },
      }),
    ).toEqual({ subjectConsistency: { checked: 1, passed: 1, failed: 0 } });
  });
});
