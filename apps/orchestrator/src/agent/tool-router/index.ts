/** REBUILD-2 part 2 tool router — see README.md. */
import { type BailianMcpClient, createBailianMcpClient } from './bailian-mcp-client.js';
import { type CallableInterfaceTool, enabledInterfaceTools } from './registry.js';

export {
  type BailianMcpClient,
  type InterfaceCallResult,
  type InterfaceSource,
  createBailianMcpClient,
} from './bailian-mcp-client.js';
export { explicitSiteRequest } from './explicit-site.js';
export {
  type CallableInterfaceTool,
  INTERFACE_TOOLS,
  enabledInterfaceTools,
  toolsForRegion,
} from './registry.js';
export {
  type InterfaceSearchLane,
  type ToolRouteDecision,
  decideExecutionRoute,
  formatSourceLine,
  interfaceSearchLane,
  routeTask,
  toExecutionModeDecision,
  withInterfaceSource,
} from './router.js';

export interface ToolRouterSettings {
  enabled: boolean;
  tools: CallableInterfaceTool[];
  client: BailianMcpClient;
}

/** Settings read once at boot. The MCP key is the Bailian China key (the services are cn). */
export function toolRouterSettings(
  environment: {
    TOOL_ROUTER_V2?: boolean;
    TOOL_ROUTER_TOOLS?: string;
    DASHSCOPE_CN_API_KEY?: string;
  },
  warn: (message: string) => void = () => {},
): ToolRouterSettings {
  const enabled = environment.TOOL_ROUTER_V2 === true;
  const apiKey = environment.DASHSCOPE_CN_API_KEY ?? '';
  return {
    enabled,
    // Without the key no interface is offered: the router chooses between answering and the browser.
    tools: enabled && apiKey ? enabledInterfaceTools(environment.TOOL_ROUTER_TOOLS, { warn }) : [],
    client: createBailianMcpClient({ apiKey }),
  };
}
