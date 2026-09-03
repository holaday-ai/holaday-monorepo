export type ModelDataRegion = 'cn' | 'intl';
export type ModelDataRegionSource = 'user' | 'organization';

export type ModelDataRegionOwnershipInput =
  | { scope: 'personal'; userRegion: unknown }
  | { scope: 'organization'; organizationRegion: unknown };

export interface ModelDataRegionOwnership {
  region: ModelDataRegion;
  source: ModelDataRegionSource;
}

export type ModelDataRegionErrorCode =
  | 'USER_MODEL_DATA_REGION_UNASSIGNED'
  | 'ORGANIZATION_MODEL_DATA_REGION_UNASSIGNED'
  | 'INVALID_MODEL_DATA_REGION';

export class ModelDataRegionError extends Error {
  constructor(public readonly code: ModelDataRegionErrorCode) {
    super(code);
    this.name = 'ModelDataRegionError';
  }
}

/** Resolve only from persisted ownership. No network or locale signals are accepted. */
export function resolveModelDataRegionOwnership(
  input: ModelDataRegionOwnershipInput,
): ModelDataRegionOwnership {
  switch (input.scope) {
    case 'organization':
      return {
        region: requireRegion(
          input.organizationRegion,
          'ORGANIZATION_MODEL_DATA_REGION_UNASSIGNED',
        ),
        source: 'organization',
      };
    case 'personal':
      return {
        region: requireRegion(input.userRegion, 'USER_MODEL_DATA_REGION_UNASSIGNED'),
        source: 'user',
      };
    default:
      throw new ModelDataRegionError('INVALID_MODEL_DATA_REGION');
  }
}

function requireRegion(
  value: unknown,
  unassignedCode: 'USER_MODEL_DATA_REGION_UNASSIGNED' | 'ORGANIZATION_MODEL_DATA_REGION_UNASSIGNED',
): ModelDataRegion {
  if (value == null) throw new ModelDataRegionError(unassignedCode);
  if (value !== 'cn' && value !== 'intl') {
    throw new ModelDataRegionError('INVALID_MODEL_DATA_REGION');
  }
  return value;
}
