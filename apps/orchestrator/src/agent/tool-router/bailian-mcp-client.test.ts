import { describe, expect, it, vi } from 'vitest';
import { createBailianMcpClient, parseRpcBody } from './bailian-mcp-client.js';
import { enabledInterfaceTools } from './registry.js';

const [WEB] = enabledInterfaceTools('bailian_web_search');
const KEY = 'sk-test0000000000000000';
const NOW = () => new Date('2026-11-11T02:30:00.000Z');

const pages = (rows: unknown[]) => ({
  jsonrpc: '2.0',
  id: 2,
  result: { content: [{ type: 'text', text: JSON.stringify({ pages: rows }) }], isError: false },
});

function reply(body: unknown, init: { status?: number; type?: string; session?: string } = {}) {
  const type = init.type ?? 'application/json';
  const text =
    typeof body === 'string'
      ? body
      : type.includes('event-stream')
        ? `event: message\ndata: ${JSON.stringify(body)}\n\n`
        : JSON.stringify(body);
  return new Response(text, {
    status: init.status ?? 200,
    headers: { 'content-type': type, ...(init.session ? { 'mcp-session-id': init.session } : {}) },
  });
}

/** A fake MCP server: initialize → notification → tools/call, in that order. */
function fakeServer(toolsCall: () => Response, initialize?: () => Response) {
  const calls: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] =
    [];
  const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    calls.push({ url: String(url), headers: init?.headers as Record<string, string>, body });
    if (body.method === 'initialize')
      return initialize?.() ?? reply({ jsonrpc: '2.0', id: 1, result: {} }, { session: 'sess-1' });
    if (body.method === 'notifications/initialized') return new Response('', { status: 202 });
    return toolsCall();
  });
  return { fetchFn: fetchFn as unknown as typeof fetch, calls };
}

describe('createBailianMcpClient', () => {
  it('initialises, calls the tool with the session and returns rows with a source', async () => {
    const server = fakeServer(() =>
      reply(pages([{ title: '上证指数', url: 'https://a.example/1', snippet: '3663.72' }]), {
        type: 'text/event-stream',
      }),
    );
    const client = createBailianMcpClient({ apiKey: KEY, fetch: server.fetchFn, now: NOW });
    const result = await client.call(WEB!, '上证指数 今日');
    expect(result).toEqual({
      ok: true,
      results: [{ title: '上证指数', url: 'https://a.example/1', snippet: '3663.72' }],
      source: { name: '百炼联网搜索', at: '2026-11-11T02:30:00.000Z' },
    });
    expect(server.calls.map((call) => call.body.method)).toEqual([
      'initialize',
      'notifications/initialized',
      'tools/call',
    ]);
    const toolCall = server.calls[2]!;
    expect(toolCall.url).toBe('https://dashscope.aliyuncs.com/api/v1/mcps/WebSearch/mcp');
    expect(toolCall.url).not.toContain(KEY);
    expect(toolCall.headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(toolCall.headers['Mcp-Session-Id']).toBe('sess-1');
    expect(toolCall.body.params).toEqual({
      name: 'bailian_web_search',
      arguments: { query: '上证指数 今日', count: 5 },
    });
  });

  it('reports an empty result as empty', async () => {
    const server = fakeServer(() => reply(pages([])));
    const client = createBailianMcpClient({ apiKey: KEY, fetch: server.fetchFn });
    expect(await client.call(WEB!, 'q')).toEqual({ ok: false, reason: 'empty' });
  });

  it('reports a service that is not enabled', async () => {
    const server = fakeServer(
      () => reply('unused'),
      () => reply('{"message":"未开通该MCP或非可用开通状态"}', { status: 404 }),
    );
    const client = createBailianMcpClient({ apiKey: KEY, fetch: server.fetchFn });
    expect(await client.call(WEB!, 'q')).toEqual({ ok: false, reason: 'not_enabled' });
  });

  it('reports a tool error, an RPC error and an HTTP error without the key', async () => {
    const isError = fakeServer(() =>
      reply({ jsonrpc: '2.0', id: 2, result: { content: [], isError: true } }),
    );
    expect(
      await createBailianMcpClient({ apiKey: KEY, fetch: isError.fetchFn }).call(WEB!, 'q'),
    ).toEqual({ ok: false, reason: 'tool_error' });

    const rpcError = fakeServer(() =>
      reply({ jsonrpc: '2.0', id: 2, error: { code: -32602, message: 'bad params' } }),
    );
    expect(
      await createBailianMcpClient({ apiKey: KEY, fetch: rpcError.fetchFn }).call(WEB!, 'q'),
    ).toEqual({ ok: false, reason: 'rpc_error', detail: 'bad params' });

    const httpError = fakeServer(() => reply(`denied for ${KEY}`, { status: 401 }));
    const result = await createBailianMcpClient({ apiKey: KEY, fetch: httpError.fetchFn }).call(
      WEB!,
      'q',
    );
    expect(result).toMatchObject({ ok: false, reason: 'http_error' });
    expect(JSON.stringify(result)).not.toContain(KEY);
  });

  it('times out and reports network failures', async () => {
    const hang = vi.fn(
      (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    ) as unknown as typeof fetch;
    expect(
      await createBailianMcpClient({ apiKey: KEY, fetch: hang, timeoutMs: 20 }).call(WEB!, 'q'),
    ).toEqual({ ok: false, reason: 'timeout' });

    const down = vi.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    expect(await createBailianMcpClient({ apiKey: KEY, fetch: down }).call(WEB!, 'q')).toEqual({
      ok: false,
      reason: 'network',
      detail: 'TypeError',
    });
  });

  it('makes no request without a key', async () => {
    const fetchFn = vi.fn() as unknown as typeof fetch;
    expect(await createBailianMcpClient({ apiKey: '', fetch: fetchFn }).call(WEB!, 'q')).toEqual({
      ok: false,
      reason: 'not_configured',
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe('parseRpcBody', () => {
  it('reads the last JSON-RPC data line of an event stream', () => {
    const text =
      'event: message\ndata: {"jsonrpc":"2.0","method":"note"}\ndata: {"jsonrpc":"2.0","id":2,"result":{"ok":1}}\n\n';
    expect(parseRpcBody('text/event-stream', text)).toEqual({
      jsonrpc: '2.0',
      id: 2,
      result: { ok: 1 },
    });
    expect(parseRpcBody('application/json', 'not json')).toBeNull();
  });
});
