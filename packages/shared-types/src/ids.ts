import { customAlphabet } from 'nanoid';

// NanoID alphabet: URL-safe, no lookalikes (we keep full default alphabet for 21-char ids).
const NANOID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const nano21 = customAlphabet(NANOID_ALPHABET, 21);

export const ID_PREFIXES = {
  user: 'usr',
  userProfile: 'prf',
  task: 'tsk',
  taskStep: 'stp',
  taskEvent: 'evt',
  skill: 'skl',
  session: 'sess',
  llmCall: 'llm',
  payment: 'pay',
  verificationCode: 'vc',
  file: 'file',
  memory: 'mem',
  // Phase 16 — user-owned task grouping.
  project: 'prj',
  // Phase 16b — scheduled task triggers (cron-style).
  scheduledTask: 'sch',
  // Phase 5b — batch tasks (a list of prompts run together) + per-item rows.
  batch: 'btc',
  batchItem: 'bti',
  plannedTask: 'pln',
  plannedTaskItem: 'pli',
  plannedTaskOverride: 'plo',
  plannedTaskRun: 'plr',
  plannedTaskRunItem: 'pri',
  // Phase 5d — user-scoped API keys (webhook / external-trigger bearer).
  apiKey: 'ak',
  // Phase 26B — per-user inbox row + external webhook channel.
  notification: 'nfn',
  notificationChannel: 'nch',
  // Phase 1 #3 — Site Playbook + Evidence Ledger (storage foundation).
  // operation_path_steps and claim_evidence_links have no external_id
  // (addressed by composite/internal keys), so they get no prefix.
  site: 'site',
  siteCapability: 'cap',
  operationPath: 'opath',
  explorationRun: 'exr',
  evidenceArtifact: 'art',
  claim: 'clm',
  canaryResult: 'cnr',
  // Phase 1 Playbook B2 — per-action capture row. NB: 'cap' is already
  // taken by siteCapability, so this uses 'tac' (task-action-capture) to
  // keep external-id prefixes collision-free for isExternalId().
  taskActionCapture: 'tac',
  // Phase 1 #2 — A股自选股 (watchlist row).
  watchlist: 'wl',
  // Deterministic stock-risk monitor linked one-to-one with a planned task.
  stockRiskMonitor: 'srm',
} as const;

export type IdKind = keyof typeof ID_PREFIXES;

export function newExternalId(kind: IdKind): string {
  return `${ID_PREFIXES[kind]}_${nano21()}`;
}

export function isExternalId(value: string, kind: IdKind): boolean {
  return (
    value.startsWith(`${ID_PREFIXES[kind]}_`) && value.length === ID_PREFIXES[kind].length + 1 + 21
  );
}
