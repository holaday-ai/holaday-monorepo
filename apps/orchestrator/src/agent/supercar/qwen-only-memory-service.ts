/**
 * Batch 06 — the former read-only Qwen memory surface is now the full
 * `memory-service.ts` (read + Qwen-runtime extraction + delete). Kept as a
 * re-export so existing imports (tasks.ts) keep compiling unchanged.
 */
export { MemoryService } from './memory-service.js';
