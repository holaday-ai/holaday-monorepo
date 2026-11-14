import { describe, expect, it, vi } from 'vitest';
import { classifyRuntimeAction } from '../supercar/runtime-action-policy.js';
import { UNREADABLE_READONLY_MESSAGE, createDescriptionActionGate } from './unified-action-gate.js';
import { isReadOnlyIntent } from './unified-browser-loop.js';

/**
 * FIX-61 DEPLOY-61 P1-2: b-m01 stopped three times at 「无法读取要点击的元素，它可能是付款、下单、
 * 删除或发送等操作。确认继续执行吗？」. That is the action gate's fail-closed confirmation for a
 * click whose target cannot be read (no box / hit not read) — not the login-popup path FIX-61 #4
 * handled. A read-only task now does not park: the click is skipped and the assistant is told to
 * re-read, close what covers the page or take another route, else finish honestly.
 */
describe('FIX-61 DEPLOY-61 P1-2: an unreadable click target in a read-only task', () => {
  const click = { kind: 'click' as const, label: '搜索', pageUrl: 'https://www.amap.com/dir' };
  const gateFor = (readOnly: boolean, transactional: string | null = null) => {
    const park = vi.fn(async () => '确认执行');
    const gate = createDescriptionActionGate({
      describe: async () => ({
        descriptors: [click],
        unverified: '无法读取要点击的元素',
        transactional,
      }),
      onBeforeAction: classifyRuntimeAction,
      pageUrl: () => 'https://www.amap.com/dir',
      park,
      aborted: () => false,
      readOnly,
    });
    return { gate, park };
  };

  it('is skipped with guidance, never asked about', async () => {
    const { gate, park } = gateFor(true);
    expect(await gate({}, 'before')).toEqual({
      kind: 'skip',
      message: UNREADABLE_READONLY_MESSAGE,
    });
    expect(park).not.toHaveBeenCalled();
    expect(UNREADABLE_READONLY_MESSAGE).toMatch(/snapshot 重读页面/);
    expect(UNREADABLE_READONLY_MESSAGE).toMatch(/关闭按钮/);
    expect(UNREADABLE_READONLY_MESSAGE).toMatch(/不要登录/);
    expect(UNREADABLE_READONLY_MESSAGE).toMatch(/如实 finish/);
  });

  it('a task that may write still asks (fail closed)', async () => {
    const { gate, park } = gateFor(false);
    await gate({}, 'before');
    expect(park).toHaveBeenCalledWith(expect.stringContaining('确认继续执行吗'), 'browser_action');
  });

  it('a transactional context still asks, read-only or not', async () => {
    const { gate, park } = gateFor(true, '交易页面');
    await gate({}, 'before');
    expect(park).toHaveBeenCalledTimes(1);
  });

  it('b-m01 and the iPhone price question are read-only; buying is not', () => {
    expect(
      isReadOnlyIntent('请使用云端浏览器，高德地图查一下杭州东站到西湖断桥怎么走，大概多久'),
    ).toBe(true);
    expect(isReadOnlyIntent('iPhone 16 Pro Max 256GB 多少钱')).toBe(true);
    expect(isReadOnlyIntent('高德地图查一下杭州东站到西湖断桥怎么走，然后帮我叫车')).toBe(false);
    expect(isReadOnlyIntent('帮我买一台 iPhone 16 Pro Max')).toBe(false);
  });
});
