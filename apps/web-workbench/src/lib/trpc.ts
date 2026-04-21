import { createTRPCClient, httpBatchLink } from '@trpc/client';
import type { AppRouter } from '@holaday/orchestrator/trpc/router';
import { getAccessToken } from '@/lib/auth';

/**
 * tRPC client for the web workbench. Talks to the orchestrator at
 * `/api/trpc` — vite's dev proxy rewrites `/api` → `http://127.0.0.1:3001`
 * so we keep same-origin and avoid CORS. In prod the workbench is
 * served behind the same hostname, and `/api` routes to the
 * orchestrator the same way.
 *
 * Auth is a Bearer header sourced from localStorage on every request
 * (not captured once at boot). That means the header picks up a fresh
 * token immediately after `auth.login` stores it — no client rebuild.
 */
export const trpc = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: '/api/trpc',
      headers() {
        const token = getAccessToken();
        return token ? { authorization: `Bearer ${token}` } : {};
      },
    }),
  ],
});

export type { AppRouter };
