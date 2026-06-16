/**
 * Video script generation (step ①).
 *
 * Turns a user's one-line ask ("帮我做一条夏季防晒的种草视频，用我出镜") into a
 * structured VideoScript the pipeline consumes: title + ordered segments
 * (口播 voiceover / B-roll), bgm mood, hashtags.
 *
 * The LLM call is INJECTED (`deps.llm`) so this module is unit-testable
 * without a real model; the lane (3e) wires it to the Anthropic planner.
 * Parsing is defensive — strips markdown fences, tolerates Chinese type
 * values (口播 / B-roll) and snake_case keys (duration_hint / bgm_mood) —
 * then validates with zod. A malformed model reply fails loud (typed
 * VideoScriptError) instead of producing a broken script downstream.
 *
 * Compliance: the system prompt instructs the model to script ONLY the
 * user's own on-camera narration (no impersonation of other people); the
 * hard authorization gate + watermark live at the lane / compositor.
 */

import { z } from 'zod';
import type { VideoScript } from './types.js';

export type LlmComplete = (params: { system: string; user: string }) => Promise<string>;

export interface GenerateScriptInput {
  readonly userPrompt: string;
  /** Soft cap guiding the model. Default 8. */
  readonly maxSegments?: number;
}

export type VideoScriptErrorKind = 'llm' | 'parse' | 'empty';

export class VideoScriptError extends Error {
  constructor(
    message: string,
    readonly kind: VideoScriptErrorKind,
    readonly detail?: string,
  ) {
    super(message);
    this.name = 'VideoScriptError';
  }
}

const SegmentSchema = z.object({
  text: z.string().min(1),
  type: z.enum(['voiceover', 'broll']),
  visual: z.string().min(1).optional(),
  // 信息点字卡(短词 ≤8字). `.catch(undefined)`: 超长/脏值 → 该段不叠,绝不让一个脏
  // keyText 崩掉整个 script parse. buildAss 还有第二层 sanitize(去 ASS 控制字符).
  keyText: z.string().trim().min(1).max(8).optional().catch(undefined),
  durationHintSec: z.coerce.number().positive().optional(),
});

const ScriptSchema = z.object({
  title: z.string().min(1),
  segments: z.array(SegmentSchema).min(1),
  bgmMood: z.string().min(1).optional(),
  hashtags: z.array(z.string().min(1)).optional(),
});

export function buildScriptSystemPrompt(maxSegments: number): string {
  return [
    '你是 HOLA DAY 的短视频脚本编导，擅长抖音/小红书种草口播。',
    '把用户的一句话需求拆成一条可拍摄的竖屏短视频脚本。',
    '',
    '硬性要求：',
    `- ${Math.max(4, maxSegments - 2)}~${maxSegments} 个分段，口播段与 B-roll 段交替，开头第一句要有钩子。`,
    '- 每个分段都带一句旁白文案（text），口语化、有信息增量、不堆砌。',
    "- type 只能是 'voiceover'（用户本人出镜对镜头口播，会做换口型）或 'broll'（产品/场景空镜，用 AI 配图）。",
    "- type='broll' 的分段必须带 visual：一句中文画面描述，用于文生图。",
    '- 合规：脚本只编排「用户本人出镜、用户本人声音」的内容，不得模仿/冒充他人。',
    '',
    '只输出 JSON（不要 markdown、不要解释），结构：',
    '{"title": "...", "segments": [{"text": "...", "type": "voiceover", "durationHintSec": 4},',
    '{"text": "...", "type": "broll", "visual": "防晒霜产品特写", "durationHintSec": 3}],',
    '"bgmMood": "轻快", "hashtags": ["#防晒", "#护肤"]}',
  ].join('\n');
}

/** Strip markdown fences / prose and parse the first JSON object. */
function parseJsonLoose(text: string): unknown {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) t = fence[1].trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start >= 0 && end > start) t = t.slice(start, end + 1);
  return JSON.parse(t);
}

function normType(v: unknown): string {
  const s = String(v ?? '').toLowerCase().trim();
  if (/口播|出镜|voiceover|talking/.test(s)) return 'voiceover';
  if (/b-?roll|broll|空镜|配图|cutaway/.test(s)) return 'broll';
  return s; // let zod reject unknowns
}

/** Map tolerant raw JSON (Chinese type values, snake_case keys) to the strict shape. */
function normalizeRawScript(raw: unknown): unknown {
  const r = (raw ?? {}) as Record<string, unknown>;
  const rawSegs = Array.isArray(r.segments) ? r.segments : [];
  const segments = rawSegs.map((s) => {
    const seg = (s ?? {}) as Record<string, unknown>;
    return {
      text: seg.text ?? seg.文案 ?? seg.narration,
      type: normType(seg.type ?? seg.类型),
      visual: seg.visual ?? seg.画面 ?? undefined,
      durationHintSec:
        seg.durationHintSec ?? seg.duration_hint ?? seg.durationHint ?? seg.duration_hint_sec ?? undefined,
    };
  });
  return {
    title: r.title ?? r.标题,
    segments,
    bgmMood: r.bgmMood ?? r.bgm_mood ?? undefined,
    hashtags: Array.isArray(r.hashtags) ? r.hashtags : undefined,
  };
}

export async function generateVideoScript(
  input: GenerateScriptInput,
  deps: { llm: LlmComplete },
): Promise<VideoScript> {
  const maxSegments = input.maxSegments ?? 8;
  let text: string;
  try {
    text = await deps.llm({ system: buildScriptSystemPrompt(maxSegments), user: input.userPrompt });
  } catch (err) {
    throw new VideoScriptError('script LLM call failed', 'llm', err instanceof Error ? err.message : String(err));
  }
  if (!text || !text.trim()) throw new VideoScriptError('script LLM returned empty', 'empty');

  let raw: unknown;
  try {
    raw = parseJsonLoose(text);
  } catch (err) {
    throw new VideoScriptError(
      'script reply was not parseable JSON',
      'parse',
      `${(err as Error).message} :: ${text.slice(0, 200)}`,
    );
  }
  const parsed = ScriptSchema.safeParse(normalizeRawScript(raw));
  if (!parsed.success) {
    throw new VideoScriptError('script did not match schema', 'parse', JSON.stringify(parsed.error.issues).slice(0, 400));
  }
  return parsed.data as VideoScript;
}

// ---------------------------------------------------------------------------
// 原方案 (simplified) — optimize a USER-PROVIDED draft.
// ---------------------------------------------------------------------------

export interface OptimizeScriptInput {
  /** The user's draft copy / idea (NOT a one-line ask). */
  readonly userText: string;
  /** Soft cap guiding the model. Default 6. */
  readonly maxSegments?: number;
}

export function buildOptimizeSystemPrompt(maxSegments: number): string {
  return [
    '你是 HOLA DAY 的短视频文案优化师。',
    '用户会给你一段草稿文案或想法，你把它优化、拆成一条可拍摄的竖屏短视频脚本（图文配音，无真人出镜、无换口型）。',
    '',
    '硬性要求：',
    `- ${Math.max(3, maxSegments - 2)}~${maxSegments} 个分段，每段一句精炼旁白（text，口语化、保留用户原意）。`,
    '- 每段一句画面描述（visual，用于 AI 文生图/文生视频）。【让画面视觉化该段旁白在说的核心动作或对象】：',
    '  例如「选 SPF50」段→阳光下手在小臂上抹开乳白防晒乳的动作；「每两小时补涂」段→户外看时间、再次涂抹的画面；',
    '  「紫外线很强」段→正午烈日暴晒的街景/皮肤。不要用与旁白无关的泛泛空镜（如随手一个草帽女）。',
    '- 【不要画含文字的特写构图】：产品包装/瓶身/标签/招牌/屏幕/书本这类——AI 会在上面编造乱码假字，一律不画、不特写。',
    '  环境里自然的远景文字（模糊路牌等）不强求避开，但别让文字成为画面主体或特写。',
    '- 【避开高解剖风险构图】：AI 画「手-物-手竖直叠帧」「双手紧贴特写」会长出多余手臂或畸形手。',
    '  优先单人、半身或环境景；手部动作用侧面、单手的简单姿势，避免「一只手拿物、另一只手操作」的正面叠手特写。',
    '- 【信息点字卡 keyText（可选）】：若该段旁白含一个值得在画面上「浮一行字」强调的关键信息点',
    '  （如「SPF50」「PA+++」「每2小时补涂」），在该段填 keyText，提炼成 ≤8 字的点睛短词。',
    '  这行字由系统用字体叠加到画面上（不是 AI 画），不会乱码，放心填；纯描述、无明确信息点的段就不填。',
    '  keyText 只是要强调的关键词，不是完整旁白（旁白已是 text）。',
    '- 忠于用户文案：优化表达/分段/补画面，但不改变事实主张、不杜撰、不模仿或冒充他人。',
    '',
    '只输出 JSON（不要 markdown、不要解释）：',
    '{"title": "...", "segments": [{"text": "旁白句", "visual": "画面描述", "keyText": "SPF50"}], "bgmMood": "轻快", "hashtags": ["#..."]}',
  ].join('\n');
}

/** Normalize the optimize reply — every segment is a narrated visual ('broll'). */
function normalizeOptimized(raw: unknown): unknown {
  const r = (raw ?? {}) as Record<string, unknown>;
  const rawSegs = Array.isArray(r.segments) ? r.segments : [];
  return {
    title: r.title ?? r.标题,
    segments: rawSegs.map((s) => {
      const seg = (s ?? {}) as Record<string, unknown>;
      return {
        text: seg.text ?? seg.文案 ?? seg.narration,
        type: 'broll' as const,
        visual: seg.visual ?? seg.画面 ?? undefined,
        keyText: seg.keyText ?? seg.关键词 ?? seg.信息点 ?? undefined,
        durationHintSec: seg.durationHintSec ?? seg.duration_hint ?? undefined,
      };
    }),
    bgmMood: r.bgmMood ?? r.bgm_mood ?? undefined,
    hashtags: Array.isArray(r.hashtags) ? r.hashtags : undefined,
  };
}

/**
 * Optimize a user-provided draft into a VideoScript. Unlike
 * generateVideoScript (which invents from a one-line ask), this stays
 * FAITHFUL to the user's text — optimize / segment / add visual prompts, no
 * fabrication, no impersonation. Every segment is a narrated visual (no
 * 出镜 / lip-sync) for the simplified 原方案 pipeline.
 */
export async function optimizeUserScript(
  input: OptimizeScriptInput,
  deps: { llm: LlmComplete },
): Promise<VideoScript> {
  if (!input.userText || !input.userText.trim()) {
    throw new VideoScriptError('user script text is empty', 'empty');
  }
  const maxSegments = input.maxSegments ?? 6;
  let text: string;
  try {
    text = await deps.llm({ system: buildOptimizeSystemPrompt(maxSegments), user: input.userText });
  } catch (err) {
    throw new VideoScriptError('optimize LLM call failed', 'llm', err instanceof Error ? err.message : String(err));
  }
  if (!text || !text.trim()) throw new VideoScriptError('optimize LLM returned empty', 'empty');
  let raw: unknown;
  try {
    raw = parseJsonLoose(text);
  } catch (err) {
    throw new VideoScriptError('optimize reply not parseable JSON', 'parse', `${(err as Error).message} :: ${text.slice(0, 200)}`);
  }
  const parsed = ScriptSchema.safeParse(normalizeOptimized(raw));
  if (!parsed.success) {
    throw new VideoScriptError('optimized script did not match schema', 'parse', JSON.stringify(parsed.error.issues).slice(0, 400));
  }
  return parsed.data as VideoScript;
}
