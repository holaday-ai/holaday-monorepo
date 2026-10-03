import { describe, expect, it } from 'vitest';
import { REDACTED_INPUT_VALUE } from '../action-capture-redaction.js';
import type { BrowserSnapshot } from '../replay/browser-tools.js';
import { PLAYBOOK_BROWSER_TOOL_NAMES } from '../replay/browser-tools.js';
import type { CreateActionCaptureInput } from '../task-action-capture-repository.js';
import {
  BrowserActionCaptureRecorder,
  describeToolCall,
  siteDomainOf,
} from './capture-recorder.js';

const snapshot: BrowserSnapshot = {
  url: 'https://www.shop.example/login',
  title: 'shop',
  elements: [
    { ref: 'e1', role: 'searchbox', name: '搜索商品', inputType: 'search' },
    { ref: 'e2', role: 'textbox', name: '密码', inputType: 'password' },
    { ref: 'e3', role: 'textbox', name: '备注' },
    { ref: 'e4', role: 'button', name: '搜索' },
    { ref: 'e5', role: 'button', name: '搜索' },
  ],
};

describe('capture recorder (batch 06 捕获)', () => {
  it('mirrors the batch-04 tool set exactly', () => {
    expect([...PLAYBOOK_BROWSER_TOOL_NAMES]).toEqual([
      'snapshot',
      'click',
      'type',
      'select',
      'scroll',
      'navigate',
      'extract',
      'screenshot',
      'wait_for',
      'back',
      'download',
      'upload',
    ]);
  });

  it('records a role+name locator (with nth for duplicates) and the wait condition', () => {
    const row = describeToolCall({
      op: 'click',
      ref: 'e5',
      snapshot,
      wait: { kind: 'text', text: '搜索结果' },
    });
    expect(row.replayJson).toEqual({
      op: 'click',
      locator: { role: 'button', name: '搜索', nth: 1 },
      wait: { kind: 'text', text: '搜索结果' },
    });
    expect(row.siteDomain).toBe('shop.example');
  });

  it('redacts typed values fail-safe: password and unknown field types never persist', () => {
    expect(describeToolCall({ op: 'type', ref: 'e1', snapshot, text: '耳机' }).inputValue).toBe(
      '耳机',
    );
    expect(describeToolCall({ op: 'type', ref: 'e2', snapshot, text: 'hunter2' }).inputValue).toBe(
      REDACTED_INPUT_VALUE,
    );
    expect(describeToolCall({ op: 'type', ref: 'e3', snapshot, text: 'x' }).inputValue).toBe(
      REDACTED_INPUT_VALUE,
    );
    expect(describeToolCall({ op: 'type', ref: 'e9', snapshot, text: 'x' }).inputValue).toBe(
      REDACTED_INPUT_VALUE,
    );
  });

  it('writes sequential action indexes, the executor source, and outcome evidence; never throws', async () => {
    const rows: CreateActionCaptureInput[] = [];
    const outcomes: unknown[] = [];
    const errors: unknown[] = [];
    let fail = false;
    const recorder = new BrowserActionCaptureRecorder(
      {
        async create(input) {
          if (fail) throw new Error('db down');
          rows.push(input);
        },
        async setOutcome(_taskId, outcome) {
          outcomes.push(outcome);
        },
      },
      { taskId: 5, executorSource: 'extension', onError: (e) => errors.push(e) },
    );
    await recorder.recordToolCall({ op: 'navigate', url: 'https://shop.example/' });
    await recorder.recordToolCall({ op: 'click', ref: 'e4', snapshot });
    fail = true;
    await expect(recorder.recordToolCall({ op: 'back' })).resolves.toBeUndefined();
    await recorder.recordOutcome({
      finalUrl: 'https://shop.example/item',
      evidenceTexts: ['商品详情'],
    });
    expect(rows.map((r) => [r.actionIndex, r.stepType, r.executorSource])).toEqual([
      [0, 'navigate', 'extension'],
      [1, 'click', 'extension'],
    ]);
    expect(errors).toHaveLength(1);
    expect(outcomes).toEqual([
      { finalUrl: 'https://shop.example/item', evidenceTexts: ['商品详情'] },
    ]);
  });

  it('derives bare site domains', () => {
    expect(siteDomainOf('https://WWW.Example.com/a')).toBe('example.com');
    expect(siteDomainOf('not a url')).toBeNull();
  });
});
