import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { type BrowserEvalTask, scoreBrowserEval } from '../../../scripts/browser-eval/score.js';

const suite = JSON.parse(
  readFileSync(new URL('../../../scripts/browser-eval/tasks.json', import.meta.url), 'utf8'),
) as { smokeIds: string[]; tasks: BrowserEvalTask[] };

describe('browser eval suite', () => {
  it('ships 30 tasks across the required categories with 5 public smoke tasks', () => {
    expect(suite.tasks).toHaveLength(30);
    expect(new Set(suite.tasks.map((task) => task.id)).size).toBe(30);
    expect(new Set(suite.tasks.map((task) => task.category))).toEqual(
      new Set(['ecommerce', 'form', 'table', 'multipage', 'login_wall', 'ai_web_app']),
    );
    expect(suite.smokeIds).toHaveLength(5);
    for (const id of suite.smokeIds)
      expect(suite.tasks.find((task) => task.id === id)?.publicSite).toBe(true);
  });

  it('scores answers, handoffs and failures deterministically', () => {
    const table = suite.tasks.find((task) => task.id === 'be-12') as BrowserEvalTask;
    expect(
      scoreBrowserEval(table, {
        status: 'completed',
        summary: '| Alfreds Futterkiste | Maria Anders | Germany |',
        evidence: 'Alfreds Futterkiste',
        steps: 3,
      }),
    ).toBe(true);
    expect(scoreBrowserEval(table, { status: 'failed', reason: 'x', steps: 1 })).toBe(false);
    const wall = suite.tasks.find((task) => task.id === 'be-21') as BrowserEvalTask;
    expect(
      scoreBrowserEval(wall, {
        status: 'awaiting_user',
        reason: 'login',
        message: '请登录',
        steps: 1,
      }),
    ).toBe(true);
    expect(
      scoreBrowserEval(wall, {
        status: 'completed',
        summary: '编造的标题',
        evidence: 'x',
        steps: 2,
      }),
    ).toBe(false);
  });
});
