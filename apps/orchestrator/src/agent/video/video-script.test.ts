import { describe, expect, it } from 'vitest';
import {
  buildScriptSystemPrompt,
  generateVideoScript,
  VideoScriptError,
  type LlmComplete,
} from './video-script.js';

const llmReturning = (text: string): LlmComplete => async () => text;

const VALID = JSON.stringify({
  title: '夏天不晒黑的3个秘诀',
  segments: [
    { text: '姐妹们夏天到了千万别让紫外线毁了你的皮肤', type: 'voiceover', durationHintSec: 4 },
    { text: '防晒霜要选这种', type: 'broll', visual: '防晒霜产品特写', durationHintSec: 3 },
  ],
  bgmMood: '轻快',
  hashtags: ['#防晒', '#护肤'],
});

describe('generateVideoScript', () => {
  it('parses a valid JSON reply into a VideoScript', async () => {
    const out = await generateVideoScript({ userPrompt: '做个防晒种草视频' }, { llm: llmReturning(VALID) });
    expect(out.title).toBe('夏天不晒黑的3个秘诀');
    expect(out.segments).toHaveLength(2);
    expect(out.segments[0]).toMatchObject({ type: 'voiceover' });
    expect(out.segments[1]).toMatchObject({ type: 'broll', visual: '防晒霜产品特写' });
    expect(out.bgmMood).toBe('轻快');
  });

  it('strips markdown fences + surrounding prose', async () => {
    const fenced = '好的，这是脚本：\n```json\n' + VALID + '\n```\n希望满意';
    const out = await generateVideoScript({ userPrompt: 'x' }, { llm: llmReturning(fenced) });
    expect(out.segments).toHaveLength(2);
  });

  it('normalizes Chinese type values + snake_case keys', async () => {
    const cn = JSON.stringify({
      标题: '测试',
      title: '测试',
      segments: [
        { text: '开场口播', type: '口播', duration_hint: 4 },
        { text: '空镜', type: 'B-roll', visual: '海边空镜', duration_hint: '3' },
      ],
      bgm_mood: '舒缓',
    });
    const out = await generateVideoScript({ userPrompt: 'x' }, { llm: llmReturning(cn) });
    expect(out.segments[0]?.type).toBe('voiceover');
    expect(out.segments[1]?.type).toBe('broll');
    expect(out.segments[0]?.durationHintSec).toBe(4); // coerced from snake_case
    expect(out.segments[1]?.durationHintSec).toBe(3); // coerced from string
    expect(out.bgmMood).toBe('舒缓');
  });

  it('throws parse error on non-JSON', async () => {
    await expect(
      generateVideoScript({ userPrompt: 'x' }, { llm: llmReturning('抱歉我做不了') }),
    ).rejects.toMatchObject({ kind: 'parse' });
  });

  it('throws parse error when the schema is violated (no segments)', async () => {
    await expect(
      generateVideoScript({ userPrompt: 'x' }, { llm: llmReturning('{"title":"x","segments":[]}') }),
    ).rejects.toMatchObject({ kind: 'parse' });
  });

  it('throws empty error on a blank reply', async () => {
    await expect(generateVideoScript({ userPrompt: 'x' }, { llm: llmReturning('   ') })).rejects.toMatchObject(
      { kind: 'empty' },
    );
  });

  it('throws llm error when the model call rejects', async () => {
    const llm: LlmComplete = async () => {
      throw new Error('anthropic 503');
    };
    await expect(generateVideoScript({ userPrompt: 'x' }, { llm })).rejects.toMatchObject({ kind: 'llm' });
  });
});

describe('buildScriptSystemPrompt', () => {
  it('carries the key constraints (口播/broll JSON-only + compliance)', () => {
    const p = buildScriptSystemPrompt(8);
    expect(p).toContain('voiceover');
    expect(p).toContain('broll');
    expect(p).toContain('只输出 JSON');
    expect(p).toMatch(/不得模仿|本人/);
  });
});

describe('VideoScriptError', () => {
  it('is an Error with a discriminated kind', () => {
    expect(new VideoScriptError('x', 'parse').kind).toBe('parse');
  });
});
