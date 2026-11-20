import { describe, expect, it, vi } from 'vitest';
import {
  type CatalogSettingsStore,
  MAX_MCP_SERVERS,
  type McpServerConfig,
  createCatalogSettingsService,
  toMcpTools,
  validateMcpServers,
} from './model-catalog-settings.js';

const AMAP = { label: 'amap', url: 'https://dashscope.aliyuncs.com/api/v1/mcps/amap/sse' };

describe('validateMcpServers', () => {
  it('accepts https SSE endpoints with unique labels', () => {
    expect(
      validateMcpServers([
        AMAP,
        { label: 'web_2', url: 'https://dashscope-intl.aliyuncs.com/api/v1/mcps/web/sse' },
      ]),
    ).toEqual([
      AMAP,
      { label: 'web_2', url: 'https://dashscope-intl.aliyuncs.com/api/v1/mcps/web/sse' },
    ]);
  });

  it.each([
    ['not a list', { label: 'a' }],
    ['bad label', [{ label: 'has space', url: AMAP.url }]],
    ['duplicate label', [AMAP, AMAP]],
    ['http', [{ label: 'a', url: 'http://dashscope.aliyuncs.com/sse' }]],
    ['credentials in url', [{ label: 'a', url: 'https://user:pw@dashscope.aliyuncs.com/sse' }]],
    ['third-party host', [{ label: 'a', url: 'https://mcp.evil.com/sse' }]],
    [
      'look-alike suffix host',
      [{ label: 'a', url: 'https://dashscope.aliyuncs.com.evil.com/sse' }],
    ],
    ['look-alike prefix host', [{ label: 'a', url: 'https://evildashscope.aliyuncs.com/sse' }]],
    ['other aliyuncs subdomain', [{ label: 'a', url: 'https://oss-cn-hangzhou.aliyuncs.com/sse' }]],
    ['non-443 port', [{ label: 'a', url: 'https://dashscope.aliyuncs.com:8443/sse' }]],
    [
      'query string',
      [{ label: 'a', url: 'https://dashscope-intl.aliyuncs.com/api/v1/mcps/web/sse?key=1' }],
    ],
    [
      'too many',
      Array.from({ length: MAX_MCP_SERVERS + 1 }, (_, i) => ({ label: `s${i}`, url: AMAP.url })),
    ],
  ])('rejects %s', (_name, value) => {
    expect(() => validateMcpServers(value)).toThrow();
  });

  it('accepts the Model Studio subdomain families', () => {
    for (const url of [
      'https://dashscope-intl.aliyuncs.com/api/v1/mcps/x/sse',
      'https://ws-1.cn-beijing.maas.aliyuncs.com/mcp/sse',
      'https://mcp.dashscope.aliyuncs.com/x/sse',
    ])
      expect(validateMcpServers([{ label: 'a', url }])).toHaveLength(1);
  });

  it('rejects a third-party host with Chinese copy', () => {
    expect(() => validateMcpServers([{ label: 'a', url: 'https://mcp.evil.com/sse' }])).toThrow(
      /阿里云百炼/,
    );
  });

  it('maps configs to neutral MCP tools', () => {
    expect(toMcpTools([AMAP])).toEqual([{ type: 'mcp', serverLabel: 'amap', serverUrl: AMAP.url }]);
  });
});

describe('createCatalogSettingsService', () => {
  function memoryStore(initial: McpServerConfig[] = []) {
    let rows = initial;
    const store: CatalogSettingsStore = {
      loadMcpServers: vi.fn(async () => rows),
      saveMcpServers: vi.fn(async ({ next }) => {
        rows = [...next];
      }),
    };
    return store;
  }

  it('starts empty and refreshes the snapshot in the background', async () => {
    const store = memoryStore([AMAP]);
    const service = createCatalogSettingsService({ store });
    expect(service.mcpServersSnapshot()).toEqual([]);
    await vi.waitFor(() => expect(service.mcpServersSnapshot()).toEqual([AMAP]));
  });

  it('caches reads within the ttl', async () => {
    let time = 0;
    const store = memoryStore([AMAP]);
    const service = createCatalogSettingsService({ store, now: () => time, ttlMs: 1000 });
    await service.mcpServers();
    await service.mcpServers();
    expect(store.loadMcpServers).toHaveBeenCalledTimes(1);
    time = 2000;
    await service.mcpServers();
    expect(store.loadMcpServers).toHaveBeenCalledTimes(2);
  });

  it('falls back to no tools when the table is missing', async () => {
    const service = createCatalogSettingsService({
      store: {
        loadMcpServers: async () => {
          throw new Error("Table 'model_catalog_settings' doesn't exist");
        },
        saveMcpServers: async () => {},
      },
    });
    await expect(service.mcpServers()).resolves.toEqual([]);
  });

  it('validates, saves with the previous value, and serves the new list immediately', async () => {
    const store = memoryStore([AMAP]);
    const service = createCatalogSettingsService({ store });
    const next = await service.updateMcpServers({
      servers: [{ label: 'web', url: 'https://dashscope-intl.aliyuncs.com/api/v1/mcps/web/sse' }],
      actorExternalId: 'usr_admin',
    });
    expect(next).toEqual([
      { label: 'web', url: 'https://dashscope-intl.aliyuncs.com/api/v1/mcps/web/sse' },
    ]);
    expect(store.saveMcpServers).toHaveBeenCalledWith({
      next,
      before: [AMAP],
      actorExternalId: 'usr_admin',
    });
    expect(service.mcpServersSnapshot()).toEqual(next);
    await expect(
      service.updateMcpServers({
        servers: [{ label: 'a', url: 'http://x' }],
        actorExternalId: 'u',
      }),
    ).rejects.toThrow();
  });
});
