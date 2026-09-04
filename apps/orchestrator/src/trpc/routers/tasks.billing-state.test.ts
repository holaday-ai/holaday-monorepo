import type { TRPCError } from '@trpc/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TaskRepository } from '../../agent/task-repository.js';
import { VIDEO_CREATION_ALLOWLIST } from '../../agent/video/video-access.js';
import { env as appEnv } from '../../config/env.js';
import { FileService } from '../../files/file-service.js';
import { QuotaService } from '../../quota/quota-service.js';
import { __tasksInternals, tasksRouter } from './tasks.js';

type ClaimVideoConfirmWithQuota = (input: {
  isBypass: boolean;
  tryConsume: () => Promise<{ ok: true } | { ok: false; reason: 'daily_limit' | 'monthly_limit' }>;
  refund: () => Promise<void>;
  claim: () => Promise<boolean>;
}) => Promise<
  { ok: true; claimed: boolean } | { ok: false; reason: 'daily_limit' | 'monthly_limit' }
>;

const internals = __tasksInternals as typeof __tasksInternals & {
  assertVideoImageChoiceAllowed?: (input: {
    choice: 'video' | 'image';
    isClone: boolean;
    isIp: boolean;
  }) => void;
  buildVideoExecutionMetadata?: (input: {
    isPet: boolean;
    isIp: boolean;
    tab?: 'normal' | 'pet' | 'ip_person';
    visualMode: 'image' | 'video';
  }) => {
    executionMode: 'generate';
    lane: 'video_creation';
    visualMode: 'image' | 'video';
    videoType: 'normal' | 'pet' | 'ip_person';
  };
  claimVideoConfirmWithQuota?: ClaimVideoConfirmWithQuota;
  shouldConsumeTaskQuotaOnCreate?: (input: {
    isBypass: boolean;
    isFollowUp: boolean;
    willCreateVideoQuote: boolean;
  }) => boolean;
};

const originalVideoEnabled = appEnv.VIDEO_CREATION_ENABLED;
const originalVideoAllowlist = [...VIDEO_CREATION_ALLOWLIST];
const mutableVideoAllowlist = VIDEO_CREATION_ALLOWLIST as Set<string>;

function makeCreateContext() {
  const logger = {
    child: () => logger,
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  };
  const db = {
    select: (projection: Record<string, unknown>) => {
      if ('plan' in projection) {
        return {
          from: () => ({
            where: () => ({
              limit: async () => [
                {
                  id: 41,
                  plan: 'free',
                  selectedRoles: [],
                  selectedSkills: [],
                  qwenVoiceId: null,
                  baseVideoFileId: null,
                  videoSelfUseAuthorizedAt: null,
                },
              ],
            }),
          }),
        };
      }
      if ('count' in projection) {
        return {
          from: () => ({
            where: async () => [{ count: 0 }],
          }),
        };
      }
      throw new Error(`unexpected select projection: ${Object.keys(projection).join(',')}`);
    },
    transaction: async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        update: () => ({
          set: () => ({ where: async () => [{ affectedRows: 1 }] }),
        }),
        insert: () => ({ values: async () => undefined }),
      }),
  };
  return {
    db,
    logger,
    planner: {},
    visionCommander: undefined,
    playwrightExecutor: null,
    executionRouter: null,
    browserPool: null,
    taskQueue: null,
    firecrawl: null,
    paypalAdapter: null,
    downloadManager: null,
    req: {},
    res: {},
    userId: 'usr_billing_state_test',
  } as never;
}

function makeConfirmContext(metadata: Record<string, unknown>) {
  const logger = {
    child: () => logger,
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  };
  const db = {
    select: (projection: Record<string, unknown>) => {
      if ('plan' in projection) {
        return {
          from: () => ({
            where: () => ({
              limit: async () => [
                {
                  id: 41,
                  plan: 'free',
                  qwenVoiceId: null,
                  baseVideoFileId: null,
                  videoSelfUseAuthorizedAt: null,
                },
              ],
            }),
          }),
        };
      }
      if ('awaitingKind' in projection) {
        return {
          from: () => ({
            where: () => ({
              limit: async () => [
                {
                  id: 72,
                  status: 'awaiting_user',
                  awaitingKind: 'video_quote',
                  intent: '生成测试视频',
                  result: { metadata },
                },
              ],
            }),
          }),
        };
      }
      throw new Error(`unexpected select projection: ${Object.keys(projection).join(',')}`);
    },
    transaction: async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        update: () => ({
          set: () => ({ where: async () => [{ affectedRows: 1 }] }),
        }),
        insert: () => ({ values: async () => undefined }),
      }),
  };
  return {
    db,
    logger,
    planner: {},
    visionCommander: undefined,
    playwrightExecutor: null,
    executionRouter: null,
    browserPool: null,
    taskQueue: null,
    firecrawl: null,
    paypalAdapter: null,
    downloadManager: null,
    req: {},
    res: {},
    userId: 'usr_billing_state_test',
  } as never;
}

afterEach(() => {
  appEnv.VIDEO_CREATION_ENABLED = originalVideoEnabled;
  mutableVideoAllowlist.clear();
  for (const userId of originalVideoAllowlist) mutableVideoAllowlist.add(userId);
  vi.restoreAllMocks();
});

describe('tasks.create billing order', () => {
  it('rejects an unavailable ordinary attachment before consuming task quota', async () => {
    const consume = vi.spyOn(QuotaService.prototype, 'tryConsume').mockResolvedValue({ ok: true });
    vi.spyOn(QuotaService.prototype, 'getActiveTaskCount').mockResolvedValue(0);
    vi.spyOn(FileService.prototype, 'loadMany').mockResolvedValue([]);

    await expect(
      tasksRouter.createCaller(makeCreateContext()).create({
        intent: '总结这份附件',
        fileIds: ['fil_missing'],
      }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect(consume).not.toHaveBeenCalled();
  });

  it('validates a locked-subject attachment before consuming task quota', async () => {
    const consume = vi.spyOn(QuotaService.prototype, 'tryConsume').mockResolvedValue({ ok: true });
    vi.spyOn(QuotaService.prototype, 'getActiveTaskCount').mockResolvedValue(0);

    await expect(
      tasksRouter.createCaller(makeCreateContext()).create({
        intent: '生成一张锁定主角的海报',
        fileIds: ['fil_other'],
        imageOptions: {
          aspectRatio: '1:1',
          imageCount: 1,
          mode: 'lock_subject',
          subjectFileId: 'fil_subject',
        },
      }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect(consume).not.toHaveBeenCalled();
  });

  it('persists an explicit video task as migration-unavailable before quota', async () => {
    appEnv.VIDEO_CREATION_ENABLED = false;
    const consume = vi
      .spyOn(QuotaService.prototype, 'tryConsume')
      .mockRejectedValue(new Error('quota should not be reached'));
    vi.spyOn(QuotaService.prototype, 'getActiveTaskCount').mockResolvedValue(0);
    vi.spyOn(TaskRepository.prototype, 'insertTask').mockResolvedValue();
    vi.spyOn(TaskRepository.prototype, 'persistVisionOutcome').mockResolvedValue({
      persisted: true,
    });

    await expect(
      tasksRouter.createCaller(makeCreateContext()).create({
        intent: '生成一条产品介绍视频',
        videoOptions: { tab: 'normal' },
      }),
    ).resolves.toMatchObject({
      status: 'failed',
      executionMode: 'video_creation',
    });
    expect(consume).not.toHaveBeenCalled();
  });

  it('persists a classified video task as migration-unavailable before quota', async () => {
    appEnv.VIDEO_CREATION_ENABLED = false;
    const consume = vi
      .spyOn(QuotaService.prototype, 'tryConsume')
      .mockRejectedValue(new Error('quota should not be reached'));
    vi.spyOn(QuotaService.prototype, 'getActiveTaskCount').mockResolvedValue(0);
    vi.spyOn(TaskRepository.prototype, 'insertTask').mockResolvedValue();
    vi.spyOn(TaskRepository.prototype, 'persistVisionOutcome').mockResolvedValue({
      persisted: true,
    });

    await expect(
      tasksRouter.createCaller(makeCreateContext()).create({
        intent: '生成一条产品介绍视频',
      }),
    ).resolves.toMatchObject({
      status: 'failed',
      executionMode: 'video_creation',
    });
    expect(consume).not.toHaveBeenCalled();
  });

  it('keeps a video task migration-unavailable outside the legacy allowlist', async () => {
    appEnv.VIDEO_CREATION_ENABLED = true;
    mutableVideoAllowlist.clear();
    mutableVideoAllowlist.add('usr_someone_else');
    const consume = vi
      .spyOn(QuotaService.prototype, 'tryConsume')
      .mockRejectedValue(new Error('quota should not be reached'));
    vi.spyOn(QuotaService.prototype, 'getActiveTaskCount').mockResolvedValue(0);
    vi.spyOn(TaskRepository.prototype, 'insertTask').mockResolvedValue();
    vi.spyOn(TaskRepository.prototype, 'persistVisionOutcome').mockResolvedValue({
      persisted: true,
    });

    await expect(
      tasksRouter.createCaller(makeCreateContext()).create({
        intent: '生成一条产品介绍视频',
        videoOptions: { tab: 'normal' },
      }),
    ).resolves.toMatchObject({
      status: 'failed',
      executionMode: 'video_creation',
    });
    expect(consume).not.toHaveBeenCalled();
  });
});

describe('video quote billing and execution state', () => {
  it('defers task quota for a video quote but not for an ordinary task', () => {
    expect(typeof internals.shouldConsumeTaskQuotaOnCreate).toBe('function');
    if (!internals.shouldConsumeTaskQuotaOnCreate) return;

    expect(
      internals.shouldConsumeTaskQuotaOnCreate({
        isBypass: false,
        isFollowUp: false,
        willCreateVideoQuote: true,
      }),
    ).toBe(false);
    expect(
      internals.shouldConsumeTaskQuotaOnCreate({
        isBypass: false,
        isFollowUp: false,
        willCreateVideoQuote: false,
      }),
    ).toBe(true);
  });

  it('does not claim a quote when confirmation quota is exhausted', async () => {
    expect(typeof internals.claimVideoConfirmWithQuota).toBe('function');
    if (!internals.claimVideoConfirmWithQuota) return;
    const claim = vi.fn(async () => true);
    const refund = vi.fn(async () => {});

    await expect(
      internals.claimVideoConfirmWithQuota({
        isBypass: false,
        tryConsume: async () => ({ ok: false, reason: 'daily_limit' }),
        refund,
        claim,
      }),
    ).resolves.toEqual({ ok: false, reason: 'daily_limit' });
    expect(claim).not.toHaveBeenCalled();
    expect(refund).not.toHaveBeenCalled();
  });

  it('consumes one task before the successful atomic confirmation claim', async () => {
    expect(typeof internals.claimVideoConfirmWithQuota).toBe('function');
    if (!internals.claimVideoConfirmWithQuota) return;
    const calls: string[] = [];
    const refund = vi.fn(async () => {});

    await expect(
      internals.claimVideoConfirmWithQuota({
        isBypass: false,
        tryConsume: async () => {
          calls.push('consume');
          return { ok: true };
        },
        refund,
        claim: async () => {
          calls.push('claim');
          return true;
        },
      }),
    ).resolves.toEqual({ ok: true, claimed: true });
    expect(calls).toEqual(['consume', 'claim']);
    expect(refund).not.toHaveBeenCalled();
  });

  it('refunds the losing duplicate confirmation so one quote consumes one task', async () => {
    expect(typeof internals.claimVideoConfirmWithQuota).toBe('function');
    if (!internals.claimVideoConfirmWithQuota) return;
    const refund = vi.fn(async () => {});

    await expect(
      internals.claimVideoConfirmWithQuota({
        isBypass: false,
        tryConsume: async () => ({ ok: true }),
        refund,
        claim: async () => false,
      }),
    ).resolves.toEqual({ ok: true, claimed: false });
    expect(refund).toHaveBeenCalledOnce();
  });

  it('refunds quota when the atomic claim itself fails', async () => {
    expect(typeof internals.claimVideoConfirmWithQuota).toBe('function');
    if (!internals.claimVideoConfirmWithQuota) return;
    const refund = vi.fn(async () => {});

    await expect(
      internals.claimVideoConfirmWithQuota({
        isBypass: false,
        tryConsume: async () => ({ ok: true }),
        refund,
        claim: async () => {
          throw new Error('claim failed');
        },
      }),
    ).rejects.toThrow('claim failed');
    expect(refund).toHaveBeenCalledOnce();
  });

  it.each([
    { isClone: true, isIp: false },
    { isClone: false, isIp: true },
  ])('rejects confirm_image for clone/IP video quotes: %o', ({ isClone, isIp }) => {
    expect(typeof internals.assertVideoImageChoiceAllowed).toBe('function');
    if (!internals.assertVideoImageChoiceAllowed) return;

    expect(() =>
      internals.assertVideoImageChoiceAllowed({
        choice: 'image',
        isClone,
        isIp,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<TRPCError>>({
        code: 'BAD_REQUEST',
      }),
    );
  });

  it.each([
    {
      label: 'clone',
      metadata: {
        lane: 'video_creation_confirm',
        petImageFileId: 'fil_subject',
        referenceVideoFileId: 'fil_reference',
        videoOptions: { tab: 'pet' },
      },
    },
    {
      label: 'IP',
      metadata: {
        lane: 'video_creation_confirm',
        ipCopyText: 'IP 口播文案',
        videoOptions: { tab: 'ip_person' },
      },
    },
  ])(
    'settles a legacy $label quote as migration-unavailable before quota',
    async ({ metadata }) => {
      const consume = vi
        .spyOn(QuotaService.prototype, 'tryConsume')
        .mockRejectedValue(new Error('quota should not be reached'));

      await expect(
        tasksRouter.createCaller(makeConfirmContext(metadata)).confirmVideo({
          taskId: 'tsk_video_quote',
          choice: 'confirm_image',
        }),
      ).resolves.toMatchObject({
        status: 'failed',
      });
      expect(consume).not.toHaveBeenCalled();
    },
  );

  it('builds refresh-safe videoType metadata before execution finishes', () => {
    expect(typeof internals.buildVideoExecutionMetadata).toBe('function');
    if (!internals.buildVideoExecutionMetadata) return;

    expect(
      internals.buildVideoExecutionMetadata({
        isPet: true,
        isIp: false,
        tab: 'pet',
        visualMode: 'video',
      }),
    ).toEqual({
      executionMode: 'generate',
      lane: 'video_creation',
      visualMode: 'video',
      videoType: 'pet',
    });
  });
});
