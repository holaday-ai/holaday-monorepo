import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MessagesAdapter } from '../llm/messages-adapter.js';
import { CoreExecutionRegistry } from './core-execution-registry.js';
import type { CoreExecutionHandle } from './core-execution-registry.js';
import {
  deriveFinalStatus,
  disposeExecution,
  finalizeCoreAnswerForPersistence,
  verifyCoreAndFinalize,
} from './execution-pipeline.js';
import { reloadFeatureFlagsForTest, setFeatureFlagsForTest } from './feature-flags.js';
import { createTaskVerificationContext } from './task-verification-context.js';

const ANSWER = `See https://example.com/help/index ${'合成正文'.repeat(80)}`;
function begin(registry: CoreExecutionRegistry, revision = 1) {
  const handle = registry.begin({
    taskId: 'core_synthetic',
    expertMode: 'expert',
    verificationContext: createTaskVerificationContext({
      schemaVersion: 1,
      executionId: `core_exec_${revision}`,
      executionRevision: revision,
      initialRequest: 'find the help page',
      userTurns: [],
      phase: 'direct',
      workflow: null,
      referencePlan: null,
      materials: [],
    }),
  });
  registry.record(handle, {
    fact: 'visited https://example.com/help/index',
    sourceType: 'tool_result',
    sourceDetail: 'synthetic',
    confidence: 'observed',
  });
  return handle;
}

function adapter(): MessagesAdapter {
  const metadata = {
    provider: 'alibaba-model-studio' as const,
    model: 'qwen3.8-flash',
    region: 'cn' as const,
    deploymentScope: 'china_mainland' as const,
    endpointKind: 'public' as const,
    protocol: 'messages' as const,
  };
  return {
    metadata,
    create: vi.fn(async () => ({
      id: 'synthetic_reply',
      metadata,
      content: [{ type: 'text' as const, text: '{"status":"pass","issues":[]}' }],
      stopReason: 'end_turn' as const,
      usage: {
        inputTokens: 1,
        outputTokens: 1,
        cacheReadInputTokens: null,
        cacheCreationInputTokens: null,
        complete: true,
      },
    })),
  };
}

beforeEach(() =>
  setFeatureFlagsForTest({
    EVIDENCE_LEDGER: true,
    EXECUTION_CONTRACT: true,
    EXECUTION_VERIFIER: true,
  }),
);
afterEach(() => reloadFeatureFlagsForTest());

describe('core pipeline ownership', () => {
  it('really verifies the next run after old and legacy cleanup', async () => {
    const registry = new CoreExecutionRegistry();
    const old = begin(registry, 1);
    const handle = begin(registry, 2);
    registry.release(old);
    disposeExecution(handle.taskId);
    const semanticAdapter = adapter();
    const output = await verifyCoreAndFinalize({
      registry,
      handle,
      answerText: ANSWER,
      semanticAdapter,
    });
    expect(output.verification).toMatchObject({
      passed: true,
      semanticStatus: 'pass',
      executionId: 'core_exec_2',
      executionRevision: 2,
    });
    const request = vi.mocked(semanticAdapter.create).mock.calls[0]?.[0];
    expect(JSON.stringify(request)).toContain('core_exec_2');
    expect(JSON.stringify(request)).not.toContain('core_exec_1');
  });

  it.each(['missing', 'null', 'copied', 'old', 'released'] as const)(
    'does not fall back to a no-op pass for a %s handle',
    async (kind) => {
      const registry = new CoreExecutionRegistry();
      let handle = begin(registry);
      if (kind === 'missing') handle = undefined as unknown as CoreExecutionHandle;
      if (kind === 'null') handle = null as unknown as CoreExecutionHandle;
      if (kind === 'copied') handle = { ...handle };
      if (kind === 'old') begin(registry, 2);
      if (kind === 'released') registry.release(handle);
      const semanticAdapter = adapter();
      const output = await verifyCoreAndFinalize({
        registry,
        handle,
        answerText: ANSWER,
        semanticAdapter,
      });
      expect(deriveFinalStatus('completed', output.verification)).toBe('failed');
      expect(output.verification?.inputCoverage).toEqual({
        complete: false,
        codes: ['VERIFICATION_CONTEXT_INVALID'],
      });
      expect(output.finalText).toBe('');
      expect(semanticAdapter.create).not.toHaveBeenCalled();
    },
  );

  it.each(['EVIDENCE_LEDGER', 'EXECUTION_CONTRACT', 'EXECUTION_VERIFIER'] as const)(
    'fails closed when the required %s flag is off',
    async (flag) => {
      const registry = new CoreExecutionRegistry();
      const handle = begin(registry);
      setFeatureFlagsForTest({ [flag]: false });
      const output = await verifyCoreAndFinalize({
        registry,
        handle,
        answerText: ANSWER,
        semanticAdapter: adapter(),
      });
      expect(deriveFinalStatus('completed', output.verification)).toBe('failed');
      expect(output.finalText).toBe('');
    },
  );

  it('rejects a late semantic pass when the active execution changed while awaiting it', async () => {
    const registry = new CoreExecutionRegistry();
    const old = begin(registry);
    const semanticAdapter = adapter();
    const response = await semanticAdapter.create({ maxTokens: 1, messages: [] });
    let finish: (value: typeof response) => void = () => {
      throw new Error('test response not pending');
    };
    vi.mocked(semanticAdapter.create)
      .mockClear()
      .mockImplementation(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
    const pending = verifyCoreAndFinalize({
      registry,
      handle: old,
      answerText: ANSWER,
      semanticAdapter,
    });
    await vi.waitFor(() => expect(semanticAdapter.create).toHaveBeenCalledTimes(1));
    const next = begin(registry, 2);
    finish(response);
    const stale = await pending;
    expect(stale.finalText).toBe('');
    expect(deriveFinalStatus('completed', stale.verification)).toBe('failed');
    const current = await verifyCoreAndFinalize({
      registry,
      handle: next,
      answerText: ANSWER,
      semanticAdapter: adapter(),
    });
    expect(current.verification).toMatchObject({ passed: true, executionId: 'core_exec_2' });
  });

  it('requires the same execution identity at the final candidate check', async () => {
    const registry = new CoreExecutionRegistry();
    const semanticAdapter = adapter();
    const old = begin(registry);
    const prior = await verifyCoreAndFinalize({
      registry,
      handle: old,
      answerText: ANSWER,
      semanticAdapter,
    });
    const next = begin(registry, 2);
    const stale = await finalizeCoreAnswerForPersistence({
      registry,
      handle: next,
      answerText: ANSWER,
      semanticMetadata: semanticAdapter.metadata,
      priorVerification: prior.verification,
    });
    expect(deriveFinalStatus('completed', stale.verification)).toBe('failed');
    expect(stale.finalText).toBe('');
    const verified = await verifyCoreAndFinalize({
      registry,
      handle: next,
      answerText: ANSWER,
      semanticAdapter,
    });
    const final = await finalizeCoreAnswerForPersistence({
      registry,
      handle: next,
      answerText: ANSWER,
      semanticMetadata: semanticAdapter.metadata,
      priorVerification: verified.verification,
    });
    expect(final.verification).toMatchObject({
      passed: true,
      executionId: 'core_exec_2',
      executionRevision: 2,
    });
  });
});
