import { describe, expect, it } from 'vitest';
import {
  buildOptimizeSystemPrompt,
  buildScriptSystemPrompt,
  generateVideoScript,
  optimizeUserScript,
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

describe('optimizeUserScript (原方案 — faithful to user draft)', () => {
  const OPTIMIZED = JSON.stringify({
    title: '夏季防晒',
    segments: [
      { text: '夏天紫外线很强，防晒不能偷懒', visual: '烈日下的海滩，阳光强烈' },
      { text: '出门前二十分钟涂够量', visual: '防晒霜挤在手心特写' },
    ],
    bgmMood: '轻快',
  });

  it('optimizes the user draft into segments (all narrated visuals)', async () => {
    const out = await optimizeUserScript(
      { userText: '我想做个讲夏天防晒的视频，提醒大家涂够量' },
      { llm: llmReturning(OPTIMIZED) },
    );
    expect(out.title).toBe('夏季防晒');
    expect(out.segments).toHaveLength(2);
    // every segment is a narrated visual (type 'broll', has text + visual)
    for (const s of out.segments) {
      expect(s.type).toBe('broll');
      expect(s.text.length).toBeGreaterThan(0);
      expect(s.visual && s.visual.length).toBeGreaterThan(0);
    }
  });

  it('throws empty on a blank user draft', async () => {
    await expect(optimizeUserScript({ userText: '   ' }, { llm: llmReturning('x') })).rejects.toMatchObject({
      kind: 'empty',
    });
  });

  it('throws parse on a non-JSON reply', async () => {
    await expect(
      optimizeUserScript({ userText: '防晒' }, { llm: llmReturning('抱歉') }),
    ).rejects.toMatchObject({ kind: 'parse' });
  });

  it('system prompt instructs faithful optimization (no fabrication)', () => {
    const p = buildOptimizeSystemPrompt(6);
    expect(p).toMatch(/忠于用户文案|不杜撰/);
    expect(p).toContain('visual');
    expect(p).toContain('只输出 JSON');
  });

  it('范围2松绑: 关联性引导 + 保留压产品乱码 + 删掉"任何文字"一刀切', () => {
    const p = buildOptimizeSystemPrompt(6);
    // 关联性(范围3): 画面视觉化该段旁白的核心动作/对象
    expect(p).toMatch(/视觉化该段旁白|核心动作或对象/);
    // 收窄保留: 不画含文字特写 + 产品乱码假字
    expect(p).toMatch(/不要画含文字的特写|含文字的特写构图/);
    expect(p).toMatch(/产品包装|瓶身|标签/);
    expect(p).toMatch(/编造乱码/);
    // 松绑: 一刀切"画面中不能(出现|有)任何文字"必须已删
    expect(p).not.toContain('画面中不能出现任何文字');
    expect(p).not.toContain('画面中不能有任何文字');
  });

  it('keyText 已撤回: 系统提示不再引导 keyText, JSON 示例无 keyText 字段', () => {
    const p = buildOptimizeSystemPrompt(6);
    expect(p).not.toMatch(/信息点字卡|keyText/);
    expect(p).not.toContain('"keyText"');
  });

  it('style: 风格词进系统提示(写实/氛围感/科普清晰), auto/undefined 不加风格行 (Phase 2)', () => {
    expect(buildOptimizeSystemPrompt(6, 'realistic')).toMatch(/【风格:写实】/);
    expect(buildOptimizeSystemPrompt(6, 'atmospheric')).toMatch(/【风格:氛围感】/);
    expect(buildOptimizeSystemPrompt(6, 'science')).toMatch(/【风格:科普清晰】/);
    expect(buildOptimizeSystemPrompt(6, 'auto')).not.toMatch(/【风格/);
    expect(buildOptimizeSystemPrompt(6)).not.toMatch(/【风格/);
  });

  it('steers away from high-anatomy-risk framing (extra-arm root fix)', () => {
    const p = buildOptimizeSystemPrompt(6);
    // avoid hand-object-hand stacked framing that grows extra arms
    expect(p).toMatch(/手-物-手|叠手|高解剖风险/);
    expect(p).toMatch(/多余手臂|畸形手/);
    // and the old text-free example must no longer suggest a 手部特写
    expect(p).not.toContain('户外涂防晒的手部特写');
  });
});
