import { getFeatureFlags } from '../execution/feature-flags.js';
import { env } from './env.js';

export function resolveBrowserCapabilities(
  userId: string | undefined,
  config: {
    allowlist?: string;
    viewport?: boolean;
    observation?: boolean;
    replay?: boolean;
    routing?: boolean;
  },
) {
  const canary = Boolean(
    userId &&
      (config.allowlist ?? '')
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean)
        .includes(userId),
  );
  return {
    viewportV2: Boolean(config.viewport || canary),
    observationV2: Boolean(config.observation || canary),
    replayV1: Boolean(config.replay || canary),
    routingV2: Boolean(config.routing || canary),
  };
}
export function browserCapabilities(userId?: string) {
  return resolveBrowserCapabilities(userId, {
    allowlist: process.env.BROWSER_V2_CANARY_USER_IDS,
    viewport: env.BROWSER_VIEWPORT_V2 || process.env.BROWSER_VIEWPORT_V2 === 'true',
    observation: env.BROWSER_OBSERVATION_V2 || process.env.BROWSER_OBSERVATION_V2 === 'true',
    replay: env.BROWSER_REPLAY_V1 || process.env.BROWSER_REPLAY_V1 === 'true',
    routing: getFeatureFlags().USER_BROWSER_ROUTING_V2,
  });
}
