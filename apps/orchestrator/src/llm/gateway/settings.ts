import { type RoleModelTable, roleModelTable } from './role-models.js';

/** The two environment keys the gateway reads (config/env.ts parses them). */
export interface ModelGatewayEnvironment {
  /** REBUILD-2 unified model gateway. Off (default) = every call takes its legacy path. */
  LLM_GATEWAY_V2?: boolean;
  /** JSON role-model overrides per region, e.g. `{"cn":{"judge":"qwen3.8-flash"}}`. */
  LLM_GATEWAY_ROLE_MODELS?: string;
}

export interface ModelGatewaySettings {
  readonly enabled: boolean;
  /** Parsed lazily, so an override is never even read while the gateway is off. */
  roleModels(): RoleModelTable;
}

export const MODEL_GATEWAY_OFF: ModelGatewaySettings = Object.freeze({
  enabled: false,
  roleModels: () => roleModelTable(undefined),
});

export function modelGatewaySettings(environment: ModelGatewayEnvironment): ModelGatewaySettings {
  if (environment.LLM_GATEWAY_V2 !== true) return MODEL_GATEWAY_OFF;
  const raw = environment.LLM_GATEWAY_ROLE_MODELS;
  return Object.freeze({ enabled: true, roleModels: () => roleModelTable(raw) });
}
