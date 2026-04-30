/**
 * Phase 16b — MCP connections router. Display-only in v1; just
 * exposes the static MCP_PROVIDERS catalogue so the SPA renders
 * the same set across all clients without hard-coding.
 *
 * A future batch adds `connect` / `disconnect` mutations + the
 * mcp_connections table once the OAuth flow lands.
 */

import { MCP_PROVIDERS } from '../../agent/mcp-providers.js';
import { protectedProcedure, router } from '../trpc.js';

export const connectionsRouter = router({
  list: protectedProcedure.query(() => {
    return MCP_PROVIDERS.map((p) => ({
      id: p.id,
      name: p.name,
      icon: p.icon,
      description: p.description,
      category: p.category,
      oauthSupported: p.oauthSupported,
      comingSoon: p.comingSoon,
    }));
  }),
});
