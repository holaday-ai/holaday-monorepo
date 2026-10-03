import { describe, expect, it } from 'vitest';
import {
  deferredMediaNotice,
  followUpParentHasBrowserContext,
  followUpParentReasonLabel,
  followUpTerminalGuardMessage,
  resolveBrowserFollowUpContinuation,
  resolveFollowUpExecutionMode,
  resolveWorkflowIdentities,
} from './task-followup-copy.js';

describe('task follow-up copy', () => {
  it('uses review-needed language for partial-success follow-up eligibility', () => {
    expect(followUpTerminalGuardMessage()).toBe(
      '只能追问已完成/需复核/失败/取消的任务，正在执行的任务请用回复',
    );
  });

  it('labels partial-success parent context as review-needed instead of partial-complete', () => {
    expect(followUpParentReasonLabel('failed')).toBe('失败原因');
    expect(followUpParentReasonLabel('partial_success')).toBe('需复核原因');
    expect(followUpParentReasonLabel('cancelled')).toBe('终止原因');
  });

  it('keeps a browser parent in the browser lane for same-page follow-up', () => {
    expect(
      resolveFollowUpExecutionMode({
        parentHasBrowserContext: true,
        typedWorkflowOverride: 'generate',
        expertRouteOverride: 'scrape',
        classifiedExecutionMode: 'generate',
      }),
    ).toBe('browser');
    expect(
      resolveFollowUpExecutionMode({
        parentHasBrowserContext: false,
        typedWorkflowOverride: null,
        expertRouteOverride: 'scrape',
        classifiedExecutionMode: 'generate',
      }),
    ).toBe('scrape');
  });

  it('lets explicit media controls override ambiguous prompt routing', () => {
    expect(
      resolveFollowUpExecutionMode({
        parentHasBrowserContext: false,
        typedWorkflowOverride: null,
        expertRouteOverride: null,
        classifiedExecutionMode: 'browser',
        explicitMediaMode: 'image',
      }),
    ).toBe('image');
    expect(
      resolveFollowUpExecutionMode({
        parentHasBrowserContext: true,
        typedWorkflowOverride: 'generate',
        expertRouteOverride: 'browser',
        classifiedExecutionMode: 'browser',
        explicitMediaMode: 'video_creation',
      }),
    ).toBe('video_creation');
  });

  it('recognizes legacy browser evidence without overriding explicit non-browser tasks', () => {
    expect(
      followUpParentHasBrowserContext({
        executionMode: null,
        finalUrl: 'https://example.com/result',
        intent: '整理最终页面',
      }),
    ).toBe(true);
    expect(
      followUpParentHasBrowserContext({
        executionMode: null,
        intent: '打开 https://example.com',
      }),
    ).toBe(true);
    expect(
      followUpParentHasBrowserContext({
        executionMode: 'scrape',
        finalUrl: 'https://example.com/source',
        intent: '总结来源',
      }),
    ).toBe(false);
  });

  it('never turns a missing retained browser into a blank same-page continuation', () => {
    expect(
      resolveBrowserFollowUpContinuation({
        hasParentTask: true,
        parentHasBrowserContext: true,
        adopted: true,
        restoreUrl: null,
      }),
    ).toBe('adopted');
    expect(
      resolveBrowserFollowUpContinuation({
        hasParentTask: true,
        parentHasBrowserContext: true,
        adopted: false,
        restoreUrl: 'https://example.com/current',
      }),
    ).toBe('restore');
    expect(
      resolveBrowserFollowUpContinuation({
        hasParentTask: true,
        parentHasBrowserContext: true,
        adopted: false,
        restoreUrl: null,
      }),
    ).toBe('unavailable');
    expect(
      resolveBrowserFollowUpContinuation({
        hasParentTask: false,
        parentHasBrowserContext: false,
        adopted: false,
        restoreUrl: null,
      }),
    ).toBe('fresh');
  });

  it('keeps workflow lineage for derived follow-ups without reusing the parent report schema', () => {
    expect(
      resolveWorkflowIdentities({
        reportWorkflowId: null,
        routingWorkflowId: 'ecom-daily',
        legacyWorkflowId: null,
      }),
    ).toEqual({
      contractWorkflowId: null,
      lineageWorkflowId: 'ecom-daily',
    });
  });

  it('uses the direct report workflow for both verification and response preservation', () => {
    expect(
      resolveWorkflowIdentities({
        reportWorkflowId: 'content-topic',
        routingWorkflowId: 'content-topic',
        legacyWorkflowId: null,
      }),
    ).toEqual({
      contractWorkflowId: 'content-topic',
      lineageWorkflowId: 'content-topic',
    });
  });

  describe('keyword-only media requests', () => {
    const base = {
      parentHasBrowserContext: false,
      typedWorkflowOverride: null,
      expertRouteOverride: null,
    } as const;

    it.each(['image', 'video_creation'] as const)(
      'answers a %s keyword match as text unless submitted from the media workbench',
      (classified) => {
        expect(resolveFollowUpExecutionMode({ ...base, classifiedExecutionMode: classified })).toBe(
          'generate',
        );
        expect(
          resolveFollowUpExecutionMode({
            ...base,
            classifiedExecutionMode: classified,
            explicitMediaMode: classified,
          }),
        ).toBe(classified);
      },
    );

    it('keeps explicit workflow routing overrides', () => {
      expect(
        resolveFollowUpExecutionMode({
          ...base,
          expertRouteOverride: 'image',
          classifiedExecutionMode: 'generate',
        }),
      ).toBe('image');
    });

    it('points to the media workbench, or says media is coming while it is closed', () => {
      expect(
        deferredMediaNotice({
          classifiedExecutionMode: 'image',
          executionMode: 'generate',
          mediaLaneAvailable: false,
        }),
      ).toContain('配图生成即将开放');
      expect(
        deferredMediaNotice({
          classifiedExecutionMode: 'image',
          executionMode: 'generate',
          mediaLaneAvailable: true,
        }),
      ).toContain('请到「图片」页面提交');
      expect(
        deferredMediaNotice({
          classifiedExecutionMode: 'generate',
          executionMode: 'generate',
          mediaLaneAvailable: false,
        }),
      ).toBeNull();
    });
  });
});
