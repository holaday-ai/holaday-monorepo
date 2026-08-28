export interface VideoEditingFeatureConfig {
  enabled: boolean;
  allowlist: string;
  licenseConfigured?: boolean;
  hostnameScopeConfigured?: boolean;
  browserLicense?: string;
  sceneRegenerationEnabled?: boolean;
}

function allowlistedUsers(value: string): Set<string> {
  return new Set(
    value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
}

export function hasLicensedVideoEditingHostnames(input: {
  licensedHostnames: string;
  stagingHostname: string;
}): boolean {
  const stagingHostname = input.stagingHostname.trim().toLowerCase();
  if (!stagingHostname) return false;
  const licensedHostnames = new Set(
    input.licensedHostnames
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
  );
  return ['holaday.ai', 'hd-app.orangebench.tech', stagingHostname].every((hostname) =>
    licensedHostnames.has(hostname),
  );
}

export function canAccessVideoEditing(
  config: VideoEditingFeatureConfig,
  userExternalId: string,
): boolean {
  if (
    !config.enabled ||
    config.licenseConfigured !== true ||
    config.hostnameScopeConfigured !== true
  ) {
    return false;
  }
  const allowlist = allowlistedUsers(config.allowlist);
  return allowlist.size > 0 && allowlist.has(userExternalId);
}

export function videoEditingCapability(
  config: VideoEditingFeatureConfig,
  userExternalId: string,
): { enabled: boolean } {
  return { enabled: canAccessVideoEditing(config, userExternalId) };
}
