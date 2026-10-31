import { eq } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { modelCatalogEvents, modelCatalogSettings } from '../db/schema/model-catalog.js';
import { users } from '../db/schema/users.js';
import { isAllowedMcpUrl } from './mcp-url-policy.js';
import { ModelCatalogError } from './model-catalog.js';
import type { NeutralMcpTool } from './responses-adapter.js';

/** A Bailian hosted MCP server (SSE). No credentials: the DashScope key is added per request. */
export interface McpServerConfig {
  label: string;
  url: string;
}

export const MAX_MCP_SERVERS = 10;
const LABEL_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** Validates an admin-submitted list; throws ModelCatalogError with Chinese copy. */
export function validateMcpServers(value: unknown): McpServerConfig[] {
  if (!Array.isArray(value))
    throw new ModelCatalogError('INVALID_UPDATE', 'MCP 服务列表格式不正确');
  if (value.length > MAX_MCP_SERVERS)
    throw new ModelCatalogError('INVALID_UPDATE', `最多配置 ${MAX_MCP_SERVERS} 个 MCP 服务`);
  const seen = new Set<string>();
  return value.map((entry) => {
    const record = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
    const label = typeof record.label === 'string' ? record.label.trim() : '';
    const url = typeof record.url === 'string' ? record.url.trim() : '';
    if (!LABEL_RE.test(label))
      throw new ModelCatalogError('INVALID_UPDATE', 'MCP 名称只能包含字母、数字、下划线和短横线');
    if (seen.has(label)) throw new ModelCatalogError('INVALID_UPDATE', `MCP 名称重复：${label}`);
    seen.add(label);
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new ModelCatalogError('INVALID_UPDATE', `MCP 地址无效：${label}`);
    }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search)
      throw new ModelCatalogError(
        'INVALID_UPDATE',
        `MCP 地址必须是不带凭据和参数的 https 地址：${label}`,
      );
    // The DashScope key is sent to this host: Alibaba Model Studio only.
    if (!isAllowedMcpUrl(parsed.toString()))
      throw new ModelCatalogError(
        'INVALID_UPDATE',
        `MCP 地址必须是阿里云百炼的域名（dashscope.aliyuncs.com、dashscope-intl.aliyuncs.com、*.dashscope.aliyuncs.com 或 *.maas.aliyuncs.com）：${label}`,
      );
    return { label, url: parsed.toString() };
  });
}

export function toMcpTools(servers: readonly McpServerConfig[]): NeutralMcpTool[] {
  return servers.map((server) => ({
    type: 'mcp',
    serverLabel: server.label,
    serverUrl: server.url,
  }));
}

export interface CatalogSettingsStore {
  loadMcpServers(): Promise<McpServerConfig[]>;
  saveMcpServers(input: {
    next: readonly McpServerConfig[];
    before: readonly McpServerConfig[];
    actorExternalId: string;
  }): Promise<void>;
}

export interface CatalogSettingsService {
  /** Synchronous view for runtime wiring; refreshes in the background every 10s. */
  mcpServersSnapshot(): readonly McpServerConfig[];
  mcpServers(): Promise<readonly McpServerConfig[]>;
  updateMcpServers(input: { servers: unknown; actorExternalId: string }): Promise<
    readonly McpServerConfig[]
  >;
}

export function createCatalogSettingsService(input: {
  store: CatalogSettingsStore | null;
  now?: () => number;
  ttlMs?: number;
}): CatalogSettingsService {
  const now = input.now ?? Date.now;
  const ttlMs = input.ttlMs ?? 10_000;
  let servers: readonly McpServerConfig[] = [];
  let loadedAt = Number.NEGATIVE_INFINITY;
  let inflight: Promise<readonly McpServerConfig[]> | null = null;
  const load = () => {
    if (!input.store) return Promise.resolve(servers);
    if (inflight) return inflight;
    inflight = input.store
      .loadMcpServers()
      .then((rows) => {
        servers = rows;
        loadedAt = now();
        return servers;
      })
      .catch(() => {
        // Missing table (pre-0064) or a transient error: no MCP tools.
        loadedAt = now();
        return servers;
      })
      .finally(() => {
        inflight = null;
      });
    return inflight;
  };
  const fresh = () => now() - loadedAt < ttlMs;
  return {
    mcpServersSnapshot() {
      if (!fresh()) void load();
      return servers;
    },
    async mcpServers() {
      return fresh() ? servers : load();
    },
    async updateMcpServers(request) {
      if (!input.store) throw new ModelCatalogError('INVALID_UPDATE', '模型目录尚未就绪');
      const next = validateMcpServers(request.servers);
      const before = await input.store.loadMcpServers().catch(() => []);
      await input.store.saveMcpServers({ next, before, actorExternalId: request.actorExternalId });
      servers = next;
      loadedAt = now();
      return servers;
    },
  };
}

export function createDrizzleCatalogSettingsStore(db: DB): CatalogSettingsStore {
  return {
    async loadMcpServers() {
      const [row] = await db
        .select({ value: modelCatalogSettings.value })
        .from(modelCatalogSettings)
        .where(eq(modelCatalogSettings.id, 'mcp_servers'))
        .limit(1);
      if (!row) return [];
      try {
        return validateMcpServers(
          typeof row.value === 'string' ? JSON.parse(row.value) : row.value,
        );
      } catch {
        return [];
      }
    },
    async saveMcpServers(change) {
      await db.transaction(async (tx) => {
        const [actor] = await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.externalId, change.actorExternalId))
          .limit(1);
        if (!actor) throw new ModelCatalogError('INVALID_UPDATE', '操作人不存在');
        await tx
          .insert(modelCatalogSettings)
          .values({ id: 'mcp_servers', value: [...change.next] })
          .onDuplicateKeyUpdate({ set: { value: [...change.next], updatedAt: new Date() } });
        await tx.insert(modelCatalogEvents).values({
          modelId: '_settings',
          actorUserId: actor.id,
          action: 'mcp_servers',
          beforeJson: { mcpServers: change.before },
          afterJson: { mcpServers: change.next },
        });
      });
    },
  };
}
