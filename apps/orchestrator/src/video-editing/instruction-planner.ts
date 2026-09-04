import type { MessagesAdapter } from '../llm/messages-adapter.js';
import {
  type VideoEditPlan,
  VideoEditPlanValidationError,
  validateVideoEditPlan,
} from './operation-schema.js';
import type { VideoEditDocument, VideoEditSourceKind } from './types.js';

export interface VideoEditPlannerClient {
  plan(input: {
    instruction: string;
    selectedSceneId?: string;
    document: VideoEditDocument;
    sourceKind: VideoEditSourceKind;
  }): Promise<unknown>;
}

export type VideoEditPlanningResult =
  | { status: 'ready' | 'suggestion'; plan: VideoEditPlan }
  | { status: 'planner_unavailable' };

const CLARIFICATION_SUMMARY =
  '请告诉我想调整哪一段，以及要裁剪、排序、改字幕、改画幅或重新生成什么。';

function isAmbiguousInstruction(instruction: string): boolean {
  const normalized = instruction.trim();
  if (!normalized) return true;
  if (/^(?:帮我)?(?:优化|调整|改进|处理)(?:一下)?[。.!！]?$/.test(normalized)) return true;
  return !/(?:第\s*\d+\s*段|场景|片段|开头|结尾|字幕|裁|删|秒|排序|放到|竖版|横版|方形|画幅|比例|静音|重(?:新)?生成)/.test(
    normalized,
  );
}

function clarificationPlan(): VideoEditPlan {
  return {
    summary: CLARIFICATION_SUMMARY,
    affectedSceneIds: [],
    operations: [],
    requiresQuote: false,
  };
}

export async function planVideoEditInstruction(input: {
  instruction: string;
  selectedSceneId?: string;
  document: VideoEditDocument;
  sourceKind: VideoEditSourceKind;
  client: VideoEditPlannerClient;
}): Promise<VideoEditPlanningResult> {
  if (isAmbiguousInstruction(input.instruction)) {
    return { status: 'suggestion', plan: clarificationPlan() };
  }
  try {
    const raw = await input.client.plan({
      instruction: input.instruction.trim(),
      ...(input.selectedSceneId ? { selectedSceneId: input.selectedSceneId } : {}),
      document: input.document,
      sourceKind: input.sourceKind,
    });
    return {
      status: 'ready',
      plan: validateVideoEditPlan(raw, {
        document: input.document,
        sourceKind: input.sourceKind,
      }),
    };
  } catch (error) {
    if (error instanceof VideoEditPlanValidationError) {
      return { status: 'planner_unavailable' };
    }
    return { status: 'planner_unavailable' };
  }
}

const PLANNER_SYSTEM_PROMPT = `你是 Holaday 的受限视频剪辑规划器。只返回 JSON，不要 Markdown。
JSON 形状必须是 {"summary":"简短中文预览","operations":[...]}。
operations 最多 20 项，只允许以下六种：
1. {"kind":"trim","sceneId":"...","startMs":0,"endMs":1000}
2. {"kind":"reorder","sceneIds":["完整场景顺序"]}
3. {"kind":"caption","sceneId":"...","text":"..."}
4. {"kind":"aspect_ratio","value":"16:9|9:16|1:1"}
5. {"kind":"remove_silence","sceneId":"...","ranges":[{"startMs":0,"endMs":1000}]}
6. {"kind":"regenerate_scene","sceneId":"...","prompt":"..."}
不得增加字段，不得编造场景，不得省略排序中的场景。裁剪时间相对该场景从 0 开始。
selectedSceneId 是用户当前明确选中的片段；“这一段”“当前片段”等指代必须绑定到它。
不得改变人物身份、锁定主体或参考素材。IP 人物重新生成时必须沿用服务端已有锁定主体，JSON 中不要输出主体或文件标识。
不确定时返回 operations: []，summary 说明需要用户明确哪一段和修改目标。`;

function plannerDocument(document: VideoEditDocument) {
  return {
    aspectRatio: document.aspectRatio,
    scenes: document.scenes.map((scene) => ({
      id: scene.id,
      order: scene.order,
      durationMs: scene.sourceEndMs - scene.sourceStartMs,
      caption: scene.caption,
      canRegenerate: scene.generationContext !== null,
      lockedSubject: Boolean(scene.generationContext?.lockedSubjectFileId),
    })),
  };
}

export function createQwenVideoEditPlannerClient(input: {
  messagesAdapter: MessagesAdapter;
  timeoutMs?: number;
}): VideoEditPlannerClient {
  return {
    async plan(request) {
      const response = await input.messagesAdapter.create(
        {
          maxTokens: 2_000,
          thinking: { type: 'disabled' },
          system: PLANNER_SYSTEM_PROMPT,
          messages: [
            {
              role: 'user',
              content: JSON.stringify({
                instruction: request.instruction,
                selectedSceneId: request.selectedSceneId ?? null,
                sourceKind: request.sourceKind,
                document: plannerDocument(request.document),
              }),
            },
          ],
          temperature: 0,
        },
        { timeoutMs: input.timeoutMs ?? 12_000, maxRetries: 1 },
      );
      const content = response.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('')
        .trim();
      if (!content) throw new Error('video edit planner returned no content');
      return JSON.parse(content) as unknown;
    },
  };
}
