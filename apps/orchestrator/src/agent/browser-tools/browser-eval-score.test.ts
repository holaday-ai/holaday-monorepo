import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  type BrowserEvalTask,
  classifyFailure,
  scoreBrowserEval,
  scoreListWithSources,
} from '../../../scripts/browser-eval/score.js';

const suite = JSON.parse(
  readFileSync(new URL('../../../scripts/browser-eval/tasks.json', import.meta.url), 'utf8'),
) as { smokeIds: string[]; listSourcesIds: string[]; tasks: BrowserEvalTask[] };

describe('browser eval suite', () => {
  it('ships 36 tasks across the required categories with 5 public smoke tasks', () => {
    expect(suite.tasks).toHaveLength(36);
    expect(new Set(suite.tasks.map((task) => task.id)).size).toBe(36);
    expect(new Set(suite.tasks.map((task) => task.category))).toEqual(
      new Set([
        'ecommerce',
        'form',
        'table',
        'multipage',
        'login_wall',
        'ai_web_app',
        'list_sources',
      ]),
    );
    expect(suite.listSourcesIds).toEqual(['be-31', 'be-32', 'be-33', 'be-34', 'be-35', 'be-36']);
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

  it('excludes model-layer and environment failures from the success rate', () => {
    const failed = {
      status: 'failed' as const,
      reason: '模型服务暂时不可用，请稍后重试。',
      steps: 0,
    };
    expect(classifyFailure(false, failed, [{ type: 'model_error', code: 'PROVIDER_ERROR' }])).toBe(
      'model_layer',
    );
    expect(
      classifyFailure(
        false,
        { status: 'failed', reason: 'harness: page.goto timeout', steps: 0 },
        [],
      ),
    ).toBe('environment');
    expect(
      classifyFailure(false, { status: 'failed', reason: '找不到按钮', steps: 6 }, [
        { type: 'model' },
        { type: 'model' },
      ]),
    ).toBe('browser');
    expect(
      classifyFailure(true, { status: 'completed', summary: 'x', evidence: 'x', steps: 2 }, []),
    ).toBe('none');
  });

  it('counts a model timeout at the task deadline as the task running out of time', () => {
    const failed = { status: 'failed' as const, reason: '模型响应超时', steps: 19 };
    const trace = [{ type: 'model' }, { type: 'model_error', code: 'REQUEST_TIMEOUT' }];
    expect(
      classifyFailure(false, failed, trace, { durationMs: 244_199, taskTimeoutMs: 240_000 }),
    ).toBe('browser');
    // A timeout well before the deadline is still a model-layer failure.
    expect(
      classifyFailure(false, failed, trace, { durationMs: 130_000, taskTimeoutMs: 240_000 }),
    ).toBe('model_layer');
    // Provider errors are never re-attributed.
    expect(
      classifyFailure(
        false,
        failed,
        [{ type: 'model' }, { type: 'model_error', code: 'PROVIDER_ERROR' }],
        { durationMs: 240_000, taskTimeoutMs: 240_000 },
      ),
    ).toBe('model_layer');
  });
});

describe('list answers with per-item sources (FIX-BATCH-A)', () => {
  const news = {
    type: 'list_with_sources',
    minItems: 3,
    domains: ['36kr.com'],
    keyField: 'date',
  } as const;
  const item = (i: number, link: string) =>
    `${i}. **原标题**：标题${i}\n   **发布日期**：2026-10-08 1${i}:00\n   **链接**：${link}`;

  it('rejects homepage links reused by every item (acceptance A2)', () => {
    const answer = [1, 2, 3].map((i) => item(i, 'https://36kr.com/')).join('\n\n');
    expect(scoreListWithSources(answer, news)).toMatchObject({
      ok: false,
      problems: [
        '第 1 条只有首页/搜索页链接',
        '第 2 条只有首页/搜索页链接',
        '第 3 条只有首页/搜索页链接',
      ],
    });
  });

  it('accepts distinct detail links with the key field, in lists and tables', () => {
    const answer = [1, 2, 3].map((i) => item(i, `https://36kr.com/p/${i}`)).join('\n\n');
    expect(scoreListWithSources(answer, news)).toMatchObject({
      ok: true,
      urls: ['https://36kr.com/p/1', 'https://36kr.com/p/2', 'https://36kr.com/p/3'],
    });
    const table = [
      '| 商品 | 价格 | 链接 |',
      '|---|---|---|',
      ...[1, 2, 3].map((i) => `| 耳机${i} | ¥${i}99 | https://item.jd.com/${i}.html |`),
    ].join('\n');
    expect(
      scoreListWithSources(table, {
        type: 'list_with_sources',
        minItems: 3,
        domains: ['jd.com'],
        keyField: 'price',
      }).ok,
    ).toBe(true);
  });

  it('flags search pages, missing fields and reused links', () => {
    const answer = [
      '1. 耳机A ¥99 https://re.jd.com/search?keyword=x',
      '2. 耳机B https://item.jd.com/2.html',
      '3. 耳机C ¥199 https://item.jd.com/2.html',
    ].join('\n');
    expect(
      scoreListWithSources(answer, {
        type: 'list_with_sources',
        minItems: 3,
        domains: ['jd.com'],
        keyField: 'price',
      }).problems,
    ).toEqual(['第 1 条只有首页/搜索页链接', '第 2 条缺少价格', '第 3 条与前面条目复用同一链接']);
  });
});

it('scores anchor variants of one article as one source', () => {
  const answer = [1, 2, 3]
    .map((i) => `${i}. 标题${i} 2026-10-08 https://36kr.com/p/1#section${i}`)
    .join('\n');
  expect(
    scoreListWithSources(answer, {
      type: 'list_with_sources',
      minItems: 3,
      domains: ['36kr.com'],
      keyField: 'date',
    }).problems,
  ).toEqual(['第 2 条与前面条目复用同一链接', '第 3 条与前面条目复用同一链接']);
});
