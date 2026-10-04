/**
 * A股问答 / 七维全景的模型调用（批次 10.5）——统一走「模型目录」generate 通道.
 *
 * 之前这两个闭包（③/⑦ 解读 + ⑦ 意图判官）内联在 tasks.ts 里，无法离线回放。这里抽成纯函数：
 *   - 模型来源：调用侧用 `createProductionModelRuntimeWiring(...).resolveCore({ lane: 'generate' })`
 *     拿到的 runtime（默认千问；目录里切到 Claude/GPT 时同一通道自动跟随，无需改这里）。
 *   - 档位：`standard`（与 tasks.ts 原值一致）。
 *   - 参数：解读 maxTokens 700 / 温度 0.3；判官 maxTokens 160 / 温度 0（同股同文同判）。
 *
 * 合规顺序不在这里改变：runner 内仍是「生成 → regex 闸门 → 意图判官 → 降级/放行」，
 * 本模块只负责把 system+user 发给目录里的模型并取回文本。
 */

import type { MessagesAdapter } from '../../llm/messages-adapter.js';
import type { ProductionModelRuntimeResolution } from '../../llm/model-runtime-wiring.js';

/** A股通道在模型目录 generate lane 上使用的档位。 */
export const ASHARE_MODEL_PURPOSE = 'standard' as const;

/** ③ 可能相关因素 / ⑦ 分析师视角：低温，更忠实照抄数字（降低 ungrounded 误降级）。 */
export const ASHARE_INTERPRET_REQUEST = { maxTokens: 700, temperature: 0.3 } as const;

/** ⑦ 意图判官：温度 0 求确定性（治"时好时降级"）。 */
export const ASHARE_JUDGE_REQUEST = { maxTokens: 160, temperature: 0 } as const;

export type AshareModelCall = (input: { system: string; user: string }) => Promise<string>;

export interface AshareModelCallers {
  interpret: AshareModelCall;
  /** 仅在 `ASHARE_INTENT_JUDGE_ENABLED` 打开时存在；缺省 = runner 走 regex-only 原行为。 */
  judge?: AshareModelCall;
}

/** generate 通道 runtime → A股用的 MessagesAdapter；不可用时返回 null（调用侧按 reasonCode 失败）。 */
export function ashareMessagesAdapter(
  runtime: ProductionModelRuntimeResolution,
): MessagesAdapter | null {
  return runtime.kind === 'ready' ? runtime.messages(ASHARE_MODEL_PURPOSE) : null;
}

function textCall(
  adapter: MessagesAdapter,
  params: { maxTokens: number; temperature: number },
): AshareModelCall {
  return async ({ system, user }) => {
    const resp = await adapter.create({
      maxTokens: params.maxTokens,
      temperature: params.temperature,
      system,
      messages: [{ role: 'user', content: user }],
      thinking: { type: 'disabled' },
    });
    return resp.content
      .filter((block) => block.type === 'text')
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join('\n');
  };
}

export function createAshareModelCallers(
  adapter: MessagesAdapter,
  options: { judgeEnabled: boolean },
): AshareModelCallers {
  const interpret = textCall(adapter, ASHARE_INTERPRET_REQUEST);
  if (!options.judgeEnabled) return { interpret };
  return { interpret, judge: textCall(adapter, ASHARE_JUDGE_REQUEST) };
}
