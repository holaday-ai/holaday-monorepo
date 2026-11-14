import { describe, expect, it } from 'vitest';
import { TestKeyProvider } from '../browser-session-vault/crypto.js';
import { createVaultRuntime } from '../browser-session-vault/runtime.js';
import { MemoryVaultStore } from '../browser-session-vault/vault.js';
import { restorableBrowserTarget, storedBrowserSessionPolicy } from './browser-session-recovery.js';
import { sessionPolicyOf } from './types.js';

const LEGACY_PUBLIC_LIMITATION =
  '已显式选择云端公开查询（无登录态）；可能遇到登录或反爬限制，无法读取个人信息。';
/** A completed browser task as Deploy-16 stored it: no policy field anywhere. */
const legacyTask = (metadata: Record<string, unknown> = {}, sourceContext: unknown = null) => ({
  origin: 'user',
  status: 'completed',
  sourceContext,
  result: {
    finalUrl: 'https://shop.example.test/catalog',
    metadata: { executionMode: 'browser', ...metadata },
  },
});

describe('D17-P1-01/02 session policy helpers', () => {
  it('allocation: only an explicit vault_allowed may load a session (fail closed)', () => {
    expect(sessionPolicyOf({ sessionPolicy: 'vault_allowed' })).toBe('vault_allowed');
    expect(sessionPolicyOf({ sessionPolicy: 'anonymous' })).toBe('anonymous');
    expect(sessionPolicyOf({})).toBe('anonymous');
    expect(sessionPolicyOf(undefined)).toBe('anonymous');
    expect(sessionPolicyOf({ sessionPolicy: 'anything' as never })).toBe('anonymous');
  });
  it.each([
    [
      'legacy public task (sourceContext null, logged-out promise)',
      legacyTask({ browserLimitation: LEGACY_PUBLIC_LIMITATION }),
      'anonymous',
    ],
    ['legacy task without any policy evidence', legacyTask(), 'anonymous'],
    [
      'legacy local-Chrome sourceContext',
      legacyTask({}, { browserSource: 'local-chrome' }),
      'anonymous',
    ],
    ['unknown stored value', legacyTask({}, { browserSessionPolicy: 'everything' }), 'anonymous'],
    ['stored anonymous', legacyTask({}, { browserSessionPolicy: 'anonymous' }), 'anonymous'],
    [
      'stored vault_allowed (identity task, PR #271 onward)',
      legacyTask({}, { browserSessionPolicy: 'vault_allowed' }),
      'vault_allowed',
    ],
    [
      'stored vault_allowed but the result promised no login',
      legacyTask(
        { browserLimitation: LEGACY_PUBLIC_LIMITATION },
        { browserSessionPolicy: 'vault_allowed' },
      ),
      'anonymous',
    ],
    ['no result at all', { sourceContext: null, result: null }, 'anonymous'],
    ['no task record (null)', null, 'anonymous'],
  ] as const)('restore policy: %s → %s', (_label, task, expected) => {
    expect(storedBrowserSessionPolicy(task)).toBe(expected);
  });
});

/**
 * The restore composition used by tasks.ensureBrowserSession: restorable target
 * + stored policy + the vault runtime. Synthetic store/keys, no network.
 */
describe('D17-P1-02: restoring a task browser with a connected grant for its site', () => {
  async function restore(task: ReturnType<typeof legacyTask>) {
    const runtime = createVaultRuntime({
      importEnabled: true,
      profileEnabled: false,
      keys: new TestKeyProvider(),
      store: new MemoryVaultStore(),
    });
    if (!runtime) throw new Error('runtime missing');
    let matched = 0;
    let opened = 0;
    runtime.vault.match = async () => {
      matched++;
      return { id: 'grant_synthetic' } as never;
    };
    runtime.worker.open = async () => {
      opened++;
      return { close: async () => {} } as never;
    };
    const target = restorableBrowserTarget(task);
    if (!target) throw new Error('not restorable');
    const executor = {};
    await runtime.prepare('usr_synthetic', executor as never, {
      targetUrl: target.url,
      sessionPolicy: storedBrowserSessionPolicy(task),
    });
    await runtime.finish(executor as never);
    return { matched, opened };
  }
  it('a legacy public task restores with 0 vault matches and 0 worker.open', async () => {
    expect(await restore(legacyTask({ browserLimitation: LEGACY_PUBLIC_LIMITATION }))).toEqual({
      matched: 0,
      opened: 0,
    });
    expect(await restore(legacyTask())).toEqual({ matched: 0, opened: 0 });
  });
  it('an explicit vault_allowed identity task still restores its session once', async () => {
    expect(await restore(legacyTask({}, { browserSessionPolicy: 'vault_allowed' }))).toEqual({
      matched: 1,
      opened: 1,
    });
  });
});
