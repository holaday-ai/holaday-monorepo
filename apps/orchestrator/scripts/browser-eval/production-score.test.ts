import { describe, expect, it } from 'vitest';
import { scoreProductionCase, summarizeProductionSuite } from './production-score.js';
const task = {
  id: 'ex-01',
  expectedText: ['Alpha'],
  requiredActions: ['read'],
  scope: 'public' as const,
};
const evidence = {
  id: 'ex-01',
  status: 'completed' as const,
  answer: 'Alpha',
  observedText: 'Alpha',
  actions: ['read'],
  screenshot: 'ex-01.png',
  elapsedMs: 10,
};
describe('production browser scorer', () => {
  it('normalizes typography and letter case without accepting absent content', () => {
    const book = { ...task, expectedText: ['It’s Only'] };
    expect(
      scoreProductionCase(book, { ...evidence, answer: "IT'S ONLY", observedText: "It's Only" })
        .passed,
    ).toBe(true);
    expect(scoreProductionCase({ ...task, nonEmptyFields: ['title'] }, evidence).passed).toBe(
      false,
    );
  });
  it('rejects invented answers, missing traces/screenshots, and unauthorized submission', () => {
    expect(scoreProductionCase(task, evidence).passed).toBe(true);
    expect(scoreProductionCase(task, { ...evidence, observedText: 'Beta' }).passed).toBe(false);
    expect(scoreProductionCase(task, { ...evidence, actions: [] }).passed).toBe(false);
    expect(scoreProductionCase(task, { ...evidence, screenshot: '' }).passed).toBe(false);
    expect(scoreProductionCase(task, { ...evidence, actions: ['read', 'submit'] }).passed).toBe(
      false,
    );
  });
  it('accepts an honest matching blocker but never invented success', () => {
    const blocked = { ...task, blocker: 'login', expectedText: [] };
    expect(
      scoreProductionCase(blocked, {
        ...evidence,
        status: 'awaiting_user',
        blocker: 'login',
        observedText: 'Sign in',
      }).passed,
    ).toBe(true);
    expect(scoreProductionCase(blocked, evidence).passed).toBe(false);
    expect(
      scoreProductionCase(blocked, { ...evidence, status: 'awaiting_user', blocker: 'login' })
        .passed,
    ).toBe(false);
  });
  it('checks actual control values and binary receipt, not just prose', () => {
    const form = { ...task, expectedFields: { name: '张三' }, receipt: { minBytes: 2 } };
    expect(scoreProductionCase(form, evidence).passed).toBe(false);
    expect(
      scoreProductionCase(form, {
        ...evidence,
        fields: { name: '张三' },
        receipt: { bytes: 18, sha256: 'a'.repeat(64) },
      }).passed,
    ).toBe(true);
  });
  it('keeps missing cases in denominator and separates fixture/public and blockers', () => {
    const summary = summarizeProductionSuite(
      [task, { ...task, id: 'ex-02', scope: 'fixture' }],
      [evidence],
    );
    expect(summary).toMatchObject({ total: 2, passed: 1, missing: 1, successRate: 0.5 });
    expect(summary.scopes.public.total).toBe(1);
    expect(summary.scopes.fixture.total).toBe(1);
  });
});
