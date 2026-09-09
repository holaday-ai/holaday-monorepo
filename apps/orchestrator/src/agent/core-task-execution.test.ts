import { pino } from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CoreExecutionRegistry } from '../execution/core-execution-registry.js';
import { reloadFeatureFlagsForTest, setFeatureFlagsForTest } from '../execution/feature-flags.js';
import type { MessagesAdapter, NeutralMessagesRequest } from '../llm/messages-adapter.js';
import type { NeutralResponsesRequest, ResponsesAdapter } from '../llm/responses-adapter.js';
import type { CoreAdmission, CoreTaskHead } from './core-task-admission.js';
import {
  type CoreExecutionEvent,
  type CoreExecutionInput,
  startCoreTaskExecution,
} from './core-task-execution.js';
import type { CoreSettlement } from './core-task-settlement.js';
import { matchExpertWorkflow } from './supercar/expert-workflows.js';

const ANSWER = `合成流程说明。${'整理输入并逐项核对结果，记录尚未确认的事项。'.repeat(25)}`;
const metadata = {
  provider: 'alibaba-model-studio',
  region: 'cn',
  deploymentScope: 'china_mainland',
  endpointKind: 'public',
} as const;
const logger = pino({ level: 'silent' });

function fixture() {
  let head: CoreTaskHead = {
    status: 'awaiting_user',
    executionId: 'synthetic-old',
    executionRevision: 2,
    recordVersion: 4,
  };
  let receipt: CoreSettlement | null = null;
  const admissions: CoreAdmission[] = [];
  const writes: CoreSettlement[] = [];
  const events: CoreExecutionEvent[] = [];
  const generation: NeutralResponsesRequest[] = [];
  const semantic: NeutralMessagesRequest[] = [];
  const repo: CoreExecutionInput['repo'] = {
    async admit(op) {
      admissions.push(op);
      if (
        head.executionRevision !== op.before.executionRevision ||
        head.status !== op.before.status
      )
        return { persisted: false };
      head = {
        status: 'executing',
        executionId: op.executionId,
        executionRevision: op.executionRevision,
        recordVersion: op.recordVersion,
      };
      return { persisted: true };
    },
    async readHead() {
      return head;
    },
    async settle(op) {
      writes.push(op);
      if (
        head.executionId !== op.executionId ||
        head.recordVersion !== op.expectedRecordVersion ||
        head.status !== 'executing'
      )
        return { persisted: false };
      receipt = op;
      head = {
        status: op.status,
        executionId: op.executionId,
        executionRevision: op.executionRevision,
        recordVersion: op.recordVersion,
      };
      return { persisted: true };
    },
    async readSettlement() {
      return { ...head, commitId: receipt?.commitId ?? null };
    },
  };
  const responses: ResponsesAdapter = {
    metadata: { ...metadata, protocol: 'responses', model: 'qwen3.8-plus' },
    async stream(request) {
      generation.push(request);
      return {
        id: 'synthetic_response',
        metadata: this.metadata,
        text: ANSWER,
        status: 'completed',
        sources: [],
        usage: { inputTokens: 10, outputTokens: 20 },
      };
    },
  };
  const messages: MessagesAdapter = {
    metadata: { ...metadata, protocol: 'messages', model: 'qwen3.8-flash' },
    async create(request) {
      semantic.push(request);
      return {
        id: 'synthetic_review',
        metadata: this.metadata,
        content: [{ type: 'text', text: '{"status":"pass","issues":[]}' }],
        stopReason: 'end_turn',
        usage: {
          inputTokens: 10,
          outputTokens: 10,
          cacheReadInputTokens: null,
          cacheCreationInputTokens: null,
          complete: true,
        },
      };
    },
  };
  let clock = 0;
  const input: CoreExecutionInput = {
    scope: { taskId: 'tsk_synthetic', userId: 7 },
    before: { ...head },
    requirements: {
      initialRequest: '解释合成流程资料，整理成清晰的交接说明。',
      userTurns: ['不要添加未经确认的结论。', '确认'],
      phase: 'approved_execution',
      workflow: null,
      referencePlan: '先整理材料，再逐项说明。',
      fileIds: ['fil_synthetic'],
    },
    blocks: [{ type: 'text', text: '独有合成材料：环节甲核对输入，环节乙复核输出。' }],
    actorExternalId: 'usr_synthetic',
    responsesAdapter: responses,
    semanticAdapter: messages,
    logger,
    expertMode: 'expert',
    registry: new CoreExecutionRegistry(),
    repo,
    publish: (event) => {
      events.push(event);
    },
    recoveryClock: {
      now: () => clock,
      wait: async (ms) => {
        clock += ms;
      },
    },
  };
  return {
    input,
    repo,
    responses,
    messages,
    events,
    admissions,
    writes,
    generation,
    semantic,
    getHead: () => head,
    replaceHead: (next: CoreTaskHead) => {
      head = next;
    },
  };
}
beforeEach(() =>
  setFeatureFlagsForTest({
    EVIDENCE_LEDGER: true,
    EXECUTION_CONTRACT: true,
    EXECUTION_VERIFIER: true,
    EXPERT_WORKFLOW: true,
  }),
);
afterEach(() => {
  reloadFeatureFlagsForTest();
  vi.restoreAllMocks();
});

describe('transactional core execution with real runner and review', () => {
  it.each(['normal', 'auto', 'expert'] as const)(
    'freezes full legacy rules and enforces semantic review in %s mode',
    async (expertMode) => {
      const f = fixture();
      const matched = matchExpertWorkflow('分析昨天抖音直播上传数据', { hasAttachments: true });
      if (!matched || matched.routeOverride !== 'generate')
        throw new Error('invalid synthetic workflow');
      const legacyWorkflow = {
        id: matched.id,
        promptPreamble: matched.promptPreamble,
        missingInputs: [...matched.missingInputs],
        routeOverride: matched.routeOverride,
      };
      f.input.requirements = {
        ...f.input.requirements,
        legacyWorkflow,
        resume: {
          schemaVersion: 1,
          expertMode,
          skillId: null,
          legacyWorkflowId: matched.id,
          intakeBindings: [],
        },
      };
      const admit = f.repo.admit;
      f.repo.admit = async (op) => {
        legacyWorkflow.promptPreamble = '迟到污染';
        return admit(op);
      };
      const started = await startCoreTaskExecution(f.input);
      expect(await started.completion).toBe('committed');
      expect(f.generation).toHaveLength(1);
      expect(f.semantic).toHaveLength(1);
      expect(f.generation[0]?.instructions).toContain(JSON.stringify(matched.promptPreamble));
      const reviewPayload = JSON.parse(String(f.semantic[0]?.messages[0]?.content));
      expect(reviewPayload.context.legacyWorkflow.promptPreamble).toBe(matched.promptPreamble);
      expect(reviewPayload.context.initialRequest).toBe('解释合成流程资料，整理成清晰的交接说明。');
      expect(reviewPayload.context.userTurns).toEqual(['不要添加未经确认的结论。', '确认']);
      expect(JSON.stringify(f.generation)).not.toContain('迟到污染');
      expect(f.admissions[0]?.requirements.legacyWorkflow?.promptPreamble).toBe(
        matched.promptPreamble,
      );
    },
  );
  it('rejects historical legacy lineage without its rules before admission or generation', async () => {
    const f = fixture();
    f.input.requirements = {
      ...f.input.requirements,
      resume: {
        schemaVersion: 1,
        expertMode: 'expert',
        skillId: null,
        legacyWorkflowId: 'douyin-livestream-review',
        intakeBindings: [],
      },
    };
    await expect(startCoreTaskExecution(f.input)).rejects.toThrow(
      'CORE_LEGACY_WORKFLOW_CONTEXT_REQUIRED',
    );
    expect(f.admissions).toHaveLength(0);
    expect(f.generation).toHaveLength(0);
    expect(f.semantic).toHaveLength(0);
  });
  it.each([
    {
      missingInputs: ['dataSource'] as const,
      routeOverride: 'generate' as const,
      status: 'awaiting_user',
      semanticCalls: 1,
    },
    {
      missingInputs: [] as const,
      routeOverride: 'browser' as const,
      status: 'failed',
      semanticCalls: 0,
    },
  ])(
    'settles legacy $routeOverride guard as $status rather than a completed answer',
    async (guard) => {
      const f = fixture();
      f.input.blocks = [];
      f.input.requirements = {
        ...f.input.requirements,
        fileIds: [],
        legacyWorkflow: {
          id: 'douyin-livestream-review',
          promptPreamble: '合成复盘规范，缺少来源时先询问来源。',
          missingInputs: guard.missingInputs,
          routeOverride: guard.routeOverride,
        },
        resume: {
          schemaVersion: 1,
          expertMode: 'auto',
          skillId: null,
          legacyWorkflowId: 'douyin-livestream-review',
          intakeBindings: [],
        },
      };
      const started = await startCoreTaskExecution(f.input);
      expect(await started.completion).toBe('committed');
      expect(f.writes).toHaveLength(1);
      expect(f.writes[0]?.status).toBe(guard.status);
      expect(f.generation).toHaveLength(0);
      expect(f.semantic).toHaveLength(guard.semanticCalls);
      if (guard.semanticCalls) {
        const payload = JSON.parse(String(f.semantic[0]?.messages[0]?.content));
        expect(payload.deliveryStage).toBe('clarification');
        expect(payload.context.legacyWorkflow.missingInputs).toEqual(['dataSource']);
      }
    },
  );
  it('rechecks the advisory deadline after the callback promise resolves', async () => {
    const f = fixture();
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    f.input.beforeGeneration = () =>
      new Promise((resolve) => {
        resolve('ready');
        queueMicrotask(() => {
          now = 15_001;
        });
      });
    const started = await startCoreTaskExecution(f.input);
    expect(await started.completion).toBe('unconfirmed');
    expect(f.generation).toHaveLength(0);
    expect(f.writes).toHaveLength(0);
  });
  it('delivers the complete same-round request and materials to both channels then atomically settles', async () => {
    const f = fixture();
    const started = await startCoreTaskExecution(f.input);
    expect(started.ack).toMatchObject({
      taskId: 'tsk_synthetic',
      executionRevision: 3,
      state: 'resumed',
    });
    expect(await started.completion).toBe('committed');
    expect(f.generation).toHaveLength(1);
    expect(f.semantic).toHaveLength(1);
    for (const wire of [JSON.stringify(f.generation), JSON.stringify(f.semantic)]) {
      expect(wire).toContain('独有合成材料');
      expect(wire).toContain('不要添加未经确认的结论');
      expect(wire).toContain('先整理材料，再逐项说明');
    }
    expect(f.writes).toHaveLength(1);
    expect(f.admissions[0]?.requirements.resume).toMatchObject({
      schemaVersion: 1,
      expertMode: 'expert',
      skillId: null,
      legacyWorkflowId: null,
      intakeBindings: [],
    });
    expect(f.writes[0]).toMatchObject({
      status: 'completed',
      executionId: started.ack.executionId,
      executionRevision: 3,
      expectedRecordVersion: 5,
      recordVersion: 6,
      result: { summary: ANSWER },
      verificationPassed: true,
    });
    expect(f.events.filter((e) => e.type === 'settled')).toHaveLength(1);
    for (const event of f.events)
      expect(event).toMatchObject({ executionId: started.ack.executionId, executionRevision: 3 });
  });

  it('rejects the full input budget before database admission or either model', async () => {
    const f = fixture();
    f.input.blocks = [{ type: 'text', text: '过'.repeat(24000) }];
    await expect(startCoreTaskExecution(f.input)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(f.admissions).toHaveLength(0);
    expect(f.generation).toHaveLength(0);
  });

  it('does not redispatch when a lost admission response is reconciled as committed', async () => {
    const f = fixture();
    const admit = f.repo.admit;
    f.repo.admit = async (op) => {
      await admit(op);
      throw new Error('PRIVATE_DRIVER_ERROR');
    };
    const result = await startCoreTaskExecution(f.input);
    expect(result.ack.state).toBe('acceptedUnconfirmed');
    expect(await result.completion).toBe('notDispatched');
    expect(f.generation).toHaveLength(0);
    expect(f.semantic).toHaveLength(0);
    expect(f.writes).toHaveLength(0);
  });

  it('admits only one caller from the same saved round', async () => {
    const f = fixture();
    const a = await startCoreTaskExecution(f.input);
    const b = await startCoreTaskExecution(f.input);
    await Promise.all([a.completion, b.completion]);
    // Equal revision with a different ID is conservatively unknown in C1;
    // the important contract is no second scheduling permit.
    expect(b.ack.state).toBe('acceptedUnconfirmed');
    expect(await b.completion).toBe('notDispatched');
    expect(f.generation).toHaveLength(1);
    expect(f.writes).toHaveLength(1);
  });

  it.each(['draft', 'revise'] as const)(
    'persists a %s as an awaiting plan, not completed delivery',
    async (phase) => {
      const f = fixture();
      f.input.requirements = { ...f.input.requirements, phase };
      const result = await startCoreTaskExecution(f.input);
      expect(await result.completion).toBe('committed');
      expect(f.writes[0]?.status).toBe('awaiting_user');
      expect(f.writes[0]?.result.planText).toContain(ANSWER);
      expect(f.writes[0]?.awaitingQuestion).toContain('确认');
      expect(f.generation).toHaveLength(1);
    },
  );

  it('preserves a normal clarification without promoting it to a reference plan', async () => {
    const f = fixture();
    const stream = f.responses.stream.bind(f.responses);
    f.responses.stream = async (request) => ({
      ...(await stream(request)),
      text: '[AWAITING_USER_INPUT]请提供预期的交付对象。',
    });
    const result = await startCoreTaskExecution(f.input);
    expect(await result.completion).toBe('committed');
    expect(f.writes[0]?.status).toBe('awaiting_user');
    expect(f.writes[0]?.result.planText).toBeUndefined();
  });

  it('converts a generation transport error into a reviewed, fixed failure without storing the raw error', async () => {
    const f = fixture();
    f.responses.stream = async () => {
      throw new Error('PRIVATE_TRANSPORT_PAYLOAD');
    };
    const result = await startCoreTaskExecution(f.input);
    expect(await result.completion).toBe('committed');
    expect(f.writes[0]?.status).toBe('failed');
    expect(f.writes[0]?.result.summary).toBeUndefined();
    expect(f.writes[0]?.verification.generation.completeness).toBe('partial');
    expect(JSON.stringify([f.events, f.writes])).not.toContain('PRIVATE_TRANSPORT_PAYLOAD');
  });

  it('reconciles a lost terminal response without repeating generation or changing the settlement operation', async () => {
    const f = fixture();
    const settle = f.repo.settle;
    f.repo.settle = async (op) => {
      await settle(op);
      throw new Error('PRIVATE_DRIVER_ERROR');
    };
    const result = await startCoreTaskExecution(f.input);
    expect(await result.completion).toBe('committed');
    expect(f.writes).toHaveLength(1);
    expect(f.generation).toHaveLength(1);
    expect(f.events.filter((e) => e.type === 'settled')).toHaveLength(1);
  });

  it('never emits saved delivery when terminal persistence stays unavailable', async () => {
    const f = fixture();
    const attempts: CoreSettlement[] = [];
    f.repo.settle = async (op) => {
      attempts.push(op);
      throw new Error('PRIVATE_DB');
    };
    f.repo.readSettlement = async () => {
      throw new Error('PRIVATE_DB');
    };
    const result = await startCoreTaskExecution(f.input);
    expect(await result.completion).toBe('unconfirmed');
    expect(f.events.filter((e) => e.type === 'settled')).toHaveLength(0);
    expect(f.events.at(-1)?.type).toBe('unconfirmed');
    expect(f.generation).toHaveLength(1);
    expect(new Set(attempts).size).toBe(1);
  });

  it('does not let notification or optional follow-up failures corrupt a committed task', async () => {
    const f = fixture();
    f.input.publish = () => {
      throw new Error('PRIVATE_PUBLISH');
    };
    const followups: CoreSettlement[] = [];
    f.input.afterSettlement = async (op) => {
      followups.push(op);
      throw new Error('PRIVATE_SUGGESTIONS');
    };
    const result = await startCoreTaskExecution(f.input);
    expect(await result.completion).toBe('committed');
    await Promise.resolve();
    expect(f.writes).toHaveLength(1);
    expect(followups).toHaveLength(1);
  });

  it('keeps a complete frozen materials snapshot while admission is pending', async () => {
    const f = fixture();
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const admit = f.repo.admit;
    f.repo.admit = async (op) => {
      await gate;
      return admit(op);
    };
    const pending = startCoreTaskExecution(f.input);
    f.input.blocks = [{ type: 'text', text: 'MUTATED_AFTER_START' }];
    f.input.requirements = { ...f.input.requirements, initialRequest: 'MUTATED_REQUEST' };
    release();
    const result = await pending;
    expect(await result.completion).toBe('committed');
    expect(JSON.stringify(f.generation)).toContain('独有合成材料');
    expect(JSON.stringify(f.semantic)).not.toContain('MUTATED_');
    expect(f.admissions[0]?.requirements.initialRequest).toBe(
      '解释合成流程资料，整理成清晰的交接说明。',
    );
  });

  it('uses frozen accepted routing metadata rather than mutable caller options after admission', async () => {
    const f = fixture();
    const resume = {
      schemaVersion: 1 as const,
      expertMode: 'expert' as 'expert' | 'normal',
      skillId: null,
      legacyWorkflowId: null,
      intakeBindings: [],
    };
    f.input.requirements = { ...f.input.requirements, resume };
    const admit = f.repo.admit;
    f.repo.admit = async (op) => {
      resume.expertMode = 'normal';
      return admit(op);
    };
    const started = await startCoreTaskExecution(f.input);
    expect(await started.completion).toBe('committed');
    expect(f.admissions[0]?.requirements.resume?.expertMode).toBe('expert');
    expect(f.semantic).toHaveLength(1);
  });

  it('drops an old runner result and late deltas without releasing the replacement handle', async () => {
    const f = fixture();
    const stream = f.responses.stream.bind(f.responses);
    let finish = () => {};
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    let lateDelta: ((delta: string) => void) | undefined;
    f.responses.stream = async (request, options) => {
      lateDelta = options?.onTextDelta;
      await gate;
      return stream(request);
    };
    const result = await startCoreTaskExecution(f.input);
    const next = f.input.registry?.begin({
      taskId: 'tsk_synthetic',
      verificationContext: {
        schemaVersion: 1,
        executionId: 'synthetic-new-owner',
        executionRevision: 4,
        initialRequest: '新一轮合成要求',
        userTurns: [],
        phase: 'direct',
        workflow: null,
        referencePlan: null,
        materials: [],
      },
    });
    finish();
    expect(await result.completion).toBe('stale');
    lateDelta?.('OLD_LATE_DELTA');
    expect(f.events).toHaveLength(0);
    expect(f.writes).toHaveLength(0);
    expect(next && f.input.registry?.read(next)).not.toBeNull();
  });

  it('does not publish or run follow-ups after the database moves to a newer execution', async () => {
    const f = fixture();
    const stream = f.responses.stream.bind(f.responses);
    f.responses.stream = async (request) => {
      f.replaceHead({
        status: 'executing',
        executionId: 'synthetic-new-owner',
        executionRevision: 4,
        recordVersion: 8,
      });
      return stream(request);
    };
    const followup = vi.fn(async () => {});
    f.input.afterSettlement = followup;
    const result = await startCoreTaskExecution(f.input);
    expect(await result.completion).toBe('stale');
    expect(f.events.some((e) => e.type === 'settled')).toBe(false);
    expect(followup).not.toHaveBeenCalled();
  });

  it('releases a completed handle so a one-slot registry can accept a different task', async () => {
    const f = fixture();
    f.input.registry = new CoreExecutionRegistry(1);
    const result = await startCoreTaskExecution(f.input);
    expect(await result.completion).toBe('committed');
    expect(() =>
      f.input.registry?.begin({
        taskId: 'tsk_other',
        verificationContext: {
          schemaVersion: 1,
          executionId: 'synthetic-other',
          executionRevision: 1,
          initialRequest: '另一个合成任务',
          userTurns: [],
          phase: 'direct',
          workflow: null,
          referencePlan: null,
          materials: [],
        },
      }),
    ).not.toThrow();
  });

  it('does not fabricate a terminal receipt or dispatch after registry capacity is exhausted', async () => {
    const f = fixture();
    f.input.registry = new CoreExecutionRegistry(1);
    const existing = f.input.registry.begin({
      taskId: 'tsk_other',
      verificationContext: {
        schemaVersion: 1,
        executionId: 'synthetic-other',
        executionRevision: 1,
        initialRequest: '另一个合成任务',
        userTurns: [],
        phase: 'direct',
        workflow: null,
        referencePlan: null,
        materials: [],
      },
    });
    const result = await startCoreTaskExecution(f.input);
    expect(result.ack.state).toBe('acceptedUnconfirmed');
    expect(await result.completion).toBe('unconfirmed');
    expect(f.generation).toHaveLength(0);
    expect(f.writes).toHaveLength(0);
    expect(f.input.registry.read(existing)).not.toBeNull();
  });

  it('never upgrades a continuation-limited draft to completed even when semantic review passes', async () => {
    const f = fixture();
    const stream = f.responses.stream.bind(f.responses);
    f.responses.stream = async (request) => ({
      ...(await stream(request)),
      status: 'incomplete',
      incompleteReason: 'max_output_tokens',
    });
    const result = await startCoreTaskExecution(f.input);
    expect(await result.completion).toBe('committed');
    expect(f.writes[0]?.status).toBe('partial_success');
    expect(f.writes[0]?.verification.generation).toEqual({
      completeness: 'partial',
      stopReason: 'continuation_limit',
    });
  });

  it('keeps missing regional semantic verification visible instead of certifying full delivery', async () => {
    const f = fixture();
    f.input.semanticAdapter = undefined;
    const result = await startCoreTaskExecution(f.input);
    expect(await result.completion).toBe('committed');
    expect(f.writes[0]?.verification.semanticStatus).toBe('unavailable');
    expect(f.writes[0]?.verificationPassed).toBe(false);
  });

  it('absorbs asynchronous notification rejection instead of leaking an unhandled error', async () => {
    const f = fixture();
    f.input.publish = async () => {
      throw new Error('SYNTHETIC_ASYNC_NOTIFICATION_FAILURE');
    };
    const result = await startCoreTaskExecution(f.input);
    expect(await result.completion).toBe('committed');
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(f.writes).toHaveLength(1);
  });

  it.each([
    { phase: 'approved_execution' as const, text: '合成说明。'.repeat(7000) },
    { phase: 'draft' as const, text: '合成说明。'.repeat(4500) },
  ])(
    'saves a controlled failure for an oversized $phase payload without retaining the rejected body',
    async ({ phase, text }) => {
      const f = fixture();
      f.input.requirements = { ...f.input.requirements, phase };
      const stream = f.responses.stream.bind(f.responses);
      f.responses.stream = async (request) => ({ ...(await stream(request)), text });
      const result = await startCoreTaskExecution(f.input);
      expect(await result.completion).toBe('committed');
      expect(f.writes[0]?.status).toBe('failed');
      expect(f.writes[0]?.verification.issueCodes).toContain('VERIFICATION_INPUT_LIMIT');
      expect(f.writes[0]?.result.summary).toBeUndefined();
      expect(f.writes[0]?.result.planText).toBeUndefined();
      expect(f.writes[0]?.awaitingQuestion).toBeNull();
      expect(f.events.some((event) => event.type === 'unconfirmed')).toBe(false);
      expect(f.generation).toHaveLength(1);
    },
    30000,
  );

  it('does not start optional follow-ups when a newer local owner appears before settlement acknowledgment', async () => {
    const f = fixture();
    const settle = f.repo.settle;
    const followup = vi.fn(async () => {});
    f.input.afterSettlement = followup;
    f.repo.settle = async (op) => {
      const result = await settle(op);
      f.input.registry?.begin({
        taskId: 'tsk_synthetic',
        verificationContext: {
          schemaVersion: 1,
          executionId: 'synthetic-next',
          executionRevision: 4,
          initialRequest: '新一轮合成要求',
          userTurns: [],
          phase: 'direct',
          workflow: null,
          referencePlan: null,
          materials: [],
        },
      });
      return result;
    };
    const result = await startCoreTaskExecution(f.input);
    expect(await result.completion).toBe('committed');
    await Promise.resolve();
    expect(f.events.some((event) => event.type === 'settled')).toBe(false);
    expect(followup).not.toHaveBeenCalled();
  });

  it('preserves the existing combined plan/question budget without silently shortening the plan', async () => {
    const f = fixture();
    const text = '合成说明。'.repeat(3500);
    f.input.requirements = { ...f.input.requirements, phase: 'draft' };
    const stream = f.responses.stream.bind(f.responses);
    f.responses.stream = async (request) => ({ ...(await stream(request)), text });
    const result = await startCoreTaskExecution(f.input);
    expect(await result.completion).toBe('committed');
    expect(f.writes[0]?.status).toBe('failed');
    expect(f.writes[0]?.verification.issueCodes).toContain('VERIFICATION_INPUT_LIMIT');
    expect(f.writes[0]?.result.planText).toBeUndefined();
    expect(f.writes[0]?.awaitingQuestion).toBeNull();
  });
});
