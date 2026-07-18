const RELEASE_REQUIREMENT =
  'Run pnpm --filter @holaday/orchestrator smoke:browser-egress separately.';

export function buildQaReportMetadata({ isLocal }) {
  return {
    scope: isLocal ? 'local-ui-fixture' : 'remote-ui',
    chromeUiVerified: true,
    liveBrowserSessionVerified: false,
    liveEgressVerified: false,
    releaseRequirement: RELEASE_REQUIREMENT,
  };
}
