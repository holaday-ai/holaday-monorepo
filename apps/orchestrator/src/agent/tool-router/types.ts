/** REBUILD-2 part 2 — shared shapes of the interface tools (no runtime dependencies). */

/** One normalised result row from an interface. */
export interface InterfaceResult {
  title: string;
  url: string;
  snippet: string;
  host?: string;
}

/** Why an interface call did not produce rows (each one hands the task to the browser). */
export type InterfaceCallFailure =
  | 'not_configured'
  | 'not_enabled'
  | 'http_error'
  | 'rpc_error'
  | 'tool_error'
  | 'quota'
  | 'invalid_arguments'
  | 'imprecise'
  | 'malformed'
  | 'empty'
  | 'timeout'
  | 'network';

/** Thrown inside a call (or a multi-step `run`) to end it with a failure reason. */
export class InterfaceCallError extends Error {
  constructor(
    readonly reason: InterfaceCallFailure,
    readonly detail?: string,
  ) {
    super(reason);
  }
}

/** One `tools/call` on an open MCP session. */
export interface McpSession {
  callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ isError: boolean; content: McpContentItem[] }>;
}

/** What the router hands an interface: its search query, and structured arguments if any. */
export interface InterfaceRequest {
  query: string;
  args?: Record<string, unknown>;
}

/** Structured arguments the router model fills when it picks this tool. */
export interface RouterArguments {
  /** Property name in the router's `choose_route` input (e.g. `amap`). */
  key: string;
  /** JSON schema of that property. */
  schema: Record<string, unknown>;
  /** The validated arguments, or null when they are unusable (→ browser). */
  parse(raw: unknown): Record<string, unknown> | null;
}

export interface McpContentItem {
  type: string;
  text?: string;
}
