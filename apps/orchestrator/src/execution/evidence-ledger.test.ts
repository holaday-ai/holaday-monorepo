import { afterEach, describe, expect, it } from 'vitest';

import {
  _resetLedgerRegistryForTest,
  disposeLedger,
  EvidenceLedger,
  getLedger,
  getOrCreateLedger,
  MAX_ENTRIES_PER_TASK,
  MAX_FACT_CHARS,
} from './evidence-ledger.js';

describe('EvidenceLedger', () => {
  afterEach(() => _resetLedgerRegistryForTest());

  it('add() assigns id + timestamp and preserves the rest', () => {
    const ledger = new EvidenceLedger('tsk_test');
    const id = ledger.add({
      fact: 'GMV = ¥100000',
      sourceType: 'user_input',
      sourceDetail: 'user message #1',
      confidence: 'observed',
    });
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(ledger.size).toBe(1);
    const e = ledger.entries[0]!;
    expect(e.id).toBe(id);
    expect(e.taskId).toBe('tsk_test');
    expect(e.fact).toBe('GMV = ¥100000');
    expect(e.sourceType).toBe('user_input');
    expect(e.confidence).toBe('observed');
    expect(new Date(e.timestamp).toString()).not.toBe('Invalid Date');
  });

  it('truncates facts above MAX_FACT_CHARS', () => {
    const ledger = new EvidenceLedger('tsk_x');
    const big = 'x'.repeat(MAX_FACT_CHARS + 50);
    ledger.add({
      fact: big,
      sourceType: 'tool_result',
      sourceDetail: 'firecrawl response',
      confidence: 'extracted',
    });
    expect(ledger.entries[0]!.fact).toHaveLength(MAX_FACT_CHARS);
  });

  it('rejects writes past MAX_ENTRIES_PER_TASK and flags truncated', () => {
    const ledger = new EvidenceLedger('tsk_y');
    for (let i = 0; i < MAX_ENTRIES_PER_TASK; i++) {
      ledger.add({
        fact: `f${i}`,
        sourceType: 'inference',
        sourceDetail: 'tick',
        confidence: 'inferred',
      });
    }
    expect(ledger.size).toBe(MAX_ENTRIES_PER_TASK);
    expect(ledger.isTruncated).toBe(false);
    const overflowId = ledger.add({
      fact: 'one too many',
      sourceType: 'inference',
      sourceDetail: 'tick',
      confidence: 'inferred',
    });
    expect(overflowId).toBe('');
    expect(ledger.size).toBe(MAX_ENTRIES_PER_TASK);
    expect(ledger.isTruncated).toBe(true);
  });

  it('getByType filters correctly', () => {
    const ledger = new EvidenceLedger('tsk_z');
    ledger.add({
      fact: 'a', sourceType: 'user_input', sourceDetail: 's', confidence: 'observed',
    });
    ledger.add({
      fact: 'b', sourceType: 'browser_state', sourceDetail: 's', confidence: 'observed',
    });
    ledger.add({
      fact: 'c', sourceType: 'browser_state', sourceDetail: 's', confidence: 'observed',
    });
    expect(ledger.getByType('browser_state')).toHaveLength(2);
    expect(ledger.getByType('user_input')).toHaveLength(1);
    expect(ledger.getByType('tool_result')).toHaveLength(0);
  });

  it('getObservedFacts only returns observed-confidence entries', () => {
    const ledger = new EvidenceLedger('tsk_o');
    ledger.add({
      fact: 'a', sourceType: 'user_input', sourceDetail: 's', confidence: 'observed',
    });
    ledger.add({
      fact: 'b', sourceType: 'inference', sourceDetail: 's', confidence: 'inferred',
    });
    ledger.add({
      fact: 'c', sourceType: 'tool_result', sourceDetail: 's', confidence: 'extracted',
    });
    expect(ledger.getObservedFacts()).toHaveLength(1);
    expect(ledger.getObservedFacts()[0]!.fact).toBe('a');
  });

  it('getGroundedUrls extracts URLs from browser_state and tool_result only', () => {
    const ledger = new EvidenceLedger('tsk_url');
    ledger.add({
      fact: 'navigated to https://example.com/ ok',
      sourceType: 'browser_state',
      sourceDetail: 'page.goto',
      confidence: 'observed',
    });
    ledger.add({
      fact: 'firecrawl returned https://www.iana.org/help/example-domains',
      sourceType: 'tool_result',
      sourceDetail: 'firecrawl',
      confidence: 'extracted',
    });
    // Inference-source URL should NOT be grounded — that's exactly
    // the fabrication failure mode the verifier needs to catch.
    ledger.add({
      fact: 'I think the docs are at https://made-up-site.example/',
      sourceType: 'inference',
      sourceDetail: 'llm',
      confidence: 'inferred',
    });
    const urls = ledger.getGroundedUrls();
    expect(urls).toContain('https://example.com/');
    expect(urls).toContain('https://www.iana.org/help/example-domains');
    expect(urls).not.toContain('https://made-up-site.example/');
    expect(urls).toHaveLength(2);
  });

  it('getGroundedUrls deduplicates repeated entries', () => {
    const ledger = new EvidenceLedger('tsk_dup');
    ledger.add({
      fact: 'visited https://example.com/',
      sourceType: 'browser_state',
      sourceDetail: 'goto',
      confidence: 'observed',
    });
    ledger.add({
      fact: 'visited https://example.com/ again',
      sourceType: 'browser_state',
      sourceDetail: 'goto',
      confidence: 'observed',
    });
    expect(ledger.getGroundedUrls()).toEqual(['https://example.com/']);
  });

  it('toJSON returns a plain serialisable snapshot', () => {
    const ledger = new EvidenceLedger('tsk_json');
    ledger.add({
      fact: 'a', sourceType: 'user_input', sourceDetail: 's', confidence: 'observed',
    });
    const snap = ledger.toJSON();
    // Round-trippable with no class instances.
    const reparsed = JSON.parse(JSON.stringify(snap)) as typeof snap;
    expect(reparsed.taskId).toBe('tsk_json');
    expect(reparsed.entries).toHaveLength(1);
    expect(reparsed.truncated).toBe(false);
  });
});

describe('ledger registry', () => {
  afterEach(() => _resetLedgerRegistryForTest());

  it('getOrCreateLedger returns the same instance for the same taskId', () => {
    const a = getOrCreateLedger('tsk_reg');
    const b = getOrCreateLedger('tsk_reg');
    expect(a).toBe(b);
  });

  it('getLedger returns undefined for unknown ids', () => {
    expect(getLedger('tsk_missing')).toBeUndefined();
  });

  it('disposeLedger removes the ledger and is idempotent', () => {
    getOrCreateLedger('tsk_d');
    expect(getLedger('tsk_d')).toBeDefined();
    disposeLedger('tsk_d');
    expect(getLedger('tsk_d')).toBeUndefined();
    // Second dispose is a no-op (no throw).
    disposeLedger('tsk_d');
  });
});
