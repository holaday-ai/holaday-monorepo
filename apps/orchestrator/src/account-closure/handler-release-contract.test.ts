import { describe, expect, it } from 'vitest';
import { ACCOUNT_CLOSURE_HANDLER_BINDINGS } from './handler-registry.js';
import {
  ACCOUNT_CLOSURE_HANDLER_EXECUTION_EVIDENCE,
  ACCOUNT_CLOSURE_HANDLER_EXECUTION_TEST,
} from './handler-release-evidence.js';

describe('production account closure handler release contract', () => {
  it('binds each category to exact runtime identity, behavior evidence, and retention capability', () => {
    expect(ACCOUNT_CLOSURE_HANDLER_BINDINGS).toHaveLength(13);
    expect(ACCOUNT_CLOSURE_HANDLER_EXECUTION_EVIDENCE).toHaveLength(13);
    expect(ACCOUNT_CLOSURE_HANDLER_EXECUTION_TEST).toBe(
      'apps/orchestrator/src/account-closure/handler-release-contract.test.ts',
    );
    for (const evidence of ACCOUNT_CLOSURE_HANDLER_EXECUTION_EVIDENCE) {
      const binding = ACCOUNT_CLOSURE_HANDLER_BINDINGS.find(
        (candidate) => candidate.categoryId === evidence.categoryId,
      );
      expect(evidence.handler).toBe(binding?.handler);
      expect(evidence.handlerRef).toBe(binding?.handlerRef);
      expect(evidence.behaviorTestRef).toMatch(/\.integration\.test\.ts$/);
      expect(evidence.handler).toMatchObject({ categoryId: evidence.categoryId, version: 1 });
      expect(evidence.handler.retentionOutcomes.length).toBeGreaterThan(0);
    }
  });

  it('executes every exact production handler through the shared evidence manifest', async () => {
    const controller = new AbortController();
    const abortReason = new Error('governance execution evidence abort');
    controller.abort(abortReason);
    const context = {
      db: {},
      logger: {},
      storage: {},
      signal: controller.signal,
      request: {
        id: 1,
        externalId: 'acl_governance_evidence',
        userId: 1,
        userExternalId: 'usr_governance_evidence',
      },
      checkpoint: null,
      pageSize: 100,
    } as const;

    for (const evidence of ACCOUNT_CLOSURE_HANDLER_EXECUTION_EVIDENCE) {
      await expect(evidence.execute(context as never)).rejects.toBe(abortReason);
    }
  });
});
