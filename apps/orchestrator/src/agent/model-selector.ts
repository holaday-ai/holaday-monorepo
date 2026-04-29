/**
 * Model selector — pick Sonnet vs Opus per task complexity.
 *
 * Today both vision-loop and supercar are wired to whatever model the
 * env says (typically Opus 4.7). This selector centralises the rule
 * so callers can ask "what model should this intent run on?" and get
 * a single answer with the same heuristic.
 *
 * Heuristic (intentionally simple — the runtime cost of mis-routing
 * one task is small, and a complex rule would add config drift):
 * - Long intents (>100 chars) → Opus
 * - "分析 / 研究 / 对比 / 报告 / 多个 / 策略 / 方案" verbs → Opus
 * - hybrid task type (browser AND search) → Opus
 * - Everything else → Sonnet
 */

import type { TaskType } from './tool-registry.js';

export type ModelChoice = 'sonnet' | 'opus';

export interface ModelConfig {
  model: string;
  thinking: { type: 'enabled'; effort: 'low' | 'medium' | 'high' };
  maxTokens: number;
}

const COMPLEXITY_HINTS = /分析|研究|对比|报告|多个|策略|方案|总结|整理.*列表/;

export function pickModelChoice(intent: string, taskType: TaskType): ModelChoice {
  if (taskType === 'hybrid') return 'opus';
  if (intent.length > 100) return 'opus';
  if (COMPLEXITY_HINTS.test(intent)) return 'opus';
  return 'sonnet';
}

export function getModelConfig(choice: ModelChoice): ModelConfig {
  if (choice === 'opus') {
    return {
      model: 'claude-opus-4-7',
      thinking: { type: 'enabled', effort: 'high' },
      maxTokens: 16000,
    };
  }
  return {
    model: 'claude-sonnet-4-6',
    thinking: { type: 'enabled', effort: 'medium' },
    maxTokens: 8000,
  };
}

/**
 * Convenience: classify + return the full config in one call.
 */
export function selectModelForTask(
  intent: string,
  taskType: TaskType,
): ModelConfig {
  return getModelConfig(pickModelChoice(intent, taskType));
}
