import { pino } from 'pino';
import { BUILTIN_MODEL_CATALOG, type BrainEntry, brainLaneModel } from '../model-catalog.js';
import type { ModelDataRegion } from '../model-data-region.js';
import {
  MODEL_ROLES,
  MODEL_ROLE_LEGACY_BINDINGS,
  type ModelRole,
  isModelRole,
} from './model-roles.js';

export const MODEL_GATEWAY_REGIONS = ['cn', 'intl'] as const satisfies readonly ModelDataRegion[];
export type RoleModelTable = Readonly<Record<ModelDataRegion, Readonly<Record<ModelRole, string>>>>;

/** The role table only feeds the Alibaba (Qwen) runtime; the same shape the observer accepts. */
const QWEN_MODEL_NAME = /^qwen[A-Za-z0-9._-]{0,76}$/;

/**
 * Today's effective model per role: the built-in Qwen brain's lane model, except a vision
 * purpose, which uses the brain's vision model (model-runtime-wiring withBrainQwenModels).
 */
function builtinRoleModels(brain: BrainEntry): Readonly<Record<ModelRole, string>> {
  const table = {} as Record<ModelRole, string>;
  for (const role of MODEL_ROLES) {
    const binding = MODEL_ROLE_LEGACY_BINDINGS[role];
    const model =
      binding.purpose === 'vision'
        ? (brainLaneModel(brain, 'vision') ?? brainLaneModel(brain, binding.lane))
        : brainLaneModel(brain, binding.lane);
    if (!model) throw new Error(`built-in Qwen brain has no model for role ${role}`);
    table[role] = model;
  }
  return Object.freeze(table);
}

function builtinQwenBrain(): BrainEntry {
  const brain = BUILTIN_MODEL_CATALOG.find((entry) => entry.provider === 'alibaba-model-studio');
  if (!brain) throw new Error('built-in model catalog has no Qwen brain');
  return brain;
}

const BUILTIN_ROLE_MODELS = builtinRoleModels(builtinQwenBrain());

/** cn is all Qwen today; intl points at the same Qwen models for now. */
export const DEFAULT_ROLE_MODELS: RoleModelTable = Object.freeze({
  cn: BUILTIN_ROLE_MODELS,
  intl: BUILTIN_ROLE_MODELS,
});

/** The default model of a role, for paths that must keep today's model with the gateway off. */
export function defaultRoleModel(role: ModelRole, region: ModelDataRegion = 'cn'): string {
  return DEFAULT_ROLE_MODELS[region][role];
}

const configLog = pino({
  level: 'warn',
  base: { service: 'orchestrator' },
  timestamp: pino.stdTimeFunctions.isoTime,
});
export type RoleModelWarn = (message: string) => void;
const defaultWarn: RoleModelWarn = (message) =>
  configLog.warn({ event: 'llm.gateway.config' }, message);

/**
 * Applies `LLM_GATEWAY_ROLE_MODELS` (JSON, e.g. `{"cn":{"judge":"qwen3.8-flash"}}`) on top of the
 * defaults. Unknown regions/roles, non-Qwen names and malformed JSON are ignored with a warning;
 * a bad override never stops the process.
 */
export function parseRoleModelOverrides(
  raw: string | undefined,
  warn: RoleModelWarn = defaultWarn,
): RoleModelTable {
  const text = raw?.trim();
  if (!text) return DEFAULT_ROLE_MODELS;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    warn('LLM_GATEWAY_ROLE_MODELS is not valid JSON; using the default role models');
    return DEFAULT_ROLE_MODELS;
  }
  if (!isRecord(parsed)) {
    warn(
      'LLM_GATEWAY_ROLE_MODELS must be an object keyed by region; using the default role models',
    );
    return DEFAULT_ROLE_MODELS;
  }
  const next = {
    cn: { ...DEFAULT_ROLE_MODELS.cn },
    intl: { ...DEFAULT_ROLE_MODELS.intl },
  };
  for (const [region, roles] of Object.entries(parsed)) {
    if (region !== 'cn' && region !== 'intl') {
      warn(`LLM_GATEWAY_ROLE_MODELS: unknown region "${safeLabel(region)}" ignored`);
      continue;
    }
    if (!isRecord(roles)) {
      warn(`LLM_GATEWAY_ROLE_MODELS: region "${region}" must map roles to model names; ignored`);
      continue;
    }
    for (const [role, model] of Object.entries(roles)) {
      if (!isModelRole(role)) {
        warn(`LLM_GATEWAY_ROLE_MODELS: unknown role "${safeLabel(role)}" in ${region} ignored`);
        continue;
      }
      if (typeof model !== 'string' || !QWEN_MODEL_NAME.test(model.trim())) {
        warn(`LLM_GATEWAY_ROLE_MODELS: ${region}.${role} must be a Qwen model name; ignored`);
        continue;
      }
      next[region][role] = model.trim();
    }
  }
  return Object.freeze({ cn: Object.freeze(next.cn), intl: Object.freeze(next.intl) });
}

let memo: { raw: string; table: RoleModelTable } | undefined;

/** Parsed once per distinct env value, so a bad override warns once, not on every call. */
export function roleModelTable(raw: string | undefined): RoleModelTable {
  const key = raw ?? '';
  if (memo?.raw !== key) memo = { raw: key, table: parseRoleModelOverrides(raw) };
  return memo.table;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeLabel(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, '?').slice(0, 40);
}
