export interface VideoEditingFeatureConfig {
  enabled: boolean;
  allowlist: string;
  licenseConfigured?: boolean;
}

function allowlistedUsers(value: string): Set<string> {
  return new Set(
    value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
}

export function canAccessVideoEditing(
  config: VideoEditingFeatureConfig,
  userExternalId: string,
): boolean {
  if (!config.enabled) return false;
  const allowlist = allowlistedUsers(config.allowlist);
  return allowlist.size === 0 || allowlist.has(userExternalId);
}

export function videoEditingCapability(
  config: VideoEditingFeatureConfig,
  userExternalId: string,
): { enabled: boolean } {
  return { enabled: canAccessVideoEditing(config, userExternalId) };
}
