/** REBUILD-2 part 2 tool router — see README.md. */
import { type BailianMcpClient, createBailianMcpClient } from './bailian-mcp-client.js';
import { type CallableInterfaceTool, enabledInterfaceTools } from './registry.js';

export {
  type BailianMcpClient,
  type InterfaceCallResult,
  type InterfaceSource,
  createBailianMcpClient,
} from './bailian-mcp-client.js';
export { explicitSiteRequest, explicitSiteRoute } from './explicit-site.js';
export {
  type FreshnessProblem,
  freshnessHandover,
  freshnessProblem,
  isTimeSensitive,
} from './freshness.js';
export {
  type BrowserEnd,
  type WallEnd,
  type WallKind,
  type ComposedFallback,
  composeFallback,
  fallbackAnswer,
  fallbackGaveFields,
  fallbackIntent,
  fallbackQuery,
  retrievalLine,
  takeoverLine,
  wallEnd,
  wallFallbackAllowed,
  wallLine,
} from './wall-fallback.js';
export { type FallbackRow, checkFallbackPrices, rowSiteName } from './wall-checks.js';
export {
  type CallableInterfaceTool,
  INTERFACE_TOOLS,
  enabledInterfaceTools,
  toolsForRegion,
} from './registry.js';
export {
  type InterfaceSearchLane,
  type SourceLanguage,
  type ToolRouteDecision,
  decideExecutionRoute,
  formatSourceLine,
  interfaceSearchLane,
  interfaceSitesOf,
  routeTask,
  toExecutionModeDecision,
  withInterfaceSource,
} from './router.js';

export type ToolRouterRegion = 'cn' | 'intl';

export interface ToolRouterSettings {
  /** TOOL_ROUTER_V2, the master switch. Requests use `enabledFor`, never this alone. */
  enabled: boolean;
  /** TOOL_ROUTER_V2_REGIONS: the model data regions the router runs for (empty = none). */
  regions: readonly ToolRouterRegion[];
  /**
   * G2a (DEPLOY-R1「生产先只对 cn 入口开 TOOL_ROUTER_V2」): whether the router decides for a user of
   * this model data region (the account's settled region — FIX-60 writes the entry's region on
   * the first task). Off (flag off, region not listed, or no region): the mainline keyword rules
   * decide, exactly as without the router.
   */
  enabledFor(region: unknown): boolean;
  tools: CallableInterfaceTool[];
  client: BailianMcpClient;
}

/** Parses TOOL_ROUTER_V2_REGIONS (comma list of cn / intl); unknown entries are ignored. */
export function toolRouterRegions(
  raw: string | undefined,
  warn: (message: string) => void = () => {},
): ToolRouterRegion[] {
  const regions: ToolRouterRegion[] = [];
  for (const part of (raw ?? '').split(',')) {
    const entry = part.trim().toLowerCase();
    if (!entry) continue;
    if (entry !== 'cn' && entry !== 'intl') {
      warn(
        `TOOL_ROUTER_V2_REGIONS: unknown region "${entry.replace(/[^a-z0-9_-]/g, '?').slice(0, 20)}" ignored`,
      );
      continue;
    }
    if (!regions.includes(entry)) regions.push(entry);
  }
  return regions;
}

/** Settings read once at boot. The MCP key is the Bailian China key (the services are cn). */
export function toolRouterSettings(
  environment: {
    TOOL_ROUTER_V2?: boolean;
    TOOL_ROUTER_V2_REGIONS?: string;
    TOOL_ROUTER_TOOLS?: string;
    DASHSCOPE_CN_API_KEY?: string;
  },
  warn: (message: string) => void = () => {},
): ToolRouterSettings {
  const enabled = environment.TOOL_ROUTER_V2 === true;
  const regions = enabled ? toolRouterRegions(environment.TOOL_ROUTER_V2_REGIONS, warn) : [];
  const apiKey = environment.DASHSCOPE_CN_API_KEY ?? '';
  return {
    enabled,
    regions,
    enabledFor: (region) =>
      enabled && (region === 'cn' || region === 'intl') && regions.includes(region),
    // Without the key no interface is offered: the router chooses between answering and the browser.
    tools: enabled && apiKey ? enabledInterfaceTools(environment.TOOL_ROUTER_TOOLS, { warn }) : [],
    client: createBailianMcpClient({ apiKey }),
  };
}
