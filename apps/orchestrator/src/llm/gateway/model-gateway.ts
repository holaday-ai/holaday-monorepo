import {
  type CoreModelGatewayHook,
  type CoreModelRuntimeEnvironment,
  type CoreModelRuntimeInput,
  type CoreModelRuntimeUnavailableReason,
  resolveCoreModelRuntime,
} from '../core-model-runtime.js';
import type { MessagesAdapter } from '../messages-adapter.js';
import type { BrainEntry, BrainProvider } from '../model-catalog.js';
import type { ModelDataRegionOwnershipInput } from '../model-data-region.js';
import type { CoreModelLane } from '../model-runtime-policy.js';
import type {
  ModelTaskUnavailableReason,
  ProductionModelRuntimeWiring,
} from '../model-runtime-wiring.js';
import type { QwenPurpose } from '../qwen-route.js';
import type { ResponsesAdapter } from '../responses-adapter.js';
import {
  type LegacyModelBinding,
  type ModelRole,
  type ModelRoleRef,
  baseModelRole,
  legacyModelBinding,
  modelRoleCallPurpose,
  roleForLanePurpose,
} from './model-roles.js';
import { normalizeMessagesAdapter } from './normalize.js';
import {
  MODEL_GATEWAY_OFF,
  type ModelGatewayEnvironment,
  type ModelGatewaySettings,
  modelGatewaySettings,
} from './settings.js';

/**
 * REBUILD-2 — the one entry business code uses to reach a chat model: ask by role.
 *
 *   LLM_GATEWAY_V2 off (default): the role's legacy lane/purpose is resolved through exactly the
 *   path the call site used before (catalog wiring, or the direct core runtime for the three call
 *   sites that bypassed the wiring). Same arguments, same adapters, nothing wrapped.
 *
 *   LLM_GATEWAY_V2 on: the Qwen model comes from the role-model table for the task's region,
 *   built through the same wiring/transport (non-Qwen catalog brains and explicit browser-brain
 *   selections keep their models), messages adapters are normalised (normalize.ts), and core
 *   calls are recorded in llm_calls as `role:<role>`.
 */

export interface ModelGatewayContext {
  actorExternalId: string;
  ownership: ModelDataRegionOwnershipInput;
  /** Explicit brain; otherwise the task's bound brain, otherwise the catalog default. */
  brain?: BrainEntry;
}

export type ModelGatewayRuntime =
  | {
      kind: 'ready';
      brainId: string;
      provider: BrainProvider;
      region: 'cn' | 'intl' | null;
      /** The role this runtime was resolved for, or another role ref of the same lane. */
      messages(role?: ModelRoleRef): MessagesAdapter;
      responses(role?: ModelRoleRef): ResponsesAdapter;
    }
  | { kind: 'unavailable'; reasonCode: ModelTaskUnavailableReason };

export type ModelGatewayAdapter<Adapter> =
  | {
      kind: 'ready';
      adapter: Adapter;
      brainId: string;
      provider: BrainProvider;
      region: 'cn' | 'intl' | null;
    }
  | { kind: 'unavailable'; reasonCode: ModelTaskUnavailableReason };

export interface ModelGateway {
  readonly enabled: boolean;
  resolve(role: ModelRoleRef, context: ModelGatewayContext): ModelGatewayRuntime;
  messages(role: ModelRoleRef, context: ModelGatewayContext): ModelGatewayAdapter<MessagesAdapter>;
  responses(
    role: ModelRoleRef,
    context: ModelGatewayContext,
  ): ModelGatewayAdapter<ResponsesAdapter>;
}

/** Direct core-runtime deps: the path plan-provider / suggestions-provider / video editing used. */
export interface CoreModelGatewayDeps
  extends Pick<CoreModelRuntimeInput, 'createMessages' | 'createResponses' | 'observe' | 'now'> {
  environment: CoreModelRuntimeEnvironment & ModelGatewayEnvironment;
}

export interface CoreModelGatewayContext {
  actorExternalId: string;
  ownership: ModelDataRegionOwnershipInput;
  /**
   * The caller already put an explicitly selected model into `environment` (browser-brain
   * planning selection). With the gateway on it keeps that model instead of the role model.
   */
  modelPinned?: boolean;
}

export type CoreModelGatewayRuntime =
  | {
      kind: 'ready';
      region: 'cn' | 'intl';
      messages(role?: ModelRoleRef): MessagesAdapter;
      responses(role?: ModelRoleRef): ResponsesAdapter;
    }
  | { kind: 'unavailable'; reason: CoreModelRuntimeUnavailableReason };

export interface CoreModelGateway {
  readonly enabled: boolean;
  resolve(role: ModelRoleRef, context: CoreModelGatewayContext): CoreModelGatewayRuntime;
}

export function modelGateway(deps: { wiring: ProductionModelRuntimeWiring }): ModelGateway;
export function modelGateway(deps: { core: CoreModelGatewayDeps }): CoreModelGateway;
export function modelGateway(
  deps: { wiring: ProductionModelRuntimeWiring } | { core: CoreModelGatewayDeps },
): ModelGateway | CoreModelGateway {
  return 'wiring' in deps ? wiringGateway(deps.wiring) : coreGateway(deps.core);
}

function wiringGateway(wiring: ProductionModelRuntimeWiring): ModelGateway {
  const settings = wiring.gateway ?? MODEL_GATEWAY_OFF;
  const resolve = (role: ModelRoleRef, context: ModelGatewayContext): ModelGatewayRuntime => {
    const binding = legacyModelBinding(role);
    const resolution = wiring.resolveCore({
      actorExternalId: context.actorExternalId,
      lane: binding.lane,
      ownership: context.ownership,
      ...(context.brain ? { brain: context.brain } : {}),
      ...(settings.enabled ? { gateway: gatewayHook(settings, role, binding.lane, false) } : {}),
    });
    if (resolution.kind === 'unavailable') return resolution;
    const purposeOf = lanePurpose(role, binding);
    return {
      kind: 'ready',
      brainId: resolution.brainId,
      provider: resolution.provider,
      region: resolution.region,
      messages: settings.enabled
        ? (ref) =>
            normalizeMessagesAdapter(
              resolution.messages(purposeOf(ref)),
              baseModelRole(ref ?? role),
            )
        : (ref) => resolution.messages(purposeOf(ref)),
      responses: (ref) => resolution.responses(purposeOf(ref)),
    };
  };
  return {
    enabled: settings.enabled,
    resolve,
    messages(role, context) {
      const runtime = resolve(role, context);
      if (runtime.kind === 'unavailable') return runtime;
      const { messages: _m, responses: _r, ...identity } = runtime;
      return { ...identity, adapter: runtime.messages() };
    },
    responses(role, context) {
      const runtime = resolve(role, context);
      if (runtime.kind === 'unavailable') return runtime;
      const { messages: _m, responses: _r, ...identity } = runtime;
      return { ...identity, adapter: runtime.responses() };
    },
  };
}

function coreGateway(deps: CoreModelGatewayDeps): CoreModelGateway {
  const settings = modelGatewaySettings(deps.environment);
  return {
    enabled: settings.enabled,
    resolve(role, context) {
      const binding = legacyModelBinding(role);
      const runtime = resolveCoreModelRuntime({
        environment: deps.environment,
        actorExternalId: context.actorExternalId,
        lane: binding.lane,
        ownership: context.ownership,
        ...(deps.createMessages ? { createMessages: deps.createMessages } : {}),
        ...(deps.createResponses ? { createResponses: deps.createResponses } : {}),
        ...(deps.observe ? { observe: deps.observe } : {}),
        ...(deps.now ? { now: deps.now } : {}),
        ...(settings.enabled
          ? { gateway: gatewayHook(settings, role, binding.lane, context.modelPinned === true) }
          : {}),
      });
      if (runtime.kind === 'unavailable') return runtime;
      const purposeOf = lanePurpose(role, binding);
      return {
        kind: 'ready',
        region: runtime.region,
        messages: settings.enabled
          ? (ref) =>
              normalizeMessagesAdapter(runtime.messages(purposeOf(ref)), baseModelRole(ref ?? role))
          : (ref) => runtime.messages(purposeOf(ref)),
        responses: (ref) => runtime.responses(purposeOf(ref)),
      };
    },
  };
}

/** A runtime hands out adapters for its own role or another role ref on the same lane. */
function lanePurpose(
  resolved: ModelRoleRef,
  binding: LegacyModelBinding,
): (ref?: ModelRoleRef) => QwenPurpose {
  return (ref) => {
    if (ref === undefined || ref === resolved) return binding.purpose;
    const other = legacyModelBinding(ref);
    if (other.lane !== binding.lane) {
      throw new Error(`model role ${ref} is not served by the ${binding.lane} lane (${resolved})`);
    }
    return other.purpose;
  };
}

function gatewayHook(
  settings: ModelGatewaySettings,
  resolved: ModelRoleRef,
  lane: CoreModelLane,
  modelPinned: boolean,
): CoreModelGatewayHook {
  const table = settings.roleModels();
  const roleOf = (purpose: QwenPurpose): ModelRole =>
    roleForLanePurpose(lane, purpose) ?? baseModelRole(resolved);
  return {
    modelFor: (region, purpose) => (modelPinned ? null : table[region][roleOf(purpose)]),
    callPurposeFor: (purpose) => modelRoleCallPurpose(roleOf(purpose)),
  };
}
