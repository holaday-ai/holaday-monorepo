export {
  runSupercarTask,
  supercarReply,
  supercarAbort,
  supercarHandoffToGenerate,
  supercarHandleOriginalIntent,
  type SupercarOutcome,
  type SupercarStatus,
  type SupercarTickEvent,
  type SupercarScreencastEvent,
  type SupercarWebSearchEvent,
  type SupercarAwaitingUserEvent,
  type RunSupercarOptions,
} from './agent-loop.js';
export { buildSupercarSystemPrompt, SUPERCAR_CORE_PROMPT } from './system-prompt.js';
export { matchRole, matchRoleWithDebug } from './role-matcher.js';
export { ROLES, type AgentRole } from './roles/index.js';
export {
  createExecutionRouter,
  classifyAsSimpleSearch,
  classifyAsCrossPlatformAutomation,
  type ExecutionRouter,
  type ExecutionRouterDeps,
  type LaneId,
  type LaneStatus,
  type TaskSignals,
} from './execution-router.js';
export {
  createZapierAdapter,
  type ZapierAdapter,
  type ZapierTriggerResult,
} from './adapters/zapier.js';
export {
  createApifyAdapter,
  type ApifyAdapter,
  type ApifyActorMatch,
} from './adapters/apify.js';
