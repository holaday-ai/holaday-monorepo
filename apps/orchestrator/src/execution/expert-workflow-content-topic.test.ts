import { describe, expect, it } from 'vitest';

import { CONTENT_TOPIC_WORKFLOW } from './expert-workflow-content-topic.js';
import { parseInputs } from './expert-workflow-parser.js';

const W = CONTENT_TOPIC_WORKFLOW;

describe('CONTENT_TOPIC_WORKFLOW — shape', () => {
  it('has stable workflowId + name + roles', () => {
    expect(W.workflowId).toBe('content-topic');
    expect(W.name).toBe('内容选题策划');
    expect(W.roleIds.length).toBeGreaterThanOrEqual(3);
  });

  it('2 required + 6 optional inputs', () => {
    expect(W.requiredInputs).toHaveLength(2);
    expect(W.optionalInputs).toHaveLength(6);
    expect(W.requiredInputs.map((i) => i.name).sort()).toEqual(
      ['category', 'platform'].sort(),
    );
  });

  it('platform is regex-gated text — pattern matches the 7 known platforms', () => {
    const platform = W.requiredInputs.find((i) => i.name === 'platform');
    expect(platform?.type).toBe('text');
    const re = platform!.extractPattern!;
    for (const p of ['小红书', '抖音', '视频号', '公众号', '知乎', '微博']) {
      expect(re.test(`平台 ${p}`)).toBe(true);
    }
    // English aliases also accepted (downstream model handles either form)
    expect(re.test('平台 bilibili')).toBe(true);
    expect(re.test('平台 xiaohongshu')).toBe(true);
    // Unknown platform doesn't match
    expect(re.test('平台 facebook')).toBe(false);
  });

  it('content_format is regex-gated text — only the 5 known formats match', () => {
    const fmt = W.optionalInputs.find((i) => i.name === 'content_format');
    expect(fmt?.type).toBe('text');
    expect(fmt!.extractPattern!.test('内容形式 短视频')).toBe(true);
    expect(fmt!.extractPattern!.test('内容形式 图文笔记')).toBe(true);
    expect(fmt!.extractPattern!.test('内容形式 vlog')).toBe(false);
  });

  it('topic_count has fallback=5', () => {
    const tc = W.optionalInputs.find((i) => i.name === 'topic_count');
    expect(tc?.type).toBe('number');
    expect(tc?.fallback).toBe(5);
  });

  it('7 report sections, 6 required + 1 optional', () => {
    expect(W.reportSections).toHaveLength(7);
    const required = W.reportSections.filter((s) => s.required);
    const optional = W.reportSections.filter((s) => !s.required);
    expect(required).toHaveLength(6);
    expect(optional).toHaveLength(1);
    expect(optional[0]!.id).toBe('competitor_reference');
  });

  it('source-annotated sections cover topic / titles / publishing / competitor', () => {
    const annotated = W.reportSections
      .filter((s) => s.sourceAnnotation)
      .map((s) => s.id)
      .sort();
    expect(annotated).toEqual(
      [
        'competitor_reference',
        'publishing_strategy',
        'title_candidates',
        'topic_directions',
      ].sort(),
    );
  });

  it('zero data validators (content-topic has no arithmetic)', () => {
    expect(W.dataValidators).toHaveLength(0);
  });

  it('3 follow-up actions covering script / calendar / competitor diff', () => {
    expect(W.followUpActions).toHaveLength(3);
    expect(W.followUpActions.map((a) => a.label)).toEqual([
      '展开 Top 选题脚本',
      '生成 30 天发布日历',
      '列竞品差异化清单',
    ]);
  });

  it('system prompt preamble pins source markers + section format', () => {
    expect(W.systemPromptPreamble).toContain('[用户提供]');
    expect(W.systemPromptPreamble).toContain('[系统计算]');
    expect(W.systemPromptPreamble).toContain('[模型假设]');
    expect(W.systemPromptPreamble).toContain('[外部来源]');
    expect(W.systemPromptPreamble).toContain('5 个');
    expect(W.systemPromptPreamble).toContain('Markdown checkbox');
  });
});

describe('CONTENT_TOPIC_WORKFLOW — parseInputs', () => {
  it('extracts both required fields from a structured input', () => {
    const r = parseInputs('品类: 美妆护肤，平台是小红书，关键词 早C晚A', W);
    expect(r.extracted.category).toBe('美妆护肤');
    expect(r.extracted.platform).toBe('小红书');
    expect(r.extracted.keywords).toBe('早C晚A');
    // topic_count has fallback=5 → matched, not missing
    expect(r.extracted.topic_count).toBe(5);
    expect(r.missingRequired).toHaveLength(0);
  });

  it('platform extracted from natural mention without label', () => {
    const r = parseInputs('我做的是 母婴 在抖音 想做爆款选题', W);
    expect(r.extracted.platform).toBe('抖音');
    expect(r.extracted.category).toBe('母婴');
  });

  it('missing platform → missingRequired surfaces it', () => {
    const r = parseInputs('品类是 数码3C', W);
    expect(r.missingRequired.map((i) => i.name)).toContain('platform');
  });

  it('missing category → missingRequired surfaces it', () => {
    const r = parseInputs('在小红书做选题', W);
    expect(r.missingRequired.map((i) => i.name)).toContain('category');
  });

  it('content_format enum extraction', () => {
    const r = parseInputs(
      '品类 美妆 平台抖音 内容形式 短视频',
      W,
    );
    expect(r.extracted.content_format).toBe('短视频');
  });

  it('topic_count override via "生成 8 个"', () => {
    const r = parseInputs(
      '品类 母婴 平台小红书 生成 8 个选题',
      W,
    );
    expect(r.extracted.topic_count).toBe(8);
  });

  it('competitor_reference field captures multi-account list', () => {
    const r = parseInputs(
      '品类 美妆 平台小红书 竞品账号 完美日记 / 花西子 / 橘朵',
      W,
    );
    expect(r.extracted.competitors).toContain('完美日记');
    expect(r.extracted.competitors).toContain('花西子');
  });

  it('English platform aliases captured verbatim (downstream model handles the mapping)', () => {
    // Parser keeps the verbatim capture for type='text'. Mapping
    // "bilibili" → "B站" canonical form happens at prompt-build time
    // (the model knows both); the workflow contract intentionally
    // doesn't normalize.
    const r1 = parseInputs('品类 美妆 平台 xiaohongshu', W);
    expect(r1.extracted.platform).toBe('xiaohongshu');
    const r2 = parseInputs('品类 数码 平台 bilibili', W);
    expect(r2.extracted.platform).toBe('bilibili');
  });
});
