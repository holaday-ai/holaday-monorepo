import {
  captureOperationScopeVeto,
  currentOperationLifetime,
  startOwnedOperation,
} from '../../execution/owned-operation.js';

/** Reserve before callers convert an upstream failure into a display envelope.
 * A fulfilled display fallback is not evidence that the original request succeeded. */
export async function runMarketRequest<T>(
  action: (beforeDispatch: () => void) => Promise<T>,
): Promise<T> {
  const parent = currentOperationLifetime();
  if (!parent) return action(() => {});
  const originalVeto = captureOperationScopeVeto();
  return startOwnedOperation(
    parent.drain,
    'execution',
    async () => {
      const lifetime = currentOperationLifetime();
      if (!lifetime) throw new Error('MARKET_SCOPE_MISSING');
      const veto = captureOperationScopeVeto();
      const beforeDispatch = () => {
        lifetime.drain.assertDispatch(lifetime.owner);
        veto();
        originalVeto();
      };
      originalVeto();
      return action(beforeDispatch);
    },
    { parent: parent.owner, errorOutcome: 'unknown', dispatch: 'immediate' },
  ).result;
}

/** Bounded memory, full body settlement; headers alone do not finish a request. */
export async function readWarmResponse(response: Response): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('PREWARM_RESPONSE_MISSING');
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > 65536) throw new Error('PREWARM_RESPONSE_LIMIT');
      chunks.push(value);
    }
    if (!response.ok) throw new Error('PREWARM_HTTP_FAILED');
    const bytes = Buffer.concat(chunks, total);
    const data: unknown = JSON.parse(bytes.toString('utf8'));
    if (
      !data ||
      typeof data !== 'object' ||
      'error' in data ||
      !('count' in data) ||
      data.count !== 1 ||
      !('data' in data) ||
      !Array.isArray(data.data) ||
      data.data.length !== 1 ||
      !data.data[0] ||
      typeof data.data[0] !== 'object' ||
      !Number.isSafeInteger(data.data[0].count) ||
      data.data[0].count < 0
    )
      throw new Error('PREWARM_RESPONSE_FAILED');
  } finally {
    try {
      await reader.cancel();
    } finally {
      reader.releaseLock();
    }
  }
}
