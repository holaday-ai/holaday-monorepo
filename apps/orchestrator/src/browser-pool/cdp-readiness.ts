import {
  type OperationLifetime,
  currentOperationLifetime,
  startOwnedOperation,
} from '../execution/owned-operation.js';

/** Only for the fixed, read-only loopback CDP version probe, never business HTTP. */
async function withProbeLifetime<T>(action: () => Promise<T>): Promise<T> {
  const lifetime = currentOperationLifetime();
  if (!lifetime) return action();
  if (lifetime.drain.snapshot().unknown > 0) throw new Error('CDP_PROBE_UNKNOWN');
  return startOwnedOperation(lifetime.drain, 'execution', action, {
    parent: lifetime.owner,
    dispatch: 'immediate',
    errorOutcome: 'known',
  }).result;
}

/** Keep the response operation pinned through headers, body and physical disposal. */
async function disposeResponse(
  response: Response | undefined,
  lifetime: OperationLifetime | undefined,
): Promise<void> {
  try {
    // This disposes only the response already acquired by the pinned operation.
    // It must still run after a later guard permanently blocks new requests.
    if (response && !response.bodyUsed) await response.body?.cancel();
  } catch (error) {
    lifetime?.drain.markUnknown(lifetime.owner);
    throw error;
  }
}

/** The existing response pin is retained until disposal completes or is unknown. */
async function probeResponse(cdpPort: number, deadline: number): Promise<string> {
  return withProbeLifetime(async () => {
    const lifetime = currentOperationLifetime();
    const controller = new AbortController();
    const attemptDeadline = Math.min(deadline, Date.now() + 2_000);
    const assertFresh = () => {
      if (controller.signal.aborted || Date.now() >= attemptDeadline) {
        throw new Error('CDP probe deadline exceeded');
      }
    };
    const timer = setTimeout(() => controller.abort(), Math.max(0, attemptDeadline - Date.now()));
    let response: Response | undefined;
    let version: string;
    try {
      assertFresh();
      response = await fetch(`http://127.0.0.1:${cdpPort}/json/version`, {
        signal: controller.signal,
        redirect: 'error',
      });
      assertFresh();
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const acquired = response;
      const body = (await withProbeLifetime(() => acquired.json())) as { Browser?: string };
      version = body.Browser ?? 'unknown';
      assertFresh();
    } finally {
      try {
        await disposeResponse(response, lifetime);
      } finally {
        clearTimeout(timer);
      }
    }
    // Cleanup may outlive the deadline even if the body arrived in time.
    assertFresh();
    return version;
  });
}

/** Poll the local read-only version endpoint; timeout never releases pending IO. */
export async function waitForCdpReady(cdpPort: number, timeoutMs = 10_000): Promise<string> {
  if (typeof cdpPort !== 'number' || !Number.isInteger(cdpPort) || cdpPort < 1 || cdpPort > 65535) {
    throw new Error('CDP probe requires an integer loopback port in 1..65535');
  }
  if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('CDP probe requires a finite positive timeout');
  }
  return withProbeLifetime(async () => {
    const deadline = Date.now() + timeoutMs;
    let lastErr: unknown = null;
    while (Date.now() < deadline) {
      try {
        const version = await probeResponse(cdpPort, deadline);
        if (Date.now() >= deadline) throw new Error('CDP probe deadline exceeded');
        return version;
      } catch (error) {
        lastErr = error;
      }
      const remaining = deadline - Date.now();
      if (remaining > 0) {
        await withProbeLifetime(
          () => new Promise((resolve) => setTimeout(resolve, Math.min(250, remaining))),
        );
      }
    }
    throw new Error(
      `waitForCdpReady(${cdpPort}): timed out after ${timeoutMs}ms (last err: ${
        lastErr instanceof Error ? lastErr.message : String(lastErr)
      })`,
    );
  });
}
