/**
 * Phase 5d — webhook task-creation handler.
 *
 * Reachable via `POST /api/webhooks/tasks` (nginx strips `/api/`,
 * so we mount the route as `/webhooks/tasks` on the express app).
 *
 * Auth: Bearer `hd_live_<...>` — distinct from the JWT-based bearer
 * the SPA uses. The orchestrator's standard `bearerAuth` middleware
 * runs first and silently no-ops for non-JWT bearers, so by the time
 * this handler runs `req.userId` is unset and we look the key up
 * ourselves.
 *
 * Response contract:
 *   200  { taskId: 'tsk_…', status: 'pending' | … }
 *   400  { error: 'missing_prompt' }
 *   401  { error: 'invalid_api_key' }
 *   429  { error: 'quota_exceeded' }
 *   500  { error: 'internal_error' }
 *
 * Errors are JSON, never HTML — third-party callers expect a stable
 * machine-readable shape.
 *
 * Side effects per successful call:
 *   - `api_keys.last_used_at` stamped (for the SPA list)
 *   - tasks.create invoked as the owning user (full quota + supercar
 *     dispatch as if the user had submitted via the SPA)
 *
 * NOTE: this handler is mounted at the app level and depends on the
 * full appRouter via createCaller. The handler doesn't have an
 * Express middleware contract beyond `(req, res) => void`, so it
 * doesn't need an explicit `next` — errors are caught + responded.
 */

import type { Request, Response } from 'express';
import { and, eq, gt, isNull, or } from 'drizzle-orm';
import type { Logger } from 'pino';
import { TRPCError } from '@trpc/server';
import {
  extractBearer,
  hashApiKey,
  isValidApiKeyShape,
} from './api-key-service.js';
import { apiKeys } from '../db/schema/api-keys.js';
import { users } from '../db/schema/users.js';
import type { DB } from '../db/client.js';
import type { Context } from '../trpc/context.js';

export interface WebhookDeps {
  db: DB;
  logger: Logger;
  /**
   * Build a Context object scoped to the resolved user. The webhook
   * needs every adapter handle that tasks.create reads through the
   * tRPC context — passing a factory rather than the raw ctx lets the
   * caller (http.ts) keep its existing deps closure.
   */
  buildContextForUser: (userExternalId: string) => Context;
  /**
   * Dispatch via the tRPC `tasks.create` mutation. Caller wires this
   * to `tasksRouter.createCaller(ctx).create({intent})` so the same
   * quota / planning / supercar path the SPA uses runs here.
   */
  dispatch: (ctx: Context, input: { intent: string }) => Promise<{
    taskId: string;
    status: string;
  }>;
}

/**
 * Validate + hash + look up the bearer key. Returns:
 *   - { ok: true, ...user, apiKeyInternalId }
 *   - { ok: false, code: 'missing' | 'malformed' | 'unknown' | 'revoked' | 'expired' }
 */
export async function resolveApiKey(
  bearer: string | null,
  db: DB,
): Promise<
  | { ok: true; userExternalId: string; apiKeyInternalId: number }
  | { ok: false; code: 'missing' | 'malformed' | 'unknown' | 'revoked' | 'expired' }
> {
  if (!bearer) return { ok: false, code: 'missing' };
  if (!isValidApiKeyShape(bearer)) return { ok: false, code: 'malformed' };
  const hash = hashApiKey(bearer);
  const [row] = await db
    .select({
      id: apiKeys.id,
      userId: apiKeys.userId,
      revokedAt: apiKeys.revokedAt,
      expiresAt: apiKeys.expiresAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.keyHash, hash))
    .limit(1);
  if (!row) return { ok: false, code: 'unknown' };
  if (row.revokedAt !== null) return { ok: false, code: 'revoked' };
  if (row.expiresAt !== null && row.expiresAt.getTime() <= Date.now()) {
    return { ok: false, code: 'expired' };
  }
  // Resolve owner's external id for the tRPC context.
  const [user] = await db
    .select({ externalId: users.externalId })
    .from(users)
    .where(eq(users.id, row.userId))
    .limit(1);
  if (!user) return { ok: false, code: 'unknown' }; // user deleted mid-flight
  return {
    ok: true,
    userExternalId: user.externalId,
    apiKeyInternalId: row.id,
  };
}

/**
 * Build the express handler. The dependency injection here lets the
 * test suite drive the handler without mounting Express.
 */
export function createWebhookTasksHandler(deps: WebhookDeps) {
  return async function handle(req: Request, res: Response): Promise<void> {
    const bearer = extractBearer(req.header('authorization'));
    const resolution = await resolveApiKey(bearer, deps.db);
    if (!resolution.ok) {
      // Don't leak whether the key was malformed vs unknown vs revoked
      // vs expired — all four are "your bearer doesn't work". The log
      // line carries the breakdown for the operator.
      deps.logger.info(
        {
          reason: resolution.code,
          bearerPrefix: bearer ? bearer.slice(0, 12) : null,
          path: req.path,
        },
        'webhook: rejected unauthorized request',
      );
      res.status(401).json({ error: 'invalid_api_key' });
      return;
    }
    const body = (req.body ?? {}) as { prompt?: unknown; roleId?: unknown };
    const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
    if (!prompt) {
      res.status(400).json({ error: 'missing_prompt' });
      return;
    }
    if (prompt.length > 2_000) {
      res.status(400).json({ error: 'prompt_too_long' });
      return;
    }
    // roleId is accepted but not yet plumbed (tasks.create's
    // `replyToTaskId` is a different shape). Reserved for a future
    // version of the webhook that routes to a specific workflow.
    void body.roleId;

    // Stamp last_used_at BEFORE dispatching the task so a long-running
    // task doesn't make the timestamp look stale to the SPA. Best-
    // effort: a failed update doesn't block the task creation.
    deps.db
      .update(apiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(apiKeys.id, resolution.apiKeyInternalId))
      .catch((err) => {
        deps.logger.warn(
          { err: err instanceof Error ? err.message : String(err) },
          'webhook: lastUsedAt update failed (non-fatal)',
        );
      });

    let ctx: Context;
    try {
      ctx = deps.buildContextForUser(resolution.userExternalId);
    } catch (err) {
      deps.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'webhook: failed to build context',
      );
      res.status(500).json({ error: 'internal_error' });
      return;
    }

    try {
      const result = await deps.dispatch(ctx, { intent: prompt });
      res.status(200).json({ taskId: result.taskId, status: result.status });
    } catch (err) {
      // TRPCError carries a code we can map. Quota / rate-limit shape
      // varies across the tasks router — TOO_MANY_REQUESTS is the
      // standard tRPC code, but the existing quota gate throws
      // PRECONDITION_FAILED with a 'quota' message; treat both as 429.
      if (err instanceof TRPCError) {
        if (
          err.code === 'TOO_MANY_REQUESTS' ||
          (err.code === 'PRECONDITION_FAILED' && /quota|配额/i.test(err.message))
        ) {
          res.status(429).json({ error: 'quota_exceeded', message: err.message });
          return;
        }
        if (err.code === 'UNAUTHORIZED' || err.code === 'FORBIDDEN') {
          res.status(403).json({ error: 'forbidden', message: err.message });
          return;
        }
        if (err.code === 'BAD_REQUEST') {
          res.status(400).json({ error: 'bad_request', message: err.message });
          return;
        }
      }
      const msg = err instanceof Error ? err.message : String(err);
      deps.logger.warn({ err: msg }, 'webhook: dispatch failed');
      res.status(500).json({ error: 'internal_error' });
    }
  };
}

// Re-export for tests + suppress unused-import warning on the
// drizzle helpers that were imported for the SQL-time `expires_at`
// check above (we ended up doing it in app code; the helpers stay
// available in case a future iteration moves the filter into the
// query itself).
export const _unused = { and, gt, isNull, or };
