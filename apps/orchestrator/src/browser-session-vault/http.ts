import { selectedChromeTargetSchema } from '@holaday/shared-types';
import type { ErrorRequestHandler, Request, RequestHandler } from 'express';
import { z } from 'zod';
import type { ExtensionToolCallOptions, ExtensionToolCallOutcome } from '../ws/server.js';
import type { VaultRuntime } from './runtime.js';
import { VaultError } from './vault.js';
const id = z.string().uuid();
const dispatch = z
  .object({
    grantId: id,
    extensionClientId: z.string().min(1).max(128),
    target: selectedChromeTargetSchema,
  })
  .strict();

/** Parser errors may embed request bytes. Never pass vault payload errors to default logs. */
export const vaultBodyErrorHandler: ErrorRequestHandler = (error, req, res, next) => {
  if (!req.path.startsWith('/browser-data')) return next(error);
  res.status(400).json({ error: 'invalid_request' });
};

export function installVaultRoutes(options: {
  get(path: string, handler: RequestHandler): void;
  post(path: string, handler: RequestHandler): void;
  runtime?: VaultRuntime;
  importEnabled: boolean;
  profileEnabled: boolean;
  send(userId: string, options: ExtensionToolCallOptions): Promise<ExtensionToolCallOutcome>;
  purgeLegacy?: (userId: string) => Promise<void>;
}) {
  const runtime = () => {
    if (!options.runtime) throw new VaultError('vault_disabled');
    return options.runtime;
  };
  const route =
    (work: (req: Request, user: string) => Promise<unknown>, needsRuntime = true): RequestHandler =>
    async (req, res) => {
      const user = (req as Request & { userId?: string }).userId;
      if (!user) {
        res.status(401).json({ error: 'unauthorized' });
        return;
      }
      if (needsRuntime && !options.runtime) {
        res.status(409).json({ error: 'vault_disabled' });
        return;
      }
      try {
        res.json(await work(req, user));
      } catch (error) {
        const code =
          error instanceof VaultError
            ? error.code
            : error instanceof z.ZodError
              ? 'invalid_request'
              : 'vault_unavailable';
        res
          .status(
            ['invalid_request', 'invalid_grant', 'scope_denied', 'invalid_session'].includes(code)
              ? 400
              : 409,
          )
          .json({ error: code });
      }
    };
  options.get(
    '/browser-data',
    route(
      async (_req, user) => ({
        enabled: Boolean(options.runtime),
        importEnabled: Boolean(options.runtime && options.importEnabled),
        profileEnabled: Boolean(options.runtime && options.profileEnabled),
        grants: options.runtime ? await options.runtime.vault.list(user) : [],
      }),
      false,
    ),
  );
  options.post(
    '/browser-data/grants',
    route(async (req, user) => {
      const body = z
        .object({ consent: z.literal('session-import-v1'), request: z.unknown() })
        .strict()
        .parse(req.body);
      const grant = await runtime().vault.grant(user, body.request);
      try {
        await options.purgeLegacy?.(user);
      } catch {
        await runtime().vault.revoke(user, grant.id);
        throw new VaultError('legacy_cleanup_failed');
      }
      return grant;
    }),
  );
  options.get(
    '/browser-data/grants/:id/scope',
    route(async (req, user) => runtime().vault.importScope(user, id.parse(req.params.id))),
  );
  options.post(
    '/browser-data/grants/:id/import',
    route(async (req, user) =>
      runtime().vault.import(user, id.parse(req.params.id), req.body, (state, grant) =>
        runtime().worker.verify(user, state, grant),
      ),
    ),
  );
  options.post(
    '/browser-data/grants/:id/revoke',
    route(async (req, user) => {
      await runtime().vault.revoke(user, id.parse(req.params.id));
      await options.purgeLegacy?.(user);
      return { status: 'revoked' };
    }),
  );
  options.post(
    '/browser-data/clear',
    route(async (_req, user) => {
      await runtime().vault.clear(user);
      await options.purgeLegacy?.(user);
      return { status: 'cleared' };
    }),
  );
  options.post(
    '/browser-data/dispatch',
    route(async (req, user) => {
      const body = dispatch.parse(req.body);
      const grant = await runtime().vault.importScope(user, body.grantId);
      if (new URL(body.target.expectedUrl).origin !== grant.origin)
        throw new VaultError('scope_denied');
      const outcome = await options.send(user, {
        taskId: `vault-${grant.id}`,
        kind: 'session_import',
        extensionClientId: body.extensionClientId,
        args: { sessionImport: { grantId: grant.id, target: body.target } },
        timeoutMs: 30000,
      });
      // The result channel contains only status; trust the server's persisted metadata.
      if (!outcome.ok) throw new VaultError('extension_unavailable');
      return (await runtime().vault.list(user)).find((g) => g.id === grant.id);
    }),
  );
}
