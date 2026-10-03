import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ExecutionAdmission } from './execution-admission.js';
import {
  type OperationLifetime,
  currentOperationLifetime,
  startOwnedOperation,
} from './owned-operation.js';

// Never read ownership from request fields, headers, or mutable application deps.
const requests = new WeakMap<Request, OperationLifetime>();
const requestScope = new AsyncLocalStorage<Request>();
const procedureScope = new AsyncLocalStorage<true>();

export function withHttpProcedure<T>(action: () => T): T {
  return procedureScope.run(true, action);
}

export function originalHttpLifetime(req: Request): OperationLifetime | undefined {
  return requests.get(req);
}

/** Only the original request's async chain can consume its root or current child. */
export function httpProcedureParent(req: Request, supplied?: OperationLifetime): OperationLifetime {
  const original = requests.get(req);
  // Always apply the current sealed-scope veto, including initial root input.
  const current = currentOperationLifetime();
  if (!original || requestScope.getStore() !== req || !supplied)
    throw new Error('HTTP_DRAIN_CONTEXT_MISMATCH');
  // Only the adapter's initial invocation may consume a root Context. Once
  // inside a procedure, descendants must use their exact current child; a saved
  // root must not bypass a closed/ended child or dispatch scope.
  if (procedureScope.getStore() ? supplied !== current : supplied !== original)
    throw new Error('HTTP_DRAIN_CONTEXT_MISMATCH');
  if (supplied.drain !== original.drain) throw new Error('HTTP_DRAIN_CONTEXT_MISMATCH');
  return supplied;
}

function ended(res: Response): boolean {
  return res.destroyed || res.writableEnded;
}

function unavailable(res: Response): void {
  if (ended(res)) return;
  if (res.headersSent) res.destroy();
  else res.status(503).json({ error: 'service_unavailable' });
}

/** An explicit per-app boundary, not a patch to Express or a global IO proxy.
 * Callback middleware must call next at actual completion. Async handlers must
 * return their original promise. Detached business work still needs its own owner. */
export function createHttpDrain(controller?: ExecutionAdmission) {
  const admit: RequestHandler = (req, res, next) => {
    if (!controller) {
      if (currentOperationLifetime()) return unavailable(res);
      return next();
    }
    try {
      if (requests.has(req) || currentOperationLifetime()) return unavailable(res);
      const operation = controller.runRoot(async (lifetime) => {
        requests.set(req, lifetime);
        await new Promise<void>((resolve, reject) => {
          const done = () => {
            res.off('finish', done);
            res.off('close', done);
            resolve();
          };
          res.once('finish', done);
          res.once('close', done);
          try {
            requestScope.run(req, next);
          } catch (error) {
            reject(error);
          }
        });
      });
      void operation.result.catch(() => unavailable(res));
    } catch {
      unavailable(res);
    }
  };

  function wrap(original: RequestHandler, callback: boolean): RequestHandler {
    if (!controller) return original;
    return (req, res, next) => {
      if (ended(res)) return;
      try {
        const anchor = requests.get(req);
        const inherited = currentOperationLifetime();
        if (
          !anchor ||
          anchor.drain !== controller.drain ||
          !inherited ||
          inherited.drain !== anchor.drain
        ) {
          return unavailable(res);
        }
        const operation = startOwnedOperation(
          controller.drain,
          'request',
          async () => {
            let called = false;
            let complete!: () => void;
            const completion = new Promise<void>((resolve) => {
              complete = resolve;
            });
            const advance: NextFunction = (error?: unknown) => {
              if (called) {
                controller.drain.block();
                return;
              }
              called = true;
              try {
                if (!ended(res)) next(error);
              } finally {
                complete();
              }
            };
            // Invoke immediately inside the child, before Promise assimilation.
            await original(req, res, advance);
            if (callback) await completion;
          },
          { parent: inherited.owner, errorOutcome: 'unknown', dispatch: 'immediate' },
        );
        void operation.result.catch(() => unavailable(res));
      } catch {
        unavailable(res);
      }
    };
  }
  return {
    admit,
    handler: (handler: RequestHandler) => wrap(handler, false),
    middleware: (handler: RequestHandler) => wrap(handler, true),
  };
}
