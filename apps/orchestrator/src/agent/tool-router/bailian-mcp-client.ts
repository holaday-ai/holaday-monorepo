/**
 * REBUILD-2 part 2 — minimal Bailian MCP client (Streamable HTTP, JSON-RPC 2.0).
 *
 *   POST https://dashscope.aliyuncs.com/api/v1/mcps/{serviceCode}/mcp
 *   initialize → notifications/initialized → tools/call
 *
 * One short session per call. The response is either `application/json` or a
 * `text/event-stream` whose last `data:` line carries the JSON-RPC reply. The API key is sent
 * only in the Authorization header; it is never logged, returned or put in a URL. Used only
 * while `TOOL_ROUTER_V2` is on.
 */
import type { CallableInterfaceTool, InterfaceResult, McpContentItem } from './registry.js';

export const BAILIAN_MCP_BASE_URL = 'https://dashscope.aliyuncs.com/api/v1/mcps';
const DEFAULT_TIMEOUT_MS = 10_000;
const PROTOCOL_VERSION = '2025-03-26';

export interface InterfaceSource {
  /** Interface name shown to the user (registry title). */
  name: string;
  /** When the interface answered (ISO 8601). */
  at: string;
}

export type InterfaceCallFailure =
  | 'not_configured'
  | 'not_enabled'
  | 'http_error'
  | 'rpc_error'
  | 'tool_error'
  | 'malformed'
  | 'empty'
  | 'timeout'
  | 'network';

export type InterfaceCallResult =
  | { ok: true; results: InterfaceResult[]; source: InterfaceSource }
  | { ok: false; reason: InterfaceCallFailure; detail?: string };

export interface BailianMcpClientOptions {
  apiKey: string;
  fetch?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
  now?: () => Date;
}

export interface BailianMcpClient {
  call(
    tool: CallableInterfaceTool,
    query: string,
    opts?: { signal?: AbortSignal },
  ): Promise<InterfaceCallResult>;
}

interface RpcReply {
  status: number;
  sessionId: string | null;
  json: {
    result?: { content?: unknown; isError?: boolean };
    error?: { code?: number; message?: string };
  } | null;
  text: string;
}

class InterfaceCallError extends Error {
  constructor(
    readonly reason: InterfaceCallFailure,
    readonly detail?: string,
  ) {
    super(reason);
  }
}

/** The JSON-RPC reply from a JSON body or the last JSON `data:` line of an event stream. */
export function parseRpcBody(contentType: string, text: string): RpcReply['json'] {
  if (contentType.includes('text/event-stream')) {
    const lines = text
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .filter(Boolean)
      .reverse();
    for (const line of lines) {
      try {
        const json = JSON.parse(line);
        if (json && (json.id !== undefined || json.result || json.error)) return json;
      } catch {
        /* not JSON — keep looking */
      }
    }
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** The server's own short message (no headers, no key), for diagnostics only. */
function safeDetail(text: string, apiKey: string): string {
  const scrubbed = apiKey ? text.split(apiKey).join('***') : text;
  return scrubbed.replace(/sk-[A-Za-z0-9]{8,}/g, 'sk-***').slice(0, 200);
}

export function createBailianMcpClient(options: BailianMcpClientOptions): BailianMcpClient {
  const doFetch = options.fetch ?? fetch;
  const baseUrl = options.baseUrl ?? BAILIAN_MCP_BASE_URL;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const now = options.now ?? (() => new Date());

  return {
    async call(tool, query, opts = {}) {
      if (!options.apiKey) return { ok: false, reason: 'not_configured' };
      const timeout = AbortSignal.timeout(timeoutMs);
      const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
      const url = `${baseUrl}/${encodeURIComponent(tool.serviceCode)}/mcp`;
      let sessionId: string | null = null;
      let nextId = 0;

      const rpc = async (
        method: string,
        params: Record<string, unknown>,
        notify = false,
      ): Promise<RpcReply> => {
        const headers: Record<string, string> = {
          Authorization: `Bearer ${options.apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        };
        if (sessionId) headers['Mcp-Session-Id'] = sessionId;
        const body = notify
          ? { jsonrpc: '2.0', method, params }
          : { jsonrpc: '2.0', id: ++nextId, method, params };
        const response = await doFetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal,
        });
        const text = await response.text();
        const replySession = response.headers.get('mcp-session-id');
        if (replySession) sessionId = replySession;
        return {
          status: response.status,
          sessionId,
          json: parseRpcBody(response.headers.get('content-type') ?? '', text),
          text,
        };
      };

      const expectOk = (reply: RpcReply) => {
        if (reply.status === 404 && /未开通|非可用开通状态/.test(reply.text))
          throw new InterfaceCallError('not_enabled');
        if (reply.status < 200 || reply.status >= 300)
          throw new InterfaceCallError(
            'http_error',
            `HTTP ${reply.status} ${safeDetail(reply.text, options.apiKey)}`,
          );
        if (reply.json?.error)
          throw new InterfaceCallError(
            'rpc_error',
            safeDetail(String(reply.json.error.message ?? ''), options.apiKey),
          );
        if (!reply.json?.result) throw new InterfaceCallError('malformed');
        return reply.json.result;
      };

      try {
        expectOk(
          await rpc('initialize', {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: { name: 'holaday-tool-router', version: '1.0' },
          }),
        );
        // A notification has no reply body worth reading; its failure is not the call's.
        await rpc('notifications/initialized', {}, true).catch(() => null);
        const result = expectOk(
          await rpc('tools/call', { name: tool.mcpTool, arguments: tool.buildArguments(query) }),
        );
        if (result.isError === true) throw new InterfaceCallError('tool_error');
        if (!Array.isArray(result.content)) throw new InterfaceCallError('malformed');
        const results = tool.readResults(result.content as McpContentItem[]);
        if (results.length === 0) return { ok: false, reason: 'empty' };
        return { ok: true, results, source: { name: tool.title, at: now().toISOString() } };
      } catch (error) {
        if (error instanceof InterfaceCallError)
          return {
            ok: false,
            reason: error.reason,
            ...(error.detail ? { detail: error.detail } : {}),
          };
        if (timeout.aborted) return { ok: false, reason: 'timeout' };
        return { ok: false, reason: 'network', detail: error instanceof Error ? error.name : '' };
      }
    },
  };
}
