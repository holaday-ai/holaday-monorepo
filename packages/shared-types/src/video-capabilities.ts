export type NormalVideoModelId =
  | 'veo_fast'
  | 'veo_lite'
  | 'veo_standard'
  | 'happyhorse'
  | 'wanxiang';

export type NormalVideoResolution = '720p' | '1080p';

export interface NormalVideoParameters {
  model: NormalVideoModelId;
  resolution: NormalVideoResolution;
  durationSeconds: number;
}

export type VideoParameterIssue = 'veo_1080p_requires_8s';
export type VideoParameterPreference = 'duration' | 'resolution';

const VEO_MODELS = new Set<NormalVideoModelId>([
  'veo_fast',
  'veo_lite',
  'veo_standard',
]);

export function videoParameterIssue(
  input: NormalVideoParameters,
): VideoParameterIssue | null {
  if (
    VEO_MODELS.has(input.model) &&
    input.resolution === '1080p' &&
    input.durationSeconds !== 8
  ) {
    return 'veo_1080p_requires_8s';
  }
  return null;
}

export function reconcileNormalVideoParameters(
  input: NormalVideoParameters,
  preference: VideoParameterPreference,
): NormalVideoParameters {
  if (!videoParameterIssue(input)) return input;
  if (preference === 'duration') {
    return { ...input, resolution: '720p' };
  }
  return { ...input, durationSeconds: 8 };
}
